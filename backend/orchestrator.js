import { spawn } from 'child_process';
import fs from 'fs';
import { devNull } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const MAX_SUBTASK_ATTEMPTS = 4;
const MAX_REVIEW_ROUNDS = 3;
const MAX_LIVE_LOG_CHARS = 24000;
const DEFAULT_TRIAGE_PROMPT = fs.readFileSync(new URL('./prompts/triage.md', import.meta.url), 'utf-8').trim();
const GEMINI_TRIAGE_POLICY = fileURLToPath(new URL('./prompts/gemini-triage.toml', import.meta.url));
const TRIAGE_READINESS = new Map([
  ['apto', 'ready'],
  ['apto com ressalvas', 'ready_with_caveats'],
  ['bloqueado', 'blocked']
]);

const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureWorkflowDirs(worktreePath) {
  const wfDir = path.join(worktreePath, '.workflow');
  fs.mkdirSync(path.join(wfDir, 'dev'), { recursive: true });
  fs.mkdirSync(path.join(wfDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(wfDir, 'review'), { recursive: true });
  return wfDir;
}

function getStateFilePath(worktreePath) {
  return path.join(worktreePath, '.workflow', 'state.json');
}

function createInitialState(workflowId, worktreePath) {
  return {
    workflowId,
    worktreePath,
    status: 'idle',
    activeBlock: 'block1_triage_planning',
    activeAgent: null,
    currentPhaseId: null,
    currentSubtaskId: null,
    reviewRound: 0,
    maxReviewRounds: MAX_REVIEW_ROUNDS,
    maxSubtaskAttempts: MAX_SUBTASK_ATTEMPTS,
    problemDescription: '',
    triageOutput: '',
    triageArtifactPath: null,
    triageConclusion: null,
    plan: null,
    planArtifactPath: null,
    reviewRounds: [],
    events: [],
    liveLog: '',
    error: null,
    updatedAt: nowIso()
  };
}

function loadStateFromDisk(workflowId, worktreePath) {
  if (!worktreePath) return null;
  const filePath = getStateFilePath(worktreePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...createInitialState(workflowId, worktreePath),
      ...parsed,
      workflowId,
      worktreePath
    };
  } catch {
    return null;
  }
}

function saveStateToDisk(state) {
  if (!state.worktreePath || !fs.existsSync(state.worktreePath)) return;
  try {
    ensureWorkflowDirs(state.worktreePath);
    fs.writeFileSync(getStateFilePath(state.worktreePath), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar state.json do orquestrador:', err.message);
  }
}

function getOrCreateSession(workflowId, worktreePath) {
  let session = sessions.get(workflowId);
  if (!session) {
    const diskState = loadStateFromDisk(workflowId, worktreePath);
    const state = diskState || createInitialState(workflowId, worktreePath || '');
    // Se o servidor reiniciou no meio de uma execução, marca como paused para evitar estado preso
    if (
      ['running_triage', 'running_planning', 'running_dev', 'running_tests', 'running_code_review'].includes(
        state.status
      )
    ) {
      state.status = 'paused';
      state.activeAgent = null;
    }
    session = {
      state,
      running: false,
      abortController: null,
      sseClients: new Set()
    };
    sessions.set(workflowId, session);
  } else if (worktreePath && !session.state.worktreePath) {
    session.state.worktreePath = worktreePath;
  }
  return session;
}

function broadcastState(session) {
  session.state.updatedAt = nowIso();
  saveStateToDisk(session.state);
  const payload = `event: state\ndata: ${JSON.stringify(session.state)}\n\n`;
  for (const res of session.sseClients) {
    try {
      res.write(payload);
    } catch {
      session.sseClients.delete(res);
    }
  }
}

function addEvent(session, { block, agent, level = 'info', message, artifactPath }) {
  const evt = {
    id: makeId('evt'),
    timestamp: nowIso(),
    block,
    agent,
    level,
    message,
    artifactPath
  };
  session.state.events = [...session.state.events.slice(-149), evt];
  broadcastState(session);
}

function appendLiveLog(session, chunk) {
  if (!chunk) return;
  const next = session.state.liveLog + chunk;
  session.state.liveLog =
    next.length > MAX_LIVE_LOG_CHARS ? next.slice(next.length - MAX_LIVE_LOG_CHARS) : next;

  const payload = `event: log\ndata: ${JSON.stringify({ chunk, liveLog: session.state.liveLog })}\n\n`;
  for (const res of session.sseClients) {
    try {
      res.write(payload);
    } catch {
      session.sseClients.delete(res);
    }
  }
}

function buildCliInvocation(cliCommand, prompt, readOnly) {
  const base = path.basename(cliCommand || '').toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
  if (base === 'claude') {
    const args = readOnly
      ? ['-p', prompt, '--permission-mode', 'plan', '--tools', 'Read,Glob,Grep']
      : ['-p', prompt, '--permission-mode', 'bypassPermissions'];
    return { bin: cliCommand, args };
  }
  if (base === 'codex') {
    const sandbox = readOnly ? 'read-only' : 'workspace-write';
    return { bin: cliCommand, args: ['--ask-for-approval', 'never', 'exec', '--sandbox', sandbox, prompt] };
  }
  if (base === 'gemini') {
    const args = readOnly
      ? ['-p', prompt, '--approval-mode', 'plan', '--policy', GEMINI_TRIAGE_POLICY]
      : ['-p', prompt, '--yolo'];
    return { bin: cliCommand, args };
  }
  if (base === 'agy' || base === 'antigravity') {
    const args = readOnly ? ['--mode', 'plan', '--sandbox', '-p', prompt] : ['-p', prompt];
    return { bin: cliCommand, args };
  }
  if (base === 'opencode') {
    return { bin: cliCommand, args: readOnly ? ['run', '--agent', 'plan', prompt] : ['run', prompt] };
  }
  if (base === 'aider') {
    const readOnlyArgs = readOnly
      ? [
          '--chat-mode', 'ask', '--dry-run', '--no-gitignore', '--no-auto-commits',
          '--skip-sanity-check-repo', '--no-pretty', '--input-history-file', devNull,
          '--chat-history-file', devNull
        ]
      : [];
    return { bin: cliCommand, args: [...readOnlyArgs, '--yes-always', '--message', prompt] };
  }
  return { bin: cliCommand, args: ['-p', prompt] };
}

/**
 * Executa um subagente completamente isolado via processo filho do CLI escolhido.
 * Nenhum histórico de conversa é compartilhado entre subagentes; apenas os artefatos em disco.
 */
function runIsolatedCliSubagent({ session, cliCommand, worktreePath, prompt, label, signal, readOnly = false }) {
  return new Promise((resolve, reject) => {
    const { bin, args } = buildCliInvocation(cliCommand, prompt, readOnly);
    appendLiveLog(
      session,
      `\n==================== [${label}] CLI isolado: ${bin} ====================\n`
    );

    let child;
    try {
      child = spawn(bin, args, {
        cwd: worktreePath,
        env: {
          ...process.env,
          CI: 'true',
          NO_COLOR: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (spawnErr) {
      return reject(new Error(`Falha ao iniciar CLI "${bin}": ${spawnErr.message}`));
    }

    // Fecha stdin para evitar que CLIs fiquem aguardando input interativo
    try {
      child.stdin.end();
    } catch {
      // Ignora
    }

    let stdout = '';
    let stderr = '';
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Já encerrado
          }
        }, 2000);
      } catch {
        // Ignora
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      stdout += text;
      appendLiveLog(session, text);
    });

    child.stderr.on('data', (text) => {
      stderr += text;
      appendLiveLog(session, text);
    });

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error(`Erro ao executar CLI "${bin}": ${err.message}`));
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      appendLiveLog(session, `\n--- [${label}] encerrado (código ${code}) ---\n`);
      if (aborted) {
        const abortErr = new Error('Execução interrompida pelo usuário.');
        abortErr.code = 'ABORTED';
        return reject(abortErr);
      }
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        combinedOutput: `${stdout}\n${stderr}`.trim()
      });
    });
  });
}

