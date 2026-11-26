import { useState } from 'react';
import type { CliApproval } from '../types/workflow';

const ACTION_LABELS: Record<CliApproval['kind'], string> = {
  command: 'Executar comando',
  network: 'Acessar a rede',
  file_change: 'Alterar arquivos',
  permissions: 'Conceder permissões'
};

interface CliApprovalCardProps {
  workflowId: string;
  agentLabel: string;
  approval: CliApproval;
}

export function CliApprovalCard({ workflowId, agentLabel, approval }: CliApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approvalLabel = approval.kind === 'permissions' || approval.grantRoot
    ? 'Aprovar nesta etapa'
    : 'Aprovar uma vez';

  const decide = async (decision: 'approve' | 'deny') => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `http://localhost:3001/api/orchestrator/${encodeURIComponent(workflowId)}/approvals/${encodeURIComponent(approval.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision })
        }
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Erro ao enviar a decisão.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar a decisão.');
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 text-xs">
      <div>
        <span className="text-foreground-subtle">Codex · {agentLabel}</span>
        <h3 className="mt-0.5 text-sm font-semibold text-foreground">{ACTION_LABELS[approval.kind]}</h3>
      </div>
      {approval.reason && <p className="whitespace-pre-wrap break-words text-foreground-secondary">{approval.reason}</p>}
      {approval.network && (
        <p className="break-all font-mono text-foreground-secondary">
          {approval.network.protocol} · {approval.network.host}
        </p>
      )}
      {approval.command && (
        <pre className="rounded-md border border-line bg-canvas p-2 whitespace-pre-wrap break-all font-mono text-foreground-secondary">
          {approval.command}
        </pre>
      )}
      {approval.paths && approval.paths.length > 0 && (
        <ul className="space-y-1 break-all font-mono text-foreground-secondary">
          {approval.paths.map((file) => <li key={file}>{file}</li>)}
        </ul>
      )}
      {approval.permissions && (
        <div className="space-y-1">
          <p className="text-foreground-subtle">Permissões solicitadas</p>
          <pre className="rounded-md border border-line bg-canvas p-2 whitespace-pre-wrap break-all font-mono text-foreground-secondary">
            {JSON.stringify(approval.permissions, null, 2)}
          </pre>
        </div>
      )}
      {approval.grantRoot && (
        <p className="break-all text-foreground-subtle">
          Acesso de escrita solicitado em <code className="text-foreground-tertiary">{approval.grantRoot}</code>
        </p>
      )}
      {approval.cwd && (
        <p className="break-all text-foreground-subtle">
          Diretório <code className="text-foreground-tertiary">{approval.cwd}</code>
        </p>
      )}
      {error && <p role="alert" className="text-danger-strong">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {submitting && <span role="status" className="text-foreground-muted">Enviando decisão…</span>}
        <button
          type="button"
          onClick={() => decide('deny')}
          disabled={submitting}
          className="cursor-pointer rounded-md border border-line-strong bg-surface px-3 py-1.5 font-medium text-foreground-secondary hover:bg-surface-muted disabled:cursor-default disabled:opacity-50"
        >
          Negar
        </button>
        {approval.canApprove && (
          <button
            type="button"
            onClick={() => decide('approve')}
            disabled={submitting}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover disabled:cursor-default disabled:opacity-50"
          >
            {approvalLabel}
          </button>
        )}
      </div>
    </section>
  );
}
