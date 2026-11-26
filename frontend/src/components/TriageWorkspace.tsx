import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  DevWorkflow,
  DetectedCli,
  OrchestratorState,
  PlanSubtask,
  ProjectPrompts,
  TriageConclusion,
  WORKFLOW_STAGES,
  WorkflowBlockId,
  WorkflowStatus
} from '../types/workflow';
import { WebTerminal } from './WebTerminal';
import { CliApprovalCard } from './CliApprovalCard';
import { ModalDialog } from './ModalDialog';
import { MarkdownContent } from './MarkdownContent';
import {
  Sparkles,
  GitBranch,
  FolderGit2,
  CheckCircle2,
  Clock,
  Terminal as TerminalIcon,
  Copy,
  Check,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
  Play,
  Bot,
  ClipboardList,
  Code2,
  FlaskConical,
  SearchCheck,
  Settings,
  Square,
  RotateCcw,
  AlertTriangle,
  XCircle,
  GitPullRequest,
  ArrowLeft,
  Activity,
  Workflow,
  Maximize2,
  X,
  type LucideIcon
} from 'lucide-react';

interface TriageWorkspaceProps {
  workflow: DevWorkflow;
  allWorkflows: DevWorkflow[];
  availableClis: DetectedCli[];
  isLightTheme: boolean;
  projectPrompts: ProjectPrompts;
  onOpenPromptsConfig: () => void;
  onUpdateWorkflow: (id: string, patch: Partial<DevWorkflow>) => void;
}

const RUNNING_STATUSES: WorkflowStatus[] = [
  'running_triage',
  'running_planning',
  'running_dev',
  'running_tests',
  'running_code_review'
];

const READINESS_LABELS: Record<TriageConclusion['readiness'], string> = {
  ready: 'Apto',
  ready_with_caveats: 'Apto com ressalvas',
  blocked: 'Bloqueado'
};

function getStatusBadgeInfo(status: WorkflowStatus): {
  label: string;
  className: string;
  spinning?: boolean;
} {
  switch (status) {
    case 'running_triage':
      return {
        label: 'Triagem em execução',
        className: 'bg-emerald-500/10 text-accent border-emerald-500/30',
        spinning: true
      };
    case 'running_planning':
      return {
        label: 'Planejando fases',
        className: 'bg-emerald-500/10 text-accent border-emerald-500/30',
        spinning: true
      };
    case 'awaiting_triage_confirmation':
      return {
        label: 'Aguardando revisão das ressalvas',
        className: 'bg-amber-500/10 text-warning border-amber-500/30'
      };
    case 'triage_blocked':
      return {
        label: 'Triagem bloqueada',
        className: 'bg-red-500/10 text-danger border-red-500/30'
      };
    case 'awaiting_plan_approval':
      return {
        label: 'Aguardando Aprovação',
        className: 'bg-amber-500/10 text-warning border-amber-500/30'
      };
    case 'running_dev':
      return {
        label: 'Desenvolvendo',
        className: 'bg-sky-500/10 text-info border-sky-500/30',
        spinning: true
      };
    case 'running_tests':
      return {
        label: 'Executando Testes',
        className: 'bg-violet-500/10 text-testing border-violet-500/30',
        spinning: true
      };
    case 'running_code_review':
      return {
        label: 'Code Review',
        className: 'bg-indigo-500/10 text-review border-indigo-500/30',
        spinning: true
      };
    case 'ready_for_github':
      return {
        label: 'Pronto p/ GitHub',
        className: 'bg-emerald-500/15 text-accent border-emerald-500/40'
      };
    case 'paused':
      return {
        label: 'Pausado',
        className: 'bg-surface-muted text-foreground-tertiary border-line-strong'
      };
    case 'failed':
      return {
        label: 'Atenção / Falha',
        className: 'bg-red-500/10 text-danger border-red-500/30'
      };
    case 'triaged':
      return {
        label: 'Triado',
        className: 'bg-emerald-500/10 text-accent border-emerald-500/30'
      };
    default:
      return {
        label: 'Pronto para iniciar',
        className: 'bg-surface text-foreground-subtle border-line'
      };
  }
}

function getSubtaskBadge(sub: PlanSubtask): { label: string; className: string } {
  switch (sub.status) {
    case 'developing':
      return {
        label: 'Desenvolvendo',
        className: 'bg-sky-500/10 border-sky-500/30 text-info'
      };
    case 'testing':
      return {
        label: 'Testando',
        className: 'bg-violet-500/10 border-violet-500/30 text-testing'
      };
    case 'passed':
      return {
        label: 'Testes OK',
        className: 'bg-emerald-500/10 border-emerald-500/30 text-accent'
      };
    case 'failed':
      return {
        label: 'Falhou',
        className: 'bg-red-500/10 border-red-500/30 text-danger'
      };
    default:
      return {
        label: 'Pendente',
        className: 'bg-surface border-line text-foreground-muted'
      };
  }
}

