import { useCallback, useEffect, useState } from 'react';
import { resolveWorkspace, workspaceModules, type WorkspaceId } from '../ui/workspaces';

export function useWorkspaceNavigation() {
  const [activeModule, setModule] = useState<WorkspaceId>(() => resolveWorkspace(window.location.hash));
  const navigate = useCallback((next: WorkspaceId) => {
    const hash = `#/${next}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setModule(next);
  }, []);

  useEffect(() => {
    const restore = () => setModule(resolveWorkspace(window.location.hash));
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
  }, []);

  useEffect(() => {
    const current = workspaceModules.find((item) => item.id === activeModule)!;
    document.title = `${current.label} · 港航网络韧性沙盘`;
    document.querySelector('.workspace-content')?.scrollTo({ top: 0 });
  }, [activeModule]);

  return [activeModule, navigate] as const;
}