function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Tenta parse direto
  try {
    return JSON.parse(text.trim());
  } catch {
    // continua
  }

  // 2. Tenta blocos ```json ... ``` (do último para o primeiro)
  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fencedMatches.length - 1; i >= 0; i--) {
    const candidate = fencedMatches[i][1].trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // tenta próximo bloco
    }
  }

  // 3. Tenta extrair o maior objeto JSON balanceado do final do texto
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = lastBrace; i >= 0; i--) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '}') {
        depth++;
      } else if (ch === '{') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(i, lastBrace + 1);
          try {
            return JSON.parse(slice);
          } catch {
            // continua procurando
          }
        }
      }
    }
  }

  return null;
}

function readOrExtractJsonArtifact(artifactPath, fallbackStdout) {
  if (fs.existsSync(artifactPath)) {
    try {
      const content = fs.readFileSync(artifactPath, 'utf-8');
      const parsed = extractJsonFromText(content);
      if (parsed) return parsed;
    } catch {
      // fallback para stdout
    }
  }
  const fromStdout = extractJsonFromText(fallbackStdout);
  if (fromStdout) {
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(fromStdout, null, 2), 'utf-8');
    return fromStdout;
  }
  return null;
}

function readOrSaveMarkdownArtifact(artifactPath, fallbackStdout) {
  if (fs.existsSync(artifactPath)) {
    const content = fs.readFileSync(artifactPath, 'utf-8').trim();
    if (content) return content;
  }
  const content = (fallbackStdout || '').trim();
  if (content) {
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, content + '\n', 'utf-8');
  }
  return content;
}