function SubtaskVerification({
  subtask,
  showAcceptanceCriteria = true
}: {
  subtask: PlanSubtask;
  showAcceptanceCriteria?: boolean;
}) {
  const criteria = subtask.acceptanceCriteria ?? [];

  return (
    <div className="space-y-2 break-words">
      {showAcceptanceCriteria && criteria.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-foreground-secondary">Critérios de aceite</p>
          <ul className="list-disc space-y-1 pl-5 text-foreground-muted">
            {criteria.map((criterion, index) => (
              <li key={index} className="whitespace-pre-wrap">
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium text-foreground-secondary">Como testar</p>
        {subtask.howToTest?.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-foreground-muted">
            {subtask.howToTest.map((step, index) => (
              <li key={index} className="whitespace-pre-wrap">
                {step}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-foreground-muted">Roteiro de teste pendente.</p>
        )}
      </div>
    </div>
  );
}

interface WorkflowArtifactPanelProps {
  title: string;
  icon: LucideIcon;
  artifactPath?: string;
  renderContent: (expanded: boolean) => React.ReactNode;
}

function WorkflowArtifactPanel({
  title,
  icon: Icon,
  artifactPath,
  renderContent
}: WorkflowArtifactPanelProps) {
  const dialogId = useId();
  const contentId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPressedRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <section
      className={`flex min-w-0 flex-col rounded-xl border border-line bg-surface/60 p-3.5 ${
        isCollapsed ? '' : 'min-h-[220px]'
      }`}
    >
      <header className={`flex items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-2'}`}>
        <div className="flex min-w-0 items-start gap-1.5">
          <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-tertiary">
              {title}
            </h3>
            {artifactPath && (
              <p className="mt-0.5 break-words font-mono text-[10px] text-foreground-muted">
                {artifactPath}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-expanded={!isCollapsed}
            aria-controls={contentId}
            aria-label={isCollapsed ? `Mostrar ${title}` : `Recolher ${title}`}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1 text-xs font-medium text-foreground-tertiary transition-colors hover:border-line-strong hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />
                Mostrar
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />
                Recolher
              </>
            )}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              dialogRef.current?.showModal();
              setIsExpanded(true);
            }}
            aria-label={`Expandir ${title}`}
            aria-haspopup="dialog"
            aria-controls={dialogId}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 text-xs font-medium text-foreground-tertiary transition-colors hover:border-line-strong hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Maximize2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Expandir
          </button>
        </div>
      </header>

      {!isCollapsed && (
        <div
          id={contentId}
          className="max-h-[340px] flex-1 overflow-y-auto break-words rounded-lg border border-line/80 bg-canvas p-3 text-xs"
        >
          {renderContent(false)}
        </div>
      )}

      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={`${dialogId}-title`}
        onClose={() => {
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setIsExpanded(false);
          }
        }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !event.currentTarget.open) {
            setIsExpanded(false);
          }
        }}
        onPointerDown={(event) => {
          backdropPressedRef.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (backdropPressedRef.current && event.target === event.currentTarget) {
            event.currentTarget.close();
          }
        }}
        className="app-modal-dialog m-auto w-[calc(100%_-_2rem)] max-w-6xl overflow-hidden rounded-2xl border border-line bg-panel p-0 text-foreground shadow-2xl"
      >
        <div className="flex max-h-[calc(100dvh_-_2rem_-_2px)] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2
                  id={`${dialogId}-title`}
                  className="text-base font-semibold leading-snug text-foreground sm:text-lg"
                >
                  {title}
                </h2>
                {artifactPath && (
                  <p className="mt-0.5 break-words font-mono text-xs text-foreground-muted">
                    {artifactPath}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label={`Fechar ${title}`}
              className="shrink-0 cursor-pointer rounded-lg p-2 text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>
          <div
            role="region"
            aria-label="Conteúdo"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain break-words p-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:p-6"
          >
            {isExpanded && renderContent(true)}
          </div>
        </div>
      </dialog>
    </section>
  );
}

export const TriageWorkspace: React.FC<TriageWorkspaceProps> = ({
  workflow,
  allWorkflows,
  availableClis,
  isLightTheme,
  projectPrompts,
  onOpenPromptsConfig,
  onUpdateWorkflow
}) => {
  const [selectedBlock, setSelectedBlock] = useState<WorkflowBlockId>('block1_triage_planning');
  const [orchState, setOrchState] = useState<OrchestratorState | null>(null);
  const [approvalState, setApprovalState] = useState<
    Pick<OrchestratorState, 'workflowId' | 'activeAgent' | 'pendingApprovals'> | null
  >(null);
  const [liveLog, setLiveLog] = useState<string>('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [replanFeedback, setReplanFeedback] = useState('');
  const [showReplanInput, setShowReplanInput] = useState(false);
  const [activityTab, setActivityTab] = useState<'events' | 'log' | 'approvals'>('events');
  const [showTerminal, setShowTerminal] = useState(false);
  const [copiedReview, setCopiedReview] = useState(false);
  const [expandedSubtasks, setExpandedSubtasks] = useState<Record<string, boolean>>({});
  const [isPendingCollapsed, setIsPendingCollapsed] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [terminalCommands, setTerminalCommands] = useState<
    Record<string, { id: number; command: string }>
  >({});

  const activityDialogId = useId();
  const pendingDialogId = useId();
  const pendingContentId = useId();
  const activityDialogRef = useRef<HTMLDialogElement>(null);
  const activityBackdropPressedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const cycleHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastAutoBlockRef = useRef<WorkflowBlockId | null>(null);

  // Conecta ao SSE do Orquestrador para o workflow ativo
  useEffect(() => {
    setApiError(null);
    setOrchState(null);
    setApprovalState(null);
    setLiveLog('');
    setShowPendingModal(false);
    setIsPendingCollapsed(false);
    lastAutoBlockRef.current = null;

    const url = `http://localhost:3001/api/orchestrator/${encodeURIComponent(
      workflow.id
    )}/stream?worktreePath=${encodeURIComponent(workflow.worktreePath)}`;

    const es = new EventSource(url);
    let lastStatus = workflow.status;
    let lastTriageOutput = workflow.triageOutput;

    es.addEventListener('state', (event) => {
      try {
        const nextState: OrchestratorState = JSON.parse((event as MessageEvent).data);
        setOrchState(nextState);
        setApprovalState(nextState.pendingApprovals?.length ? {
          workflowId: nextState.workflowId,
          activeAgent: nextState.activeAgent,
          pendingApprovals: nextState.pendingApprovals
        } : null);
        setLiveLog(nextState.liveLog || '');

        if (nextState.activeBlock && nextState.activeBlock !== lastAutoBlockRef.current) {
          lastAutoBlockRef.current = nextState.activeBlock;
          setSelectedBlock(nextState.activeBlock);
        }

        if (nextState.status !== lastStatus || nextState.triageOutput !== lastTriageOutput) {
          lastStatus = nextState.status;
          lastTriageOutput = nextState.triageOutput;
          onUpdateWorkflow(workflow.id, {
            status: lastStatus,
            triageOutput: lastTriageOutput
          });
        }
      } catch {
        // Ignora parse inválido
      }
    });

    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (typeof data.liveLog === 'string') {
          setLiveLog(data.liveLog);
        }
      } catch {
        // Ignora
      }
    });

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id, workflow.worktreePath]);

  const scrollActivityLog = useCallback(() => {
    const log = logRef.current;
    if (activityDialogRef.current?.open && log) {
      log.scrollTop = log.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollActivityLog();
  }, [liveLog, activityTab, scrollActivityLog]);

  const status: WorkflowStatus = orchState?.status || workflow.status || 'idle';
  const isRunning = RUNNING_STATUSES.includes(status);
  const triageOutput = orchState?.triageOutput ?? workflow.triageOutput;
  const triageConclusion = orchState?.triageConclusion;
  const awaitingTriageConfirmation = status === 'awaiting_triage_confirmation';
  const triageDescriptionChanged = awaitingTriageConfirmation &&
    workflow.problemDescription.trim() !== orchState?.problemDescription;
  const plan = orchState?.plan || null;
  const reviewRounds = orchState?.reviewRounds || [];
  const latestReview = reviewRounds.length > 0 ? reviewRounds[reviewRounds.length - 1] : null;
  const events = orchState?.events || [];
  const pendingApprovals = approvalState?.workflowId === workflow.id ? approvalState.pendingApprovals ?? [] : [];
  const awaitingCliApproval = pendingApprovals.length > 0;
  const approvalAgentLabel = WORKFLOW_STAGES.find((stage) => stage.id === approvalState?.activeAgent)?.label
    ?? 'Subagente ativo';

  useEffect(() => {
    if (awaitingCliApproval && activityDialogRef.current?.open) setActivityTab('approvals');
  }, [awaitingCliApproval, workflow.id]);

  const totalSubtasks = plan
    ? plan.phases.reduce((acc, ph) => acc + ph.subtasks.length, 0)
    : 0;
  const completedSubtasks = plan
    ? plan.phases.reduce(
        (acc, ph) => acc + ph.subtasks.filter((s) => s.status === 'passed').length,
        0
      )
    : 0;

  const triggerTerminalCommand = (cmd: string) => {
    setShowTerminal(true);
    setTerminalCommands((prev) => ({
      ...prev,
      [workflow.id]: {
        id: Date.now() + Math.random(),
        command: cmd
      }
    }));
  };

  const handleChangeCli = (cliId: string) => {
    const found = availableClis.find((c) => c.id === cliId);
    if (found) {
      onUpdateWorkflow(workflow.id, {
        selectedCliId: found.id,
        selectedCliName: found.name,
        selectedCliCommand: found.command
      });
    }
  };

  const callOrchestrator = async (endpoint: string, body: Record<string, unknown>) => {
    setApiError(null);
    try {
      const res = await fetch(`http://localhost:3001/api/orchestrator/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Erro ao chamar ${endpoint}`);
      }
      if (json.state) {
        setOrchState(json.state);
      }
    } catch (err: any) {
      setApiError(err.message);
    }
  };

  const handleStartBlock1 = () => {
    if (!workflow.problemDescription.trim()) return;
    setShowReplanInput(false);
    setReplanFeedback('');
    callOrchestrator('start-block1', {
      workflowId: workflow.id,
      worktreePath: workflow.worktreePath,
      cliCommand: workflow.selectedCliCommand,
      cliName: workflow.selectedCliName,
      problemDescription: workflow.problemDescription,
      prompts: projectPrompts
    });
  };

  const handleConfirmTriage = () => {
    if (!triageConclusion || triageDescriptionChanged) return;
    callOrchestrator('confirm-triage', {
      workflowId: workflow.id,
      worktreePath: workflow.worktreePath,
      cliCommand: workflow.selectedCliCommand,
      cliName: workflow.selectedCliName,
      triageId: triageConclusion.id,
      problemDescription: workflow.problemDescription,
      prompts: projectPrompts
    });
  };

  const handleReplan = () => {
    setShowReplanInput(false);
    callOrchestrator('replan', {
      workflowId: workflow.id,
      worktreePath: workflow.worktreePath,
      cliCommand: workflow.selectedCliCommand,
      cliName: workflow.selectedCliName,
      feedback: replanFeedback,
      prompts: projectPrompts
    });
    setReplanFeedback('');
  };

  const handleApprovePlan = () => {
    setSelectedBlock('block2_dev_testing');
    callOrchestrator('approve-plan', {
      workflowId: workflow.id,
      worktreePath: workflow.worktreePath,
      cliCommand: workflow.selectedCliCommand,
      cliName: workflow.selectedCliName,
      prompts: projectPrompts
    });
  };

  const handleResumeBlock2 = () => {
    setSelectedBlock('block2_dev_testing');
    callOrchestrator('resume', {
      workflowId: workflow.id,
      worktreePath: workflow.worktreePath,
      cliCommand: workflow.selectedCliCommand,
      cliName: workflow.selectedCliName,
      prompts: projectPrompts
    });
  };

  const handleStop = () => {
    callOrchestrator('stop', { workflowId: workflow.id });
  };

  const handleCopyReview = () => {
    if (!latestReview) return;
    navigator.clipboard.writeText(latestReview.summary);
    setCopiedReview(true);
    setTimeout(() => setCopiedReview(false), 2000);
  };

  const toggleSubtaskExpand = (id: string) => {
    setExpandedSubtasks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const installedClis = availableClis.filter((c) => c.installed);
  const statusBadge = awaitingCliApproval
    ? { label: 'Aguardando sua aprovação', className: 'bg-amber-500/10 text-warning border-amber-500/30' }
    : getStatusBadgeInfo(status);

  // Badges de cada um dos 3 Blocos (mesma estética da engrenagem)
  const block1Badge = (() => {
    if (status === 'running_triage')
      return { text: 'Triando...', cls: 'bg-emerald-500/15 border-emerald-500/40 text-accent' };
    if (status === 'running_planning')
      return { text: 'Planejando...', cls: 'bg-emerald-500/15 border-emerald-500/40 text-accent' };
    if (status === 'awaiting_triage_confirmation')
      return { text: 'Revisar ressalvas', cls: 'bg-amber-500/15 border-amber-500/40 text-warning-strong' };
    if (status === 'triage_blocked')
      return { text: 'Triagem bloqueada', cls: 'bg-red-500/15 border-red-500/40 text-danger' };
    if (status === 'failed' && orchState?.activeBlock === 'block1_triage_planning')
      return { text: 'Falha', cls: 'bg-red-500/15 border-red-500/40 text-danger' };
    if (status === 'awaiting_plan_approval')
      return { text: 'Aprovar Plano', cls: 'bg-amber-500/15 border-amber-500/40 text-warning-strong' };
    if (plan && ['running_dev', 'running_tests', 'running_code_review', 'ready_for_github'].includes(status))
      return { text: 'Aprovado', cls: 'bg-emerald-500/10 border-emerald-500/30 text-accent' };
    if (plan)
      return { text: 'Planejado', cls: 'bg-emerald-500/10 border-emerald-500/30 text-accent' };
    return { text: 'Pendente', cls: 'bg-surface border-line text-foreground-muted' };
  })();

  const block2Badge = (() => {
    if (status === 'running_dev')
      return { text: 'Desenvolvendo', cls: 'bg-sky-500/15 border-sky-500/40 text-info' };
    if (status === 'running_tests')
      return { text: 'Testando', cls: 'bg-violet-500/15 border-violet-500/40 text-testing' };
    if (status === 'failed' && orchState?.activeBlock === 'block2_dev_testing')
      return { text: 'Falhou (4/4)', cls: 'bg-red-500/15 border-red-500/40 text-danger' };
    if (totalSubtasks > 0 && completedSubtasks === totalSubtasks)
      return { text: `${completedSubtasks}/${totalSubtasks} OK`, cls: 'bg-emerald-500/10 border-emerald-500/30 text-accent' };
    if (totalSubtasks > 0)
      return { text: `${completedSubtasks}/${totalSubtasks} subtarefas`, cls: 'bg-surface border-line-strong text-foreground-tertiary' };
    return { text: 'Aguardando Bloco 1', cls: 'bg-surface border-line text-foreground-muted' };
  })();

  const block3Badge = (() => {
    if (status === 'running_code_review')
      return { text: 'Revisando...', cls: 'bg-indigo-500/15 border-indigo-500/40 text-review' };
    if (status === 'ready_for_github')
      return { text: 'Pronto p/ GitHub', cls: 'bg-emerald-500/15 border-emerald-500/40 text-accent' };
    if (latestReview?.verdict === 'return_to_block2')
      return { text: 'Voltou ao Bloco 2', cls: 'bg-amber-500/15 border-amber-500/40 text-warning-strong' };
    return { text: 'Aguardando Bloco 2', cls: 'bg-surface border-line text-foreground-muted' };
  })();

  const blocks: {
    id: WorkflowBlockId;
    number: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    badge: { text: string; cls: string };
  }[] = [
    {
      id: 'block1_triage_planning',
      number: 'Bloco 1',
      title: 'Triagem e Planejamento',
      description:
        'Traduz o problema e gera o plano sequencial em fases e subtarefas para aprovação humana.',
      icon: Sparkles,
      badge: block1Badge
    },
    {
      id: 'block2_dev_testing',
      number: 'Bloco 2',
      title: 'Desenvolvimento e Testes',
      description:
        'Executa cada subtarefa com testes novos + regressão e correção automática (até 4 tentativas).',
      icon: Code2,
      badge: block2Badge
    },
    {
      id: 'block3_code_review',
      number: 'Bloco 3',
      title: 'Code Review e GitHub',
      description:
        'Revisa todas as alterações e decide se está pronto para o GitHub ou se retorna ao Bloco 2.',
      icon: SearchCheck,
      badge: block3Badge
    }
  ];

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-canvas">
      {/* Cabeçalho do Workflow */}
      <header className="px-5 py-3 bg-surface/90 border-b border-line flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-surface-muted text-foreground-tertiary">
              {workflow.projectName}
            </span>
            <h1 className="text-base font-semibold text-foreground truncate">
              {workflow.worktreeName}
            </h1>
            <span
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border ${statusBadge.className}`}
            >
              {statusBadge.spinning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : status === 'ready_for_github' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : status === 'failed' ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
              {statusBadge.label}
            </span>
          </div>

          <div className="flex items-center gap-4 mt-1.5 text-xs text-foreground-subtle">
            <span className="inline-flex items-center gap-1.5 font-mono text-accent/90">
              <GitBranch className="w-3.5 h-3.5" />
              {workflow.branch}
            </span>
            <span
              className="inline-flex items-center gap-1.5 font-mono truncate max-w-md"
              title={workflow.worktreePath}
            >
              <FolderGit2 className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
              {workflow.worktreePath}
            </span>
          </div>
        </div>

        {/* Controles do workflow */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-canvas border border-line rounded-lg px-2.5 py-1">
            <Bot className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="text-[11px] text-foreground-subtle">CLI:</span>
            <select
              value={workflow.selectedCliId}
              disabled={isRunning}
              onChange={(e) => handleChangeCli(e.target.value)}
              className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer disabled:opacity-50"
            >
              {installedClis.length === 0 && (
                <option value="" className="bg-surface">
                  Nenhum CLI detectado
                </option>
              )}
              {availableClis.map((cli) => (
                <option
                  key={cli.id}
                  value={cli.id}
                  disabled={!cli.installed}
                  className="bg-surface text-foreground"
                >
                  {cli.name} ({cli.command}) {cli.installed ? '' : '— não instalado'}
                </option>
              ))}
            </select>
          </div>

          {isRunning && (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-danger-strong text-xs font-medium transition cursor-pointer"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Pausar</span>
            </button>
          )}

          <button
            onClick={onOpenPromptsConfig}
            title="Configurar os 5 prompts deste diretório"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-canvas border border-line hover:border-line-strong text-xs text-foreground-tertiary transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-accent" />
            <span className="hidden xl:inline">Prompts</span>
          </button>

          <button
            type="button"
            onClick={() => cycleHeadingRef.current?.focus()}
            aria-label="Orquestrador"
            title="Ir para o ciclo do Orquestrador"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-canvas border border-line hover:border-line-strong text-xs font-medium text-foreground-tertiary transition cursor-pointer"
          >
            <Workflow className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">Orquestrador</span>
          </button>

          <button
            type="button"
            onClick={(event) => {
              if (awaitingCliApproval) setActivityTab('approvals');
              else if (activityTab === 'approvals') setActivityTab('events');
              event.currentTarget.focus();
              activityDialogRef.current?.showModal();
              scrollActivityLog();
            }}
            aria-label={awaitingCliApproval ? 'Atividade do Orquestrador com aprovação pendente' : 'Atividade do Orquestrador'}
            aria-haspopup="dialog"
            aria-controls={activityDialogId}
            title="Atividade do Orquestrador"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-canvas border border-line hover:border-line-strong text-xs font-medium text-foreground-tertiary transition cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
            <span className="hidden xl:inline">Atividade</span>
            {awaitingCliApproval ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] text-warning-strong">
                {pendingApprovals.length}
              </span>
            ) : events.length > 0 && (
              <span className="text-[10px] px-1.5 rounded-full bg-surface-muted text-foreground-tertiary">
                {events.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-strong text-xs font-medium text-foreground-secondary transition cursor-pointer"
          >
            <TerminalIcon className="w-3.5 h-3.5 text-foreground-subtle" />
            <span>{showTerminal ? 'Ocultar' : 'Terminal'}</span>
            {showTerminal ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </header>

      {/* Corpo Principal: Layout Visual em Cards (idêntico à Engrenagem de Prompts) */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
        {/* Erro global da API ou do Orquestrador */}
        {(apiError || orchState?.error) && (
          <div className="p-3.5 rounded-xl bg-danger-surface/40 border border-danger-line/60 text-xs text-danger-strong flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
            <div className="flex-1">
              <div className="font-semibold text-danger-strong mb-0.5">Atenção do Orquestrador</div>
              <div className="whitespace-pre-wrap">{apiError || orchState?.error}</div>
            </div>
          </div>
        )}

        {/* 3 Cards dos Blocos do Ciclo de Desenvolvimento */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 ref={cycleHeadingRef} tabIndex={-1} className="text-xs font-medium text-foreground-tertiary">
              Ciclo de Desenvolvimento Orquestrado (selecione um bloco)
            </h2>
            {orchState?.activeAgent && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-accent">
                <Loader2 className="w-3 h-3 animate-spin" />
                Subagente isolado ativo: <strong className="uppercase">{orchState.activeAgent}</strong>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {blocks.map((block) => {
              const Icon = block.icon;
              const isSelected = selectedBlock === block.id;
              const isOrchestratorHere = isRunning && orchState?.activeBlock === block.id;

              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setSelectedBlock(block.id)}
                  className={`flex flex-col justify-between p-3.5 rounded-xl border text-left transition cursor-pointer h-full min-h-[126px] ${
                    isSelected
                      ? 'bg-emerald-500/10 border-accent-line shadow-sm'
                      : 'bg-panel border-line hover:border-line-strong'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            isSelected
                              ? 'bg-emerald-500/20 text-accent'
                              : 'bg-surface text-foreground-subtle'
                          }`}
                        >
                          {isOrchestratorHere ? (
                            <Loader2 className="w-4 h-4 animate-spin text-accent" />
                          ) : (
                            <Icon className="w-4 h-4" />
                          )}
                        </div>
                        <span className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                          {block.number}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${block.badge.cls}`}
                      >
                        {block.badge.text}
                      </span>
                    </div>

                    <div className="text-sm font-semibold text-foreground">{block.title}</div>
                  </div>

                  <p className="text-[11px] text-foreground-subtle leading-snug mt-1.5">
                    {block.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Painel Contextual do Bloco Selecionado */}
        {selectedBlock === 'block1_triage_planning' && (
          <div className="bg-panel border border-line rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                  Bloco 1 — Triagem e Planejamento
                </span>
              </div>

              <button
                type="button"
                onClick={handleStartBlock1}
                disabled={
                  isRunning || !workflow.problemDescription.trim() || !workflow.selectedCliCommand
                }
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-xs font-semibold transition cursor-pointer"
              >
                {status === 'running_triage' || status === 'running_planning' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {status === 'running_triage' ? 'Executando Triagem...' : 'Gerando Plano...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>
                      {triageOutput || plan || status === 'failed' || status === 'paused'
                        ? 'Refazer triagem'
                        : 'Iniciar triagem'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Entrada do Problema */}
            <div>
              <label className="block text-[11px] font-medium text-foreground-subtle mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Descrição do Problema / Tarefa
              </label>
              <textarea
                rows={4}
                disabled={isRunning}
                value={workflow.problemDescription}
                onChange={(e) =>
                  onUpdateWorkflow(workflow.id, { problemDescription: e.target.value })
                }
                placeholder="Descreva a tarefa e inclua as regras de negócio, referências e esclarecimentos disponíveis."
                className="w-full bg-surface/80 border border-line rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-accent-line resize-y leading-relaxed disabled:opacity-60"
              />
            </div>

            {triageConclusion && (
              <section aria-label="Conclusão da triagem" className="min-w-0 space-y-2 rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-foreground-tertiary">Prontidão para planejamento</p>
                    <h3 className="text-sm font-semibold text-foreground">
                      {READINESS_LABELS[triageConclusion.readiness]}
                    </h3>
                  </div>
                  {awaitingTriageConfirmation && (
                    <button
                      type="button"
                      onClick={handleConfirmTriage}
                      disabled={triageDescriptionChanged || !workflow.selectedCliCommand}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Planejar com ressalvas
                    </button>
                  )}
                </div>
                <MarkdownContent content={triageConclusion.justification} size="xs" />
                {triageConclusion.readiness !== 'ready' && triageConclusion.pendingDetails && (
                  <div className="space-y-2 rounded-lg border border-line/80 bg-canvas/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPendingCollapsed((prev) => !prev)}
                        aria-expanded={!isPendingCollapsed}
                        aria-controls={pendingContentId}
                        className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {isPendingCollapsed ? (
                          <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />
                        ) : (
                          <ChevronUp className="h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />
                        )}
                        <span>Pendências e incertezas</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPendingModal(true)}
                        aria-label="Expandir Pendências e incertezas"
                        aria-haspopup="dialog"
                        aria-controls={pendingDialogId}
                        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-xs font-medium text-foreground-tertiary transition-colors hover:border-line-strong hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <Maximize2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                        Expandir
                      </button>
                    </div>
                    {!isPendingCollapsed && (
                      <div
                        id={pendingContentId}
                        className="max-h-[340px] overflow-y-auto rounded-lg border border-line/70 bg-canvas p-3"
                      >
                        <MarkdownContent content={triageConclusion.pendingDetails} size="xs" />
                      </div>
                    )}
                  </div>
                )}
                {triageDescriptionChanged ? (
                  <p className="text-xs text-warning-strong">A descrição mudou. Refaça a triagem antes de planejar.</p>
                ) : status === 'triage_blocked' ? (
                  <p className="text-xs text-foreground-tertiary">Resolva as pendências e selecione Refazer triagem.</p>
                ) : null}
              </section>
            )}

            {status === 'awaiting_plan_approval' && plan && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-accent-strong flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Checkpoint Humano — Aprovação do Planejamento
                    </div>
                    <p className="text-xs text-foreground-tertiary mt-1">
                      Revise as <strong>{plan.phases.length} fase(s)</strong> e{' '}
                      <strong>{totalSubtasks} subtarefa(s)</strong> abaixo. Ao aprovar, o
                      Orquestrador executará automaticamente o <strong>Bloco 2</strong>{' '}
                      (Desenvolvimento + Testes) e o <strong>Bloco 3</strong> (Code Review).
                    </p>
                    {!triageConclusion && (
                      <p className="mt-1 text-xs text-foreground-tertiary">
                        Para ajustar este plano, refaça a triagem com o formato atual.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {triageConclusion && (
                      <button
                        type="button"
                        onClick={() => setShowReplanInput((v) => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-muted border border-line-strong text-xs font-medium text-foreground-secondary transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Ajustar Plano</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleApprovePlan}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-sm transition cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Aprovar Plano e Iniciar Bloco 2</span>
                    </button>
                  </div>
                </div>

                {triageConclusion && showReplanInput && (
                  <div className="pt-2 border-t border-emerald-500/20 flex gap-2">
                    <input
                      type="text"
                      value={replanFeedback}
                      onChange={(e) => setReplanFeedback(e.target.value)}
                      placeholder="Descreva o que deseja ajustar nas fases ou subtarefas..."
                      className="flex-1 bg-canvas border border-line rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent-line"
                    />
                    <button
                      type="button"
                      onClick={handleReplan}
                      disabled={!replanFeedback.trim()}
                      className="px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-strong disabled:opacity-40 text-xs font-medium text-foreground cursor-pointer"
                    >
                      Refazer Planejamento
                    </button>
                  </div>
                )}
              </div>
            )}

            <div key={workflow.id} className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <WorkflowArtifactPanel
                title="Artefato de Triagem"
                icon={Sparkles}
                artifactPath={orchState?.triageArtifactPath ? '.workflow/01-triage.md' : undefined}
                renderContent={(expanded) =>
                  triageOutput ? (
                    <MarkdownContent content={triageOutput} size={expanded ? 'sm' : 'xs'} />
                  ) : (
                    <div className="flex h-full items-center justify-center py-10 text-center text-foreground-muted">
                      O artefato de Triagem aparecerá aqui após iniciar o Bloco 1.
                    </div>
                  )
                }
              />

              <WorkflowArtifactPanel
                title="Planejamento (Fases e Subtarefas)"
                icon={ClipboardList}
                artifactPath={orchState?.planArtifactPath ? '.workflow/02-plan.json' : undefined}
                renderContent={(expanded) =>
                  plan ? (
                    <div className="space-y-3">
                      {plan.summary && (
                        <p className="whitespace-pre-wrap border-b border-line/80 pb-2 leading-relaxed text-foreground-tertiary">
                          {plan.summary}
                        </p>
                      )}
                      {plan.phases.map((phase) => (
                        <div
                          key={phase.id}
                          className="p-2.5 rounded-lg bg-surface/70 border border-line space-y-2"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                            <h4 className="min-w-0 font-semibold text-foreground">
                              Fase {phase.order}: {phase.title}
                            </h4>
                            <span className="text-[0.875em] text-foreground-muted">
                              {phase.subtasks.length} subtarefa(s)
                            </span>
                          </div>
                          {phase.description && (
                            <p className="whitespace-pre-wrap text-[0.875em] leading-relaxed text-foreground-subtle">
                              {phase.description}
                            </p>
                          )}
                          <ol className="space-y-1.5 pl-1">
                            {phase.subtasks.map((sub) => (
                              <li
                                key={sub.id}
                                className="rounded border border-line/70 bg-canvas/70 px-2.5 py-1.5 text-[0.875em] leading-relaxed text-foreground-tertiary"
                              >
                                <span className="font-mono text-accent mr-1.5">
                                  {phase.order}.{sub.order}
                                </span>
                                <span className="font-medium text-foreground-secondary">{sub.title}</span>
                                {sub.description && (
                                  <p className="mt-0.5 whitespace-pre-wrap text-foreground-muted">
                                    {sub.description}
                                  </p>
                                )}
                                <div className="mt-2">
                                  <SubtaskVerification subtask={sub} showAcceptanceCriteria={expanded} />
                                </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center py-10 text-center text-foreground-muted">
                      O plano aparecerá aqui após o planejamento.
                    </div>
                  )
                }
              />
            </div>
          </div>
        )}

        {selectedBlock === 'block2_dev_testing' && (
          <div className="bg-panel border border-line rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                  Bloco 2 — Desenvolvimento e Testes por Subtarefa
                </span>
                {totalSubtasks > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface border border-line text-foreground-tertiary">
                    {completedSubtasks}/{totalSubtasks} aprovadas
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {plan && (status === 'paused' || status === 'failed') && (
                  <button
                    type="button"
                    onClick={handleResumeBlock2}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Retomar Bloco 2</span>
                  </button>
                )}
              </div>
            </div>

            {!plan ? (
              <div className="p-8 rounded-xl bg-surface/40 border border-dashed border-line text-center text-xs text-foreground-muted">
                Conclua e aprove o Planejamento no <strong className="text-foreground-tertiary">Bloco 1</strong>{' '}
                para liberar o ciclo sequencial de Desenvolvimento e Testes.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Barra de Progresso */}
                <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full bg-accent-line transition-all duration-300"
                    style={{
                      width: `${totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0}%`
                    }}
                  />
                </div>

                {/* Lista Sequencial de Fases e Subtarefas */}
                {plan.phases.map((phase) => (
                  <div
                    key={phase.id}
                    className={`rounded-xl border p-3.5 space-y-2.5 ${
                      phase.source === 'code_review'
                        ? 'bg-amber-500/5 border-amber-500/30'
                        : 'bg-surface/50 border-line'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          Fase {phase.order}: {phase.title}
                        </span>
                        {phase.source === 'code_review' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-warning-strong font-medium">
                            Retorno do Code Review · Rodada {phase.reviewRound}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-foreground-muted">
                        {phase.subtasks.filter((s) => s.status === 'passed').length}/
                        {phase.subtasks.length} concluídas
                      </span>
                    </div>

                    <div className="space-y-2">
                      {phase.subtasks.map((sub) => {
                        const badge = getSubtaskBadge(sub);
                        const isActiveSub = orchState?.currentSubtaskId === sub.id && isRunning;
                        const isExpanded = Boolean(expandedSubtasks[sub.id]) || sub.status === 'failed';

                        return (
                          <div
                            key={sub.id}
                            className={`rounded-lg border p-3 transition ${
                              isActiveSub
                                ? 'bg-emerald-500/5 border-emerald-500/50'
                                : 'bg-canvas border-line/90'
                            }`}
                          >
                            <div
                              onClick={() => toggleSubtaskExpand(sub.id)}
                              className="flex items-center justify-between gap-3 cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {sub.status === 'passed' ? (
                                  <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                                ) : sub.status === 'failed' ? (
                                  <XCircle className="w-4 h-4 text-danger shrink-0" />
                                ) : isActiveSub ? (
                                  <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
                                ) : (
                                  <Clock className="w-4 h-4 text-foreground-faint shrink-0" />
                                )}

                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-foreground truncate">
                                    <span className="font-mono text-foreground-muted mr-1.5">
                                      {phase.order}.{sub.order}
                                    </span>
                                    {sub.title}
                                  </div>
                                  {sub.description && (
                                    <div className="text-[11px] text-foreground-muted truncate">
                                      {sub.description}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {sub.attempts > 0 && (
                                  <span className="text-[10px] font-mono text-foreground-subtle">
                                    Tentativa {sub.attempts}/{sub.maxAttempts}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.className}`}
                                >
                                  {badge.label}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />
                                )}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="mt-3 pt-3 border-t border-line/80 space-y-2.5 text-[11px]">
                                {sub.description && (
                                  <p className="text-foreground-tertiary whitespace-pre-wrap">
                                    {sub.description}
                                  </p>
                                )}

                                <SubtaskVerification subtask={sub} />

                                {sub.devSummary && (
                                  <div className="p-2.5 rounded-lg bg-surface/70 border border-line">
                                    <div className="font-semibold text-info mb-1 flex items-center gap-1.5">
                                      <Code2 className="w-3.5 h-3.5" />
                                      Artefato de Desenvolvimento
                                    </div>
                                    <p className="text-foreground-tertiary whitespace-pre-wrap">
                                      {sub.devSummary}
                                    </p>
                                  </div>
                                )}

                                {(sub.testSummary || sub.newTestsSummary || sub.regressionSummary) && (
                                  <div className="p-2.5 rounded-lg bg-surface/70 border border-line space-y-1.5">
                                    <div className="font-semibold text-testing flex items-center gap-1.5">
                                      <FlaskConical className="w-3.5 h-3.5" />
                                      Artefato de Testes (Novos + Regressão)
                                    </div>
                                    {sub.testSummary && (
                                      <p className="text-foreground-secondary">{sub.testSummary}</p>
                                    )}
                                    {sub.newTestsSummary && (
                                      <p className="text-foreground-subtle">
                                        <strong className="text-foreground-tertiary">Novos testes:</strong>{' '}
                                        {sub.newTestsSummary}
                                      </p>
                                    )}
                                    {sub.regressionSummary && (
                                      <p className="text-foreground-subtle">
                                        <strong className="text-foreground-tertiary">Regressão:</strong>{' '}
                                        {sub.regressionSummary}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {sub.lastError && (
                                  <div className="p-2.5 rounded-lg bg-danger-surface/40 border border-danger-line/50 text-danger-strong whitespace-pre-wrap">
                                    <strong>Última falha registrada:</strong>
                                    {'\n'}
                                    {sub.lastError}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedBlock === 'block3_code_review' && (
          <div className="bg-panel border border-line rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <SearchCheck className="w-4 h-4 text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                  Bloco 3 — Code Review e Veredito para GitHub
                </span>
              </div>
              {reviewRounds.length > 0 && (
                <span className="text-[11px] text-foreground-muted">
                  {reviewRounds.length} rodada(s) executada(s)
                </span>
              )}
            </div>

            {status === 'running_code_review' && (
              <div className="p-5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-review animate-spin shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-review">
                    Subagente de Code Review analisando a worktree...
                  </div>
                  <p className="text-[11px] text-foreground-subtle mt-0.5">
                    Verificando diff, critérios de aceite, qualidade e cobertura de testes.
                  </p>
                </div>
              </div>
            )}

            {latestReview ? (
              <div className="space-y-4">
                {/* Banner de Veredito */}
                {latestReview.verdict === 'ready_for_github' ? (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 space-y-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 text-accent-strong font-semibold text-sm">
                        <GitPullRequest className="w-5 h-5 text-accent" />
                        <span>Pronto para enviar ao GitHub!</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyReview}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-muted border border-line-strong text-xs text-foreground-secondary transition cursor-pointer"
                      >
                        {copiedReview ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-accent" />
                            <span>Resumo Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar Resumo</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-foreground-secondary leading-relaxed whitespace-pre-wrap">
                      {latestReview.summary}
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 text-warning-strong font-semibold text-sm">
                        <AlertTriangle className="w-5 h-5 text-warning" />
                        <span>Precisa voltar para o Bloco 2 (Ajustes solicitados)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedBlock('block2_dev_testing')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-muted border border-line-strong text-xs text-foreground-secondary transition cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Acompanhar correções no Bloco 2</span>
                      </button>
                    </div>
                    <p className="text-xs text-foreground-secondary leading-relaxed whitespace-pre-wrap">
                      {latestReview.summary}
                    </p>
                  </div>
                )}

                {/* Histórico das Rodadas de Code Review */}
                <div className="space-y-3">
                  {[...reviewRounds].reverse().map((r) => (
                    <div
                      key={r.round}
                      className="rounded-xl bg-surface/60 border border-line p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground-secondary">
                          Rodada {r.round}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                            r.verdict === 'ready_for_github'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-accent'
                              : 'bg-amber-500/10 border-amber-500/30 text-warning-strong'
                          }`}
                        >
                          {r.verdict === 'ready_for_github'
                            ? 'Aprovado p/ GitHub'
                            : 'Retornado ao Bloco 2'}
                        </span>
                      </div>

                      <p className="text-xs text-foreground-tertiary whitespace-pre-wrap">{r.summary}</p>

                      {r.issues.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-line/80">
                          <div className="text-[11px] font-medium text-foreground-subtle">
                            Apontamentos convertidos em subtarefas no Bloco 2 ({r.issues.length}):
                          </div>
                          {r.issues.map((iss) => (
                            <div
                              key={iss.id}
                              className="p-2.5 rounded-lg bg-canvas border border-line text-xs space-y-1"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${
                                    iss.severity === 'critical'
                                      ? 'bg-red-500/10 border-red-500/30 text-danger'
                                      : iss.severity === 'major'
                                      ? 'bg-amber-500/10 border-amber-500/30 text-warning-strong'
                                      : 'bg-surface border-line-strong text-foreground-subtle'
                                  }`}
                                >
                                  {iss.severity}
                                </span>
                                <span className="font-semibold text-foreground">{iss.title}</span>
                                {iss.file && (
                                  <code className="text-[10px] text-foreground-muted font-mono">
                                    {iss.file}
                                  </code>
                                )}
                              </div>
                              {iss.description && (
                                <p className="text-[11px] text-foreground-subtle">{iss.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              status !== 'running_code_review' && (
                <div className="p-8 rounded-xl bg-surface/40 border border-dashed border-line text-center text-xs text-foreground-muted">
                  Assim que todas as fases e subtarefas do{' '}
                  <strong className="text-foreground-tertiary">Bloco 2</strong> passarem nos testes, o
                  Orquestrador executará automaticamente o Code Review aqui.
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Painel Inferior: Terminal Isolado do Git Worktree */}
      <div
        className={`border-t border-line flex flex-col shrink-0 transition-all ${
          showTerminal ? 'h-64' : 'h-0 overflow-hidden border-none'
        }`}
      >
        <div className="px-4 py-1.5 bg-surface border-b border-line flex items-center justify-between text-xs text-foreground-subtle">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-3.5 h-3.5 text-accent" />
            <span>Terminal da Worktree:</span>
            <code className="text-foreground-secondary font-mono">{workflow.worktreePath}</code>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => triggerTerminalCommand(workflow.selectedCliCommand)}
              disabled={!workflow.selectedCliCommand}
              className="px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-[11px] text-accent-strong cursor-pointer"
            >
              Abrir {workflow.selectedCliName || 'CLI'}
            </button>
          </div>
        </div>

        <div className="flex-1 relative min-h-0">
          {allWorkflows.map((wf) => (
            <WebTerminal
              key={wf.id}
              sessionId={wf.id}
              cwd={wf.worktreePath}
              isActive={wf.id === workflow.id}
              isLightTheme={isLightTheme}
              commandToInject={terminalCommands[wf.id] || null}
            />
          ))}
        </div>
      </div>

      <dialog
        ref={activityDialogRef}
        id={activityDialogId}
        aria-labelledby={`${activityDialogId}-title`}
        onPointerDown={(event) => {
          activityBackdropPressedRef.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (activityBackdropPressedRef.current && event.target === event.currentTarget) {
            event.currentTarget.close();
          }
        }}
        className="app-modal-dialog m-auto w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-2xl border border-line bg-panel p-0 text-foreground shadow-2xl"
      >
        <div className="flex h-[min(28rem,calc(100dvh_-_2rem_-_2px))] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
              </div>
              <h2 id={`${activityDialogId}-title`} className="text-sm font-semibold text-foreground">
                Agente Orquestrador (Isolamento por Artefatos)
              </h2>
            </div>
            <button
              type="button"
              onClick={() => activityDialogRef.current?.close()}
              aria-label="Fechar atividade do Orquestrador"
              className="shrink-0 cursor-pointer rounded-lg p-2 text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div
            role="group"
            aria-label="Visualização da atividade"
            className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-4 py-2 sm:px-5"
          >
            <button
              type="button"
              onClick={() => setActivityTab('events')}
              aria-pressed={activityTab === 'events'}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activityTab === 'events'
                  ? 'bg-emerald-500/15 text-accent-strong'
                  : 'text-foreground-subtle hover:bg-surface-muted hover:text-foreground-secondary'
              }`}
            >
              Eventos ({events.length})
            </button>
            <button
              type="button"
              onClick={() => setActivityTab('log')}
              aria-pressed={activityTab === 'log'}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activityTab === 'log'
                  ? 'bg-emerald-500/15 text-accent-strong'
                  : 'text-foreground-subtle hover:bg-surface-muted hover:text-foreground-secondary'
              }`}
            >
              Log ao vivo do CLI
            </button>
            {(awaitingCliApproval || activityTab === 'approvals') && (
              <button
                type="button"
                onClick={() => setActivityTab('approvals')}
                aria-pressed={activityTab === 'approvals'}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium ${
                  activityTab === 'approvals' ? 'bg-amber-500/15 text-warning-strong' : 'text-warning hover:bg-surface-muted'
                }`}
              >
                Aprovações ({pendingApprovals.length})
              </button>
            )}
          </div>

          {activityTab === 'approvals' ? (
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-4 sm:p-5">
              {awaitingCliApproval ? pendingApprovals.map((approval) => (
                <CliApprovalCard
                  key={approval.id}
                  workflowId={workflow.id}
                  agentLabel={approvalAgentLabel}
                  approval={approval}
                />
              )) : (
                <p role="status" className="text-center text-xs text-foreground-muted">Nenhuma aprovação pendente.</p>
              )}
            </div>
          ) : activityTab === 'events' ? (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-4 sm:p-5">
              {events.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-xs text-foreground-muted">
                  Nenhum evento registrado ainda.
                </div>
              ) : (
                [...events].reverse().map((evt) => (
                  <div
                    key={evt.id}
                    className="flex items-start gap-2 text-[11px] bg-surface/50 border border-line/70 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[10px] text-foreground-muted shrink-0 mt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString('pt-BR')}
                    </span>
                    <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-canvas border border-line text-accent shrink-0">
                      {evt.agent}
                    </span>
                    <div className="min-w-0 flex-1 break-words">
                      <span
                        className={
                          evt.level === 'error'
                            ? 'text-danger-strong'
                            : evt.level === 'warning'
                            ? 'text-warning-strong'
                            : evt.level === 'success'
                            ? 'text-accent-strong'
                            : 'text-foreground-tertiary'
                        }
                      >
                        {evt.message}
                      </span>
                      {evt.artifactPath && (
                        <div className="text-[10px] font-mono text-foreground-muted truncate">
                          Artefato: {evt.artifactPath}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div
              ref={logRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words bg-canvas p-4 font-mono text-xs leading-relaxed text-foreground-tertiary sm:p-5"
            >
              {liveLog || 'Aguardando saída do subagente CLI...'}
            </div>
          )}
        </div>
      </dialog>

      <ModalDialog
        isOpen={Boolean(
          showPendingModal &&
            triageConclusion &&
            triageConclusion.readiness !== 'ready' &&
            triageConclusion.pendingDetails
        )}
        onClose={() => setShowPendingModal(false)}
        id={pendingDialogId}
        ariaLabelledBy={`${pendingDialogId}-title`}
        className="w-[calc(100%_-_2rem)] max-w-6xl rounded-2xl border border-line bg-panel shadow-2xl"
      >
        {triageConclusion && triageConclusion.readiness !== 'ready' && triageConclusion.pendingDetails && (
          <div className="flex max-h-[calc(100dvh_-_2rem_-_2px)] flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                    triageConclusion.readiness === 'blocked'
                      ? 'border-red-500/30 bg-red-500/10 text-danger'
                      : 'border-amber-500/30 bg-amber-500/10 text-warning'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2
                    id={`${pendingDialogId}-title`}
                    className="text-base font-semibold leading-snug text-foreground sm:text-lg"
                  >
                    Pendências e incertezas
                  </h2>
                  <p className="mt-0.5 text-xs text-foreground-muted">
                    Prontidão para planejamento: {READINESS_LABELS[triageConclusion.readiness]}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                aria-label="Fechar Pendências e incertezas"
                className="shrink-0 cursor-pointer rounded-lg p-2 text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div
              role="region"
              aria-label="Conteúdo das pendências e incertezas"
              tabIndex={0}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain break-words p-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:p-6"
            >
              <div className="rounded-xl border border-line bg-surface/60 p-3.5">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Justificativa
                </p>
                <MarkdownContent content={triageConclusion.justification} size="sm" />
              </div>

              <MarkdownContent content={triageConclusion.pendingDetails} size="sm" />

              {triageDescriptionChanged ? (
                <p className="text-xs text-warning-strong">
                  A descrição mudou. Refaça a triagem antes de planejar.
                </p>
              ) : status === 'triage_blocked' ? (
                <p className="text-xs text-foreground-tertiary">
                  Resolva as pendências e selecione Refazer triagem.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
};
