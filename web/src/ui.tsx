import type {ReactNode} from 'react';

import type {Capability, Remedy} from './capabilities';

interface BlockedProps {
  capability: Capability;
  onRemedy: (target: Remedy['target']) => void;
  /** 当前已在补救目标时只解释原因，避免出现跳回自己的无效按钮。 */
  currentSection?: Remedy['target'];
}

/** 统一展示能力阻断原因及可用的补救入口。 */
export const Blocked = ({capability, onRemedy, currentSection}: BlockedProps) => {
  if (capability.blockers.length === 0) return null;

  return (
    <div className="blocked">
      {capability.blockers.map((blocker) => (
        <p className="blocked-line" key={blocker.reason}>
          <span>{blocker.reason}</span>
          {blocker.remedy && blocker.remedy.target !== currentSection && (
            <button className="link-button" onClick={() => onRemedy(blocker.remedy!.target)}>
              {blocker.remedy.label}
            </button>
          )}
        </p>
      ))}
    </div>
  );
};

interface SectionProps {
  title: string;
  /** 标题右侧的次要说明,如"19 张照片" */
  meta?: ReactNode;
  /** 页面级导航已说明当前区段时，保留供辅助技术使用的标题。 */
  titleHidden?: boolean;
  children: ReactNode;
}

export const Section = ({title, meta, titleHidden = false, children}: SectionProps) => (
  <section className="section">
    <div className={titleHidden && meta === undefined ? 'section-head section-head-semantic' : 'section-head'}>
      <h2 className={titleHidden ? 'section-title visually-hidden' : 'section-title'}>{title}</h2>
      {meta !== undefined && <span className="section-meta">{meta}</span>}
    </div>
    {children}
  </section>
);

export const CommandHint = ({command, label}: {command: string; label?: string}) => (
  <button
    type="button"
    className={label ? 'command-hint command-hint-compact' : 'command-hint'}
    title={label ? '复制完整命令' : '点击复制'}
    onClick={() => navigator.clipboard?.writeText(command)}
  >
    {label ?? <code>{command}</code>}
  </button>
);
