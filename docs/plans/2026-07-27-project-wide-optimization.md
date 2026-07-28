# 项目全面优化执行方案

日期：2026-07-27
基线：`d761ac5`（`main` 与 `origin/main`）
状态：批次 0–7 已实施；最终文档/全量 QA 待记录

## 目标与边界

在不改变 tsuzuri 既有本地优先、素材写入安全边界、CLI/Analyzer/Renderer/Web 契约及 timeline 结构的前提下，完成一轮以真实问题为依据的全面优化：文案、clean code、性能、渲染、加载、动画、UI/UX、文档及实现对齐，并只在职责明确时进行适度模块拆分。

本轮不做大规模目录迁移、框架替换、monorepo 化或为了行数而拆文件；所有性能调整均先建立基线并以测量结果决定是否保留。

## 审计结论与优先级

### P0：流程正确性

- 静态导出被视频门禁阻断：无音频时无法进入“制作”，只有静态作品时无法进入“成果”（`web/src/Workbench.tsx:62-65` 的 `makeUnlocked` 只看 `renderVideo`，`resultsUnlocked` 只看 `output.videos`）。应将 `exportStill`、`output.stills` 纳入流程解锁及默认 Tab 判定。此项单独作为批次 0 先行发布。

### P1：跨层契约与任务生命周期

- 任务创建或运行中切换素材夹会丢失进度和取消入口，服务端任务仍可能继续。任务期间应禁用切换，并保证 POST 成功后的 job id 不丢失。
- 交互菜单可重复启动多个 Web 服务，多个实例可能同时操作同一项目。启动 Web 后应退出菜单循环，维持单一常驻服务。
- 多音频时前端仍放行“在线找歌词”，点击后才由后端拒绝。能力层应要求恰好一份音频，并明确歌词歧义状态。
- “等效终端命令”未包含画幅、滤镜、EXIF、草稿、倍率等实际选项。应从同一纯映射生成任务参数与命令展示。
- 视频与 still 使用不同的 TOML 解析/校验语义；timeline 手工编辑错误会延迟至 Remotion 深处。应建立统一字段 schema、跨运行时 fixture 和运行前 validator。
- 显式滤镜及强度未进入默认输出后缀，可能覆盖普通版或其他滤镜版本。显式滤镜应有稳定后缀，显式 `-o` 保持用户控制。

### P1：加载、缓存与渲染性能

- `/api/doctor` 在 HTTP 回调中同步运行多个外部命令，最坏可阻塞所有请求约六秒。Web 应异步并行检查并加短 TTL，CLI 保持同步。
- 已有 LRC 时仍把 Whisper 模型和 demucs 状态纳入分析缓存，可能无意义重跑。运行时指纹应按 LRC/demucs 的实际执行路径计算。
- 缩略图服务端缓存键会变化，但浏览器 URL 不变且缓存一天，原地替换图片后可能继续看到旧图。应采用 ETag 与 `private, no-cache` 复核语义。

### P1：UI、UX、无障碍与文案

- 390px 运行态下路径与“环境”控件重叠；需覆盖 320/390/640px，移动端拆行或真实截断。
- Materials 与 Results 的 Tabs 均全部进入 Tab 顺序，方向键/Home/End 不工作；应抽轻量共享 Tabs 行为并实现 roving `tabIndex`。
- 歌词候选单击即写入文件，与音频确认和 CLI 流程不一致；首次点击只选择，明确点击“保存这份歌词”才落盘。
- 项目刷新错误被吞，文件夹快速导航存在旧响应覆盖新响应的竞态；应提供错误/重试，并用请求序号或取消机制保证最后一次选择获胜。
- README 与启动文案仍称“只读画廊”，与改名、删除、撤销、回收区实现冲突；统一为“本地工作台”，准确说明写入与撤销边界。

### P1：动画与交互反馈

- `prefers-reduced-motion` 将所有反馈压到 `0.01ms`，spinner 停止且产生瞬时位移；改为组件级去除位移，保留短 opacity/color 反馈。
- 高频照片 hover 同时动画位移和大阴影，触摸设备也可能触发伪 hover；移除位移或仅保留轻反馈，阴影静态化并限定 fine pointer。
- 参数与环境面板使用不可中断 keyframe，关闭时直接消失；改为可重定向 transition，进入约 200ms、退出约 150ms。
- 进度条动画 `width`；改为 `scaleX()` 或取消宽度平滑。
- 两套局部 Tabs 重复，且含无实际效果的 transform transition；统一为克制的共享 motion 样式。

## 不建议实施的改动

- 不合并 `web / cli / analyzer / renderer` 顶层目录。
- 不迁移 Express/Fastify，不引入 monorepo 工具。
- 不为行数强拆 React/Python 文件。
- 不立即引入 `sharp`、复杂时间线索引或更激进默认并发。
- 保留资产写入安全边界、集中 capabilities、跨 Tab 音频挂载和现有 timeline 结构。
- 本轮不做以下动画增强（记录在案，避免实施时自由发挥）：Tab 内容切换淡入、Dialog 更快退出淡化、撤销条 reveal、搜索候选与确认区的空间关系反馈。它们不修复已知缺陷，留待动画基线稳定后单独评估。

## 性能基线与决策规则

在批次五开始前记录以下基线，并将同一素材、同一运行环境和同一命令用于实施后比较：

- Web：生产构建体积、关键 API 首次与重复请求耗时、素材夹切换时长、图片/音频加载行为。
- CLI/Analyzer：有 LRC、无 LRC、demucs 开启/关闭时的缓存命中及分析耗时。
- Renderer：典型项目与大素材项目的渲染耗时、峰值内存、帧率/帧耗时及滤镜成本。
- 浏览器：Lightbox 预加载、缩略图缓存复核和首屏请求瀑布。

候选项包括 Renderer 三套字体约 39MB、Lightbox 默认预加载前后两张全尺寸原图、大素材项目重复文件读取/EXIF 打开、`Diary` 每帧扫描 timeline、`riso` 视频滤镜逐帧成本。没有可重复测量收益的候选项不进入实现。

## 执行方式与批次门

- 每个批次给出「执行」与「验证」分工：推理密集项（schema 语义、任务生命周期、竞态）交 deep-reasoner 出结论，实现与批量编辑交 fast-worker，测试/类型/构建的实际运行交 qa-runner。
- 批次门：当前批次的验证未由 qa-runner 报告通过，不进入下一批次；修复回到 fast-worker，不在验证环节顺手改代码。
- 每批次结束后在「实施记录」追加实际改动与偏差，再开下一批。

