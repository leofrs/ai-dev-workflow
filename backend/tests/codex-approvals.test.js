import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  approvePlanAndStartBlock2,
  decideCliApproval,
  getWorkflowState,
  startBlock1,
  stopWorkflow,
  subscribeWorkflowStream
} from '../orchestrator.js';

function fakeCodex() {
  const assert = require('node:assert/strict');
  const { createReadStream, writeSync } = require('node:fs');
  const { createInterface } = require('node:readline');
  if (process.argv[2] !== 'app-server') {
    assert.deepEqual(process.argv.slice(2, 7), ['--ask-for-approval', 'never', 'exec', '--sandbox', 'read-only']);
    writeSync(1, '# Triagem\n\n## 8. Conclusão da Triagem\n- Prontidão para planejamento: Apto\n- Justificativa: Tarefa definida.\n');
    return;
  }

  const threadId = `thread-${process.pid}`;
  const turnId = 'turn-1';
  const requestId = 9;
  const send = (message) => writeSync(1, `${JSON.stringify(message)}\n`);
  const notify = (method, params) => send({ method, params: { threadId, turnId, ...params } });
  let stage;

  function startTurn(message) {
    const { text } = message.params.input[0];
    assert.equal(message.params.threadId, threadId);
    stage = text.match(/^Você é o Subagente Isolado de ([A-Z ]+?) (?:acionado|\(Rodada)/)[1];
    send({ id: message.id, result: { turn: { id: turnId } } });

    const context = { threadId, turnId, itemId: 'action-1', reason: 'Validar dependências' };
    if (stage === 'TESTES') {
      send({
        id: requestId,
        method: 'item/commandExecution/requestApproval',
        params: { ...context, networkApprovalContext: { host: 'example.test', protocol: 'https' } }
      });
    } else if (stage === 'CODE REVIEW') {
      send({
        id: requestId,
        method: 'item/permissions/requestApproval',
        params: { ...context, permissions: { network: { enabled: true } } }
      });
    } else if (stage === 'DESENVOLVIMENTO') {
      notify('item/started', { item: { id: context.itemId, type: 'fileChange', changes: [{ path: 'example.txt' }] } });
      send({ id: requestId, method: 'item/fileChange/requestApproval', params: context });
    } else {
      notify('item/started', {
        item: { id: context.itemId, type: 'commandExecution', command: 'npm test', cwd: process.cwd() }
      });
      send({ id: requestId, method: 'item/commandExecution/requestApproval', params: context });
    }
  }

  function completeTurn(response) {
    let text;
    switch (stage) {
      case 'PLANEJAMENTO':
        assert.ok(['accept', 'decline'].includes(response.decision));
        text = JSON.stringify({ summary: response.decision, phases: [{ id: 'phase-1', subtasks: [{ id: 'task-1' }] }] });
        break;
      case 'DESENVOLVIMENTO':
        assert.deepEqual(response, { decision: 'accept' });
        text = '# Desenvolvimento concluído';
        break;
      case 'TESTES':
        assert.deepEqual(response, { decision: 'accept' });
        text = JSON.stringify({ passed: true, summary: 'Testes concluídos' });
        break;
      case 'CODE REVIEW':
        assert.deepEqual(response, { permissions: {}, scope: 'turn' });
        text = JSON.stringify({ verdict: 'ready_for_github', summary: 'Revisão concluída' });
        break;
    }

    notify('serverRequest/resolved', { requestId });
    notify('item/agentMessage/delta', { delta: text });
    notify('item/completed', { item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text } });
    notify('item/completed', { item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Progresso' } });
    notify('turn/completed', { turn: { id: turnId, status: 'completed' } });
  }

  createInterface({ input: createReadStream(null, { fd: 0 }) }).on('line', (line) => {
    const message = JSON.parse(line);
    switch (message.method) {
      case 'initialize':
        send({ id: message.id, result: {} });
        break;
      case 'thread/start':
        assert.equal(message.params.cwd, process.cwd());
        assert.equal(message.params.ephemeral, true);
        assert.equal(message.params.approvalPolicy, 'on-request');
        assert.equal(message.params.approvalsReviewer, 'user');
        assert.equal(message.params.sandbox, 'workspace-write');
        send({ id: message.id, result: { thread: { id: threadId } } });
        break;
      case 'turn/start':
        startTurn(message);
        break;
      default:
        if (message.id === requestId) completeTurn(message.result);
    }
  });
}

async function createWorkflows(t, ...workflowIds) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'workflow-codex-')));
  t.after(async () => {
    for (const id of workflowIds) stopWorkflow(id);
    await rm(directory, { recursive: true, force: true });
  });
  const cliCommand = path.join(directory, 'codex');
  await writeFile(cliCommand, `#!${process.execPath}\n(${fakeCodex.toString()})();\n`, { mode: 0o755 });

  return Promise.all(workflowIds.map(async (workflowId) => {
    const worktreePath = path.join(directory, workflowId);
    await mkdir(worktreePath);
    return { workflowId, worktreePath, cliCommand, problemDescription: 'Validar aprovações' };
  }));
}