function extractTriageMarkdown(stdout) {
  const fenced = stdout.match(/^(`{3,}|~{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]+)\r?\n\1$/i);
  const markdown = fenced ? fenced[2].trim() : stdout;
  const title = markdown.search(/^#[ \t]+Triagem\b/im);
  return title > 0 ? markdown.slice(title) : markdown;
}

function parseTriageConclusion(markdown) {
  const lines = markdown.replace(/<!--.*?(?:-->|$)/gs, '').split(/\r?\n/);
  const readinessValues = [];
  const justifications = [];
  const pendingLines = [];
  let section = '';
  let conclusionCount = 0;
  let fence = null;

  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker?.[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,2})[ \t]+(.+)$/);
    if (heading) {
      section = heading[1] === '##' ? heading[2].replace(/\s+#+$/, '').trim().toLowerCase() : '';
      if (section === '8. conclusão da triagem') conclusionCount++;
      continue;
    }
    if (section === '7. pendências e incertezas') pendingLines.push(line);
    if (section !== '8. conclusão da triagem') continue;

    const field = line.match(/^ {0,3}(?:[-+*][ \t]+)?(?:\*\*)?(Prontidão para planejamento|Justificativa)(?:\*\*:|:\*\*|:)[ \t]*(.*)$/i);
    if (field?.[1].toLowerCase() === 'prontidão para planejamento') {
      const value = field[2].trim().replace(/\.$/, '').replace(/^\*\*(.+)\*\*$/, '$1');
      readinessValues.push(value.replace(/[ \t]+/g, ' ').trim().toLowerCase());
    } else if (field) {
      justifications.push(field[2].trim());
    }
  }

  const readiness = TRIAGE_READINESS.get(readinessValues[0]);
  if (conclusionCount !== 1 || readinessValues.length !== 1 || !readiness) {
    throw new Error('Artefato de triagem inválido. Informe um único valor de prontidão na seção 8 (Apto, Apto com ressalvas ou Bloqueado) e refaça a triagem.');
  }
  if (justifications.length !== 1 || !justifications[0]) {
    throw new Error('Artefato de triagem inválido. A seção 8 precisa de uma justificativa para a prontidão. Refaça a triagem.');
  }

  return {
    id: makeId('triage'),
    readiness,
    justification: justifications[0],
    pendingDetails: pendingLines.join('\n').trim()
  };
}

function normalizeTestSteps(value) {
  const steps = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(steps)) return [];

  return steps.filter((step) => typeof step === 'string').map((step) => step.trim()).filter(Boolean);
}

function normalizePlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== 'object') {
    throw new Error(
      'O subagente de Planejamento não retornou um plano JSON estruturado com fases e subtarefas.'
    );
  }

  const rawPhases = rawPlan.phases || rawPlan.fases || [];
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
    throw new Error('O plano retornado não contém nenhuma fase.');
  }

  const phases = rawPhases.map((p, pIdx) => {
    const rawSubtasks = p.subtasks || p.subtarefas || p.tasks || [];
    const normalizedSubtasks =
      Array.isArray(rawSubtasks) && rawSubtasks.length > 0
        ? rawSubtasks.map((s, sIdx) => ({
            id: String(s.id || `phase-${pIdx + 1}-subtask-${sIdx + 1}`),
            order: sIdx + 1,
            title: String(s.title || s.titulo || `Subtarefa ${pIdx + 1}.${sIdx + 1}`),
            description: String(s.description || s.descricao || ''),
            acceptanceCriteria: Array.isArray(s.acceptanceCriteria || s.criteriosAceite)
              ? (s.acceptanceCriteria || s.criteriosAceite).map(String)
              : [],
            howToTest: normalizeTestSteps(s.howToTest ?? s.comoTestar),
            status: 'pending',
            attempts: 0,
            maxAttempts: MAX_SUBTASK_ATTEMPTS
          }))
        : [
            {
              id: `phase-${pIdx + 1}-subtask-1`,
              order: 1,
              title: String(p.title || p.titulo || `Executar Fase ${pIdx + 1}`),
              description: String(p.description || p.descricao || ''),
              acceptanceCriteria: [],
              howToTest: normalizeTestSteps(p.howToTest ?? p.comoTestar),
              status: 'pending',
              attempts: 0,
              maxAttempts: MAX_SUBTASK_ATTEMPTS
            }
          ];

    return {
      id: String(p.id || `phase-${pIdx + 1}`),
      order: pIdx + 1,
      title: String(p.title || p.titulo || `Fase ${pIdx + 1}`),
      description: String(p.description || p.descricao || ''),
      source: p.source === 'code_review' ? 'code_review' : 'plan',
      reviewRound: p.reviewRound,
      status: 'pending',
      subtasks: normalizedSubtasks
    };
  });

  return {
    summary: String(rawPlan.summary || rawPlan.resumo || 'Plano técnico estruturado em fases e subtarefas.'),
    phases
  };
}

function normalizeTestResult(raw, exitCode, combinedOutput) {
  if (raw && typeof raw === 'object') {
    const passed = Boolean(
      raw.passed === true || raw.aprovado === true || String(raw.status).toLowerCase() === 'passed'
    );
    const failures = Array.isArray(raw.failures || raw.falhas)
      ? (raw.failures || raw.falhas).map((f) => (typeof f === 'string' ? f : JSON.stringify(f)))
      : [];
    return {
      passed,
      summary: String(
        raw.summary || raw.resumo || (passed ? 'Testes aprovados sem regressões.' : 'Falha nos testes.')
      ),
      newTestsSummary: String(raw.newTestsSummary || raw.novosTestes || ''),
      regressionSummary: String(raw.regressionSummary || raw.regressao || ''),
      failures
    };
  }

  return {
    passed: false,
    summary:
      exitCode === 0
        ? 'O subagente de Testes não retornou o artefato JSON estruturado esperado.'
        : `O subagente de Testes falhou com código ${exitCode}.`,
    newTestsSummary: '',
    regressionSummary: '',
    failures: [combinedOutput.slice(-1500) || 'Sem saída capturada.']
  };
}

function normalizeReviewResult(raw, combinedOutput) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `O subagente de Code Review não retornou um veredito JSON válido. Saída final: ${combinedOutput.slice(-500)}`
    );
  }

  const rawVerdict = String(raw.verdict || raw.veredito || raw.status || '').toLowerCase();
  const isReady =
    rawVerdict === 'ready_for_github' ||
    rawVerdict === 'approved' ||
    rawVerdict === 'aprovado' ||
    raw.readyForGithub === true;

  const rawIssues = Array.isArray(raw.issues || raw.apontamentos) ? raw.issues || raw.apontamentos : [];
  const issues = rawIssues.map((iss, idx) => ({
    id: String(iss.id || `issue-${idx + 1}`),
    severity: ['critical', 'major', 'minor'].includes(String(iss.severity || '').toLowerCase())
      ? String(iss.severity).toLowerCase()
      : 'major',
    title: String(iss.title || iss.titulo || `Ajuste de Code Review #${idx + 1}`),
    description: String(iss.description || iss.descricao || ''),
    file: iss.file || iss.arquivo ? String(iss.file || iss.arquivo) : undefined,
    howToTest: normalizeTestSteps(iss.howToTest ?? iss.comoTestar)
  }));

  const verdict = isReady && issues.length === 0 ? 'ready_for_github' : isReady ? 'ready_for_github' : 'return_to_block2';

  return {
    verdict,
    summary: String(
      raw.summary ||
        raw.resumo ||
        (verdict === 'ready_for_github'
          ? 'Alterações revisadas e aprovadas. Pronto para enviar ao GitHub.'
          : 'Foram encontrados apontamentos que precisam ser corrigidos no Bloco 2.')
    ),
    issues
  };
}

// ======================= PROMPTS DOS SUBAGENTES ISOLADOS =======================

function buildTriagePrompt({ problemDescription, customPrompt }) {
  const customBlock = typeof customPrompt === 'string' && customPrompt.trim()
    ? `\n\n## Diretrizes complementares do projeto\n${customPrompt.trim()}`
    : '';

  return `${DEFAULT_TRIAGE_PROMPT}${customBlock}

## Execução da triagem na worktree

Mantenha o modo somente leitura durante toda a execução. O orquestrador salvará o artefato a partir da sua resposta final. Comece a resposta pelo título da triagem e siga a estrutura de saída definida no prompt padrão, inclusive quando houver diretrizes complementares.

Na seção 8, escreva a prontidão e a justificativa em linhas distintas, com os nomes dos campos do modelo. Escolha exatamente um valor para a prontidão.

- Apto quando as informações disponíveis forem suficientes para planejar.
- Apto com ressalvas quando as pendências puderem entrar no plano como premissas ou pontos de validação.
- Bloqueado quando faltar uma decisão ou informação que possa alterar o escopo, as regras de negócio ou a direção do plano.

## Descrição da tarefa

${problemDescription.trim()}`;
}

function buildPlanningPrompt({ triageArtifactPath, caveats, outputArtifactPath, customPrompt, previousPlanPath, feedback }) {
  const customBlock = customPrompt?.trim()
    ? `\n### Diretrizes personalizadas do projeto (Planejamento)\n${customPrompt.trim()}\n`
    : '';

  const replanBlock = previousPlanPath && feedback?.trim()
    ? `\n### Feedback humano para refazer o planejamento\nLeia o plano anterior em ${previousPlanPath} e ajuste conforme o feedback abaixo:\n${feedback.trim()}\n`
    : '';
  const caveatsBlock = caveats
    ? '\nA triagem foi liberada com ressalvas. Use a justificativa e as pendências do artefato para explicitar as premissas no resumo do plano e indicar os pontos de validação nas subtarefas pertinentes.\n'
    : '';

  return `Você é o Subagente Isolado de PLANEJAMENTO acionado pelo Orquestrador.
Você não possui histórico das etapas anteriores. Sua única entrada é o código da worktree e o artefato de triagem em: ${triageArtifactPath}
${customBlock}${replanBlock}${caveatsBlock}
### Tarefa
1. Leia o artefato ${triageArtifactPath} e inspecione os arquivos relevantes do repositório.
2. Crie um plano técnico sequencial dividido em FASES e, dentro de cada fase, SUBTAREFAS pequenas, ordenadas e testáveis individualmente. Derive os critérios de aceite do comportamento esperado e dos comportamentos a preservar descritos na triagem.
3. Preencha "howToTest" em cada subtarefa com passos reproduzíveis para verificar os critérios de aceite. Inclua a preparação necessária, os comandos ou ações e os resultados esperados.
4. NÃO implemente código nesta etapa — apenas gere o artefato de planejamento.

### Artefato obrigatório de saída
Salve um JSON válido exatamente em: ${outputArtifactPath}
E também inclua o mesmo JSON dentro de um bloco \`\`\`json ... \`\`\` na sua resposta final.

Schema obrigatório:
\`\`\`json
{
  "summary": "Resumo executivo do plano técnico",
  "phases": [
    {
      "id": "phase-1",
      "order": 1,
      "title": "Nome curto da Fase 1",
      "description": "Objetivo desta fase",
      "subtasks": [
        {
          "id": "phase-1-subtask-1",
          "order": 1,
          "title": "Nome curto da subtarefa",
          "description": "O que exatamente deve ser implementado nesta subtarefa e arquivos esperados",
          "acceptanceCriteria": ["Critério verificável 1", "Critério verificável 2"],
          "howToTest": ["Prepare os dados necessários", "Execute a ação ou o comando e confira o resultado esperado"]
        }
      ]
    }
  ]
}
\`\`\``;
}