## 实施批次

### 批次 0：静态导出流程门禁（P0，可独立发布）

- [x] 将 `exportStill`、`output.stills` 纳入流程解锁判定：无音频但有照片时可进入「制作」，仅有静态作品时可进入「成果」。
- [x] 同步修正默认 Tab（`initialSection`）与能力 remedy 回链，使静态-only 素材夹不会落到锁死的步骤。

影响范围：`web/src/Workbench.tsx` 及其测试。

执行：fast-worker。验证：qa-runner 跑 Web 类型检查与组件测试。

验收：静态-only 与无音频素材夹可完整走完导出→查看；视频流程行为不变。

### 批次 1：能力门禁、歌词确认与命令映射

- [x] 收紧在线找歌词能力为“恰好一份音频”，显示多音频歧义说明。
- [x] 将歌词候选改为选择后显式确认保存，与 CLI 的确认模型一致（与上一条同属歌词语义域，一次改完，不拆到后续批次）。
- [x] 抽出纯 `options → argv → command` 映射，使任务参数与“等效终端命令”同源。
- [x] 将启动提示与界面内文案由“只读画廊”改为“本地工作台”，写清写入、撤销与回收边界。README 双语不在本批次改动，统一留到批次 7。

影响范围：`web/src/capabilities.ts`、`web/src/Materials.tsx`、`web/src/Make.tsx`、`cli/web-api/fetch.mjs`、`cli/web.mjs` 启动提示。

执行：fast-worker（命令映射的选项清单先由 deep-reasoner 对照 CLI 参数核定）。验证：qa-runner 跑 Web 与 CLI 单测。

验收：静态-only、视频-only、无音频、多音频四类素材夹均展示正确能力；命令展示和实际 argv 对所有可见选项一致；选择歌词候选在确认前不写文件。

### 批次 2：任务生命周期、单实例与请求竞态

- [x] 任务创建/运行期间禁用素材夹切换，保留进度、错误和取消入口。
- [x] 确保 POST 成功后 job id 即使在状态切换中也不丢失。
- [x] Web 启动后退出交互菜单循环，避免同一项目多服务实例。
- [x] 为项目刷新提供可见错误与重试；为文件夹导航加入请求取消或序号防旧响应覆盖。

影响范围：`web/src/useJob.ts`、`web/src/Workbench.tsx`、`web/src/App.tsx`、`web/src/FolderPicker.tsx`、`cli/tsuzuri.mjs`、`cli/web.mjs` 及相应测试。

执行：deep-reasoner 先定任务状态机与竞态处理方案，fast-worker 实现。验证：qa-runner。

验收：慢创建、运行中切换、取消、连续导航、重复启动菜单均有自动化或可复现覆盖；服务端任务状态与 UI 始终一致。

### 批次 3：配置、timeline 与输出命名契约

前置决策（本批次开工前必须定，不得边写边定）：

- **存量配置兼容**：~~需先选定硬切还是先出 warning~~ —— **已定：硬切，不做兼容层**（2026-07-27 用户确认：项目目前只有作者本人在用，不存在需要保护的存量配置）。`cli/still.mjs` 当前是宽容的手写 flat 解析器（未知键静默跳过、非法值静默回退默认、`background = FFFFFF` 这类标准 TOML 非法写法今天可用），一律改为 fail-fast + 明确报错信息（含键名与期望形式）。静默降级本身就是本轮要消除的问题。
- **Node 侧解析实现**：与 `tomllib` 对齐语义，要么引入 TOML 依赖，要么扩写手写解析器。这与「不为理论收益增加新依赖」存在张力；本轮的取舍是：仅在手写解析器无法覆盖 schema 所需语义时才引依赖，且必须在本文件记录理由。

- [x] 定义视频/still 共用字段 schema 与跨 Node/Python fixture。
- [x] 按上述前置决策统一合法数值形式和非法字段的 fail-fast 行为，并给出可读错误信息。
- [x] 在渲染前增加只读 timeline validator，报告精确 JSON path，不自动改写文件。
- [x] 为显式滤镜/强度生成稳定默认后缀，保持显式 `-o` 原样优先。
- [x] 记录本批次导致失效的文档点（默认产物文件名示例、配置字段说明），交批次 7 统一更新。

影响范围：`analyzer/plan.py`、`cli/still.mjs`、`cli/render.mjs`、`cli/tsuzuri.mjs`、配置与 fixture 测试。

执行：deep-reasoner 定 schema 与兼容策略，fast-worker 实现与写 fixture。验证：qa-runner 跑 CLI 单测与 Python 测试。

验收：同一配置在视频与静态导出具有一致校验结果；错误 timeline 在进入 Remotion 前报出；默认产物不互相覆盖；存量非法配置的报错行为与前置决策一致，并已登记待更新文档点。

### 批次 4：移动端、Tabs 与无障碍

（歌词确认已并入批次 1，此处不再重复。）

- [x] 修复 320/390/640px 下的顶部运行态布局、路径截断与控件换行。
- [x] 抽轻量共享 Tabs 行为，支持 roving `tabIndex`、方向键、Home/End 和正确 ARIA 关联。
- [x] 补齐任务、媒体、空状态、错误状态及键盘可达性的反馈。

影响范围：`web/src/App.css`、`web/src/Materials.tsx`、`web/src/Results.tsx`、相关共享 hook/组件及测试。

执行：fast-worker。验证：qa-runner 跑组件测试与窄屏断言。

验收：键盘可完成 Tab 切换；窄屏无重叠。

### 批次 5：doctor、缓存、缩略图与测量驱动性能优化

- [x] 将 Web doctor 改为异步并行、短 TTL 的状态检查；CLI doctor 保持原同步语义。
- [x] 按实际 LRC/demucs 执行路径计算分析缓存运行时指纹。
- [x] 调整缩略图响应为 ETag + `private, no-cache`，验证原地替换后的浏览器复核。
- [x] 对字体、Lightbox、EXIF、timeline 扫描和 riso 按基线结果选择少量高收益改动。

