import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RegisteredProject,
  DevWorkflow,
  DetectedCli,
  PromptsByProject,
  EMPTY_PROJECT_PROMPTS
} from './types/workflow';
import { DirectoryPickerModal } from './components/DirectoryPickerModal';
import { ModalDialog } from './components/ModalDialog';
import { PromptsConfigModal } from './components/PromptsConfigModal';
import { TriageWorkspace } from './components/TriageWorkspace';
import {
  FolderGit2,
  Plus,
  GitBranch,
  Trash2,
  CheckCircle2,
  Clock,
  Layers,
  AlertTriangle,
  Loader2,
  Bot,
  RefreshCw,
  Folder,
  Settings,
  Sun,
  Moon
} from 'lucide-react';

const STORAGE_PROJECTS_KEY = 'ai_dev_wf_projects_v2';
const STORAGE_WORKFLOWS_KEY = 'ai_dev_wf_workflows_v2';
const STORAGE_PROMPTS_KEY = 'ai_dev_wf_prompts_v1';
const STORAGE_THEME_KEY = 'ai_dev_wf_theme';

export default function App() {
  const [isLightTheme, setIsLightTheme] = useState(
    () => document.documentElement.dataset.theme === 'light'
  );
  const themeToggleLabel = isLightTheme ? 'Ativar tema escuro' : 'Ativar tema claro';

  const [projects, setProjects] = useState<RegisteredProject[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PROJECTS_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const [workflows, setWorkflows] = useState<DevWorkflow[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_WORKFLOWS_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const [availableClis, setAvailableClis] = useState<DetectedCli[]>([]);
  const [loadingClis, setLoadingClis] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => projects[0]?.id || null
  );
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(
    () => workflows[0]?.id || null
  );

  const [promptsByProject, setPromptsByProject] = useState<PromptsByProject>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PROMPTS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  // Modais
  const [isDirModalOpen, setIsDirModalOpen] = useState(false);
  const [isNewWorkflowModalOpen, setIsNewWorkflowModalOpen] = useState(false);
  const [isPromptsModalOpen, setIsPromptsModalOpen] = useState(false);

  // Campos do Modal de Nova Worktree / Workflow
  const worktreeNameInputRef = useRef<HTMLInputElement>(null);
  const [manualWorktreeName, setManualWorktreeName] = useState('');
  const [newWorkflowBaseBranch, setNewWorkflowBaseBranch] = useState('');
  const [selectedCliIdForNew, setSelectedCliIdForNew] = useState('');
  const [newWorkflowProblem, setNewWorkflowProblem] = useState('');
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const fetchDetectedClis = useCallback(async () => {
    setLoadingClis(true);
    try {
      const res = await fetch('http://localhost:3001/api/clis');
      const json = await res.json();
      if (res.ok && Array.isArray(json.clis)) {
        setAvailableClis(json.clis);
        const firstInstalled = json.clis.find((c: DetectedCli) => c.installed);
        if (firstInstalled) {
          setSelectedCliIdForNew((prev) => prev || firstInstalled.id);
        }
      }
    } catch (err) {
      console.error('Erro ao detectar CLIs:', err);
    } finally {
      setLoadingClis(false);
    }
  }, []);

  useEffect(() => {
    fetchDetectedClis();
  }, [fetchDetectedClis]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(STORAGE_WORKFLOWS_KEY, JSON.stringify(workflows));
  }, [workflows]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PROMPTS_KEY, JSON.stringify(promptsByProject));
  }, [promptsByProject]);

  useEffect(() => {
    if (isNewWorkflowModalOpen) {
      worktreeNameInputRef.current?.focus();
    }
  }, [isNewWorkflowModalOpen]);

  const toggleTheme = () => {
    const nextTheme = isLightTheme ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    setIsLightTheme(nextTheme === 'light');

    try {
      localStorage.setItem(STORAGE_THEME_KEY, nextTheme);
    } catch {
      // A troca continua disponível quando o navegador impede salvar a preferência.
    }
  };

  const handleAddProject = (dirPath: string, isGitRepo: boolean) => {
    const existing = projects.find((p) => p.path === dirPath);
    if (existing) {
      setSelectedProjectId(existing.id);
      return;
    }

    const folderName = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
    const newProj: RegisteredProject = {
      id: `proj-${Date.now()}`,
      name: folderName,
      path: dirPath,
      isGitRepo
    };

    setProjects((prev) => [...prev, newProj]);
    setSelectedProjectId(newProj.id);
  };

  const handleRemoveProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.id !== projectId);
      if (selectedProjectId === projectId) {
        setSelectedProjectId(filtered[0]?.id || null);
      }
      return filtered;
    });
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;
  const projectWorkflows = workflows.filter((w) => w.projectId === selectedProject?.id);
  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId) || null;
  const installedClis = availableClis.filter((c) => c.installed);

  const openNewWorkflowModal = () => {
    setWorktreeError(null);
    setManualWorktreeName('');
    setNewWorkflowBaseBranch('');
    setNewWorkflowProblem('');
    if (!selectedCliIdForNew && installedClis.length > 0) {
      setSelectedCliIdForNew(installedClis[0].id);
    }
    setIsNewWorkflowModalOpen(true);
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !manualWorktreeName.trim()) return;

    const chosenCli = availableClis.find((c) => c.id === selectedCliIdForNew);
    if (!chosenCli) {
      setWorktreeError('Selecione um CLI instalado na máquina para iniciar o workflow.');
      return;
    }

    setCreatingWorktree(true);
    setWorktreeError(null);

    try {
      const res = await fetch('http://localhost:3001/api/git/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: selectedProject.path,
          worktreeName: manualWorktreeName.trim(),
          baseBranch: newWorkflowBaseBranch.trim() || undefined
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao criar git worktree');
      }

      const newWf: DevWorkflow = {
        id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        repoPath: selectedProject.path,
        worktreeName: json.worktreeName,
        branch: json.branch,
        worktreePath: json.worktreePath,
        selectedCliId: chosenCli.id,
        selectedCliName: chosenCli.name,
        selectedCliCommand: chosenCli.command,
        status: 'pending_triage',
        problemDescription: newWorkflowProblem.trim(),
        triageOutput: '',
        createdAt: new Date().toISOString()
      };

      setWorkflows((prev) => [newWf, ...prev]);
      setActiveWorkflowId(newWf.id);
      setIsNewWorkflowModalOpen(false);
    } catch (err: any) {
      setWorktreeError(err.message);
    } finally {
      setCreatingWorktree(false);
    }
  };

  const handleDeleteWorkflow = async (wf: DevWorkflow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        `Remover a worktree "${wf.worktreeName}" e excluir o diretório ${wf.worktreePath}?`
      )
    ) {
      return;
    }

    try {
      await fetch('http://localhost:3001/api/git/worktrees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: wf.repoPath,
          worktreePath: wf.worktreePath
        })
      });
    } catch {
      // Continua removendo da lista local
    }

    setWorkflows((prev) => {
      const updated = prev.filter((item) => item.id !== wf.id);
      if (activeWorkflowId === wf.id) {
        setActiveWorkflowId(updated[0]?.id || null);
      }
      return updated;
    });
  };

  const handleUpdateWorkflow = (id: string, patch: Partial<DevWorkflow>) => {
    setWorkflows((prev) =>
      prev.map((wf) => (wf.id === id ? { ...wf, ...patch } : wf))
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-canvas text-foreground overflow-hidden">
      {/* Topbar Global */}
      <div className="h-11 bg-panel border-b border-line px-4 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5 text-accent" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap">
            AI Dev Workflow
          </span>

          {/* Badge com os CLIs detectados na máquina */}
          <div className="hidden md:flex items-center gap-1.5 ml-2 pl-3 border-l border-line min-w-0 overflow-x-auto whitespace-nowrap">
            <span className="text-[11px] text-foreground-muted">CLIs detectados:</span>
            {installedClis.length > 0 ? (
              installedClis.map((cli) => (
                <span
                  key={cli.id}
                  title={cli.path || cli.command}
                  className="text-[11px] px-2 py-0.5 rounded bg-surface border border-line text-accent font-mono"
                >
                  {cli.name}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-warning">
                {loadingClis ? 'Buscando...' : 'Nenhum CLI no PATH'}
              </span>
            )}
            <button
              onClick={fetchDetectedClis}
              title="Reescanear CLIs na máquina"
              className="p-1 rounded hover:bg-surface text-foreground-muted hover:text-foreground-secondary transition"
            >
              <RefreshCw className={`w-3 h-3 ${loadingClis ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            title={themeToggleLabel}
            aria-label={themeToggleLabel}
            className="p-1.5 rounded-md bg-surface border border-line text-foreground-subtle hover:text-accent hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition cursor-pointer"
          >
            {isLightTheme ? (
              <Moon className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Sun className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setIsPromptsModalOpen(true)}
            title="Configurar prompts por diretório de trabalho"
            aria-label="Configurar prompts por diretório de trabalho"
            className="p-1.5 rounded-md bg-surface border border-line text-foreground-subtle hover:text-accent hover:border-line-strong transition cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Corpo Principal */}
      <div className="flex-1 flex min-h-0">
        {/* SIDE MENU UNIFICADO: Diretórios em cima + Barra Horizontal + Worktrees embaixo */}
        <aside className="w-76 bg-surface border-r border-line flex flex-col shrink-0">
          {/* SEÇÃO SUPERIOR: DIRETÓRIOS */}
          <div className="flex flex-col h-[42%] min-h-[180px]">
            <div className="px-3 py-2.5 border-b border-line/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-warning" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground-tertiary">
                  Diretórios ({projects.length})
                </span>
              </div>
              <button
                onClick={() => setIsDirModalOpen(true)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-primary hover:bg-primary-hover text-white text-xs font-medium transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Diretório</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {projects.length === 0 ? (
                <div className="text-center py-6 px-3">
                  <p className="text-xs text-foreground-muted mb-2.5">
                    Nenhum diretório selecionado.
                  </p>
                  <button
                    onClick={() => setIsDirModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-strong text-xs text-foreground-secondary transition"
                  >
                    + Adicionar Diretório
                  </button>
                </div>
              ) : (
                projects.map((proj) => {
                  const isSelected = proj.id === selectedProject?.id;
                  const count = workflows.filter((w) => w.projectId === proj.id).length;
                  return (
                    <div
                      key={proj.id}
                      onClick={() => {
                        setSelectedProjectId(proj.id);
                        const firstWf = workflows.find((w) => w.projectId === proj.id);
                        setActiveWorkflowId(firstWf ? firstWf.id : null);
                      }}
                      className={`group flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition ${
                        isSelected
                          ? 'bg-surface-muted text-foreground border border-line-strong'
                          : 'text-foreground-subtle hover:bg-surface-muted/50 hover:text-foreground-secondary'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FolderGit2
                            className={`w-4 h-4 shrink-0 ${
                              proj.isGitRepo ? 'text-accent' : 'text-warning'
                            }`}
                          />
                          <span className="text-xs font-medium truncate">{proj.name}</span>
                        </div>
                        <div className="text-[10px] text-foreground-muted truncate font-mono mt-0.5">
                          {proj.path}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 ml-1.5">
                        {count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-canvas text-foreground-tertiary">
                            {count}
                          </span>
                        )}
                        <button
                          onClick={(e) => handleRemoveProject(proj.id, e)}
                          title="Remover diretório"
                          className="p-1 rounded hover:bg-surface-strong text-foreground-muted hover:text-danger opacity-0 group-hover:opacity-100 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* BARRA HORIZONTAL DIVISÓRIA ENTRE DIRETÓRIOS E WORKTREES */}
          <div className="relative py-1 bg-canvas border-y-2 border-line flex items-center justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-surface-strong" />
          </div>

          {/* SEÇÃO INFERIOR: WORKTREES / WORKFLOWS DO DIRETÓRIO SELECIONADO */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2.5 border-b border-line/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <GitBranch className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground-tertiary truncate">
                  Worktrees {selectedProject ? `(${projectWorkflows.length})` : ''}
                </span>
              </div>
              {selectedProject && (
                <button
                  onClick={openNewWorkflowModal}
                  disabled={!selectedProject.isGitRepo}
                  title={
                    selectedProject.isGitRepo
                      ? 'Criar nova worktree manualmente'
                      : 'Este diretório não é um repositório Git'
                  }
                  className="flex items-center gap-1 px-2 py-1 rounded bg-surface-muted hover:bg-surface-strong disabled:opacity-40 text-accent text-xs font-medium transition cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Worktree</span>
                </button>
              )}
            </div>

            {selectedProject && !selectedProject.isGitRepo && (
              <div className="m-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-warning-strong flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Diretório sem Git. Inicialize o Git para criar worktrees.</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {!selectedProject ? (
                <div className="text-center py-8 px-3 text-xs text-foreground-muted">
                  Selecione um diretório acima para gerenciar suas worktrees.
                </div>
              ) : projectWorkflows.length === 0 ? (
                <div className="text-center py-8 px-3">
                  <p className="text-xs text-foreground-muted mb-2.5">
                    Nenhuma worktree em <strong>{selectedProject.name}</strong>.
                  </p>
                  {selectedProject.isGitRepo && (
                    <button
                      onClick={openNewWorkflowModal}
                      className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-xs font-medium text-white transition"
                    >
                      + Criar Worktree
                    </button>
                  )}
                </div>
              ) : (
                projectWorkflows.map((wf) => {
                  const isActive = wf.id === activeWorkflow?.id;
                  return (
                    <div
                      key={wf.id}
                      onClick={() => setActiveWorkflowId(wf.id)}
                      className={`group p-2.5 rounded-lg border cursor-pointer transition ${
                        isActive
                          ? 'bg-surface-muted/90 border-emerald-500/50 shadow-sm'
                          : 'bg-canvas/40 border-line/80 hover:border-line-strong'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <GitBranch className="w-3.5 h-3.5 text-accent shrink-0" />
                          <span className="text-xs font-semibold text-foreground truncate">
                            {wf.worktreeName}
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDeleteWorkflow(wf, e)}
                          title="Excluir worktree"
                          className="p-1 rounded hover:bg-surface-strong text-foreground-muted hover:text-danger opacity-0 group-hover:opacity-100 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[11px]">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-line text-foreground-tertiary font-mono">
                          <Bot className="w-3 h-3 text-accent" />
                          {wf.selectedCliName}
                        </span>

                        {wf.status === 'ready_for_github' ? (
                          <span className="inline-flex items-center gap-1 text-accent">
                            <CheckCircle2 className="w-3 h-3" />
                            Pronto p/ GitHub
                          </span>
                        ) : wf.status === 'awaiting_plan_approval' || wf.status === 'awaiting_triage_confirmation' ? (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <Clock className="w-3 h-3" />
                            {wf.status === 'awaiting_plan_approval' ? 'Aprovar plano' : 'Revisar ressalvas'}
                          </span>
                        ) : wf.status === 'failed' || wf.status === 'triage_blocked' ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <AlertTriangle className="w-3 h-3" />
                            {wf.status === 'triage_blocked' ? 'Triagem bloqueada' : 'Falha'}
                          </span>
                        ) : [
                            'running_triage',
                            'running_planning',
                            'running_dev',
                            'running_tests',
                            'running_code_review'
                          ].includes(wf.status) ? (
                          <span className="inline-flex items-center gap-1 text-accent">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Executando
                          </span>
                        ) : wf.status === 'triaged' ? (
                          <span className="inline-flex items-center gap-1 text-accent">
                            <CheckCircle2 className="w-3 h-3" />
                            Triado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <Clock className="w-3 h-3" />
                            Pendente
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Área Principal: Workspace da Worktree Ativa */}
        <main className="flex-1 flex flex-col min-w-0 h-full">
          {activeWorkflow ? (
            <TriageWorkspace
              workflow={activeWorkflow}
              allWorkflows={workflows}
              availableClis={availableClis}
              isLightTheme={isLightTheme}
              projectPrompts={{
                ...EMPTY_PROJECT_PROMPTS,
                ...(promptsByProject[activeWorkflow.repoPath] || {})
              }}
              onOpenPromptsConfig={() => setIsPromptsModalOpen(true)}
              onUpdateWorkflow={handleUpdateWorkflow}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-surface border border-line flex items-center justify-center mb-4">
                <GitBranch className="w-7 h-7 text-accent" />
              </div>
              <h2 className="text-lg font-semibold text-foreground-secondary mb-1">
                Selecione ou crie uma Worktree
              </h2>
              <p className="text-sm text-foreground-subtle max-w-md">
                Escolha um diretório no menu lateral, crie uma worktree com nome manual,
                selecione qual CLI instalado na sua máquina deseja utilizar e execute a etapa de
                triagem.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Modal: Selecionar Diretório */}
      <DirectoryPickerModal
        isOpen={isDirModalOpen}
        onClose={() => setIsDirModalOpen(false)}
        onConfirm={handleAddProject}
      />

      {/* Modal: Configurar Prompts por Diretório */}
      <PromptsConfigModal
        isOpen={isPromptsModalOpen}
        onClose={() => setIsPromptsModalOpen(false)}
        projects={projects}
        initialProjectPath={selectedProject?.path || null}
        promptsByProject={promptsByProject}
        onSavePrompts={setPromptsByProject}
      />

      {/* Modal: Criar Nova Worktree Manualmente & Escolher CLI */}
      <ModalDialog
        isOpen={isNewWorkflowModalOpen && Boolean(selectedProject)}
        onClose={() => setIsNewWorkflowModalOpen(false)}
        ariaLabelledBy="new-worktree-modal-title"
        className="w-[calc(100%_-_2rem)] max-w-lg rounded-xl border border-line bg-surface shadow-2xl"
      >
        {selectedProject && (
          <form
            onSubmit={handleCreateWorkflow}
            className="flex max-h-[90vh] flex-col"
          >
            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-accent" />
                <h3 id="new-worktree-modal-title" className="font-semibold text-foreground text-sm">
                  Nova Worktree em {selectedProject.name}
                </h3>
              </div>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Nome manual da worktree */}
              <div>
                <label className="block text-xs font-medium text-foreground-tertiary mb-1">
                  Nome da Worktree (Manual) *
                </label>
                <input
                  ref={worktreeNameInputRef}
                  type="text"
                  required
                  value={manualWorktreeName}
                  onChange={(e) => setManualWorktreeName(e.target.value)}
                  placeholder="ex: feat-pagamento-pix ou fix-auth-token"
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent-line"
                />
                <p className="text-[11px] text-foreground-muted mt-1">
                  Será criada a pasta{' '}
                  <code className="text-foreground-tertiary">
                    ../{selectedProject.name}-worktrees/
                    {manualWorktreeName.trim() || '<nome>'}
                  </code>{' '}
                  com a branch de mesmo nome.
                </p>
              </div>

              {/* Escolha obrigatória do CLI instalado */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-foreground-tertiary">
                    CLI para Executar o Fluxo & Triagem *
                  </label>
                  <button
                    type="button"
                    onClick={fetchDetectedClis}
                    className="text-[11px] text-accent hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingClis ? 'animate-spin' : ''}`} />
                    Atualizar lista
                  </button>
                </div>

                {installedClis.length === 0 ? (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-warning-strong">
                    Nenhum CLI de IA (Claude Code, Codex, Antigravity, Gemini, Aider) foi
                    encontrado no PATH da máquina. Instale um deles e clique em "Atualizar
                    lista".
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableClis.map((cli) => {
                      const isSelected = cli.id === selectedCliIdForNew;
                      return (
                        <button
                          key={cli.id}
                          type="button"
                          disabled={!cli.installed}
                          onClick={() => setSelectedCliIdForNew(cli.id)}
                          className={`flex items-start justify-between p-2.5 rounded-lg border text-left transition ${
                            !cli.installed
                              ? 'opacity-40 cursor-not-allowed bg-canvas/40 border-line/60'
                              : isSelected
                              ? 'bg-emerald-500/10 border-accent-line text-foreground cursor-pointer'
                              : 'bg-canvas border-line hover:border-line-strong text-foreground-tertiary cursor-pointer'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold flex items-center gap-1.5">
                              <Bot
                                className={`w-3.5 h-3.5 ${
                                  isSelected ? 'text-accent' : 'text-foreground-muted'
                                }`}
                              />
                              <span>{cli.name}</span>
                            </div>
                            <div className="text-[10px] font-mono text-foreground-muted truncate mt-0.5">
                              {cli.installed ? cli.path : 'Não instalado'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Branch Base */}
              <div>
                <label className="block text-xs font-medium text-foreground-tertiary mb-1">
                  Branch Base (opcional)
                </label>
                <input
                  type="text"
                  value={newWorkflowBaseBranch}
                  onChange={(e) => setNewWorkflowBaseBranch(e.target.value)}
                  placeholder="Deixe vazio para usar o HEAD atual (ex: main)"
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-line"
                />
              </div>

              {/* Descrição inicial do problema */}
              <div>
                <label className="block text-xs font-medium text-foreground-tertiary mb-1">
                  Descrição Inicial do Problema (opcional)
                </label>
                <textarea
                  rows={3}
                  value={newWorkflowProblem}
                  onChange={(e) => setNewWorkflowProblem(e.target.value)}
                  placeholder="Cole a descrição do problema para a etapa de triagem..."
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-line resize-none"
                />
              </div>

              {worktreeError && (
                <div className="p-3 rounded-lg bg-danger-surface/40 border border-danger-line/60 text-xs text-danger-strong">
                  {worktreeError}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-line bg-canvas/60 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsNewWorkflowModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-foreground-tertiary hover:bg-surface-muted"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  creatingWorktree ||
                  !manualWorktreeName.trim() ||
                  installedClis.length === 0
                }
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary-hover disabled:opacity-50 text-white cursor-pointer"
              >
                {creatingWorktree ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Criando Worktree...</span>
                  </>
                ) : (
                  <span>Criar Worktree & Iniciar</span>
                )}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>
    </div>
  );
}
