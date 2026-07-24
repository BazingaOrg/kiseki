# 滤镜系统 + 本地画廊 Web 页面

日期：2026-07-24
状态：待确认

## 背景与决策

- **滤镜做进 tsuzuri，不单独立项**。滤镜唯一消费者是本项目的两条渲染管线（视频 + still），独立项目只有同步成本没有复用收益。
- **技术路径：CSS filter + SVG filter，不做 sharp 预处理**。`renderer/src/FramedPhoto.tsx` 是 `Photo.tsx`（视频）和 `Still.tsx`（照片导出）唯一共享的图片渲染点，在其 `<Img>` 上注入滤镜即可一处改动、两条管线同时生效；且未来 Web 端可用同一套 CSS 做所见即所得预览。
- **Web 页面：`tsuzuri web` 子命令起本地只读 server + Vite/React 单页**。MVP 只做画廊（浏览素材夹、看导出照片），不做触发渲染的 wizard。Remotion Studio 不面向终端用户复用。
- 步骤条做成可自由跳转的导航（看片四步），不是强制线性向导。
- 视觉沿用 `theme.ts` 暖灰调色板与照片框阴影，文案延续现有菜单的安静语气，图标用细线单色（lucide 风格）。

## 阶段一：滤镜核心（先做）

1. [x] 新建 `renderer/src/filters.ts`：纯数据注册表，仿 `theme.ts` 的 `PALETTES` 风格。
   - `FilterDef = { id, label, css?, svg?, overlay?, defaultIntensity }`，统一 `intensity`（0–1）插值。
   - 内置 6~8 个滤镜：对比/饱和/色温/褪色类用 CSS filter；青橙、褪色胶片用 SVG `feColorMatrix`/`feComponentTransfer`；暗角/漏光用 overlay 渐变层。
   - 导出 `getFilter(id, intensity)` 返回 `{ imgStyle, svgDefs, overlayNode }`；SVG defs 的唯一 id 由注册表生成。
   - → 验证：filters.ts 单测（注册表完整性、intensity 插值边界）。
2. [x] `renderer/src/types.ts`：`PhotoClip` 与 Still props 增加可选 `filter` 字段（`{ id, intensity }`）。
3. [x] `FramedPhoto.tsx` 增加可选 `filter` prop：在 `<Img>` 合并 filter 样式，必要时外层容器渲染 SVG defs 与 overlay。不动布局。`Photo.tsx`/`Still.tsx` 透传。
   - → 验证：`--draft` 渲染一段视频 + `still` 导出一张，逐个滤镜目检。
4. [x] CLI：`options.mjs` 增加 `--filter <id>`、`--filter-intensity <0-1>`（渲染与 still 通用，全局统一），校验 id 合法性，透传到 inputProps。
   - → 验证：options 单测 + 非法 id 报错信息。
5. [x] 文档：README 命令表与 flag 说明补充。
   - → 验证：qa-runner 跑 cli 全部测试 + renderer typecheck。

## 阶段二：滤镜体验完善

6. [ ] 交互菜单：render/still 流程选完路径后追加"选滤镜（默认：无）"一步，列注册表 label；菜单只组装 argv，不引入菜单专属逻辑。
7. [ ] 逐张覆盖：素材夹项目配置（`project.mjs` 管理）记录 `{ filter, intensity, perPhoto }`，CLI flag 优先级高于配置文件。
8. [x] `riso` 滤镜（本次参考图的孔版印刷风格）：duotone（feComponentTransfer 灰阶映射墨蓝→橙→纸白）+ 半调网点（grayscale/contrast + repeating radial-gradient 叠层 mix-blend-mode）+ 毛边（feTurbulence + feDisplacementMap 作用于 mask）；套印偏移为可选加分项。intensity 控制网点密度与油墨浓度。
   - **部分完成**：duotone（feColorMatrix saturate(0) + feComponentTransfer 三段查表 暗部#1d4e5f→中间调#e8763a→高光#f5f0e6）与半调网点（overlay 双层错位 radial-gradient + mix-blend-mode: overlay）已落地。毛边（feTurbulence+feDisplacementMap）与套印偏移**未做**，留作后续增强。
   - → 验证：still 导出命令跑通（`node cli/tsuzuri.mjs still ... --filter riso` 成功生成 PNG），renderer tsc/8 test、cli 153 test 全绿。
   - 目检调优：初版三段查表 + defaultIntensity 0.7 导致高光偏粉、duotone 被恒等稀释发灰、6px 网点在 4K 图上不可见。改为五段查表（深墨蓝→青→橙→浅橙→纸白）、defaultIntensity=1、网点 12px/multiply 混合后达到参考图质感。视频逐帧性能仍未量化（风险项保留）。