影响范围：`cli/doctor.mjs`、`cli/web-server.mjs`、`cli/analysis-cache.mjs`、`cli/web-api/thumb.mjs`、`web/src/media.ts`、Renderer 或 Lightbox（仅在数据支持时）。

执行：deep-reasoner 判定缓存指纹与基线取舍，fast-worker 实现。验证：qa-runner 跑测试并记录前后测量。

验收：doctor 不再阻塞并发请求；缓存命中符合实际执行路径；缩略图替换可复核；每个保留优化有前后数据。

### 批次 6：动画、reduced-motion 与交互质量

- [x] 为 reduced-motion 设计组件级降级，消除移动/缩放但保留必要状态反馈。
- [x] 降低照片 hover 的布局/绘制成本并限定细指针设备。
- [x] 将参数/环境面板 keyframe 改为可中断、可反向的 transition。
- [x] 将进度条改为 transform 驱动或取消不必要的平滑。
- [x] 合并 Tabs 的重复 motion 样式，移除无效 transition。

影响范围：`web/src/index.css`、`web/src/App.css` 及引用该样式的组件。

执行：fast-worker。验证：qa-runner 跑构建与 reduced-motion 相关断言，视觉部分转人工验收。

验收：快速开关面板无突变；reduced-motion 无位移且仍可读；触摸设备无悬停残留；进度更新不以 width transition 造成额外布局。

### 批次 7：文档、配置说明与状态对齐

- [x] 校对 README 中英版本、命令帮助、配置字段、API 与当前 UI 行为（README 双语的“只读画廊”表述由本批次统一处理，批次 1 只改启动与界面文案）。
- [x] 落实批次 3 登记的失效文档点：默认产物文件名示例、配置字段合法形式与报错行为。
- [x] 明确素材变更、撤销、回收区、任务、静态导出、歌词歧义和缓存行为。
- [x] 维护项目状态与本计划的实施/复审记录，避免测试数量或实现描述漂移。

影响范围：`README.md`、`README.en.md`、`docs/` 中相关配置/状态文档及本文件。

执行：fast-worker。验证：qa-runner 逐条对照命令帮助与实际输出。

验收：文档命令、配置字段、界面文案和真实运行行为逐项对应；不再出现“只读画廊”等过期表述。

### 批次 8：有明确收益的模块拆分与收尾复审

- [x] 仅拆分已在本轮修改且职责明确的 `jobs.mjs` / `fetch.mjs` 部分，避免迁移式重构。
- [x] 清理本轮产生的重复逻辑、无用 import、无效样式和过期测试断言。
- [x] 对契约、安全边界、性能回归、UI/UX 和文档进行独立复审并修复发现项。

影响范围：以批次零至七实际改动为准，不提前创建抽象或迁移目录。

执行：fast-worker 拆分与清理，复审交 deep-reasoner 独立进行。验证：qa-runner 跑全量。

验收：模块边界更清晰但对外 API、文件格式、输出目录和资产安全边界保持兼容；全量验证通过。

## 风险与控制

- 资产写入、改名、删除、撤销必须继续使用当前扫描身份、软链接/冲突/job/lock 检查与回滚预检；不因 UI 改动放宽服务端边界。
- 任务与缓存调整可能改变长任务时序；需优先覆盖慢响应、取消、重复提交、旧响应和缓存命中/失效边界。
- 配置统一不可“悄悄兼容”非法输入；应明确报错并在 fixture 中固定语义。同时必须承认这是对存量 `tsuzuri.toml` 的破坏性变更：今天被静默接受的写法将开始报错，取舍见批次 3 前置决策，且报错信息要能直接指导用户改写。
- 滤镜输出后缀变化会改变默认产物文件名，文档与测试断言需同批登记、批次 7 统一更新，避免中途出现描述与实现不符的窗口。
- 动画改动不得重置跨 Tab 音频播放或以视觉效果掩盖加载/失败状态。
- 性能优化不为理论收益增加新依赖、默认并发或复杂索引；测量不足时保留现状。

## 验证矩阵

- CLI：完整单测、命令参数/输出命名、菜单与 Web 单实例行为。
- Analyzer：Python 测试、配置 fixture、缓存命中与 fail-fast 校验。
- Renderer：TypeScript、渲染配置、代表性 timeline/滤镜冒烟与测量。
- Web：TypeScript、生产构建、组件/交互测试、窄屏布局、键盘与 reduced-motion。
- 文档：README、命令帮助、配置字段、API、状态文档与实现逐项复核。
- 性能：记录与基线一致的样本、环境和前后结果；仅报告可重复结论。

浏览器真实媒体播放、成片视觉质量与跨平台弹出行为应由最终人工验收确认，不将构建成功等同于视觉或媒体验收。

### 批次 8：Web Job spec 最小模块拆分

- [x] 将 yt-dlp 进度解析、fetch-audio spec/校验/finalize 与 `buildJobSpec` 纯移动至 `cli/web-api/job-spec.mjs`。
- [x] 保持 `jobs.mjs` 的状态、spawn、SSE、取消与清理职责，并继续 re-export 既有 spec/进度符号。
- [x] 锁定 `JobValidationError` 的单一类身份，保留 web server 的 `instanceof` 400 映射。

影响范围：`cli/web-api/jobs.mjs`、新增 `cli/web-api/job-spec.mjs`、`cli/web-api/jobs.test.mjs`。

执行：fast-worker。验证：定向 CLI tests 与 `git diff --check`。

验收：既有 jobs 导入路径不变；fetch-audio 与 CLI job 的 spec、进度和校验语义不变；HTTP 仍将字段校验错误映射为 400。

## 实施记录

每个批次完成后在本节追加实际改动、验证结果、与原计划的偏差及其原因；不改写上方原计划。

### 批次 0（2026-07-27，完成）

改动：`web/src/Workbench.tsx` 三处 —— `makeUnlocked` 改为 `renderVideo || exportStill`，`resultsUnlocked` 改为 `videos.length > 0 || stills.length > 0`，`initialSection` 同步纳入 stills 并改写与之矛盾的旧注释。第 68-72 行的回退 useEffect 按引用读取这两个变量，自动继承放宽后的门禁，无需改动。

`capabilities.ts` 未改：逐个核对 remedy 目标后确认 `exportStill` 能力本身早已实现且回链正确，本批次的缺陷纯粹在 `Workbench.tsx` 的步骤门禁。

