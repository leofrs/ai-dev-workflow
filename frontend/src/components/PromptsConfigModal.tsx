import React, { useEffect, useId, useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import {
  EMPTY_PROJECT_PROMPTS,
  ProjectPrompts,
  PromptsByProject,
  RegisteredProject,
  WORKFLOW_STAGES,
  WorkflowStageId
} from '../types/workflow';
import {
  Check,
  ClipboardList,
  Code2,
  FlaskConical,
  FolderGit2,
  GitBranch,
  RotateCcw,
  SearchCheck,
  Settings,
  Sparkles,
  X
} from 'lucide-react';

interface PromptsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: RegisteredProject[];
  initialProjectPath: string | null;
  promptsByProject: PromptsByProject;
  onSavePrompts: (updated: PromptsByProject) => void;
}

const STAGE_ICONS: Record<WorkflowStageId, React.ComponentType<{ className?: string }>> = {
  triage: Sparkles,
  planning: ClipboardList,
  development: Code2,
  testing: FlaskConical,
  code_review: SearchCheck
};

export const PromptsConfigModal: React.FC<PromptsConfigModalProps> = ({
  isOpen,
  onClose,
  projects,
  initialProjectPath,
  promptsByProject,
  onSavePrompts
}) => {
  const titleId = useId();
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [activeStage, setActiveStage] = useState<WorkflowStageId | null>(null);
  const [draftPrompts, setDraftPrompts] = useState<PromptsByProject>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fallbackPath = projects[0]?.path || '';
    const preselected =
      initialProjectPath && projects.some((p) => p.path === initialProjectPath)
        ? initialProjectPath
        : fallbackPath;

    setSelectedPath(preselected);
    setActiveStage(null);
    setDraftPrompts(promptsByProject);
  }, [isOpen, initialProjectPath, projects, promptsByProject]);

  useEffect(() => {
    if (activeStage && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [activeStage, selectedPath]);

  const selectedProject = projects.find((p) => p.path === selectedPath) || null;
  const currentProjectPrompts: ProjectPrompts = {
    ...EMPTY_PROJECT_PROMPTS,
    ...(selectedPath ? draftPrompts[selectedPath] : {})
  };
  const activeStageMeta = WORKFLOW_STAGES.find((s) => s.id === activeStage) || null;

  const handlePromptChange = (stageId: WorkflowStageId, value: string) => {
    if (!selectedPath) return;
    setDraftPrompts((prev) => ({
      ...prev,
      [selectedPath]: {
        ...EMPTY_PROJECT_PROMPTS,
        ...prev[selectedPath],
        [stageId]: value
      }
    }));
  };

  const handleClearActivePrompt = () => {
    if (!activeStage) return;
    handlePromptChange(activeStage, '');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSavePrompts(draftPrompts);
    onClose();
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      className="w-[calc(100%_-_2rem)] max-w-4xl rounded-xl border border-line bg-surface shadow-2xl"
    >
      <form
        onSubmit={handleSave}
        className="flex max-h-[90vh] flex-col"
      >
        {/* Cabeçalho do Modal */}
        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Settings className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 id={titleId} className="font-semibold text-foreground text-sm">
                Prompts por Diretório de Trabalho
              </h3>
              <p className="text-[11px] text-foreground-subtle">
                Personalize os prompts utilizados pelas worktrees do projeto selecionado.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-foreground-subtle hover:text-foreground hover:bg-surface-muted transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {projects.length === 0 ? (
            <div className="p-6 rounded-xl bg-canvas border border-line text-center">
              <FolderGit2 className="w-8 h-8 text-foreground-faint mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground-tertiary">
                Nenhum diretório cadastrado ainda
              </p>
              <p className="text-xs text-foreground-muted mt-1">
                Adicione um diretório de projeto no menu lateral antes de configurar os prompts.
              </p>
            </div>
          ) : (
            <>
              {/* Seletor de Diretório Atual */}
              <div>
                <label className="block text-xs font-medium text-foreground-tertiary mb-1.5">
                  Diretório de Trabalho
                </label>
                <div className="flex items-center gap-2 bg-canvas border border-line rounded-lg px-3 py-2 focus-within:border-accent-line transition">
                  <FolderGit2 className="w-4 h-4 text-accent shrink-0" />
                  <select
                    value={selectedPath}
                    onChange={(e) => setSelectedPath(e.target.value)}
                    className="w-full bg-transparent text-sm text-foreground focus:outline-none cursor-pointer"
                  >
                    {projects.map((proj) => (
                      <option key={proj.id} value={proj.path} className="bg-surface text-foreground">
                        {proj.name} — {proj.path}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedProject && (
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-foreground-muted">
                    <GitBranch className="w-3 h-3 text-accent shrink-0" />
                    <span className="font-mono truncate">{selectedProject.path}</span>
                  </div>
                )}
              </div>

              {/* 5 Cards das Etapas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-foreground-tertiary">
                    Etapas do Workflow (selecione um card para configurar o prompt)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {WORKFLOW_STAGES.map((stage) => {
                    const Icon = STAGE_ICONS[stage.id];
                    const isSelected = activeStage === stage.id;
                    const hasPrompt = Boolean(currentProjectPrompts[stage.id]?.trim());

                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => setActiveStage(stage.id)}
                        className={`flex flex-col justify-between p-3.5 rounded-xl border text-left transition cursor-pointer h-full min-h-[124px] ${
                          isSelected
                            ? 'bg-emerald-500/10 border-accent-line shadow-sm'
                            : 'bg-canvas/70 border-line hover:border-line-strong hover:bg-canvas'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                                isSelected
                                  ? 'bg-emerald-500/20 text-accent'
                                  : 'bg-surface text-foreground-subtle'
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                                hasPrompt
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-accent'
                                  : 'bg-surface border-line text-foreground-muted'
                              }`}
                            >
                              {hasPrompt ? 'Configurado' : 'Padrão'}
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-foreground">
                            {stage.label}
                          </div>
                        </div>

                        <p className="text-[11px] text-foreground-subtle leading-snug mt-1.5">
                          {stage.shortDescription}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editor de Texto do Card Selecionado */}
              {activeStageMeta ? (
                <div className="bg-canvas border border-line rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {React.createElement(STAGE_ICONS[activeStageMeta.id], {
                        className: 'w-4 h-4 text-accent'
                      })}
                      <span className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                        Prompt de {activeStageMeta.label}
                      </span>
                      <span className="text-[11px] text-foreground-muted">
                        ({selectedProject?.name})
                      </span>
                    </div>

                    {currentProjectPrompts[activeStageMeta.id]?.trim() && (
                      <button
                        type="button"
                        onClick={handleClearActivePrompt}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-foreground-subtle hover:text-foreground-secondary hover:bg-surface transition cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Limpar</span>
                      </button>
                    )}
                  </div>

                  <textarea
                    ref={textareaRef}
                    rows={6}
                    value={currentProjectPrompts[activeStageMeta.id]}
                    onChange={(e) => handlePromptChange(activeStageMeta.id, e.target.value)}
                    placeholder={activeStageMeta.placeholder}
                    className="w-full bg-surface/80 border border-line rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-accent-line resize-y leading-relaxed"
                  />

                  <p className="text-[11px] text-foreground-muted">
                    {activeStageMeta.id === 'triage' ? (
                      'Estas diretrizes complementam o prompt padrão de triagem. A saída segue o formato padrão, com a prontidão na conclusão.'
                    ) : (
                      <>
                        Este texto será entregue pelo Orquestrador ao subagente isolado de{' '}
                        <strong className="text-foreground-tertiary">{activeStageMeta.label}</strong> nas worktrees
                        deste diretório (se vazio, o Orquestrador usa as instruções padrão do sistema).
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-canvas/50 border border-dashed border-line text-center text-xs text-foreground-muted">
                  Clique em um dos 5 cards acima para preencher o prompt que será utilizado pelos
                  subagentes nas worktrees de{' '}
                  <strong className="text-foreground-tertiary">{selectedProject?.name}</strong>.
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 border-t border-line bg-canvas/60 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-foreground-tertiary hover:bg-surface-muted transition cursor-pointer"
          >
            Cancelar
          </button>
          {projects.length > 0 && (
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary-hover text-white transition cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Salvar Prompts</span>
            </button>
          )}
        </div>
      </form>
    </ModalDialog>
  );
};