function formatSubtaskVerification(subtask) {
  const criteria = subtask.acceptanceCriteria?.length
    ? subtask.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')
    : '- Atender à descrição da subtarefa sem quebrar funcionalidades existentes.';
  const testSteps = subtask.howToTest?.length
    ? subtask.howToTest.map((step, index) => `${index + 1}. ${step}`).join('\n')
    : 'Use a descrição e os critérios de aceite para definir os cenários de teste.';

  return `### Critérios de aceite
${criteria}

### Como testar
${testSteps}`;
}

function buildDevPrompt({
  triageArtifactPath,
  planArtifactPath,
  phase,
  subtask,
  attempt,
  previousTestArtifactPath,
  outputArtifactPath,
  customPrompt
}) {
  const customBlock = customPrompt?.trim()
    ? `\n### Diretrizes personalizadas do projeto (Desenvolvimento)\n${customPrompt.trim()}\n`
    : '';

  const retryBlock =
    attempt > 1 && previousTestArtifactPath
      ? `\n### ATENÇÃO — Tentativa ${attempt}/${MAX_SUBTASK_ATTEMPTS} (Correção de Falha nos Testes)
A tentativa anterior falhou na etapa de Testes. Leia obrigatoriamente o artefato de falha em: ${previousTestArtifactPath}
Corrija a causa raiz da falha apontada nos testes.\n`
      : '';

  return `Você é o Subagente Isolado de DESENVOLVIMENTO acionado pelo Orquestrador.
Você não possui histórico de conversas anteriores. Baseie-se apenas nos artefatos indicados e no código atual da worktree.
${customBlock}${retryBlock}
### Artefatos de entrada
- Triagem: ${triageArtifactPath}
- Plano completo: ${planArtifactPath}

### Fase atual
- Fase ${phase.order}: ${phase.title}
- Descrição da fase: ${phase.description}

### Subtarefa atual (implemente SOMENTE esta subtarefa)
- ID: ${subtask.id}
- Subtarefa ${subtask.order}: ${subtask.title}
- Descrição: ${subtask.description}

${formatSubtaskVerification(subtask)}

### Artefato obrigatório de saída
Após implementar as alterações no código da worktree, salve um resumo em Markdown em: ${outputArtifactPath}
Descreva quais arquivos foram criados/modificados e o que foi implementado.`;
}

function buildTestPrompt({
  phase,
  subtask,
  attempt,
  devArtifactPath,
  outputArtifactPath,
  customPrompt
}) {
  const customBlock = customPrompt?.trim()
    ? `\n### Diretrizes personalizadas do projeto (Testes)\n${customPrompt.trim()}\n`
    : '';

  return `Você é o Subagente Isolado de TESTES acionado pelo Orquestrador.
Você não possui histórico de conversas anteriores. Baseie-se apenas no artefato de desenvolvimento e no código atual da worktree.
${customBlock}
### Artefato de entrada
- Relatório do desenvolvimento desta subtarefa: ${devArtifactPath}

### Subtarefa implementada (Tentativa ${attempt}/${MAX_SUBTASK_ATTEMPTS})
- Fase ${phase.order}: ${phase.title}
- Subtarefa ${subtask.order}: ${subtask.title}
- Descrição: ${subtask.description}

${formatSubtaskVerification(subtask)}

### Obrigação dupla de testes
1. **Novos testes:** Use o roteiro acima para orientar os cenários. Escreva e execute testes automatizados cobrindo o que foi implementado nesta subtarefa.
2. **Regressão:** Execute também a suíte de testes/build já existente no projeto para garantir que nada que já funcionava foi quebrado.

### Artefato obrigatório de saída
Salve um JSON válido exatamente em: ${outputArtifactPath}
E também imprima o mesmo JSON dentro de um bloco \`\`\`json ... \`\`\` na sua resposta final.

Schema obrigatório:
\`\`\`json
{
  "passed": true,
  "summary": "Resumo objetivo do resultado dos testes",
  "newTestsSummary": "Quais testes novos foram criados/executados e o resultado",
  "regressionSummary": "Quais testes/builds existentes foram executados para validar regressão e o resultado",
  "failures": []
}
\`\`\`
Se qualquer teste novo, teste de regressão ou build falhar, defina "passed": false e detalhe os erros em "failures".`;
}