偏差：未新增 Workbench 层测试。该文件无既有测试且 web 侧没有组件测试基建，新建属于超出批次范围的基建工作；门禁行为改由人工验收。

### 批次 1（2026-07-27，完成）

计划外但同批修复的真 bug：`cli/web-api/fetch.mjs:258` 在写入锁内做 TOCTOU 复查时，把已经过 `resolveSafePath` 的 realpath 又传回校验，而 `root` 仍是未展开符号链接的原始路径；`sandbox.mjs` 第一层是纯字符串前缀比对，于是 `/private/var/...` 不以 `/var/folders/...` 开头即判越界返回 403。后果是**只要服务根路径含符号链接（macOS 的 /tmp、/var、软链接的 home），网页保存歌词必然失败**。此缺陷在基线 `d761ac5` 上已存在，表现为 `fetch.test.mjs` 的落盘测试稳定失败。修法是复查改为重新校验客户端原始入参，既修 bug 也是更强的 TOCTOU 语义。已核对 `cli/web-api/` 全部 `resolveSafePath` 调用点，确认仅此一处。回归测试用手工构造的 symlink 对，不依赖 OS tmpdir 恰好是软链接。

其余四项：

- `fetchLyrics` 能力补 `ambiguousAudio` / `ambiguousLyrics`，与后端 400/409 语义对齐。
- 歌词候选改为「点击选中 → 确认区 → 保存这份歌词」，复用既有 `audio-confirm` 结构与音频确认同形。
- 抽出 `cli/job-argv.mjs` 作为唯一映射源（`buildJobArgv` / `buildJobEnv` / `buildJobInvocation`），`jobs.mjs` 转为 re-export，web 新增 `web/src/command.ts` 直接复用同一份实现。选择共享实现而非双份 + fixture：`filters.mjs` 当年双份的理由是 mjs 无法 import TS 源码，而本例是 ts→mjs 方向，Vite 与 `--experimental-strip-types` 均可直接 import，真能共享就不该留漂移窗口。安全边界不变，前端永不发送 argv。
- 启动提示、占位页、USAGE、菜单项共 7 处「只读画廊」改为「本地工作台」并说明写入/撤销边界；README 双语按计划留给批次 7。

顺带修正的既有缺陷：`cli/command-format.mjs` 原用双引号包裹路径，对含 `$`、反引号、`\` 的路径会静默生成另一个路径，统一到 POSIX 单引号 + `'\''` 转义（`Make.tsx` 原有的那套实现是对的）。

行为改动：`still` 的 `--scale 2` 是 `parseStillArgs` 的默认值却被无条件下发，改为默认值不进 argv，执行结果等价。新增「`buildJobInvocation` 的 argv 与 `buildJobSpec` 实际 args 尾部逐项相等」护栏测试，防止将来只改一边。

验证：web typecheck / 28 测试 / build，cli 370 测试，renderer typecheck / 9 测试，analyzer 128 测试，全部通过。qa-runner 另行逐条审查了所有 `*.test.*` 改动，确认无断言被削弱、删除或 skip。

待人工验收：静态-only 素材夹的步骤门禁与默认落点、歌词候选的选中与确认保存交互、等效命令展示与实际执行的一致性（建议复制展示的命令直接在终端跑一次比对产物）。

留待批次 8 复审：`sandbox.mjs` 第一层比对是否也应使用 `realpathSync(root)`，使 `resolveSafePath` 对「传入已解析路径」幂等。该改动会影响不存在路径的行为，属安全核心，不并入功能批次。

### 批次 2（2026-07-27，完成）

**核心判据（写进了代码注释，防止后人改错）**：「看」不改变任务归属，段切换随便切；「换素材夹」改变任务归属，任务期间禁止。任务状态挂在 Workbench 层正是为了让段切换不卸载 `useJob`，本批次一行未动，并列为回归验收项。同时在注释里显式挡住「把 `useJob` 上移到 App」——那能让任务跨素材夹存活，恰好是本批次要禁止的语义，且会让 `onProjectRefresh` 刷到错的项目。

计划外发现的真缺陷：`cli/web.mjs:83` 用 `process.once('SIGINT')`，第二次启动注册的 handler 排在第一个之后，而第一个 handler 里直接 `process.exit()`，于是**第二个 server 的 `killAll()` 永不执行，Ctrl+C 后其 remotion/chromium 进程树成为孤儿继续占用 CPU**。菜单可重复启动因此不只是 UX 问题，是正确性问题。

`useJob.ts` 实际堵上的五个竞态窗口（原先只有一个 `mountedRef`，且判断位置在赋值之前）：

- POST 在途时卸载 → `jobIdRef.current = id` 永不执行，服务端 job 跑完整程而前端从未持有其 id，`runningJobId` 被占死且无取消入口。修法是赋值提到判断之前。
- 并发 start → 无 in-flight 守卫，两发 POST 的错误状态互相覆盖。加 `startingRef`。
- 旧响应覆盖新响应 → 加代次 `runRef`。
- `jobIdRef` 从不清空 → cancel 可能打到上一轮任务。
- 慢创建期间点取消是**空操作且无反馈**（取消按钮在 `status==='running'` 即渲染，而 `cancel()` 遇空 id 直接 return）。改为挂起并在拿到 id 后补发，仍照常挂 EventSource，由服务端 end 帧定成 cancelled。

竞态修法选序号而非 AbortController：需要的是「状态的最后写入者获胜」，序号对成功/失败/finally 三条路径统一生效；AbortController 只省一点本地服务开销，却引入 `AbortError` 落进 catch 画出假错误的第二种失败模式。有意不取消在途请求。`createLatestGate` 的 `isCurrent` 实现为 `ticket !== 0 && ticket === current` —— 新 gate 的 `current` 初值就是 0，naive 写法会让从未 `begin()` 过的 ticket 意外通过，是测试先失败逼出来的。

重连（独立提交，可整块回退）：前端守卫堵不住「刷新页面 / 关标签页」，而刷新恰是用户困惑时的第一反应，一旦发生就回到 409 死局。新增 `GET /api/jobs/current`，页面 mount 时拉一次，**仅当 folder 与当前素材夹匹配才 attach**。job 上存 `folder` 的用途是让客户端校验归属，不是让服务端拒绝 —— 服务端进程级 `runningJobId` 409 已足够严格。事件重放是现成的（`subscribeEvents` 逐条补发 `job.events`），所以重连后进度日志完整，这是该补丁便宜的原因。

编排者自查补的一处：`attach()` 开头补 `closeSource()`。`start()` 本来就先关一次（幂等无害），但 `reconnect()` 没有；虽然 reconnect 目前只在 mount 时调用、彼时 `sourceRef` 必为空，漏掉这行仍是留给后人的陷阱 —— 一旦 reconnect 被第二次调用就会留下一条没人读也没人关的连接。

**明确的非目标**：不加素材夹级 lockfile。`createJob` 的进程级 `runningJobId` 409 比按 folder 去重更严格；往素材夹写锁文件与既有写入边界姿态冲突；崩溃后的陈旧锁会让用户再也起不来；两个终端各跑一个 `tsuzuri web` 是合法的高级用法。残留风险（两个进程渲染到同一输出路径）在基线上同样存在，非本批次引入。

验证：web typecheck / 33 测试 / build，cli 380 测试，renderer 9 测试，analyzer 128 测试，全部通过。qa-runner 另行逐条确认 `menu-loop.test.mjs` 原有四条用例一字未改，且全部测试改动均为新增、无削弱。

待人工验收：慢创建期间立刻点取消是否真的取消；渲染中换素材夹按钮禁用与「回到任务」链接；**回归项 —— 渲染中在三段间来回切进度与日志不丢**；任务跑到一半硬刷新页面，进度与取消入口是否都回来；面包屑一深一浅快速连点是否停在最后点的那层；菜单选 web 后菜单不再出现且 Ctrl+C 后无 chromium 残留。

### 批次 3（2026-07-28，配置契约第一段完成）

新增 `cli/config.mjs` 与 `cli/toml.mjs`：Node 不新增 TOML 依赖，只解析顶层单行 bool/int/float/string 子集，明确拒绝 table、数组、内联表、多行字符串和点号键。`cli/still.mjs` 改为投影这份共用 schema，不再因错误配置静默回退默认画布；字符串中的 `#` 保持为内容。背景色收紧为 `#RRGGBB`。

