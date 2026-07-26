/**
 * 跨区段复用的小件。刻意只放三个:再多就该拆文件,再少就要在各处重复。
 */
import type {ReactNode} from 'react';

import type {Capability, Remedy} from './capabilities';

interface BlockedProps {
  capability: Capability;
  onRemedy: (target: Remedy['target']) => void;
  /** 当前已在补救目标时只解释原因，避免出现跳回自己的无效按钮。 */
  currentSection?: Remedy['target'];
}

/**
 * 禁用与空状态的统一出口。规则:**永远不许只灰掉不解释** —— 每条 blocker 都要说清
 * 缺什么,并给出一个真能点的补齐入口。这是这次重构最想修掉的体验缺陷。
 */
export const Blocked = ({capability, onRemedy, currentSection}: BlockedProps) => {
  // 能力可用时什么都不渲染。调用方常常是"缺件时顺带给个补齐入口",
  // 不加这个判断会在能力其实可用时留下一个空 div,用户看到一句提示却无处可点
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

/** 可复制的等效终端命令。沿用 CLI 菜单"用一次就学会直达写法"的思路。 */
export const CommandHint = ({command}: {command: string}) => (
  <button
    className="command-hint"
    title="点击复制"
    onClick={() => navigator.clipboard?.writeText(command)}
  >
    <code>{command}</code>
  </button>
);
