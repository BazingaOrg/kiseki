/**
 * 「制作」区段。
 *
 * 本批只做门禁与说明:能不能做、为什么不能、以及怎么补 —— 这些判断已经全部就位。
 * 真正在网页里起渲染任务(进度、取消)属于下一批,所以这里先给出可复制的等效终端
 * 命令,而不是画一个点了没反应的按钮。宁可少一个功能,不要多一个骗人的入口。
 */
import {Clapperboard, ImageDown} from 'lucide-react';

import type {Capability, Capabilities, Remedy} from './capabilities';
import type {ProjectResponse} from './types';
import {Blocked, CommandHint, Section} from './ui';

interface ActionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  capability: Capability;
  command: string;
  onRemedy: (target: Remedy['target']) => void;
}

const ActionCard = ({icon, title, description, capability, command, onRemedy}: ActionProps) => (
  <div className={capability.enabled ? 'action-card' : 'action-card action-card-blocked'}>
    <div className="action-head">
      <span className="action-icon">{icon}</span>
      <h3 className="action-title">{title}</h3>
    </div>
    <p className="action-description">{description}</p>
    {capability.enabled ? (
      <>
        <p className="action-ready">素材齐了，可以开工。</p>
        <CommandHint command={command} />
      </>
    ) : (
      <Blocked capability={capability} onRemedy={onRemedy} />
    )}
  </div>
);

interface MakeProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
}

/**
 * 给命令里的路径加引号,复制出去要能直接跑。
 * 用单引号而不是双引号:双引号里 `$`、反引号、`\` 仍会被 shell 解释,
 * 路径里带这些字符时复制出去的命令会静默变成另一个路径。
 */
const quote = (value: string): string =>
  /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

export const Make = ({project, capabilities, onRemedy}: MakeProps) => {
  const folder = quote(project.path);

  return (
    <Section title="制作">
      <div className="action-cards">
        <ActionCard
          icon={<Clapperboard size={20} strokeWidth={1.5} />}
          title="渲染相册视频"
          description="分析音乐的节拍，把照片排进时间线，渲染成一支踩点影像日记。"
          capability={capabilities.renderVideo}
          command={`tsuzuri ${folder}`}
          onRemedy={onRemedy}
        />
        <ActionCard
          icon={<ImageDown size={20} strokeWidth={1.5} />}
          title="导出静态作品图"
          description="按成片同款视觉导出单张照片，可带 EXIF 展签与签名落款。"
          capability={capabilities.exportStill}
          command={`tsuzuri still ${folder}`}
          onRemedy={onRemedy}
        />
      </div>

      <p className="note">
        在网页里直接开工（选滤镜、看进度、随时取消）是下一批的事。现在点上面的命令可以复制到终端。
      </p>
    </Section>
  );
};