Python `tomllib` 解析后以 `analyzer/plan.py` 的镜像字段表收窄到同一产品子集，未知/弃用/类型或范围错误一律退出；`examples/config-cases.json` 由 Node 与 Python 测试共同消费，固定默认值、21 个字段与接受/拒绝案例。未引入 TOML 依赖，因为当前严格标量子集已由手写解析器覆盖。

独立 QA 最终验证：Node targeted 51/51、完整 CLI 260/260、Python config+plan 87、完整 analyzer 150，`git diff --check` 通过。timeline validator 与滤镜输出命名仍未开始，留待本批次后续工作。

### 批次 3（2026-07-28，timeline validator）

新增无依赖的 `cli/timeline-validator.mjs`。它是纯函数：只检查渲染器实际消费的根字段、照片/章节/字幕与可选 `trim`、`chapters`、`branding`、`beats`、`motion` 的真实形态，使用如 `$.photos[2].transition.duration` 的精确路径报错；不补默认、不修复或写回 timeline。省略 `kind` 的旧照片仍合法，未知 `kind` 事件保持忽略以支持将来扩展。

主 CLI 每次读取 timeline 后、统计照片前校验；内部 `render.mjs` 在加载任何 Remotion 代码前再次校验，覆盖直接内部调用。新增 Node 窄测覆盖 analyzer 兼容 fixture、根/事件/数组索引错误、有限数、可选字段、旧照片、未知事件与两个入口的拒绝路径。

独立 QA 最终验证：targeted 20/20、完整 CLI 430/430（无 skip）、analyzer 150、renderer 9/9 + typecheck，`git diff --check` 均通过。QA 发现 `cli/term.test.mjs` 的 trim precedence stub 因缺少 v1 必填字段与首张照片边界，曾把 validator 错误写进 calls 却未断言；已补全合法 timeline v1（保留未知 kind fixture）并断言不存在 `['error', ...]`。另补 `trimmed_duration <= full_duration` 边界，超出时报告 `$.meta.trim.trimmed_duration`。滤镜命名第三段尚未开始。

### 批次 3（2026-07-28，滤镜默认输出命名）

新增 `cli/output-naming.mjs` 作为视频与 still 共用的纯命名规则：只有 CLI、Web job argv 或项目 `tsuzuri.json` 实际给出并最终生效的滤镜才进入默认文件名；渲染器内部滤镜默认强度不会让普通产物改名。规范化后的 registry id 进入后缀，显式强度按数值稳定化（`0.8` 与 `0.80` 同名）；项目逐张配置有多个有效组合时按排序后的完整组合命名，避免覆盖不同滤镜版本。没有有效滤镜的仅强度配置不产生误导性后缀。

`-o` 明确文件路径继续完全原样，仍只对默认基名（以及 existing 的 still 目录输出基名）追加后缀；视频和 still 的原扩展名/基础命名保持不变。CLI、Web 和项目配置统一将 `tealorange`/`teal_orange` 规范为注册表的 `teal-orange`，渲染参数仍使用同一规范 id，未改动滤镜效果。

批次 7 待更新：README 中默认视频/still 产物文件名示例，以及 `tsuzuri.json` 的 filter/intensity 配置说明，需明确显式有效滤镜会形成默认输出后缀与逐张组合规则。

批次 3 至此完成。独立 QA 最终验证：targeted 141/141、完整 CLI 438/438（无 skip）、Web 33/33 + typecheck/build、analyzer 150、renderer 9/9 + typecheck，`git diff --check` 通过。

### 批次 4（2026-07-28，完成）

新增 `web/src/useTabs.ts`，只接收 `values`、`value`、`onValueChange` 与 `idPrefix`，不保存选中值；其水平 roving `tabIndex` 支持 Left/Right 循环、Home/End、自动激活与焦点转移，外部 `value` 变化只重渲染属性而不夺焦。`Materials` 与 `Results` 都改为使用该行为，所有 tab/panel 均以双向 id/ARIA 关联；Materials 三个 panel 继续通过 `hidden` 常驻，Results 的三个 panel 也保持在 DOM 中，音频节点因而不会随 Tab 重建。