## 阶段三：Web 画廊 MVP

9. [ ] `cli/web.mjs`：`tsuzuri web` 子命令入口，起 server、自动开浏览器；菜单加"打开本地画廊"项。
10. [ ] `cli/web-server.mjs` + `cli/web-api/*.mjs`：Node 原生 http，三个只读 API——`/api/dirs`（目录浏览）、`/api/project`（素材夹照片/歌词/产物清单，复用 `project.mjs`/`exif.mjs`/`lrc.mjs`）、`/media`（媒体透传，路径白名单限定在用户选定根目录下）。
    - → 验证：API 单测（路径沙箱穿越用例必测）。
11. [ ] `web/`：独立 Vite + React 前端（与 renderer 隔离，不共享构建）。视图：FolderPicker（目录浏览）+ PhotoGrid（导出照片网格，点开看大图/EXIF）。导入 theme.ts 调色板与同款字体。
    - → 验证：本地起 `tsuzuri web` 手测流程；构建产物由 server serve `web/dist`。

## 阶段四：Web 播放与歌词（后续）

12. [ ] Player 视图：渲染视频 / 音乐播放。
13. [ ] Lyrics 视图：读 lrc（复用 lrc.mjs 解析），随播放高亮当前行。
14. [ ] （谨慎，另立计划）触发渲染 + 进度；Web 滤镜实时预览选择器（与渲染同源 CSS）。

## 实施记录（阶段一，2026-07-24）

- 已按计划落地步骤 1–5：`renderer/src/filters.ts` 注册表（8 个滤镜）、FramedPhoto 注入、`--filter`/`--filter-intensity`、README 更新。cli 153/153、renderer 8/8、tsc 通过。
- 偏离 1：cli 与 renderer 无法运行时共享 TS 模块，滤镜 id 列表在 `cli/filters.mjs` 维护并行副本（带同步注释）——计划中的备选方案。
- 偏离 2：逐张 `PhotoClip.filter` 字段已预留（防御性读取 `clip.filter ?? meta.filter`），但 CLI 阶段一只接入全局 `TimelineMeta.filter`。
- 目检修正：teal-orange 初版用对称 feColorMatrix 交叉混合，效果几乎不可见；重写为分离色调（feComponentTransfer 按通道曲线：蓝抬暗部压高光、绿暗部半量抬升、红抬中间调 + saturate），demo 素材目检确认暗部青、高光橙。教训：调色类滤镜必须真图目检，哈希不同 ≠ 效果达标。
- 测试修正：filters.test.ts 原断言"每滤镜恰好一种实现"过严，与设计（允许 css/svg/overlay 组合，riso 将全用）冲突，改为"至少一种"。

## Review 记录（2026-07-24）

- 中等：cli/renderer 两份滤镜 id 副本无防漂移校验 → 已修：`cli/filters.test.mjs` 从 renderer 源码正则抽取 id 与 `FILTER_IDS` 断言一致。
- 低：`cli/filters.mjs` 的 label 字段无人消费（推测性数据）→ 已修：改为纯 id 数组。
- 低：FramedPhoto 无滤镜时也包 wrapper div，DOM 非严格恒等 → 已修：恒等路径直接返回裸 `<Img>`。
- 低（遗留到阶段二）：SVG filter id 按滤镜 id 生成，交叉淡化时两张照片重复 id；全局滤镜下内容相同无害，但逐张滤镜（阶段二步骤 7）落地时必须给 id 加 intensity/索引指纹，否则不同参数互相污染。

## 风险

- 半调/毛边滤镜在 Remotion 逐帧渲染的性能开销未知——先在 `--draft` 上量化，超预算则 riso 限 still 使用。
- SVG filter 在 Chromium headless 与本地浏览器的渲染一致性需在阶段一目检确认。
- `/media` 路径透传是唯一安全敏感面，白名单校验必须有测试覆盖。
