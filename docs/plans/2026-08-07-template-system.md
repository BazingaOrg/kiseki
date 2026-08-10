# 模板系统：呈现层方案

日期：2026-08-07。状态：已批准，P0 实施中。

## 背景与模型

渲染配置长期是"平铺的勾选项"。经讨论确定为分层模型，核心边界：

- **素材基调层**（不归模板）：滤镜（逐张照片的修整，现状 `clip.filter` 已逐张归属）、背景/色板（画布基调，config 键，`getPalette` 由背景明暗推导）、画幅（渲染目标）、trim/pacing（内容适配）、speed（资源档位）。
- **内容与身份层**（不归模板）：签名（身份资产）、outro_text（内容）、intro/chapters 开关（结构决策）。现状 `Branding` 类型已承载。
- **呈现层（模板的全部）**：照片的布局与动效、转场、歌词/字幕的呈现（字体、字距、位置、入场动效）、章节卡样式。**模板只负责"怎么动、怎么呈现"**。

补充概念：**预设 ≠ 模板**。预设是用户级"一键组合"（模板 + 滤镜 + 背景 + 开关），存素材夹偏好；模板是系统级呈现层资产。P0 只做模板，预设列为后续。

## 数据模型

```ts
// renderer/src/templates.ts —— 权威注册表(与 filters.ts 同模式)
// cli/templates.mjs 平行镜像纯数据副本,用于 CLI 校验/帮助/web 端点
export interface TemplateCaptionsStyle {
  fontSize?: number;        // 1080p 基准
  fontWeight?: number;
  letterSpacing?: string;
  letterSpacingCompact?: string;
  riseDistance?: number;    // 入场位移
}
export interface TemplateChapterCardStyle {
  fontSize?: number;
  letterSpacing?: string;
  riseDistance?: number;
}
export interface Template {
  id: string;
  name: string;             // 中文名
  description: string;      // 一句话气质描述
  composition: 'Diary';     // L1 只有 Diary;L2 可指向新 composition
  transition: 'album' | 'cut' | 'crossfade';  // 照片切换默认
  captions?: TemplateCaptionsStyle;
  chapterCard?: TemplateChapterCardStyle;
}
```

L1 目录（全部为现有代码的参数重排，零新组件）：

| id | name | transition | captions | chapterCard |
|---|---|---|---|---|
| album | 相册翻页 | album | 无覆盖（现状） | 无覆盖 |
| news-cut | 新闻快切 | cut | 大字号 44、字重 700、紧凑字距 | 简洁小卡 |
| slow-cinema | 电影舒缓 | crossfade | 小字号 32、细字重 300、0.2em 字距、大位移 | 居中放大 56 |

## 渲染管线

- CLI：`--template <id>` → options 解析校验（`cli/templates.mjs` 镜像）→ 注入
- 注入沿用 render.mjs 既定模式（`buildTimelineProps`，timeline.json 绝不改写）：`timeline.meta.template = {transition, captions, chapterCard}`
- Diary 消费：照片 clip 的转场 = `meta.template.transition ?? clip.transition`（模板胜于 config，呈现层>基调层；chapter 卡保持自身节奏）；字幕/章节卡样式经 props 传给块组件，缺省回退现有常量（**无模板时行为逐字节不变**）
- 模板不触碰 plan.py、不触碰分析缓存键（纯呈现）

## 优先级

`显式 flag(EXIF/签名/暗色/滤镜) > config 默认` 保持不变；模板只在其呈现字段上覆盖 config（转场、字幕、章节卡），与滤镜/背景正交。

## P0 步骤

1. **注册表与 CLI 侧**：`renderer/src/templates.ts` + `cli/templates.mjs` 镜像 + `--template` flag 解析/校验 + render.mjs 注入 meta.template + 测试
2. **渲染器消费**：Diary/Subtitle/ChapterCard 接受模板样式（缺省回退常量）+ 纯函数 `resolveTemplatePresentation` 可测 + 测试
3. **Web 模板墙**：`/api/templates` 端点 + Make.tsx 模板卡片选择（滤镜/暗色等素材层选项保持独立可见）+ `JobOptions.template` 管线（--template 透传）+ localStorage 记住上次选择 + 测试
4. **CLI 菜单**：菜单加"选择模板"步骤（数字列表，含"不应用模板"），滤镜步骤保留（素材层独立）+ 测试
5. **文档与验证**：README 用法、`tsuzuri templates` 命令、全量 QA、推送

## 后续（不在 P0）

- P0.5（已完成）：**模板卡片示意预览**——直接 import renderer 注册表的真实样式值拼 CSS 示意卡（与滤镜预览同模式，标注"示意"），不做真实 still 渲染（成本/收益比不划算，列为长期）；**预设系统**——用户级一键组合（模板+滤镜+暗色+开关）按素材夹存 localStorage（presets.ts），同名覆盖、模板 id 净化
- L2 第一步（已完成）：**照片运镜**——`TemplateMotion`（kenburns: zoom + pan，'random' 按照片 src 稳定哈希确定性分配），slow-cinema 获得 `{zoom: 1.06, pan: 'random'}`，album/news-cut 保持静态。历史背景：Ken Burns 在 2026-07-11 视觉修订（f975b8c）随"克制化审美"被移除，config 键 motion/kenburns_from/kenburns_to 随后弃用；本方案以"运镜是模板呈现能力、默认模板无运镜"的方式回归，不复活 config 键
- L1.5（已完成）：**黑体字体资产**——Noto Sans JP/SC/Latin VF woff2（经代理下载，共 12MB，比 serif 的 TTF 小一半）随 bundle 加载；`FONT_FAMILY` 重构为 serif/sans 两套 × ja/zh/en/mixed 路由；模板可声明 `fontFamily: 'serif' | 'sans'`，news-cut 用黑体；字体路由抽成纯模块 `fontFamily.ts` 可直测。模板默认文件名追加 `-template-<id>`（B1，换模板不再覆盖成片）
- L2 布局模板（进行中）：**拍立得（PolaroidWall）**——第一个新 composition：照片以白色相框 + 确定性旋转（±4°，按 src 哈希）的拍立得卡片呈现，入场旋转落定；复用 Subtitle/ChapterCard 与音频/白场收尾；模板接口 `composition` 联合类型扩展，render.mjs 按模板选 composition，CLI 镜像携带 composition 字段。**走带（Filmstrip）**——第二个新 composition：当前照片大图 + 前/当前/后三帧底部走带，当前帧高亮，字幕带挤到主照片与走带之间。**减法：album 模板已砍**（与"默认"逐像素重复，侵蚀模板墙信任）。后续：大字报（谨慎，与照片日记定位有张力）/本地模板目录 + 导入导出
- 长期：模板真实预览图（复用 still 管线按素材夹缓存，需处理任务锁与浏览器并发）

## 不做的事

- 不做时间线编辑器（定位是"选风格"不是"手动剪辑"）
- 不改 21 键 config 契约；模板是 flag/UI 层选项
- 模板不拥有滤镜/背景/签名/文案/结构开关（边界见模型节）
