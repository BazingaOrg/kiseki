# 项目全面优化执行方案

日期：2026-07-27  
基线：`d761ac5`（`main` 与 `origin/main`）  
状态：待实施

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

- [ ] 将 `exportStill`、`output.stills` 纳入流程解锁判定：无音频但有照片时可进入「制作」，仅有静态作品时可进入「成果」。
- [ ] 同步修正默认 Tab（`initialSection`）与能力 remedy 回链，使静态-only 素材夹不会落到锁死的步骤。

影响范围：`web/src/Workbench.tsx` 及其测试。

执行：fast-worker。验证：qa-runner 跑 Web 类型检查与组件测试。

验收：静态-only 与无音频素材夹可完整走完导出→查看；视频流程行为不变。

### 批次 1：能力门禁、歌词确认与命令映射

- [ ] 收紧在线找歌词能力为“恰好一份音频”，显示多音频歧义说明。
- [ ] 将歌词候选改为选择后显式确认保存，与 CLI 的确认模型一致（与上一条同属歌词语义域，一次改完，不拆到后续批次）。
- [ ] 抽出纯 `options → argv → command` 映射，使任务参数与“等效终端命令”同源。
- [ ] 将启动提示与界面内文案由“只读画廊”改为“本地工作台”，写清写入、撤销与回收边界。README 双语不在本批次改动，统一留到批次 7。

影响范围：`web/src/capabilities.ts`、`web/src/Materials.tsx`、`web/src/Make.tsx`、`cli/web-api/fetch.mjs`、`cli/web.mjs` 启动提示。

执行：fast-worker（命令映射的选项清单先由 deep-reasoner 对照 CLI 参数核定）。验证：qa-runner 跑 Web 与 CLI 单测。

验收：静态-only、视频-only、无音频、多音频四类素材夹均展示正确能力；命令展示和实际 argv 对所有可见选项一致；选择歌词候选在确认前不写文件。

### 批次 2：任务生命周期、单实例与请求竞态

- [ ] 任务创建/运行期间禁用素材夹切换，保留进度、错误和取消入口。
- [ ] 确保 POST 成功后 job id 即使在状态切换中也不丢失。
- [ ] Web 启动后退出交互菜单循环，避免同一项目多服务实例。
- [ ] 为项目刷新提供可见错误与重试；为文件夹导航加入请求取消或序号防旧响应覆盖。

影响范围：`web/src/useJob.ts`、`web/src/Workbench.tsx`、`web/src/App.tsx`、`web/src/FolderPicker.tsx`、`cli/tsuzuri.mjs`、`cli/web.mjs` 及相应测试。

执行：deep-reasoner 先定任务状态机与竞态处理方案，fast-worker 实现。验证：qa-runner。

验收：慢创建、运行中切换、取消、连续导航、重复启动菜单均有自动化或可复现覆盖；服务端任务状态与 UI 始终一致。

### 批次 3：配置、timeline 与输出命名契约

前置决策（本批次开工前必须定，不得边写边定）：

- **存量配置兼容**：`cli/still.mjs` 当前是宽容的手写 flat 解析器 —— 未知键静默跳过、非法值静默回退默认、`background = FFFFFF` 这类标准 TOML 非法写法今天可用。改为 fail-fast 会让现存 `tsuzuri.toml` 从静默降级变成直接报错。需先在 deep-reasoner 结论中选定：硬切并在文档/CHANGELOG 声明，或先出一版 warning 再硬切。默认倾向硬切 + 明确报错信息（含键名与期望形式），因为静默降级本身就是本轮要消除的问题。
- **Node 侧解析实现**：与 `tomllib` 对齐语义，要么引入 TOML 依赖，要么扩写手写解析器。这与「不为理论收益增加新依赖」存在张力；本轮的取舍是：仅在手写解析器无法覆盖 schema 所需语义时才引依赖，且必须在本文件记录理由。

- [ ] 定义视频/still 共用字段 schema 与跨 Node/Python fixture。
- [ ] 按上述前置决策统一合法数值形式和非法字段的 fail-fast 行为，并给出可读错误信息。
- [ ] 在渲染前增加只读 timeline validator，报告精确 JSON path，不自动改写文件。
- [ ] 为显式滤镜/强度生成稳定默认后缀，保持显式 `-o` 原样优先。
- [ ] 记录本批次导致失效的文档点（默认产物文件名示例、配置字段说明），交批次 7 统一更新。

影响范围：`analyzer/plan.py`、`cli/still.mjs`、`cli/render.mjs`、`cli/tsuzuri.mjs`、配置与 fixture 测试。