顶部素材夹路径取消 JavaScript 字符数截断，改由可收缩容器和 CSS ellipsis 处理，完整路径仍保留在 title；窄屏音频加载、缓冲和错误改为控制条下一行显示，不再隐藏。首轮 320px 几何复测发现 folder 按钮自身出现负 x：`topbar-actions` 位于 Grid 的 `auto` 列，其 max-content 宽度向左溢出。修为 `auto minmax(0, 1fr)`，actions 拉伸到可收缩列，folder `flex: 1 1 0`，图标和 doctor 固定自身宽度；未用 transform、负 margin 或隐藏环境入口。

任务状态改为 polite live status，确定/不确定进度均有可读 progress 语义，失败为 alert，日志保持非 live；媒体加载/缓冲为 status、媒体错误为 alert，FolderPicker 请求错误为 alert，既有 projectStale polite status 未改。未触及批次 6 的 motion 规则。

独立 QA：Web 37/37、typecheck、production build 与 `git diff --check` 全部通过。Playwright 在 320/390/639/640/641/800/801px 下确认 folder 始终在 topbar 内、不与 doctor 交叠、doctor 保持边界可达且无横向 overflow；真实键盘 Arrow/Home/End/环绕、唯一 `tabIndex=0`、ARIA 关联和焦点转移均通过。未新增键盘动画，未触碰批次 6。

仍待人工媒体验收：Results 的真实 audio 播放跨 Tab identity 已由浏览器验证；但动态 loading/buffering/error 状态在该次运行中不可达，需在可复现网络/媒体条件下确认其实际播报与窄屏换行。

### 批次 5（2026-07-28，实施前基线）

环境：HEAD `9ad8b14`；Node `22.18`、npm `10.9.3`、uv `0.11.28`、ffmpeg `8.1.2`、yt-dlp `2026.07.04`；Mac16,1，10 核。

构建与样本：字体总计 `40,587,056B`；Web production build `296K`（`index` `1006B`、CSS `36592B`、JS `259304B`），Vite `831ms`。fixture 为 5 个文件、`237397B`，仅可作 smoke，不能代表真实媒体负载。targeted 测试 `29` 项通过。

doctor：连续 5 次为 `209.52` / `209.36` / `206.34` / `209.72` / `210.71ms`，且 Web 调用仍为同步阻塞。

分析缓存：现有所有运行时路径均包含 `backend`、`model`、`demucs_available`；这些字段变化均为 miss，`invalid => null`。

缩略图：响应为 `200`、`Cache-Control: private, max-age=86400`，没有 ETag/304；原地替换后仍返回 `200`。

5D 的昂贵候选项（字体、Lightbox、EXIF、timeline 扫描、riso）暂不在本基线样本上判断；须以真实样本和预先定义的阈值补齐基准后，才选择高收益改动。

### 批次 5A（2026-07-28，Web doctor）

Web 的 `uv`、`ffmpeg`、`yt-dlp` 探测改为无 shell 的异步并行 `spawn`；每项独立 2 秒超时，超时会终止子进程并返回与缺失/非零退出相同的既有失败项。node、renderer 与 analyzer 仍为同步本地检查，结果在全部完成后严格按 CLI 原有六项顺序组装；`collectDoctorChecks` 与 `runDoctor` 未改，CLI 输出、顺序和退出码保持原语义。

`/api/doctor` 现在由 server 实例持有的 service 提供：完整成功探测完成后缓存 5 秒，同期请求共享同一个 promise；缺依赖仍为可缓存的 200，内部异常由路由转为 500 且不缓存。`refresh=1` 清除已完成缓存但会加入已有 in-flight；前端“重新检查”带该参数，首屏请求保持普通路径。新增注入式测试覆盖并行/固定顺序、超时 kill、single-flight、TTL、refresh 及异常不缓存；全量数字待独立 QA。

独立 QA：targeted `39/39`；完整 CLI `444/444`（无 skip）；Web `37/37`、typecheck、production build 与 `git diff --check` 全部通过。补测覆盖 spawn `error`、非零 `close`、timeout kill、single-flight、TTL、refresh、缺依赖仍为 200 且缓存、异常不缓存及实例缓存隔离。真实异步请求五次为 `202.78` / `170.26` / `190.07` / `178.20` / `208.51ms`，平均 `189.96ms`；同步基线平均 `209.13ms`。service 首次 `185.72ms`，立即重复 `0ms`（collector `1` 次）。wall time 只有小幅改善，核心收益是外部命令不再阻塞 event loop，以及并发请求的 single-flight 合并。

### 批次 5B（2026-07-28，analysis cache runtime 指纹）

分析缓存 contract 升为 v2。Node 保留 Python 报告的完整能力信息，但在稳定哈希前按实际输入投影：有 LRC 时仅包含 analyzer schema/beat feature 版本；无 LRC 且 `demucs = false` 时包含 backend/model 而不包含 demucs availability；无 LRC 且 demucs 开启或默认时包含完整运行时字段。音频与 LRC 内容仍参与哈希，`lyrics` 命令未纳入；无效或重复 demucs、运行时命令失败或字段非法时返回 `null`，保守跳过缓存。v1 manifest 会自然 miss 后以 v2 重建，无迁移或兼容读取。

测试覆盖 LRC/no-LRC 各路径的命中与失效、LRC 内容变动、无效 demucs/运行时与 v1 manifest miss；并补测无 LRC 时相同 audio/runtime 的显式 `demucs = false` 与默认/`true` 哈希不同，确保实际执行路径不会复用。独立 QA：analysis-cache `8/8`、完整 CLI `451/451`（无 skip）、analyzer `150`，`git diff --check` 通过。v1 manifest 以一次 miss 自然重建为 v2，无迁移或兼容读取。

### 批次 5C（2026-07-28，thumbnail ETag）

缩略图身份以 canonical path、dev、ino、size、高精度 mtime/ctime 与归一化宽度共同哈希，同时作为落盘缓存键和强 ETag；旧平台没有纳秒字段时稳定回退到毫秒字段。响应改为 `private, no-cache`，支持 `If-None-Match` 的列表、弱标签及 `*`，命中时仅返回 ETag/缓存控制的 304，不创建读取流。

生成期间在完成后再次 stat；身份变化会清除本次临时文件并从新身份重试一次，连续变化明确返回 409，避免缓存错图。ffmpeg 失败仍回退原图，但复用同一源身份 ETag。已加入可注入 stat/generator/stream 的单测覆盖。