function buildCodeReviewPrompt({
  triageArtifactPath,
  planArtifactPath,
  reviewRound,
  outputArtifactPath,
  customPrompt
}) {
  const customBlock = customPrompt?.trim()
    ? `\n### Diretrizes personalizadas do projeto (Code Review)\n${customPrompt.trim()}\n`
    : '';

  return `Você é o Subagente Isolado de CODE REVIEW acionado pelo Orquestrador (Rodada ${reviewRound}).
Você não possui histórico de conversas anteriores. Baseie-se apenas nos artefatos indicados e nas alterações reais da worktree (execute \`git status\` e \`git diff\`).
${customBlock}
### Artefatos de entrada
- Triagem (comportamento esperado, cenários e impactos): ${triageArtifactPath}
- Plano executado: ${planArtifactPath}

### Tarefa
1. Revise cuidadosamente todas as alterações feitas na worktree (\`git status\`, \`git diff\`).
2. Verifique aderência aos critérios de aceite, bugs, casos de borda, segurança, qualidade do código e cobertura de testes.
3. Decida o veredito final:
   - \`ready_for_github\`: se tudo estiver sólido, testado e pronto para ser enviado ao GitHub.
   - \`return_to_block2\`: se houver qualquer problema real que exija voltar ao Bloco 2 para correção e novos testes. Liste cada correção necessária em \`issues\`, pois o Orquestrador converterá cada item em uma nova subtarefa no Bloco 2.
4. Para cada apontamento, preencha "howToTest" com passos para verificar a correção e os resultados esperados.

### Artefato obrigatório de saída
Salve um JSON válido exatamente em: ${outputArtifactPath}
E também imprima o mesmo JSON dentro de um bloco \`\`\`json ... \`\`\` na sua resposta final.

Schema obrigatório:
\`\`\`json
{
  "verdict": "ready_for_github",
  "summary": "Resumo claro da revisão técnica e justificativa do veredito",
  "issues": [
    {
      "id": "issue-1",
      "severity": "major",
      "title": "Título objetivo da correção necessária",
      "description": "Explicação detalhada do problema encontrado e o que precisa ser corrigido",
      "file": "caminho/opcional/do/arquivo.ts",
      "howToTest": ["Execute o cenário afetado e confira o resultado esperado após a correção"]
    }
  ]
}
\`\`\``;
}

// ======================= PIPELINES DO ORQUESTRADOR =======================