执行：deep-reasoner 定 schema 与兼容策略，fast-worker 实现与写 fixture。验证：qa-runner 跑 CLI 单测与 Python 测试。

验收：同一配置在视频与静态导出具有一致校验结果；错误 timeline 在进入 Remotion 前报出；默认产物不互相覆盖；存量非法配置的报错行为与前置决策一致，并已登记待更新文档点。

### 批次 4：移动端、Tabs 与无障碍

（歌词确认已并入批次 1，此处不再重复。）

- [ ] 修复 320/390/640px 下的顶部运行态布局、路径截断与控件换行。
- [ ] 抽轻量共享 Tabs 行为，支持 roving `tabIndex`、方向键、Home/End 和正确 ARIA 关联。
- [ ] 补齐任务、媒体、空状态、错误状态及键盘可达性的反馈。

影响范围：`web/src/App.css`、`web/src/Materials.tsx`、`web/src/Results.tsx`、相关共享 hook/组件及测试。

执行：fast-worker。验证：qa-runner 跑组件测试与窄屏断言。

验收：键盘可完成 Tab 切换；窄屏无重叠。

### 批次 5：doctor、缓存、缩略图与测量驱动性能优化

- [ ] 将 Web doctor 改为异步并行、短 TTL 的状态检查；CLI doctor 保持原同步语义。
- [ ] 按实际 LRC/demucs 执行路径计算分析缓存运行时指纹。
- [ ] 调整缩略图响应为 ETag + `private, no-cache`，验证原地替换后的浏览器复核。
- [ ] 对字体、Lightbox、EXIF、timeline 扫描和 riso 按基线结果选择少量高收益改动。

影响范围：`cli/doctor.mjs`、`cli/web-server.mjs`、`cli/analysis-cache.mjs`、`cli/web-api/thumb.mjs`、`web/src/media.ts`、Renderer 或 Lightbox（仅在数据支持时）。

执行：deep-reasoner 判定缓存指纹与基线取舍，fast-worker 实现。验证：qa-runner 跑测试并记录前后测量。

验收：doctor 不再阻塞并发请求；缓存命中符合实际执行路径；缩略图替换可复核；每个保留优化有前后数据。

### 批次 6：动画、reduced-motion 与交互质量

- [ ] 为 reduced-motion 设计组件级降级，消除移动/缩放但保留必要状态反馈。
- [ ] 降低照片 hover 的布局/绘制成本并限定细指针设备。
- [ ] 将参数/环境面板 keyframe 改为可中断、可反向的 transition。
- [ ] 将进度条改为 transform 驱动或取消不必要的平滑。
- [ ] 合并 Tabs 的重复 motion 样式，移除无效 transition。

影响范围：`web/src/index.css`、`web/src/App.css` 及引用该样式的组件。

执行：fast-worker。验证：qa-runner 跑构建与 reduced-motion 相关断言，视觉部分转人工验收。

验收：快速开关面板无突变；reduced-motion 无位移且仍可读；触摸设备无悬停残留；进度更新不以 width transition 造成额外布局。

### 批次 7：文档、配置说明与状态对齐

- [ ] 校对 README 中英版本、命令帮助、配置字段、API 与当前 UI 行为（README 双语的“只读画廊”表述由本批次统一处理，批次 1 只改启动与界面文案）。
- [ ] 落实批次 3 登记的失效文档点：默认产物文件名示例、配置字段合法形式与报错行为。
- [ ] 明确素材变更、撤销、回收区、任务、静态导出、歌词歧义和缓存行为。
- [ ] 维护项目状态与本计划的实施/复审记录，避免测试数量或实现描述漂移。

影响范围：`README.md`、`README.en.md`、`docs/` 中相关配置/状态文档及本文件。

执行：fast-worker。验证：qa-runner 逐条对照命令帮助与实际输出。

验收：文档命令、配置字段、界面文案和真实运行行为逐项对应；不再出现“只读画廊”等过期表述。

### 批次 8：有明确收益的模块拆分与收尾复审

- [ ] 仅拆分已在本轮修改且职责明确的 `jobs.mjs` / `fetch.mjs` 部分，避免迁移式重构。
- [ ] 清理本轮产生的重复逻辑、无用 import、无效样式和过期测试断言。
- [ ] 对契约、安全边界、性能回归、UI/UX 和文档进行独立复审并修复发现项。

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

## 复审记录

待实施后复审。复审应记录发现项、根因、修复批次、回归验证与仍保留的已知限制。