独立 QA：targeted `41/41`、完整 CLI `459/459`（无 skip）、Web `37/37` + typecheck + production build，以及 `git diff --check` 全部通过。真实 HTTP 验证为首次 `200 → 304`，同路径替换后返回新 ETag 的 `200 → 304`，响应缓存控制为 `private, no-cache`；临时 fixture 已清理。首次并行 runner 出现一次 deserialize 偶发，单独完整重跑后清零，判定为测试运行环境偶发而非产品失败。

### 批次 5D（2026-07-28，性能候选测量与取舍）

本项无源码改动。三套字体分别为 `1887192B`、`13574352B`、`25125512B`，合计 `40587056B`；均由语言回退实际引用，没有安全候选可删。

repo 仅有 3 张 JPEG，且均无 EXIF；Lightbox/EXIF 缺少真实负载证据。对这 3 张的 EXIF 测量 median 为 `0.16–0.29ms`，总计约 `0.68ms`，仅能视为 smoke，不作优化依据。

timeline 等价筛选 100 / 500 / 2000 条目的 median 为 `0.074` / `0.326` / `1.306ms`；500 条目未达 `1ms`，且没有 render wall time `>= 5` 的证据，故不改。

合法 1s、60 frames 的 riso 测量：base `2.88s`、riso `2.91s`，增加 `1.0%`；RSS median 分别为 `477927552` / `478041976`，增加 `0.024%`，p95 增加 `0.35%`，均未跨阈值，故不改。临时目录已清理。

批次 5 的四项均已完成；最终全量 QA 待后续记录。

### 批次 5（2026-07-28，最终 QA）

最终全量 QA 通过：CLI `459/459`，无 fail / skip / todo；analyzer `150`；renderer `9/9` 加 typecheck；Web `37/37` 加 typecheck 与 production build；`git diff --check` 通过。测试未新增 skip / only / todo，保留的仅为既有平台条件。

工作区 12 项改动均为预期的 5A–5C 实现与本计划记录，没有临时垃圾。根目录执行 `npm test` 的 `ENOENT` 是根目录没有 `package.json`，不是测试失败；正确的 CLI 测试命令在 `cli/` 目录执行。

批次 5 完成，未提交。

### 批次 6（2026-07-28，实施）

移除了全局的 `0.01ms` reduced-motion 覆盖，改为组件级规则：参数与环境面板在 reduced motion 下只淡入淡出，spinner 与不确定进度条保留 opacity 状态反馈而不再旋转或横移。新增最小 `useTransitionPresence`，参数表单与环境面板关闭后保留 150ms，进入为 200ms；因此快速开关可中断且不会直接消失。

照片卡片不再位移或扩张阴影，只在 `hover: hover` 和 `pointer: fine` 下反馈边框颜色。任务确定进度换为带完整 ARIA 数值的 `div[role=progressbar]`，内部填充以 `scaleX()` 过渡，不再依赖浏览器 progress value 的 `width` transition。素材与成果 Tabs 合并为同一组 CSS，并移除无实际 transform 的 transition。

新增 `motion-contract.test.ts` 守护上述约束，并按现有 Node 测试惯例加入 `tsconfig` exclude。实施者已跑 Web `40/40`、typecheck、production build 与 `git diff --check`，均通过；人工视觉、触摸与系统 reduced-motion 验收待独立 QA。

## 复审记录

### 批次 3 配置契约漂移修复（2026-07-28）

- 根因：Node 标量解析器曾支持 TOML literal 单引号字符串，而 schema 校验阶段已丢失引号来源；Python 仅在 `tomllib` 解析后检查 `str`，同样无法区分双引号与单引号。共享 fixture 因而错误地将该写法固定为合法。
- 修复：Node 在标量入口按键名和行号拒绝单引号；Python 在 `tomllib` 前以最小逐行 bare-key/标量词法扫描镜像拒绝，不重写第二套 TOML parser，双引号值中的 `#` 不受影响。fixture 改为 `single-quoted-string-rejected`，供两侧契约测试共同消费。
- 回归边界：保留双引号基本字符串和行尾注释语义；`1_920`、`0x780`、数组和 table 的既有接受/拒绝规则不变。定向验证交由 QA，未提交。

### 批次 3 数字下划线契约补正（2026-07-28）

- QA 复核发现真实产品入口仍接受 `width = 1_920`。根因是此前测试名称与 parser 的 standalone 覆盖被误读为入口契约，数值下划线没有锁入 Node/Python 共用 fixture。
- 修复：Node bare number 词法层拒绝含 `_` 的数字；Python 的原始标量预扫描镜像同一规则。错误均包含键名、行号与“改用不带下划线的十进制”指导；键名及双引号字符串中的下划线不受影响。
- fixture 改为 `numeric-underscore-rejected`，保留 0x 与单引号拒绝路径；窄测可选，完整验证交 QA，未提交。

### 批次 6 QA 退回（2026-07-28）

- 发现：presence 仅靠 150ms timer 卸载，未消费真实的 `opacity` transitionend；快速 reopen 后旧的异步回调没有代际隔离。
  根因：初版 hook 只建模了可见状态，没有把 transition 生命周期和过期事件视为独立契约。
- 发现：退出中的参数/环境面板仍可能接收焦点或点击；reduced-motion 把 spinner 和不确定进度改成 pulse keyframe，仍违反无位移动画的退化要求。
  根因：只处理了视觉 opacity，缺少交互隔离与静态替代的无障碍约束。

### 批次 6 QA 修复（2026-07-28）

`useTransitionPresence` 现以 `opacity` 的直属 transitionend 为优先卸载路径，并保留约 250ms timer 作为缺失事件的 fallback；reopen 会取消 pending rAF/timer，并以 generation 重建承载节点，隔离旧 transition 事件。参数和环境面板在关闭的同一渲染中设置 `aria-hidden` 与 pointer-events，并通过 DOM `inert` 属性移出交互树。reduced-motion 下 spinner 与不确定进度的移动填充均隐藏，状态文本仍保留。

复验结果：Web motion 契约 `3/3`（整套 Web `40/40`）、typecheck、production build 与 `git diff --check` 通过；人工浏览器/辅助技术验收仍待独立 QA。

待实施后复审。复审应记录发现项、根因、修复批次、回归验证与仍保留的已知限制。

### 批次 6 QA 第三轮发现（2026-07-28）