async function runBlock2AndBlock3Loop(session, { cliCommand, cliName, prompts }) {
  const { state } = session;
  const worktreePath = state.worktreePath;
  const wfDir = ensureWorkflowDirs(worktreePath);
  const triageArtifactPath = state.triageArtifactPath || path.join(wfDir, '01-triage.md');
  const planArtifactPath = state.planArtifactPath || path.join(wfDir, '02-plan.json');

  while (true) {
    // ================= BLOCO 2: DESENVOLVIMENTO E TESTES =================
    state.activeBlock = 'block2_dev_testing';
    state.error = null;
    broadcastState(session);

    const phases = state.plan?.phases || [];
    for (const phase of phases) {
      if (phase.status === 'completed') continue;

      phase.status = 'in_progress';
      state.currentPhaseId = phase.id;
      addEvent(session, {
        block: 'block2_dev_testing',
        agent: 'orchestrator',
        level: 'info',
        message: `Iniciando Fase ${phase.order}: ${phase.title} (${phase.subtasks.length} subtarefas).`
      });

      for (const subtask of phase.subtasks) {
        if (subtask.status === 'passed') continue;

        state.currentSubtaskId = subtask.id;
        let subtaskPassed = false;

        while (subtask.attempts < MAX_SUBTASK_ATTEMPTS) {
          subtask.attempts += 1;
          const attempt = subtask.attempts;
          const prevTestArtifact =
            attempt > 1
              ? path.join(wfDir, 'tests', `${subtask.id}-attempt-${attempt - 1}.json`)
              : null;

          // --- Subagente isolado de Desenvolvimento ---
          subtask.status = 'developing';
          state.status = 'running_dev';
          state.activeAgent = 'development';
          const devArtifactPath = path.join(wfDir, 'dev', `${subtask.id}-attempt-${attempt}.md`);

          addEvent(session, {
            block: 'block2_dev_testing',
            agent: 'development',
            level: 'info',
            message: `[Fase ${phase.order} · Subtarefa ${subtask.order}] Acionando subagente de Desenvolvimento via ${cliName} (Tentativa ${attempt}/${MAX_SUBTASK_ATTEMPTS}): "${subtask.title}".`
          });

          const devPrompt = buildDevPrompt({
            triageArtifactPath,
            planArtifactPath,
            phase,
            subtask,
            attempt,
            previousTestArtifactPath: prevTestArtifact,
            outputArtifactPath: devArtifactPath,
            customPrompt: prompts?.development
          });

          const devRun = await runIsolatedCliSubagent({
            session,
            cliCommand,
            worktreePath,
            prompt: devPrompt,
            label: `Dev ${subtask.id} #${attempt}`,
            signal: session.abortController.signal
          });

          const devMarkdown = readOrSaveMarkdownArtifact(devArtifactPath, devRun.stdout || devRun.combinedOutput);
          subtask.devArtifactPath = devArtifactPath;
          subtask.devSummary = devMarkdown.slice(0, 1200);

          addEvent(session, {
            block: 'block2_dev_testing',
            agent: 'development',
            level: 'success',
            message: `Subagente de Desenvolvimento concluiu "${subtask.title}" (Tentativa ${attempt}/${MAX_SUBTASK_ATTEMPTS}). Artefato entregue ao Orquestrador.`,
            artifactPath: devArtifactPath
          });

          // --- Subagente isolado de Testes (Novos testes + Regressão) ---
          subtask.status = 'testing';
          state.status = 'running_tests';
          state.activeAgent = 'testing';
          const testArtifactPath = path.join(wfDir, 'tests', `${subtask.id}-attempt-${attempt}.json`);

          addEvent(session, {
            block: 'block2_dev_testing',
            agent: 'testing',
            level: 'info',
            message: `[Fase ${phase.order} · Subtarefa ${subtask.order}] Acionando subagente de Testes (novos testes + regressão) via ${cliName} (Tentativa ${attempt}/${MAX_SUBTASK_ATTEMPTS}).`
          });

          const testPrompt = buildTestPrompt({
            phase,
            subtask,
            attempt,
            devArtifactPath,
            outputArtifactPath: testArtifactPath,
            customPrompt: prompts?.testing
          });

          const testRun = await runIsolatedCliSubagent({
            session,
            cliCommand,
            worktreePath,
            prompt: testPrompt,
            label: `Testes ${subtask.id} #${attempt}`,
            signal: session.abortController.signal
          });

          const rawTestJson = readOrExtractJsonArtifact(testArtifactPath, testRun.combinedOutput);
          const testResult = normalizeTestResult(rawTestJson, testRun.exitCode, testRun.combinedOutput);

          // Garante artefato normalizado salvo em disco
          fs.writeFileSync(testArtifactPath, JSON.stringify(testResult, null, 2), 'utf-8');
          subtask.testArtifactPath = testArtifactPath;
          subtask.testSummary = testResult.summary;
          subtask.newTestsSummary = testResult.newTestsSummary;
          subtask.regressionSummary = testResult.regressionSummary;

          if (testResult.passed) {
            subtask.status = 'passed';
            subtask.lastError = undefined;
            subtaskPassed = true;
            addEvent(session, {
              block: 'block2_dev_testing',
              agent: 'testing',
              level: 'success',
              message: `Testes aprovados para "${subtask.title}" (novos testes + regressão OK).`,
              artifactPath: testArtifactPath
            });
            break;
          } else {
            const failureText =
              testResult.failures.length > 0 ? testResult.failures.join('\n') : testResult.summary;
            subtask.lastError = failureText;

            if (attempt < MAX_SUBTASK_ATTEMPTS) {
              addEvent(session, {
                block: 'block2_dev_testing',
                agent: 'orchestrator',
                level: 'warning',
                message: `Testes falharam em "${subtask.title}" (Tentativa ${attempt}/${MAX_SUBTASK_ATTEMPTS}). Orquestrador devolvendo artefato de erro para correção automática.`,
                artifactPath: testArtifactPath
              });
            } else {
              subtask.status = 'failed';
              phase.status = 'failed';
              state.status = 'failed';
              state.activeAgent = null;
              state.error = `Subtarefa "${subtask.title}" falhou após ${MAX_SUBTASK_ATTEMPTS} tentativas automáticas de correção.`;
              addEvent(session, {
                block: 'block2_dev_testing',
                agent: 'orchestrator',
                level: 'error',
                message: state.error,
                artifactPath: testArtifactPath
              });
              return;
            }
          }
        }

        if (!subtaskPassed) return;
      }

      phase.status = 'completed';
      addEvent(session, {
        block: 'block2_dev_testing',
        agent: 'orchestrator',
        level: 'success',
        message: `Fase ${phase.order} ("${phase.title}") concluída com todas as subtarefas testadas.`
      });
    }

    // ================= BLOCO 3: CODE REVIEW E VEREDITO =================
    state.activeBlock = 'block3_code_review';
    state.status = 'running_code_review';
    state.activeAgent = 'code_review';
    state.currentPhaseId = null;
    state.currentSubtaskId = null;
    state.reviewRound += 1;

    const round = state.reviewRound;
    const reviewArtifactPath = path.join(wfDir, 'review', `round-${round}.json`);

    addEvent(session, {
      block: 'block3_code_review',
      agent: 'code_review',
      level: 'info',
      message: `Bloco 2 concluído. Orquestrador acionando subagente isolado de Code Review (Rodada ${round}) via ${cliName}.`
    });

    const reviewPrompt = buildCodeReviewPrompt({
      triageArtifactPath,
      planArtifactPath,
      reviewRound: round,
      outputArtifactPath: reviewArtifactPath,
      customPrompt: prompts?.code_review
    });

    const reviewRun = await runIsolatedCliSubagent({
      session,
      cliCommand,
      worktreePath,
      prompt: reviewPrompt,
      label: `Code Review #${round}`,
      signal: session.abortController.signal
    });

    const rawReview = readOrExtractJsonArtifact(reviewArtifactPath, reviewRun.combinedOutput);
    const normalizedReview = normalizeReviewResult(rawReview, reviewRun.combinedOutput);
    fs.writeFileSync(reviewArtifactPath, JSON.stringify(normalizedReview, null, 2), 'utf-8');

    const roundEntry = {
      round,
      verdict: normalizedReview.verdict,
      summary: normalizedReview.summary,
      artifactPath: reviewArtifactPath,
      issues: normalizedReview.issues,
      createdAt: nowIso()
    };
    state.reviewRounds = [...state.reviewRounds, roundEntry];

    if (normalizedReview.verdict === 'ready_for_github') {
      state.status = 'ready_for_github';
      state.activeAgent = null;
      addEvent(session, {
        block: 'block3_code_review',
        agent: 'code_review',
        level: 'success',
        message: `Code Review (Rodada ${round}) APROVADO! Alterações prontas para enviar ao GitHub.`,
        artifactPath: reviewArtifactPath
      });
      return;
    }

    // Veredito: Voltar ao Bloco 2 -> converte apontamentos em novas subtarefas de correção
    const nextPhaseOrder = (state.plan?.phases?.length || 0) + 1;
    const fixIssues =
      normalizedReview.issues.length > 0
        ? normalizedReview.issues
        : [
            {
              id: `review-${round}-fix-1`,
              severity: 'major',
              title: `Corrigir apontamentos do Code Review (Rodada ${round})`,
              description: normalizedReview.summary
            }
          ];

    const fixPhase = {
      id: `phase-review-round-${round}`,
      order: nextPhaseOrder,
      title: `Correções do Code Review (Rodada ${round})`,
      description: normalizedReview.summary,
      source: 'code_review',
      reviewRound: round,
      status: 'pending',
      subtasks: fixIssues.map((iss, idx) => ({
        id: `review-${round}-subtask-${idx + 1}`,
        order: idx + 1,
        title: iss.title,
        description: `${iss.description}${iss.file ? `\nArquivo relacionado: ${iss.file}` : ''}`,
        acceptanceCriteria: [
          `Resolver o apontamento [${iss.severity.toUpperCase()}]: ${iss.title}`,
          'Garantir cobertura de testes e ausência de regressões'
        ],
        howToTest: iss.howToTest ?? [],
        status: 'pending',
        attempts: 0,
        maxAttempts: MAX_SUBTASK_ATTEMPTS
      }))
    };

    state.plan = {
      summary: state.plan?.summary || '',
      phases: [...(state.plan?.phases || []), fixPhase]
    };
    fs.writeFileSync(planArtifactPath, JSON.stringify(state.plan, null, 2), 'utf-8');

    if (round >= state.maxReviewRounds) {
      state.status = 'paused';
      state.activeAgent = null;
      state.activeBlock = 'block2_dev_testing';
      addEvent(session, {
        block: 'block3_code_review',
        agent: 'orchestrator',
        level: 'warning',
        message: `Code Review (Rodada ${round}) solicitou ajustes e ${fixPhase.subtasks.length} subtarefa(s) foram adicionadas ao Bloco 2. Limite de ${state.maxReviewRounds} rodadas automáticas atingido — clique em "Retomar Bloco 2" se quiser continuar.`,
        artifactPath: reviewArtifactPath
      });
      return;
    }

    addEvent(session, {
      block: 'block3_code_review',
      agent: 'orchestrator',
      level: 'warning',
      message: `Code Review (Rodada ${round}) solicitou retorno ao Bloco 2. ${fixPhase.subtasks.length} nova(s) subtarefa(s) de correção criada(s) automaticamente.`,
      artifactPath: reviewArtifactPath
    });
    // Continua o while(true) executando a nova fase no Bloco 2 e depois novo Code Review!
  }
}

export function getWorkflowState(workflowId, worktreePath) {
  const session = getOrCreateSession(workflowId, worktreePath);
  return session.state;
}

export function subscribeWorkflowStream(workflowId, worktreePath, res) {
  const session = getOrCreateSession(workflowId, worktreePath);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  session.sseClients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(session.state)}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      session.sseClients.delete(res);
    }
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    session.sseClients.delete(res);
  });
}