async function waitForState(workflow, predicate) {
  for (let i = 0; i < 200; i++) {
    const state = getWorkflowState(workflow.workflowId, workflow.worktreePath);
    assert.notEqual(state.status, 'failed', state.error);
    if (predicate(state)) return state;
    await delay(15);
  }
  assert.fail(`Estado esperado não recebido em ${workflow.workflowId}`);
}

const pendingApproval = (workflow) => waitForState(workflow, (state) => state.pendingApprovals.length > 0);

test('encaminha a decisão somente à execução que solicitou e produz o artefato final', { skip: process.platform === 'win32' }, async (t) => {
  const [first, second] = await createWorkflows(t, 'first', 'second');
  startBlock1(first);
  startBlock1(second);
  const [firstState, secondState] = await Promise.all([pendingApproval(first), pendingApproval(second)]);
  const [approval] = firstState.pendingApprovals;
  assert.equal(firstState.activeAgent, 'planning');
  assert.equal(approval.command, 'npm test');
  assert.equal(approval.cwd, first.worktreePath);
  assert.equal(approval.reason, 'Validar dependências');
  assert.notEqual(approval.id, secondState.pendingApprovals[0].id);
  assert.equal(decideCliApproval(second.workflowId, approval.id, 'approve'), false);

  const stream = new EventEmitter();
  stream.writeHead = () => {};
  const updates = [];
  stream.write = (event) => updates.push(event);
  subscribeWorkflowStream(first.workflowId, first.worktreePath, stream);
  t.after(() => stream.emit('close'));
  assert.match(updates[0], new RegExp(approval.id));
  stream.emit('close');
  const diskState = await readFile(path.join(first.worktreePath, '.workflow', 'state.json'), 'utf8');
  assert.equal(JSON.parse(diskState).pendingApprovals, undefined);

  assert.equal(decideCliApproval(first.workflowId, approval.id, 'approve'), true);
  assert.equal(decideCliApproval(first.workflowId, approval.id, 'deny'), false);
  assert.equal(decideCliApproval(second.workflowId, secondState.pendingApprovals[0].id, 'deny'), true);

  for (const [workflow, decision] of [[first, 'accept'], [second, 'decline']]) {
    const state = await waitForState(workflow, (snapshot) => snapshot.status === 'awaiting_plan_approval');
    assert.deepEqual(state.pendingApprovals, []);
    const plan = JSON.parse(await readFile(state.planArtifactPath, 'utf8'));
    assert.equal(plan.summary, decision);
  }

  approvePlanAndStartBlock2(first);
  const dev = await pendingApproval(first);
  assert.equal(dev.activeAgent, 'development');
  assert.deepEqual(dev.pendingApprovals[0].paths, ['example.txt']);
  assert.equal(decideCliApproval(first.workflowId, dev.pendingApprovals[0].id, 'approve'), true);

  const testing = await pendingApproval(first);
  assert.equal(testing.activeAgent, 'testing');
  assert.deepEqual(testing.pendingApprovals[0].network, { host: 'example.test', protocol: 'https' });
  assert.equal(decideCliApproval(first.workflowId, testing.pendingApprovals[0].id, 'approve'), true);

  const review = await pendingApproval(first);
  assert.equal(review.activeAgent, 'code_review');
  assert.equal(review.pendingApprovals[0].kind, 'permissions');
  assert.equal(decideCliApproval(first.workflowId, review.pendingApprovals[0].id, 'deny'), true);

  const done = await waitForState(first, (snapshot) => snapshot.status === 'ready_for_github');
  assert.deepEqual(done.pendingApprovals, []);
  assert.equal(done.plan.phases[0].subtasks[0].status, 'passed');
  assert.equal(done.reviewRounds[0].summary, 'Revisão concluída');
});

test('invalida o pedido quando o usuário pausa e inicia outra execução', { skip: process.platform === 'win32' }, async (t) => {
  const [workflow] = await createWorkflows(t, 'restart');
  startBlock1(workflow);
  const initial = await pendingApproval(workflow);
  const [{ id: expiredId }] = initial.pendingApprovals;
  stopWorkflow(workflow.workflowId);
  const paused = await waitForState(workflow, (state) => state.status === 'paused');
  assert.deepEqual(paused.pendingApprovals, []);
  assert.equal(decideCliApproval(workflow.workflowId, expiredId, 'approve'), false);

  startBlock1(workflow);
  const restarted = await pendingApproval(workflow);
  const [{ id }] = restarted.pendingApprovals;
  assert.notEqual(id, expiredId);
  assert.equal(decideCliApproval(workflow.workflowId, expiredId, 'approve'), false);
  assert.equal(decideCliApproval(workflow.workflowId, id, 'deny'), true);
  await waitForState(workflow, (state) => state.status === 'awaiting_plan_approval');
});