- 发现：reduced-motion 的 presence 规则选择器与普通 `.transition-presence-open`、`.transition-presence` 同级或更弱，open 的 200ms 与 closing 的 150ms 可在层叠中覆盖预期的 120ms。
  根因：初版 reduced-motion 规则只收窄 transition 属性，没有为 open 和 closing 状态建立能胜过普通状态规则的明确选择器与时长契约。

修复待后续最终验证：reduced-motion 以 `.transition-presence.transition-presence-open` 与 `.transition-presence:not(.transition-presence-open)` 分别覆盖 open/closing，二者均只保留 opacity、`transform: none` 与 `transition-duration: 120ms`；不使用 `!important`。回归断言将明确检查 closing selector 与 120ms 同在该规则中，避免普通 closing 150ms 重新覆盖。

### 批次 6（2026-07-28，最终独立 QA）

独立 QA：Web `40/40`、typecheck、production build 与 `git diff --check` 全部通过。首次 QA 曾因 presence 生命周期语义及 reduced-motion pulse 退回；修复后，normal 模式实测 Doctor 面板 open 为 `200ms`，close 为 `10ms`，关闭期间仍挂载且具备 `aria-hidden`、`inert` 与 `pointer-events: none`，`50ms` reopen 不会被旧回调误删，`300ms` 后卸载。

reduced-motion 最终加载的 CSS 为 `index-BPgiXn1-.css`，`matchMedia` 为 `true`；open/close 均为 `transform: none`、`transition-property: opacity`、`transition-duration: 120ms`、`transition-timing-function: ease-out`、`transition-delay: 0`、`animation: none`，close 于 `160ms` 卸载。中间一次 duration 断言失败的根因是旧 dist fingerprint，重新 production build 后通过。

人工验收边界：未在浏览器验证 Make 的实际快速反向、390px coarse-touch 照片反馈、动态 JobPanel progress/spinner，以及 Lightbox 的 reduced-motion；源码与守护测试已覆盖相应约束，但不以此宣称完整视觉验收。验证工具目录已清理。

### 批次 7（2026-07-28，文档实施）

README 中英版压缩为同构的「快速开始、使用、配置与文档、开发、许可」入口：明确产品是可写入的本地工作台，保留最短命令、裸命令菜单语义、默认视频/still 命名与显式 `-o` 优先级，移除长滤镜 JSON、签名教程、并发、fetch 流程、架构和 FAQ 式内容。两版标题顺序、命令和链接目标已逐项对齐。

`docs/config.md` 改为严格 21 键 schema，列出默认值、范围和 TOML 词法边界；明确 Python 视频和 Node still 使用同一契约与 fixture，但不承诺错误文字逐字一致。`timeline-schema.md` 限定为 validator 实际消费的只读检查、精确 path、双入口、filter/sign、旧照片与未知 kind 兼容，不再夸大为完整 JSON Schema 或连续性保证。

`tsuzuri-status.md` 对齐本地工作台的资产 mutation 安全、回收区与进程内 undo、job 409、换夹禁用、同 server 同 folder 刷新重挂、歌词确认、still scale、doctor、缩略图 ETag/304 与分析缓存 v2。移除过期测试数字 `103` / `138`，最终 QA 数字由独立 QA 后补。

自检：仅修改 README、配置、timeline、状态和本计划；相对链接、README 标题/命令/链接对齐、21 个配置键及 `git diff --check` 交由本批次自检。完整测试仍交 QA，未提交。

### 批次 7 文档漂移复审（2026-07-28）

- 发现：README 与状态页仍把工作台描述为只读，并保留已被批次 3 输出命名与严格配置契约淘汰的说明和过期测试计数。
  根因：跨层实现批次将用户可见行为登记在计划中，但没有在同一批更新长期入口文档，且历史验证数在后续测试扩展后未被替换。
- 修复：批次 7 将入口文档压缩并链接至稳定参考，配置和 timeline 文档按当前 validator/schema 收窄，状态页以行为边界替代历史实现流水账；测试数字等待最终 QA 后再写入。

### 批次 7（2026-07-28，最终验证）

基线 HEAD `8a40d07`，在当前工作树完成最终验证：CLI `460/460`、Analyzer `150`、Renderer `9/9` 加 typecheck、Web `40/40` 加 typecheck 与 production build 全部通过，0 skip / only。浏览器真实媒体播放与成片视觉质量仍由人工验收。

历史段落中的“只读画廊”和 `Cache-Control: private, max-age=86400` 是保留的审计/性能基线文字，不能按现状解读；它们不改写历史记录，当前语义以批次 1、5C 与批次 7 的实现记录为准。

### 批次 8（2026-07-28，实施）

新增 `cli/web-api/job-spec.mjs`，纯移动 yt-dlp 进度解析、fetch-audio 的字段校验/spec/finalize 和 `buildJobSpec`；`jobs.mjs` 仅保留 job 状态、spawn、SSE、取消和清理，并继续从原路径 re-export `buildJobSpec`、`parseYtDlpProgress`、`YTDLP_PROGRESS_LABEL`。

取舍：没有拆分 `fetch.mjs`，也未增加新的抽象或目录迁移。`JobValidationError` 在 `job-spec.mjs` 与 `jobs.mjs` 均直接来自 `job-argv.mjs`；新增 identity 测试锁定该约束，避免 web server 的 `instanceof` 400 映射因重复类定义失效。

验证：`(cd cli && node --test web-api/jobs.test.mjs)` 79/79 通过；`git diff --check` 通过。不在此记录“最终全仓复审通过”。

### 批次 8（2026-07-28，最终验证与独立复审）

基线：HEAD `73f7bac` 加当前工作树。targeted `461`、完整 CLI `461`、Analyzer `150`、Renderer `9` 加 typecheck、Web `40` 加 typecheck 与 production build、`git diff --check` 均通过。

独立复审结论：`job-spec.mjs` 仅承接 spec 组装与 fetch-audio 的纯校验/收尾；`jobs.mjs` 仍独占任务状态、spawn、SSE、取消和清理。原导出路径保持，`JobValidationError` 继续来自同一个 `job-argv.mjs` 类定义，未发现代码缺陷或行为回归。批次 8 的实施项均已勾选完成。

人工验收边界：未做真实浏览器交互、真实 yt-dlp 网络下载或真实媒体渲染；上述项目仍需人工环境验收。
