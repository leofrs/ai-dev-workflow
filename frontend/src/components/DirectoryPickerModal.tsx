import React, { useState, useEffect, useCallback, useId } from 'react';
import { ModalDialog } from './ModalDialog';
import {
  Folder,
  FolderOpen,
  ArrowUp,
  Home,
  GitBranch,
  X,
  Check,
  AlertCircle,
  ChevronRight
} from 'lucide-react';

interface DirectoryItem {
  name: string;
  path: string;
  isHidden: boolean;
}

interface DirectoryResponse {
  currentPath: string;
  parentPath: string | null;
  homePath: string;
  isGitRepo: boolean;
  directories: DirectoryItem[];
}

interface DirectoryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (path: string, isGitRepo: boolean) => void;
}

const API_URL = 'http://localhost:3001/api/directories';

export const DirectoryPickerModal: React.FC<DirectoryPickerModalProps> = ({
  isOpen,
  onClose,
  onConfirm
}) => {
  const titleId = useId();
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async (targetPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
      const res = await fetch(`${API_URL}${query}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao acessar pasta');
      setData(json);
      setManualPath(json.currentPath);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadDir();
    }
  }, [isOpen, loadDir]);

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      className="w-[calc(100%_-_2rem)] max-w-xl rounded-xl border border-line bg-surface shadow-2xl"
    >
      <div className="flex max-h-[82vh] flex-col">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-accent" />
            <h3 id={titleId} className="font-semibold text-foreground text-sm">
              Adicionar Diretório / Repositório
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-foreground-subtle hover:text-foreground hover:bg-surface-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-line bg-canvas/60 flex items-center gap-2">
          <button
            onClick={() => data && loadDir(data.homePath)}
            title="Home"
            className="p-2 rounded-lg bg-surface border border-line hover:bg-surface-muted text-foreground-tertiary"
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={() => data?.parentPath && loadDir(data.parentPath)}
            disabled={!data?.parentPath}
            title="Subir nível"
            className="p-2 rounded-lg bg-surface border border-line hover:bg-surface-muted text-foreground-tertiary disabled:opacity-40"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualPath.trim()) loadDir(manualPath.trim());
            }}
            className="flex-1"
          >
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              className="w-full bg-canvas border border-line rounded-lg px-3 py-1.5 text-xs font-mono text-foreground-secondary focus:outline-none focus:border-accent-line"
              placeholder="/caminho/do/projeto"
            />
          </form>
        </div>

        {data && (
          <div className="px-4 py-2 border-b border-line/80 flex items-center justify-between text-xs bg-surface/80">
            <span className="text-foreground-subtle truncate max-w-[340px] font-mono">
              {data.currentPath}
            </span>
            {data.isGitRepo ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-accent border border-emerald-500/30 font-medium">
                <GitBranch className="w-3.5 h-3.5" />
                Repositório Git
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-warning border border-amber-500/30">
                <AlertCircle className="w-3.5 h-3.5" />
                Não é repositório Git
              </span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-[240px]">
          {error && (
            <div className="p-3 text-xs text-danger bg-danger-surface/30 border border-danger-line/50 rounded-lg">
              {error}
            </div>
          )}

          {!loading &&
            data?.directories
              .filter((d) => !d.isHidden)
              .map((dir) => (
                <div
                  key={dir.path}
                  onClick={() => loadDir(dir.path)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-muted/80 cursor-pointer group transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Folder className="w-4 h-4 text-warning shrink-0" />
                    <span className="text-sm text-foreground-secondary truncate">{dir.name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground-faint group-hover:text-foreground-tertiary" />
                </div>
              ))}
        </div>

        <div className="px-4 py-3 border-t border-line bg-canvas/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-foreground-tertiary hover:bg-surface-muted transition"
          >
            Cancelar
          </button>
          <button
            disabled={!data}
            onClick={() => {
              if (data) {
                onConfirm(data.currentPath, data.isGitRepo);
                onClose();
              }
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-primary hover:bg-primary-hover text-white transition cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Selecionar este Diretório</span>
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
