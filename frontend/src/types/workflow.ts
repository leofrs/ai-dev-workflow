export interface DetectedCli {
  id: string;
  name: string;
  command: string;
  description: string;
  installed: boolean;
  path: string | null;
}

export interface RegisteredProject {
  id: string;
  name: string;
  path: string;
  isGitRepo: boolean;
}

export type WorkflowStatus =
  | 'idle'
  | 'pending_triage'
  | 'triaged'
  | 'running_triage'
  | 'awaiting_triage_confirmation'
  | 'triage_blocked'
  | 'running_planning'
  | 'awaiting_plan_approval'
  | 'running_dev'
  | 'running_tests'
  | 'running_code_review'
  | 'ready_for_github'
  | 'paused'
  | 'failed';

export type WorkflowStageId =
  | 'triage'
  | 'planning'
  | 'development'
  | 'testing'
  | 'code_review';

export type WorkflowBlockId =
  | 'block1_triage_planning'
  | 'block2_dev_testing'
  | 'block3_code_review';

export type OrchestratorAgentId = 'orchestrator' | WorkflowStageId;

export type ProjectPrompts = Record<WorkflowStageId, string>;

export type PromptsByProject = Record<string, ProjectPrompts>;

export interface WorkflowStageMeta {
  id: WorkflowStageId;
  label: string;
  shortDescription: string;
  placeholder: string;
}

export const WORKFLOW_STAGES: WorkflowStageMeta[] = [
  {
    id: 'triage',
    label: 'Triagem',
    shortDescription: 'Investiga a tarefa e avalia a prontidão para planejamento.',
    placeholder:
      'Exemplo de diretriz do projeto — verifique os consumidores da API e as regras de faturamento relacionadas à tarefa.'
  },
  {
    id: 'planning',
    label: 'Planejamento',
    shortDescription: 'Define fases e subtarefas sequenciais do plano técnico.',
    placeholder:
      'Ex: Leia o artefato de triagem, mapeie os arquivos impactados e estruture um plano sequencial dividido em fases e subtarefas verificáveis...'
  },
  {
    id: 'development',
    label: 'Desenvolvimento',
    shortDescription: 'Implementa cada subtarefa seguindo os padrões do projeto.',
    placeholder:
      'Ex: Implemente exclusivamente a subtarefa atual seguindo os padrões do repositório, mantendo mudanças focadas e limpas...'
  },
  {
    id: 'testing',
    label: 'Testes',
    shortDescription: 'Cria testes para o novo código e valida regressões.',
    placeholder:
      'Ex: Crie testes automatizados para a subtarefa implementada e execute a suíte de testes existente para garantir que não houve regressão...'
  },
  {
    id: 'code_review',
    label: 'Code Review',
    shortDescription: 'Revisa alterações e decide se vai ao GitHub ou volta ao Bloco 2.',
    placeholder:
      'Ex: Execute git diff na worktree atual e faça um code review rigoroso verificando bugs, casos de borda, segurança e aderência aos critérios de aceite...'
  }
];

export const EMPTY_PROJECT_PROMPTS: ProjectPrompts = {
  triage: '',
  planning: '',
  development: '',
  testing: '',
  code_review: ''
};

export interface PlanSubtask {
  id: string;
  order: number;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  howToTest?: string[];
  status: 'pending' | 'developing' | 'testing' | 'passed' | 'failed';
  attempts: number;
  maxAttempts: number;
  devArtifactPath?: string;
  devSummary?: string;
  testArtifactPath?: string;
  testSummary?: string;
  newTestsSummary?: string;
  regressionSummary?: string;
  lastError?: string;
}

export interface PlanPhase {
  id: string;
  order: number;
  title: string;
  description: string;
  source?: 'plan' | 'code_review';
  reviewRound?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  subtasks: PlanSubtask[];
}

export interface WorkflowPlan {
  summary: string;
  phases: PlanPhase[];
}

export interface CodeReviewIssue {
  id: string;
  severity: 'critical' | 'major' | 'minor';
  title: string;
  description: string;
  file?: string;
  howToTest?: string[];
}

export interface CodeReviewRound {
  round: number;
  verdict: 'ready_for_github' | 'return_to_block2';
  summary: string;
  artifactPath?: string;
  issues: CodeReviewIssue[];
  createdAt: string;
}

export interface OrchestratorEvent {
  id: string;
  timestamp: string;
  block: WorkflowBlockId;
  agent: OrchestratorAgentId;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  artifactPath?: string;
}

export interface TriageConclusion {
  id: string;
  readiness: 'ready' | 'ready_with_caveats' | 'blocked';
  justification: string;
  pendingDetails: string;
}

export interface OrchestratorState {
  workflowId: string;
  worktreePath: string;
  status: WorkflowStatus;
  activeBlock: WorkflowBlockId;
  activeAgent: OrchestratorAgentId | null;
  currentPhaseId: string | null;
  currentSubtaskId: string | null;
  reviewRound: number;
  maxReviewRounds: number;
  maxSubtaskAttempts: number;
  problemDescription: string;
  triageOutput: string;
  triageArtifactPath: string | null;
  triageConclusion: TriageConclusion | null;
  plan: WorkflowPlan | null;
  planArtifactPath: string | null;
  reviewRounds: CodeReviewRound[];
  events: OrchestratorEvent[];
  liveLog: string;
  error: string | null;
  updatedAt: string;
}

export interface DevWorkflow {
  id: string;
  projectId: string;
  projectName: string;
  repoPath: string;
  worktreeName: string;
  branch: string;
  worktreePath: string;
  selectedCliId: string;
  selectedCliName: string;
  selectedCliCommand: string;
  status: WorkflowStatus;
  problemDescription: string;
  triageOutput: string;
  createdAt: string;
}