function getIdleBlock1Session({ workflowId, worktreePath, cliCommand }) {
  const session = getOrCreateSession(workflowId, worktreePath);
  if (session.running) {
    throw new Error('O Orquestrador já está executando uma tarefa nesta worktree.');
  }
  if (!worktreePath || worktreePath !== session.state.worktreePath || !fs.existsSync(worktreePath)) {
    throw new Error('Diretório da worktree não encontrado.');
  }
  if (typeof cliCommand !== 'string' || !cliCommand.trim()) {
    throw new Error('Selecione um CLI instalado para executar o Bloco 1.');
  }
  return session;
}

function runBlock1Operation(session, operation, recoverStatus) {
  session.running = true;
  session.abortController = new AbortController();

  (async () => {
    try {
      await operation();
    } catch (err) {
      const aborted = err.code === 'ABORTED';
      session.state.status = recoverStatus || (aborted ? 'paused' : 'failed');
      session.state.activeAgent = null;
      session.state.error = aborted ? null : err.message || 'Erro durante a execução do Bloco 1.';
      addEvent(session, {
        block: 'block1_triage_planning',
        agent: 'orchestrator',
        level: aborted ? 'warning' : 'error',
        message: aborted ? 'Execução interrompida pelo usuário.' : session.state.error
      });
    } finally {
      session.running = false;
      session.abortController = null;
    }
  })();

  return session.state;
}

function requireCurrentPlanningTriage(state) {
  const { triageArtifactPath, triageConclusion, triageOutput } = state;
  if (
    !triageArtifactPath ||
    !['ready', 'ready_with_caveats'].includes(triageConclusion?.readiness)
  ) {
    throw new Error('Execute uma triagem com prontidão válida antes de planejar.');
  }
  if (!fs.existsSync(triageArtifactPath) || fs.readFileSync(triageArtifactPath, 'utf-8').trim() !== triageOutput) {
    throw new Error('O artefato de triagem foi alterado ou removido. Refaça a triagem para planejar.');
  }
}

async function runPlanning(session, { cliCommand, cliName, prompts, previousPlanPath, feedback }) {
  const { state } = session;
  const { triageArtifactPath, triageConclusion, worktreePath } = state;
  const workflowDir = path.dirname(triageArtifactPath);
  const planArtifactPath = path.join(workflowDir, '02-plan.json');
  const draftPath = path.join(workflowDir, `${makeId('.plan')}.json`);
  const caveats = triageConclusion.readiness === 'ready_with_caveats';

  state.status = 'running_planning';
  state.activeBlock = 'block1_triage_planning';
  state.activeAgent = 'planning';
  state.error = null;

  const action = previousPlanPath ? 'Refazendo o Planejamento' : 'Iniciando o Planejamento';
  addEvent(session, {
    block: 'block1_triage_planning',
    agent: 'planning',
    level: 'info',
    message: `${caveats && !previousPlanPath ? 'Ressalvas confirmadas. ' : ''}${action} via ${cliName || cliCommand}.`
  });

  try {
    const planRun = await runIsolatedCliSubagent({
      session,
      cliCommand,
      worktreePath,
      prompt: buildPlanningPrompt({
        triageArtifactPath,
        caveats,
        outputArtifactPath: draftPath,
        customPrompt: prompts?.planning,
        previousPlanPath,
        feedback
      }),
      label: previousPlanPath ? 'Bloco 1 · Replanejamento' : 'Bloco 1 · Planejamento',
      signal: session.abortController.signal
    });
    if (planRun.exitCode !== 0) {
      throw new Error(`O CLI de Planejamento terminou com código ${planRun.exitCode}. Consulte o log da execução.`);
    }

    const normalizedPlan = normalizePlan(readOrExtractJsonArtifact(draftPath, planRun.stdout));
    fs.writeFileSync(planArtifactPath, JSON.stringify(normalizedPlan, null, 2), 'utf-8');
    state.plan = normalizedPlan;
    state.planArtifactPath = planArtifactPath;
    state.status = 'awaiting_plan_approval';
    state.activeAgent = null;

    const totalSubtasks = normalizedPlan.phases.reduce((acc, phase) => acc + phase.subtasks.length, 0);
    addEvent(session, {
      block: 'block1_triage_planning',
      agent: 'planning',
      level: 'success',
      message: `Planejamento concluído com ${normalizedPlan.phases.length} fase(s) e ${totalSubtasks} subtarefa(s). Aguardando aprovação humana para iniciar o Bloco 2.`,
      artifactPath: planArtifactPath
    });
  } finally {
    fs.rmSync(draftPath, { force: true });
  }
}

export function startBlock1({
  workflowId,
  worktreePath,
  cliCommand,
  cliName,
  problemDescription,
  prompts
}) {
  const session = getIdleBlock1Session({ workflowId, worktreePath, cliCommand });
  if (typeof problemDescription !== 'string' || !problemDescription.trim()) {
    throw new Error('A descrição do problema é obrigatória para iniciar o Bloco 1.');
  }
  const wfDir = ensureWorkflowDirs(worktreePath);
  const triageArtifactPath = path.join(wfDir, '01-triage.md');

  Object.assign(session.state, {
    status: 'running_triage',
    activeBlock: 'block1_triage_planning',
    activeAgent: 'triage',
    currentPhaseId: null,
    currentSubtaskId: null,
    reviewRound: 0,
    problemDescription: problemDescription.trim(),
    triageOutput: '',
    triageArtifactPath: null,
    triageConclusion: null,
    plan: null,
    planArtifactPath: null,
    reviewRounds: [],
    liveLog: '',
    error: null
  });

  return runBlock1Operation(session, async () => {
    addEvent(session, {
      block: 'block1_triage_planning',
      agent: 'triage',
      message: `Iniciando a Triagem do Bloco 1 via ${cliName || cliCommand}.`
    });

    const triageRun = await runIsolatedCliSubagent({
      session,
      cliCommand,
      worktreePath,
      prompt: buildTriagePrompt({ problemDescription, customPrompt: prompts?.triage }),
      label: 'Bloco 1 · Triagem',
      signal: session.abortController.signal,
      readOnly: true
    });
    if (triageRun.exitCode !== 0) {
      throw new Error(`O CLI de Triagem terminou com código ${triageRun.exitCode}. Consulte o log da execução.`);
    }

    const triageOutput = extractTriageMarkdown(triageRun.stdout);
    if (!triageOutput) {
      throw new Error('O subagente de Triagem não retornou o artefato Markdown. Refaça a triagem.');
    }

    fs.writeFileSync(triageArtifactPath, triageOutput + '\n', 'utf-8');
    fs.writeFileSync(path.join(worktreePath, '.workflow-triage.md'), triageOutput + '\n', 'utf-8');
    session.state.triageOutput = triageOutput;
    session.state.triageArtifactPath = triageArtifactPath;
    const conclusion = parseTriageConclusion(triageOutput);
    session.state.triageConclusion = conclusion;

    if (conclusion.readiness !== 'ready') {
      const blocked = conclusion.readiness === 'blocked';
      session.state.status = blocked ? 'triage_blocked' : 'awaiting_triage_confirmation';
      session.state.activeAgent = null;
      addEvent(session, {
        block: 'block1_triage_planning',
        agent: 'triage',
        level: 'warning',
        message: blocked
          ? 'Triagem bloqueada. Resolva as pendências antes de refazer a triagem.'
          : 'Triagem apta com ressalvas. Aguardando confirmação para planejar.',
        artifactPath: triageArtifactPath
      });
      return;
    }

    addEvent(session, {
      block: 'block1_triage_planning',
      agent: 'triage',
      level: 'success',
      message: 'Triagem concluída com prontidão Apto.',
      artifactPath: triageArtifactPath
    });
    await runPlanning(session, { cliCommand, cliName, prompts });
  });
}

