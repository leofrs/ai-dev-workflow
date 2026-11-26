import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const INITIALIZE = 1;
const START_THREAD = 2;
const START_TURN = 3;

function describeApproval(method, params, item) {
  const context = { reason: params.reason, cwd: params.cwd ?? item?.cwd };

  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const network = params.networkApprovalContext;
      return {
        ...context,
        kind: network ? 'network' : 'command',
        command: network ? undefined : params.command ?? item?.command,
        network: network ?? undefined,
        permissions: params.additionalPermissions,
        canApprove: !params.availableDecisions || params.availableDecisions.includes('accept')
      };
    }
    case 'item/fileChange/requestApproval':
      return {
        ...context,
        kind: 'file_change',
        paths: item?.changes?.map((change) => change.path),
        grantRoot: params.grantRoot,
        canApprove: true
      };
    case 'item/permissions/requestApproval':
      return { ...context, kind: 'permissions', permissions: params.permissions, canApprove: true };
    default:
      return null;
  }
}

function exitError(stderr, code) {
  const detail = stderr.trim().slice(-1500);
  return new Error(`O Codex App Server encerrou antes de concluir a etapa (código ${code ?? 'indisponível'}).${detail ? `\n${detail}` : ''}`);
}

export function startCodexSubagent({ cliCommand, worktreePath, prompt, signal, onLog, onApprovalsChange }) {
  const child = spawn(cliCommand, ['app-server'], {
    cwd: worktreePath,
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pendingApprovals = new Map();
  const items = new Map();
  let threadId;
  let turnId;
  let stdout = '';
  let finalAnswer = '';
  let stderr = '';
  let closing = false;
  let completed = false;
  let failure;
  let shutdownTimer;

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

  function clearApprovals() {
    if (pendingApprovals.size === 0) return;
    pendingApprovals.clear();
    onApprovalsChange();
  }

  const startupTimer = setTimeout(() => {
    finish(new Error('O Codex App Server não iniciou a etapa a tempo. Consulte o log do CLI.'));
  }, 45000);

  function finish(error) {
    if (closing) return;
    closing = true;
    failure = error;
    clearTimeout(startupTimer);
    clearApprovals();
    child.stdin.end();
    if (error) child.kill('SIGTERM');
    shutdownTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
  }

  function receiveResponse(message) {
    if (message.error) {
      finish(new Error(`O Codex App Server recusou a inicialização da etapa. ${message.error.message}`));
      return;
    }

    switch (message.id) {
      case INITIALIZE:
        send({ method: 'initialized', params: {} });
        send({
          id: START_THREAD,
          method: 'thread/start',
          params: {
            cwd: worktreePath,
            ephemeral: true,
            sandbox: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user'
          }
        });
        break;
      case START_THREAD:
        threadId = message.result.thread.id;
        send({
          id: START_TURN,
          method: 'turn/start',
          params: { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }] }
        });
        break;
      case START_TURN:
        turnId = message.result.turn.id;
        clearTimeout(startupTimer);
        break;
    }
  }

  function receiveRequest({ id, method, params }) {
    const belongsToTurn = threadId && params?.threadId === threadId && (!turnId || params.turnId === turnId);
    const details = belongsToTurn && describeApproval(method, params, items.get(params.itemId));
    if (!details) {
      send({ id, error: { code: -32601, message: 'Solicitação do Codex incompatível com esta execução.' } });
      return;
    }
    if (pendingApprovals.has(id)) return;

    pendingApprovals.set(id, { id: randomUUID(), ...details });
    onApprovalsChange();
  }

  function receiveNotification(method, params) {
    if (!threadId || params?.threadId !== threadId) return;
    const notificationTurnId = params.turnId ?? params.turn?.id;
    if (turnId && notificationTurnId && notificationTurnId !== turnId) return;

    switch (method) {
      case 'turn/started':
        turnId = params.turn.id;
        clearTimeout(startupTimer);
        break;
      case 'item/started':
        if (['commandExecution', 'fileChange'].includes(params.item.type)) {
          items.set(params.item.id, params.item);
        }
        break;
      case 'item/agentMessage/delta':
      case 'item/commandExecution/outputDelta':
      case 'item/reasoning/summaryTextDelta':
        onLog(params.delta);
        break;
      case 'item/completed': {
        const { item } = params;
        items.delete(item.id);
        if (item.type === 'agentMessage' && item.phase !== 'commentary') {
          stdout = item.text;
          if (item.phase === 'final_answer') finalAnswer = item.text;
        }
        break;
      }
      case 'serverRequest/resolved':
        if (pendingApprovals.delete(params.requestId)) onApprovalsChange();
        break;
      case 'turn/completed':
        completed = params.turn.status === 'completed';
        finish(completed ? undefined : new Error(
          params.turn.error?.message || `O Codex encerrou a etapa com status ${params.turn.status}.`
        ));
        break;
    }
  }

  const onAbort = () => finish(new Error('Execução interrompida pelo usuário.'));
  const completion = new Promise((resolve, reject) => {
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => finish(error));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-24000);
      onLog(chunk);
    });

    lines.on('line', (line) => {
      if (closing || !line.trim()) return;
      try {
        const message = JSON.parse(line);
        if (message.method) {
          if (message.id === undefined) receiveNotification(message.method, message.params);
          else receiveRequest(message);
        } else {
          receiveResponse(message);
        }
      } catch (error) {
        finish(new Error(`Resposta inválida do Codex App Server. ${error.message}`));
      }
    });

    child.on('close', (code) => {
      closing = true;
      clearTimeout(startupTimer);
      clearTimeout(shutdownTimer);
      signal.removeEventListener('abort', onAbort);
      clearApprovals();
      if (signal.aborted) {
        return reject(Object.assign(new Error('Execução interrompida pelo usuário.'), { code: 'ABORTED' }));
      }
      if (failure || !completed) return reject(failure || exitError(stderr, code));

      const output = (finalAnswer || stdout).trim();
      resolve({ exitCode: 0, stdout: output, stderr: stderr.trim(), combinedOutput: output || stderr.trim() });
    });

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    send({
      id: INITIALIZE,
      method: 'initialize',
      params: { clientInfo: { name: 'ai_dev_workflow', title: 'AI Dev Workflow', version: '1.0.0' } }
    });
  });

  return {
    completion,
    getPendingApprovals: () => [...pendingApprovals.values()],
    decideApproval(approvalId, decision) {
      if (closing || signal.aborted || !child.stdin.writable) return false;
      if (decision !== 'approve' && decision !== 'deny') return false;
      for (const [requestId, approval] of pendingApprovals) {
        if (approval.id !== approvalId) continue;
        const approved = decision === 'approve';
        if (approved && !approval.canApprove) return false;

        const result = approval.kind === 'permissions'
          ? { permissions: approved ? approval.permissions : {}, scope: 'turn' }
          : { decision: approved ? 'accept' : 'decline' };
        send({ id: requestId, result });
        pendingApprovals.delete(requestId);
        onApprovalsChange();
        return true;
      }
      return false;
    }
  };
}
