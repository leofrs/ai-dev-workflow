# AI Dev Workflow — Diretórios, Git Worktrees, Detecção de CLIs & Triagem

Aplicação local em **React + TypeScript + Tailwind CSS + Node.js** para gerenciar múltiplos diretórios, criar `git worktree` com nomes manuais, detectar automaticamente os CLIs de IA instalados na máquina (**Claude Code**, **Codex**, **Antigravity**, **Gemini CLI**, **Aider**, **OpenCode**) e executar a etapa de triagem em cada workflow.

## Como instalar e executar

1. Extraia o arquivo ZIP e entre na pasta `ai-dev-workflow-app`.
2. Instale todas as dependências:
   ```bash
   npm run install:all
   ```
3. Inicie o backend e o frontend:
   ```bash
   npm run dev
   ```
4. Acesse **http://localhost:5173** no navegador.