export function confirmTriage({ workflowId, worktreePath, cliCommand, cliName, triageId, problemDescription, prompts }) {
  const session = getIdleBlock1Session({ workflowId, worktreePath, cliCommand });
  const { state } = session;
  if (
    state.status !== 'awaiting_triage_confirmation' ||
    state.triageConclusion?.readiness !== 'ready_with_caveats' ||
    state.triageConclusion.id !== triageId
  ) {
    throw new Error('Esta triagem não está aguardando confirmação. Consulte a conclusão atual do Bloco 1.');
  }
  if (typeof problemDescription !== 'string' || problemDescription.trim() !== state.problemDescription) {
    throw new Error('A descrição da tarefa mudou. Refaça a triagem para planejar com a descrição atual.');
  }
  requireCurrentPlanningTriage(state);

  return runBlock1Operation(
    session,
    () => runPlanning(session, { cliCommand, cliName, prompts }),
    'awaiting_triage_confirmation'
  );
}

export function replanBlock1({ workflowId, worktreePath, cliCommand, cliName, feedback, prompts }) {
  const session = getIdleBlock1Session({ workflowId, worktreePath, cliCommand });
  requireCurrentPlanningTriage(session.state);
  const previousPlanPath = session.state.planArtifactPath;
  if (!session.state.plan || !previousPlanPath) {
    throw new Error('Gere e revise o plano inicial antes de solicitar o replanejamento.');
  }

  return runBlock1Operation(
    session,
    () => runPlanning(session, { cliCommand, cliName, prompts, previousPlanPath, feedback }),
    'awaiting_plan_approval'
  );
}

export function approvePlanAndStartBlock2({
  workflowId,
  worktreePath,
  cliCommand,
  cliName,
  prompts
}) {
  const session = getOrCreateSession(workflowId, worktreePath);
  if (session.running) {
    throw new Error('O Orquestrador já está em execução.');
  }
  if (!session.state.plan || !session.state.plan.phases?.length) {
    throw new Error('Nenhum plano encontrado para aprovar.');
  }

  session.running = true;
  session.abortController = new AbortController();

  addEvent(session, {
    block: 'block1_triage_planning',
    agent: 'orchestrator',
    level: 'success',
    message: 'Plano aprovado pelo usuário! Orquestrador liberando execução automática do Bloco 2 e Bloco 3.'
  });

  (async () => {
    try {
      await runBlock2AndBlock3Loop(session, { cliCommand, cliName: cliName || cliCommand, prompts });
    } catch (err) {
      if (err.code === 'ABORTED') {
        session.state.status = 'paused';
        session.state.activeAgent = null;
        addEvent(session, {
          block: session.state.activeBlock,
          agent: 'orchestrator',
          level: 'warning',
          message: 'Orquestração pausada pelo usuário.'
        });
      } else {
        session.state.status = 'failed';
        session.state.activeAgent = null;
        session.state.error = err.message || 'Erro inesperado durante a orquestração.';
        addEvent(session, {
          block: session.state.activeBlock,
          agent: 'orchestrator',
          level: 'error',
          message: session.state.error
        });
      }
    } finally {
      session.running = false;
      session.abortController = null;
    }
  })();

  return session.state;
}

export function resumeBlock2({ workflowId, worktreePath, cliCommand, cliName, prompts }) {
  const session = getOrCreateSession(workflowId, worktreePath);
  if (session.running) {
    throw new Error('O Orquestrador já está em execução.');
  }
  if (!session.state.plan || !session.state.plan.phases?.length) {
    throw new Error('Nenhum plano encontrado para retomar.');
  }

  // Reabilita subtarefas falhadas para uma nova rodada de até 4 tentativas
  for (const phase of session.state.plan.phases) {
    if (phase.status === 'failed') {
      phase.status = 'pending';
    }
    for (const sub of phase.subtasks) {
      if (sub.status === 'failed' || sub.status === 'developing' || sub.status === 'testing') {
        sub.status = 'pending';
        sub.attempts = 0;
      }
    }
  }

  // Se já estava no limite de rodadas de review, permite mais rodadas ao retomar manualmente
  if (session.state.reviewRound >= session.state.maxReviewRounds) {
    session.state.maxReviewRounds = session.state.reviewRound + MAX_REVIEW_ROUNDS;
  }

  session.running = true;
  session.abortController = new AbortController();

  addEvent(session, {
    block: 'block2_dev_testing',
    agent: 'orchestrator',
    level: 'info',
    message: 'Retomando execução automática do Bloco 2 e Bloco 3.'
  });

  (async () => {
    try {
      await runBlock2AndBlock3Loop(session, { cliCommand, cliName: cliName || cliCommand, prompts });
    } catch (err) {
      if (err.code === 'ABORTED') {
        session.state.status = 'paused';
        session.state.activeAgent = null;
        addEvent(session, {
          block: session.state.activeBlock,
          agent: 'orchestrator',
          level: 'warning',
          message: 'Orquestração pausada pelo usuário.'
        });
      } else {
        session.state.status = 'failed';
        session.state.activeAgent = null;
        session.state.error = err.message || 'Erro inesperado ao retomar orquestração.';
        addEvent(session, {
          block: session.state.activeBlock,
          agent: 'orchestrator',
          level: 'error',
          message: session.state.error
        });
      }
    } finally {
      session.running = false;
      session.abortController = null;
    }
  })();

  return session.state;
}

export function stopWorkflow(workflowId) {
  const session = sessions.get(workflowId);
  if (!session) return null;
  if (session.abortController) {
    session.abortController.abort();
  }
  return session.state;
}
