import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { execFile } from 'child_process';
import { promisify } from 'util';
import pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import path from 'path';
import {
  getWorkflowState,
  subscribeWorkflowStream,
  startBlock1,
  confirmTriage,
  replanBlock1,
  approvePlanAndStartBlock2,
  resumeBlock2,
  stopWorkflow,
  decideCliApproval
} from './orchestrator.js';

const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = 3001;

// Helper para executar comandos git de forma segura
async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    throw new Error(err.stderr || err.message || 'Erro ao executar comando git');
  }
}

// Verifica se um diretório é um repositório Git
async function checkIsGitRepo(dirPath) {
  try {
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], dirPath);
    return stdout === 'true';
  } catch {
    return false;
  }
}

// Verifica se um binário/comando existe no PATH da máquina
async function checkBinaryExists(binName) {
  const isWin = os.platform() === 'win32';
  const lookupCmd = isWin ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(lookupCmd, [binName]);
    const resolved = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return resolved || null;
  } catch {
    // Fallback em caminhos comuns no macOS/Linux caso o PATH do processo Node seja reduzido
    if (!isWin) {
      const commonDirs = [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        path.join(os.homedir(), '.local/bin'),
        path.join(os.homedir(), '.npm-global/bin'),
        path.join(os.homedir(), '.nvm/current/bin'),
        path.join(os.homedir(), '.bun/bin')
      ];
      for (const dir of commonDirs) {
        const candidate = path.join(dir, binName);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }
}

// Endpoint: Detectar CLIs de IA instalados na máquina
app.get('/api/clis', async (req, res) => {
  try {
    const catalog = [
      {
        id: 'claude',
        name: 'Claude Code',
        command: 'claude',
        description: 'Anthropic Claude Code CLI'
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        command: 'codex',
        description: 'OpenAI Codex CLI'
      },
      {
        id: 'antigravity',
        name: 'Antigravity',
        command: 'antigravity',
        aliases: ['agy'],
        description: 'Antigravity Agent CLI'
      },
      {
        id: 'gemini',
        name: 'Gemini CLI',
        command: 'gemini',
        description: 'Google Gemini CLI'
      },
      {
        id: 'aider',
        name: 'Aider',
        command: 'aider',
        description: 'Aider AI Pair Programming CLI'
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        command: 'opencode',
        description: 'OpenCode Terminal Agent'
      }
    ];

    const detected = [];

    for (const item of catalog) {
      let binPath = await checkBinaryExists(item.command);
      let resolvedCommand = item.command;

      if (!binPath && Array.isArray(item.aliases)) {
        for (const alias of item.aliases) {
          const aliasPath = await checkBinaryExists(alias);
          if (aliasPath) {
            binPath = aliasPath;
            resolvedCommand = alias;
            break;
          }
        }
      }

      detected.push({
        id: item.id,
        name: item.name,
        command: resolvedCommand,
        description: item.description,
        installed: Boolean(binPath),
        path: binPath
      });
    }

    res.json({ clis: detected });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao detectar CLIs na máquina' });
  }
});

// Endpoint: Explorador de diretórios
app.get('/api/directories', async (req, res) => {
  try {
    const requestedPath = req.query.path ? String(req.query.path) : os.homedir();
    const resolvedPath = path.resolve(requestedPath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Diretório não encontrado' });
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'O caminho não é um diretório' });
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => {
        try {
          if (entry.isDirectory()) return true;
          if (entry.isSymbolicLink()) {
            return fs.statSync(path.join(resolvedPath, entry.name)).isDirectory();
          }
          return false;
        } catch {
          return false;
        }
      })
      .map((dir) => ({
        name: dir.name,
        path: path.join(resolvedPath, dir.name),
        isHidden: dir.name.startsWith('.')
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolvedPath);
    const isGitRepo = await checkIsGitRepo(resolvedPath);

    res.json({
      currentPath: resolvedPath,
      parentPath: parentPath !== resolvedPath ? parentPath : null,
      homePath: os.homedir(),
      isGitRepo,
      directories
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao ler diretório' });
  }
});

// Endpoint: Criar um novo Git Worktree com nome manual definido pelo usuário
app.post('/api/git/worktrees', async (req, res) => {
  try {
    const { repoPath, worktreeName, baseBranch } = req.body;
    if (!repoPath || !worktreeName) {
      return res.status(400).json({ error: 'repoPath e worktreeName são obrigatórios' });
    }

    const resolvedRepo = path.resolve(repoPath);
    const isGit = await checkIsGitRepo(resolvedRepo);
    if (!isGit) {
      return res.status(400).json({ error: 'Diretório não é um repositório Git.' });
    }

    // Sanitiza o nome manual para pasta e branch válidos no Git
    const safeName = worktreeName
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!safeName) {
      return res.status(400).json({ error: 'Nome da worktree inválido.' });
    }

    const repoName = path.basename(resolvedRepo);
    const parentDir = path.dirname(resolvedRepo);
    const worktreesRoot = path.join(parentDir, `${repoName}-worktrees`);
    const targetWorktreePath = path.join(worktreesRoot, safeName);
    const branchName = safeName;

    if (fs.existsSync(targetWorktreePath)) {
      return res.status(409).json({
        error: `Já existe uma worktree com esse nome em: ${targetWorktreePath}`
      });
    }

    fs.mkdirSync(worktreesRoot, { recursive: true });

    let branchExists = false;
    try {
      await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], resolvedRepo);
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      await runGit(['worktree', 'add', targetWorktreePath, branchName], resolvedRepo);
    } else {
      const args = ['worktree', 'add', '-b', branchName, targetWorktreePath];
      if (baseBranch && baseBranch.trim()) {
        args.push(baseBranch.trim());
      }
      await runGit(args, resolvedRepo);
    }

    res.json({
      worktreePath: targetWorktreePath,
      branch: branchName,
      worktreeName: safeName
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Remover um Git Worktree
app.delete('/api/git/worktrees', async (req, res) => {
  try {
    const { repoPath, worktreePath } = req.body;
    if (!repoPath || !worktreePath) {
      return res.status(400).json({ error: 'repoPath e worktreePath são obrigatórios' });
    }
    await runGit(
      ['worktree', 'remove', '--force', path.resolve(worktreePath)],
      path.resolve(repoPath)
    );
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Etapa de Triagem (Gera o prompt estruturado e salva no worktree para uso com o CLI)
app.post('/api/ai/triage', async (req, res) => {
  try {
    const {
      problemDescription,
      model,
      worktreePath,
      cliName,
      cliCommand,
      customPrompt
    } = req.body;

    if (!problemDescription || !problemDescription.trim()) {
      return res.status(400).json({ error: 'A descrição do problema é obrigatória.' });
    }

    const effectiveApiKey = process.env.GEMINI_API_KEY;
    const trimmedCustomPrompt = customPrompt && typeof customPrompt === 'string' ? customPrompt.trim() : '';

    const defaultSystemPrompt = `Você é um Engenheiro de Software Sênior especialista em triagem técnica.
Sua tarefa é ler a descrição bruta de um problema ou tarefa e traduzi-la em uma linguagem simples, direta e objetiva focada no COMPORTAMENTO ESPERADO.

Responda estritamente em Português do Brasil seguindo esta estrutura em Markdown:

### 🎯 Comportamento Esperado (Resumo Direto)
Explique em 1 a 3 frases simples e diretas o que o sistema DEVE fazer após a resolução.

### 🔍 O que está acontecendo hoje (Problema Atual)
Resuma de forma clara qual é a falha ou necessidade descrita.

### ✅ Critérios de Aceite
- [ ] Critério verificável 1
- [ ] Critério verificável 2
- [ ] Critério verificável 3`;

    const systemPrompt = trimmedCustomPrompt || defaultSystemPrompt;

    let triageResult = '';
    let mode = 'local-structured';

    if (effectiveApiKey) {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      const selectedModel = model || 'gemini-2.5-flash';

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: `Descrição do problema/tarefa:\n\n${problemDescription}`,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2
        }
      });

      triageResult = response.text || 'Não foi possível gerar a triagem.';
      mode = 'ai';
    } else {
      const sentences = problemDescription
        .split(/[.!?\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const customSection = trimmedCustomPrompt
        ? `### 📋 Diretrizes de Triagem do Projeto\n${trimmedCustomPrompt}\n\n`
        : '';

      triageResult = `${customSection}### 🎯 Comportamento Esperado (Resumo Direto)
O sistema deve garantir que: **${sentences[0] || problemDescription.trim()}**, operando de forma previsível e sem erros para o usuário.

### 🔍 O que está acontecendo hoje (Problema Atual)
${sentences.length > 1 ? sentences.slice(1).join('. ') + '.' : problemDescription.trim()}

### ✅ Critérios de Aceite
- [ ] O comportamento esperado acima foi validado no fluxo principal
- [ ] Casos de erro e entradas inválidas foram tratados
- [ ] Nenhuma regressão foi introduzida`;
    }

    // Salva o arquivo .workflow-triage.md dentro da worktree para o CLI consumir
    if (worktreePath && fs.existsSync(worktreePath)) {
      const triageFile = path.join(worktreePath, '.workflow-triage.md');
      const promptBlock = trimmedCustomPrompt
        ? `\n## Prompt de Triagem Configurado\n${trimmedCustomPrompt}\n`
        : '';
      fs.writeFileSync(
        triageFile,
        `# Triagem Técnica (${cliName || cliCommand || 'CLI'})\n${promptBlock}\n## Descrição Original\n${problemDescription.trim()}\n\n---\n\n${triageResult}\n`,
        'utf-8'
      );
    }

    return res.json({
      triageResult,
      mode,
      savedToDisk: Boolean(worktreePath && fs.existsSync(worktreePath))
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao executar triagem' });
  }
});

// ================= ENDPOINTS DO ORQUESTRADOR DE WORKFLOW =================

app.get('/api/orchestrator/:workflowId/state', (req, res) => {
  try {
    const { workflowId } = req.params;
    const worktreePath = req.query.worktreePath ? String(req.query.worktreePath) : '';
    const state = getWorkflowState(workflowId, worktreePath);
    res.json({ state });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao obter estado do orquestrador' });
  }
});

app.get('/api/orchestrator/:workflowId/stream', (req, res) => {
  const { workflowId } = req.params;
  const worktreePath = req.query.worktreePath ? String(req.query.worktreePath) : '';
  subscribeWorkflowStream(workflowId, worktreePath, res);
});

app.post('/api/orchestrator/:workflowId/approvals/:approvalId', (req, res) => {
  const origin = req.get('Origin');
  if (origin && !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Responda ao pedido pela aplicação local.' });
  }

  const { workflowId, approvalId } = req.params;
  const decision = req.body?.decision;
  if (decision !== 'approve' && decision !== 'deny') {
    return res.status(400).json({ error: 'Selecione Aprovar ou Negar.' });
  }
  if (!decideCliApproval(workflowId, approvalId, decision)) {
    return res.status(409).json({ error: 'Esta decisão não está disponível para o pedido do CLI.' });
  }
  res.status(204).end();
});

app.post('/api/orchestrator/start-block1', (req, res) => {
  try {
    const state = startBlock1(req.body);
    res.json({ state });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao iniciar Bloco 1' });
  }
});

app.post('/api/orchestrator/confirm-triage', (req, res) => {
  try {
    const state = confirmTriage(req.body);
    res.json({ state });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao confirmar a triagem' });
  }
});

app.post('/api/orchestrator/replan', (req, res) => {
  try {
    const state = replanBlock1(req.body);
    res.json({ state });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao refazer planejamento' });
  }
});

app.post('/api/orchestrator/approve-plan', (req, res) => {
  try {
    const state = approvePlanAndStartBlock2(req.body);
    res.json({ state });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao aprovar plano' });
  }
});

app.post('/api/orchestrator/resume', (req, res) => {
  try {
    const state = resumeBlock2(req.body);
    res.json({ state });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao retomar Bloco 2' });
  }
});

app.post('/api/orchestrator/stop', (req, res) => {
  try {
    const { workflowId } = req.body;
    const state = stopWorkflow(workflowId);
    res.json({ state });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erro ao pausar orquestrador' });
  }
});

// WebSocket para terminais vinculados a cada worktree
const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedCwd = url.searchParams.get('cwd') || os.homedir();
  const cols = parseInt(url.searchParams.get('cols') || '80', 10);
  const rows = parseInt(url.searchParams.get('rows') || '24', 10);

  let cwd = os.homedir();
  try {
    if (fs.existsSync(requestedCwd) && fs.statSync(requestedCwd).isDirectory()) {
      cwd = path.resolve(requestedCwd);
    }
  } catch {
    cwd = os.homedir();
  }

  const shell =
    os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: isNaN(cols) ? 80 : cols,
    rows: isNaN(rows) ? 24 : rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }));
      ws.close();
    }
  });

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'input' && typeof msg.data === 'string') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols && msg.rows) {
        ptyProcess.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
      }
    } catch (e) {
      console.error('Erro WS:', e);
    }
  });

  ws.on('close', () => {
    try {
      ptyProcess.kill();
    } catch {
      // Já encerrado
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Backend AI Dev Workflow rodando em http://localhost:${PORT}`);
});
