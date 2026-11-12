import { Anchor, ArrowRight, ChevronRight, RadioTower, ShieldCheck } from 'lucide-react';
import { workspaceModules, type WorkspaceId } from '../ui/workspaces';

interface WorkspaceProps {
  activeModule: WorkspaceId;
  onNavigate: (id: WorkspaceId) => void;
  isRunning: boolean;
  elapsedMinutes: number;
}

export function WorkspaceNavigation({ activeModule, onNavigate, isRunning, elapsedMinutes }: WorkspaceProps) {
  return (
    <aside className="workspace-navigation" aria-label="系统工作区导航">
      <a className="workspace-brand" href="#/overview" onClick={(event) => { event.preventDefault(); onNavigate('overview'); }}>
        <span><Anchor size={23} /></span><div><strong>港航韧性沙盘</strong><small>PORT RESILIENCE</small></div>
      </a>
      <div className="workspace-nav-caption">工作空间 <span>WORKSPACES</span></div>
      <nav className="workspace-module-nav" aria-label="Web 页面模块切换">
        {workspaceModules.map((module, index) => {
          const Icon = module.icon;
          return (
            <button
              aria-current={activeModule === module.id ? 'page' : undefined}
              aria-pressed={activeModule === module.id}
              className={`workspace-nav-item${activeModule === module.id ? ' is-active' : ''}`}
              data-xiaoyi-action={`module-${module.id}`}
              key={module.id}
              onClick={() => onNavigate(module.id)}
              type="button"
            >
              <Icon size={18} /><span><strong>{module.label}</strong><small>{module.task}</small></span><em>{String(index + 1).padStart(2, '0')}</em>
            </button>
          );
        })}
      </nav>
      <div className="workspace-runtime" role="status">
        <span><RadioTower size={13} />{isRunning ? '沙盘持续运行中' : '沙盘已暂停'}</span>
        <strong>已推进 {elapsedMinutes} <small>min</small></strong>
        <p>跨页面保留当前场景与任务</p>
      </div>
      <div className="workspace-boundary"><ShieldCheck size={14} /><span>公开数据校准模拟<br /><small>研究与工程验证</small></span></div>
    </aside>
  );
}

export function WorkspaceHeading({ activeModule, onNavigate }: Pick<WorkspaceProps, 'activeModule' | 'onNavigate'>) {
  const current = workspaceModules.find((item) => item.id === activeModule)!;
  return (
    <section className="workspace-heading" aria-label="当前工作区">
      <div>
        <div className="workspace-breadcrumb">港航韧性沙盘 <ChevronRight size={12} /><span>{current.label}</span><small>{current.eyebrow}</small></div>
        <h2 id="workspace-title">{current.label}</h2><p>{current.description}</p>
      </div>
      <button className="workspace-next" onClick={() => onNavigate(current.next)} type="button">{current.nextLabel}<ArrowRight size={16} /></button>
    </section>
  );
}
