# Web 工作台重构：流程梳理 + 交互与 UI 设计

日期：2026-07-25
状态：批 A 已完成，批 B / C 待做

## 目标

把 `web/` 从"只读画廊"重构成**素材夹工作台**：终端菜单的全部能力在网页上可用，且每一步的可用性由素材与依赖的真实状态决定（不满足就禁用并说明原因），而不是四个可以乱点的 tab。

用户诉求原文要点：先选素材夹，没选之前什么都做不了；菜单/操作之间的依赖要在 UI 上体现；补 logo；重做文案；重做照片查看、歌词样式、视频播放的全部 UI；尽量复用现有代码。

---

## 一、流程与分支梳理（设计的地基）

### 1.1 素材夹的状态向量

一个素材夹能被观测到的全部状态，只有这几维（均可由现有 `scanFolderLoose` + 约定路径读出）：

| 维度 | 取值 | 来源 |
| --- | --- | --- |
| `photos` | 0 / ≥1 | `scanFolderLoose` |
| `audio` | 无 / 1 份 / 多份（歧义） | `scanFolderLoose` |
| `lrc` | 有 / 无 | `scanFolderLoose` |
| `recognized` | `output/metadata/lyrics.json` 是否存在 | 约定路径 |
| `timeline` | `output/metadata/timeline.json` 是否存在 | 约定路径 |
| `videos` | `output/*.mp4` 列表 | 已有 |
| `stills` | `output/stills/*` 列表 | 已有 |
| `filterConfig` | `tsuzuri.json` | `readFilterConfig` |

横切一维（与素材夹无关）：**环境依赖** = node / uv / ffmpeg / renderer node_modules（硬）+ yt-dlp / analyzer venv / whisper model（软），来自 `doctor.mjs`。

### 1.2 能力 → 依赖表（这张表就是前端门禁的唯一真相）

| 能力 | 硬依赖 | 软依赖 | 产物 |
| --- | --- | --- | --- |
| 检查环境 doctor | — | — | 状态 |
| 在线取音频 | 文件夹 | yt-dlp | `audio/*.mp3` |
| 在线取歌词 | **已有音频**（靠标题/时长匹配） | 网络 | `audio/*.lrc` |
| 识别歌词 lyrics | 音频 + uv | whisper 模型（首次自动下） | `output/metadata/lyrics.json` |
| 导出静态图 still | ≥1 照片 + renderer deps | — | `output/stills/*` |
| 渲染视频 render | ≥1 照片 + 音频 + uv + ffmpeg + renderer deps | lrc（无则本地识别） | `output/*.mp4` |
| 播放成片 | 已有成片 | — | — |
| 歌词跟播 | 音频 + (lrc 或 lyrics.json) | — | — |
| 浏览照片 | ≥1 照片 或 ≥1 stills | — | — |

**推论一**：`fetch` 不是平级功能，是素材缺失时的补齐动作 → 应长在"素材"区的空位上，而不是主菜单第 5 项。
**推论二**：`doctor` 不是平级功能，是横切前置条件 → 应是常驻的环境状态指示，缺件时直接把对应能力禁用并写明"缺 ffmpeg"。
**推论三**：`lyrics`（识别预览）不是独立页面，是"歌词"这一素材的获取方式之一，与"在线取歌词"并列。

### 1.3 重构后的信息架构

```
[未选素材夹]  全屏欢迎页：logo + 一句话 + 文件夹选择器
              —— 没有导航栏。不是"导航栏灰掉"，是根本不存在。
                 这是最干净的门禁：无处可点，就不必解释为什么不能点。

[已选素材夹]  顶栏：logo | 素材夹名 ▾（切换） | 环境状态点 ▾（doctor 面板）
              主区三段（锚点导航，可自由跳转，但每段内部按依赖禁用）：

              ① 素材   照片条 · 音频卡 · 歌词卡
                       缺件时该卡变成行动卡（在线获取 / 本地识别 / 说明如何放文件）
              ② 制作   渲染视频卡 · 导出静态图卡
                       各自可展开参数表单；不满足依赖时禁用并给出补齐入口
              ③ 成果   成片播放 · 照片墙 · 歌词跟播
                       无产物时给出"去制作"的回链，而不是干巴巴一句"还没有"
```

段与段之间**不做强制线性锁**（用户可能只想看已有成果），锁在**能力粒度**上——这比锁在页面粒度上更准确，也更少挫败感。

---

## 二、后端：如何复用现有代码

### 2.1 执行模型：只组装 argv，spawn 子进程

`cli/tsuzuri.mjs` 的 `runCommandFromArgv(argv)` 是全部能力的唯一入口，`menu.mjs` 已经确立了"菜单只组装 argv 交回 parseArgs，与命令行走同一条代码路径"的约定。Web 沿用同一约定：前端表单 → argv → `spawn(process.execPath, ['cli/tsuzuri.mjs', ...argv])`。

选子进程而非同进程调用的理由：
1. 渲染是重 CPU 长任务，同进程会把 server 阻死；
2. 可取消（kill 进程组）；
3. 子进程崩溃不带走 server；
4. `stdin` 用 `'ignore'` → `process.stdin.isTTY` 为 false → `maybePersistTrimChoice` 与 `offerFetch` 的交互分支自动跳过，不会出现"网页上的任务卡在一个看不见的终端提问上"。（trim 的选择改由前端显式传 `--trim`。）

**零重复实现**：不在 web 侧复制任何管线逻辑。

### 2.2 进度：给 term.mjs 加一个结构化出口

现有 `term.mjs` / `progress.mjs` 的输出是给人看的（`▸ 分析音频`、`└ [████░░] 42%`），在 web 端正则解析既脆又丑。改为：新增环境变量 `TSUZURI_JSON_PROGRESS=1`，开启时 `term.*` 与 `createPercentProgress` 额外向 **fd 3** 写 NDJSON 事件（`{stage, kind, text, percent}`）。终端行为零变化（fd 3 不存在时静默丢弃），web 端拿到干净的结构化事件流。改动集中在 `term.mjs` / `progress.mjs` 两处。

### 2.3 fetch 是唯一不能 spawn 的

`fetch.mjs` 全程 readline 问答（搜索→选择→确认）。但它的决策逻辑**已经抽成纯函数**（文件头注释即言明），交互层只负责问答与 spawn。方案：新增 `/api/fetch/search`（薄封装 `ytdlp.mjs` 的 `searchYtDlp` 与 LRCLIB 调用）与 `/api/fetch/download`（`downloadWithYtDlp`），把"选哪一条"的交互放到前端。这是本次**唯一需要在 cli 侧做导出重构**的地方——把 LRCLIB 搜索从 `fetch.mjs` 的交互流程里提出为可独立调用的导出函数。

### 2.4 安全：写操作必须加 token

现有 server 只 bind 127.0.0.1 + 校验 `Host` 头（阶段三 review 已修 DNS rebinding）。但一旦引入写操作，本地 server 就具备"在用户机器上执行渲染 / 下载 / 写文件"的能力，风险等级变了：

- 现有 `req.method !== 'GET' → 405` 挡住了简单跨源请求，但**跨源 POST 表单是允许发出的**，仅靠 Host 头不够稳妥（Host 校验对 `<form>` 提交同样生效，但不应把安全全部押在单一控制上）。
- 措施：启动时生成随机 token 注入 `index.html`，所有写请求必须带 `X-Tsuzuri-Token`（自定义头 → 强制预检 → 天然免疫表单型 CSRF）。**双控制而非单控制。**
- 写操作一律限定在沙箱根内，复用 `resolveSafePath`。

### 2.5 新增 API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/doctor` | 复用 `doctor.mjs`，返回结构化依赖状态（需把 `runDoctor` 的检查项与打印分离） |
| GET | `/api/exif?path=` | 单张 EXIF，复用 `exif.mjs`（填上阶段三留的缺口） |
| POST | `/api/jobs` | 起任务，body = `{kind, folder, options}` → 服务端组装 argv，返回 `jobId` |
| GET | `/api/jobs/:id/events` | SSE 推 NDJSON 进度事件 |
| POST | `/api/jobs/:id/cancel` | 终止 |
| GET/POST | `/api/fetch/search` · `/api/fetch/download` | 见 2.3 |

---

## 三、UI / 视觉设计

### 3.1 Logo（内联 SVG 字标）

概念：「綴」的偏旁「糸」抽象成一条穿针引线的曲线，串起三枚小方块（三张照片）——"缀连"的字面意思，也正是产品做的事。细线单色 `currentColor`（自动适配深浅色），24px 高，右侧配小字 `tsuzuri`。同一份 SVG 转 data URI 做 favicon。放在顶栏左侧与欢迎页中央（欢迎页版本放大到 64px）。

不复用 CLI 的 ASCII 猫——那是终端语境的产物，网页上是降级不是延续。

### 3.2 设计语言

沿用 `renderer/src/theme.ts` 的暖灰调色板与三层照片阴影（`index.css` 里已建好 CSS 变量，继续用）。补充：

- **字体**：正文继续 `-apple-system` 系；标题与歌词用衬线（与渲染成片的 Noto Serif 呼应），拉开层次。当前全局一律 serif，导致 UI 控件也是衬线，偏"文档"不像"工具"——改为**控件用无衬线，内容用衬线**。
- **留白优先于描边**：分区靠间距而非卡片边框，减少视觉噪声。
- **禁用态必须携带原因**：所有 disabled 控件旁跟一行小字说明缺什么 + 一个补齐入口。灰掉但不解释是当前最大的体验缺陷。

### 3.3 文案

原则：安静、具体、给下一步。延续 CLI 的语气但去掉终端腔。

| 场景 | 现在 | 改为 |
| --- | --- | --- |
| 未选文件夹 | （无欢迎页） | 「先挑一个素材夹。里面放着照片、一首歌，剩下的交给 tsuzuri。」 |
| 步骤未解锁 | 「先选择一个素材夹吧。」 | （不出现——未选时导航根本不存在） |
| 无导出照片 | 「还没有导出的照片，先渲染一张吧。」 | 「这里会放导出的作品图。→ 去导出一张」（带真按钮） |
| 无成片 | 「还没有渲染好的成片。」 | 「还没有成片。19 张照片和一首歌都齐了，可以开始渲染。→ 渲染」 |
| 缺音频 | （无） | 「还差一首歌。可以拖进文件夹，也可以在线找一首。→ 在线获取」 |
| 缺 ffmpeg | （无） | 「渲染需要 ffmpeg。→ 复制安装命令」（复用 `dependencies.mjs` 的 FIXES 文案） |

### 3.4 照片查看（重做）

现状：只展示 `output/stills`，原始 `photos[]` 从未消费；Lightbox 只有一张图 + 关闭。

- 照片墙分两组：**素材照片** 与 **导出作品**（现在只有后者）。
- 缩略图走 `/media`，但加 `loading="lazy"` + `decoding="async"` + 固定 `aspect-ratio` 占位，避免瀑布式重排。
- Lightbox 重做：← → 翻页、`n / N` 计数、EXIF 侧栏（新 API）、双击/滚轮缩放、从缩略图位置放大的 FLIP 过渡、`Esc` 关闭（已有）。焦点陷阱 + `aria-modal`。

### 3.5 歌词（重做）

现状：`font-weight: 600` + 字号从 1rem 跳到 1.1rem，跳变生硬；`scrollIntoView({behavior:'smooth'})` 不可打断、用户手动滚动时会被抢走。

- 视觉：非当前行 `opacity` 按距离衰减（0.55 / 0.35 / 0.2），当前行 1.0 且字号放大；用 `transform: scale()` + `opacity` 过渡（0.35s ease-out），不动 `font-size`（避免逐帧重排）。
- 滚动：改为容器 `scrollTop` 自己补间，**可被用户滚动打断**（打断后 3s 无操作再恢复自动跟随）。
- 无 lrc 但有 `lyrics.json` 时也能跟播（现在只读 lrc）；置信度低于 `RENDER_CONFIDENCE_THRESHOLD` 的行标灰并提示"渲染时不会显示"。
- `prefers-reduced-motion` 下去掉位移与缩放，只留透明度切换。

### 3.6 播放（重做）

- 成片播放器：自定义控制条（原生 `<video controls>` 在深色页面里很突兀），保留键盘可达性。多份成片时用带缩略帧的选择器而非纯文件名按钮。
- 音频播放器：加波形/进度条 + 时间显示，与歌词视图共享播放状态（当前 Player 与 Lyrics 各自持有独立 `<audio>`，切 tab 进度丢失——阶段四明确接受的简化，本次重构应当解决，因为三段式布局下两者可能同屏）。

### 3.7 动画原则

只动 `opacity` / `transform`；进入 200–300ms `ease-out`，退出 150ms；列表项 stagger ≤ 30ms；任务进度用确定进度条（有 percent 时）否则呼吸式 indeterminate；全部动效在 `prefers-reduced-motion: reduce` 下降级为无位移。

---

## 四、执行计划（分三批，逐批验收）

### 批 A：流程重构 + 只读体验重做（不含写操作）

1. [x] `web/src/logo.tsx`：内联 SVG 字标 + favicon data URI。→ 验证：深浅色下目检。
2. [x] `cli/web-api/doctor.mjs` + `GET /api/doctor`：拆分 `doctor.mjs` 的检查项与打印（检查项返回结构化数组，`runDoctor` 只负责打印）。→ 验证：doctor CLI 输出零变化的回归测试 + 新 API 单测。
3. [x] `cli/web-api/exif.mjs` + `GET /api/exif?path=`：复用 `exif.mjs`。→ 验证：单测含沙箱穿越用例。
4. [x] `/api/project` 补充 `recognized` / `timeline` 状态位与 `photos` 的存在性。→ 验证：单测。
5. [x] `web/src/state.ts`：把 §1.2 的能力→依赖表实现为**一份纯函数**（`deriveCapabilities(project, doctor)` → 每个能力返回 `{enabled, reason, remedy}`），所有 UI 门禁只读这一份。→ 验证：纯函数单测覆盖依赖矩阵（这是本次最该有测试的地方）。
6. [x] `App.tsx` 重构为「欢迎页 / 工作台」两态 + 三段布局，替换四 tab。
7. [x] 素材段、成果段的组件与文案重做（§3.3–3.6）。
8. [x] 制作段以**禁用+说明**形态先落地（按钮存在、点了提示"下一批接通"或直接给出等效终端命令可复制）。
   → 验证：`tsc --noEmit` + `npm run build` + 浏览器实测全部空/满状态。

### 批 B：任务执行

9. [ ] `term.mjs` / `progress.mjs` 的 fd 3 NDJSON 出口（§2.2）。→ 验证：终端输出零变化 + NDJSON 事件单测。
10. [ ] token 注入与写请求校验（§2.4）。→ 验证：无 token / 错 token → 403 的测试。
11. [ ] `cli/web-api/jobs.mjs`：起/查/取消，argv 组装复用 `menu.mjs` 的 `buildArgvFromChoices` 思路。→ 验证：argv 组装单测 + 越权 folder 用例。
12. [ ] 制作段接通：渲染/still 参数表单（EXIF / 签名 / 黑底 / 画幅 / 滤镜 / trim）+ 实时进度 + 取消 + 完成后自动刷新成果段。滤镜选择器直接复用 `renderer/src/filters.ts` 的 CSS 做实时预览（同源，所见即所得）。

### 批 C：素材补齐

13. [ ] `fetch` 的搜索/下载 API 化（§2.3）+ 前端选择界面。
14. [ ] 歌词本地识别（`lyrics` 命令）接入任务系统，含 whisper 首次下载模型的长进度提示。

---

## 五、风险与取舍

- **最大风险是范围**：本次等于给一个 CLI 工具加一层完整 GUI。分三批的意义是每批都能独立验收、独立回滚。
- **写操作的安全面**：`/media` 曾是唯一敏感面，批 B 后 `/api/jobs` 成为更敏感的面（能执行子进程）。token + 沙箱 + argv 白名单三层，且 argv **由服务端从结构化选项组装**，绝不接受前端直传字符串数组。
- **`term.mjs` 改动的回归风险**：它是全部 CLI 输出的出口，fd 3 方案的好处正是"不开启时代码路径不变"。
- **滤镜实时预览的一致性**：web 用 CSS 预览、renderer 用同一套 CSS，理论一致；但 SVG filter 在浏览器与 Chromium headless 的细微差异（阶段一已记录的风险）依然存在，预览需标注"以成片为准"。
- **不做**：多素材夹并行任务队列（本地单人工具，一次一个任务足够）、任务历史持久化（进程内即可）、移动端适配（本地工具，桌面优先，但布局用响应式栅格不至于崩）。

---

## 库 vs 造轮子的评估（2026-07-25，动工前）

维护状态均为动工当天 `npm view` 实查，非记忆。

| 需求 | 决定 | 理由 |
| --- | --- | --- |
| 图片查看器 | 用库 `yet-another-react-lightbox` 3.32.1（MIT，2 周前更新） | 焦点陷阱、键盘、触摸手势、缩放、ARIA 自己写必然做不全；`render.slideFooter` 插槽正好塞 EXIF 展签 |
| — | **否决** `photoswipe` | 最后更新 2024-05，两年未动 |
| 图标 | 用库 `lucide-react` 1.26.0（ISC，2 天前更新） | 细线单色正是设计目标，按需 tree-shake |
| 动画 | **手写 CSS** | 只动 opacity/transform，`motion` 要 ~40KB 换零收益，与「UI 简洁」相悖 |
| 歌词滚动补间 | **手写 rAF ~30 行** | 核心诉求是「可被用户打断」，没有库提供这个 |
| 音频波形 | **不做** | wavesurfer 要解码整份音频，慢且是视觉噪声 |
| 缩略图缩放 | **用已有的 ffmpeg**，否决 `sharp` | 见下方步骤 A8：ffmpeg 已是硬依赖，用它等于零新增依赖 |
| 单测运行器 | **`node --experimental-strip-types --test`**，否决 vitest | renderer 已有同款约定，零新增 devDep |
| 路由 / 状态管理 | **不引入** | 页面少，锚点 + useState 足够 |

净增两个运行时依赖，构建产物 207KB（gzip 69KB）。

## 实施记录（批 A，2026-07-25）

### 后端

- **A1 `cli/doctor.mjs` 拆分**：新增 `collectDoctorChecks()` 返回结构化数组（每项带 `id`/`ok`/`line`/`fix`/`optional`），`runDoctor` 只剩打印。原先 `reportYtDlp`/`reportAnalyzerEnv` 直接 `term.*` 打印，改写成同样返回结构的 `ytDlpCheck`/`analyzerEnvCheck`，由 `runDoctor` 统一按 `optional` 区别对待（可选项失败走 `term.info` 而非 `term.error`，且不计入退出码）。
  - 新增 `cli/doctor.test.mjs` 盯住"打印行为不因拆分而改变"：monkey-patch `process.stdout/stderr.write` 捕获行序，断言每项恰好一条 `● ` 行且顺序与 `collectDoctorChecks` 一致、失败项后紧跟 `└ ` 提示行、退出码只由必需项决定。这是本次唯一有回归风险的改动，所以补了测试。
- **A2 `/api/doctor`**（`cli/web-api/doctor.mjs`）：`fix` 显式回 `null` 而非 `undefined`——`JSON.stringify` 会整个丢掉 `undefined` 键，前端就分不清"没有安装提示"和"字段拼错了"。
- **A3 `/api/exif`**（`cli/web-api/exif.mjs`）：复用 `extractFormattedExif`，与成片上印的是同一份格式化结果。限定图片扩展名（不让 exifr 被指向任意文件）；照片没有 EXIF 回 200 + `exif: null` 而非报错（截图、导出图没有 EXIF 是常态）。它是第一个异步 handler，`web-server.mjs` 里用 `.catch()` 兜住，否则未捕获的 rejection 会带走整个 server。
- **A4 `/api/project` 扩展**：新增 `name`、`audioCount`、`lyricsCount`、`lyricsSource`、`recognizedLyricsPath`、`timelinePath`。
  - **计划外但必要的修正**：`deriveCapabilities` 原本允许"识别过歌词"解锁跟播，但后端只解析 `.lrc`——能力开了却没内容可显示。改为后端在无 `.lrc` 时读 `output/metadata/lyrics.json` 的 `segments` 并归一成同一个 `{time, text}[]`，前端不必关心来源差异；`lyricsSource` 告诉 UI 该不该提示"歌词由本地识别，可能有出入"。
- **A8（计划外，实测发现）`/api/thumb`**：见下方"实测发现的问题"。

### 前端

- **A5 `web/src/capabilities.ts`**：§1.2 的表实现为纯函数，8 个能力 × `{enabled, blockers[]}`。三个设计决定：
  1. **返回全部 blocker 而不是第一个**——只报第一个会让用户来回补两次（补完歌才发现还缺 ffmpeg）。
  2. **doctor 为 `null`（还在加载）时挂起依赖类判断**，而不是判成"全部不可用"——那只是还没查完。
  3. **每条 blocker 都必须带 remedy**，有一条单测专门守这个不变量。
  - `capabilities.test.ts` 16 个用例覆盖依赖矩阵：空文件夹只剩 `fetchAudio`、有照片无音频则 still 可用而 render 不可用、缺 ffmpeg 挡渲染但不挡 still、缺 renderer 两者都挡、缺 uv 不影响播放、纯音乐（识别结果为空）仍挡跟播等。
- **A6 Logo**：三枚照片方框对角线缀连、前者遮后者，`stroke=currentColor` + `fill=var(--color-background)` 自动适配深浅色。**刻意不画"穿针引线"的线条**：24px 下方框加细线必然糊成一团，叠压关系本身已表达"缀连"。favicon 用同一份图形，但颜色写死（浏览器不给 favicon 主题上下文）。
- **A7 布局重构**：`App.tsx` 从四 tab 改成两态——未选素材夹时是全屏欢迎页且**根本没有导航栏**（不是"导航栏灰掉"）；选定后 `Workbench.tsx` 顶栏 + 素材/制作/成果三段。默认落在哪一段由状态决定（有成果直接看成果），少一次点击。
- **组件**：`Materials`（缺件时卡片变行动卡）、`Make`（本批只做门禁 + 可复制的等效命令，不画点了没反应的按钮）、`Results`（持有唯一的 `<audio>`）、`ui.tsx`（`Blocked`/`Section`/`CommandHint`）、`DoctorPanel`。
- **播放状态上提**：阶段四曾让 Player 与 Lyrics 各持一个 `<audio>`，切视图进度归零。三段式布局下两者同屏，两个音源会叠着响，所以抽出 `useAudioPlayer` 由 Results 统一持有。视频仍用原生 `<video controls>`（整帧媒体的原生控件是用户预期，自带全屏/画中画/键盘/读屏，重写要补的窟窿远多于收益），只有音频自建控制条。
- **删除 `web/src/Lightbox.tsx`**：被库取代，是本次改动造成的孤儿，按"清理自己制造的垃圾"原则删掉。

### 实测发现并修复的问题（浏览器实跑 demo 素材夹）

1. **【重】缩略图在下载完整原图**。44px 的素材缩略图和 150px 的照片墙格子直接引用原图，一张相机 JPEG 331KB–3.4MB，19 张就是几十 MB，页面上是一片迟迟不出来的白框——看着就像坏了。这是本次"展示素材照片"（旧版只显示 stills，且只有 5 张）新暴露的问题。
   - 修复：新增 `/api/thumb?path=&w=`，**用 ffmpeg 而不是 sharp**——ffmpeg 已是 tsuzuri 的硬依赖（doctor 会检查、渲染必用），拿它缩图零新增依赖；sharp 要引入原生模块，为缩略图不值当。代价是每张 spawn 一次进程（~50ms），所以结果落盘缓存只付一次。
   - 缓存写**系统临时目录**而不是用户素材夹——用户没要求我们往他的文件夹里放东西。缓存键含 `mtime` + `size` + 宽度，原图被换掉自动失效；宽度收敛到 `[128,256,400,640,1024]` 五档，避免每个像素宽度生成一份。
   - 先写临时文件再 `rename`，并发请求同一张图不会读到写了一半的文件。ffmpeg 缺失或解码失败时**退回原图**——慢，但页面不开天窗。
   - 实测：331,879 → 4,593 字节（400px，小 72 倍），128px 档 1,151 字节（小 288 倍）；冷缓存 56ms、热缓存 3.6ms。
   - `thumb.test.mjs` 9 个用例，含全套沙箱穿越（`..`／绝对路径／根内软链指向根外）、目录与非图片文件、宽度归一、缓存键失效条件、解码失败回退原图。
2. **【中】`--color-secondary-text` 对比度只有约 2:1**。直接搬 `theme.ts` 的 `#B0AEA6`，正文在屏幕上读不清。那个值是给**成片**用的——压在照片上的小字展签，浅才不抢画面；网页正文是另一种媒介，取值就该不同。改为 `#6F6A60`（约 4.7:1，WCAG AA），另留 `--color-faint-text` 给真正不承载信息的文字。**这是对 theme.ts 的刻意偏离，已在 CSS 注释里写明原因。**
3. **【中】未播放时全部歌词淡到 opacity 0.2**。距离衰减在 `activeIndex < 0`（前奏段或还没播）时把每一行都算成"最远"，整段看着像坏了。新增 `idle` 档（0.7），整段以可读浓度静静待着。

### 验证

- `cd cli && node --test`：**228/229 通过**。唯一失败项 `picks the next free port when the first one is occupied` 是**环境冲突，非本次改动导致**——用户机器上另有一个 `tsuzuri web` 进程（PID 15191）占着 3000，该测试要自己 `listen(3000)` 做占位才能断言回退到 3001，端口被别人占着就直接 EADDRINUSE。这是该测试既有的环境脆弱性（硬编码 3000），值得后续改成先探测一个空闲端口再占位。
- `cd web && npx tsc --noEmit` 干净；`npm run build` 成功；`npm test` 16/16。
- 起真实 server 实测：`/api/doctor` 六项全绿、`/api/exif` 返回真实拍摄参数（FUJIFILM X-T1 / XC15-45mm / 45mm·f/20·1/52s·ISO 200）、`/api/thumb` 体积与耗时如上、三个新端点的穿越用例均 403。
- 浏览器实测完整流程：欢迎页无导航栏 → 选中 demo → 三段可切 → 素材段 12 张缩略图秒出 → 制作段两张卡均"可开工"且命令可复制 → 成果段成片被挡且给出"去制作"按钮 → 照片墙 19 张 → Lightbox 显示 `2 / 19`、翻页/缩放/关闭齐全、底部 EXIF 展签正确 → 点击歌词第 6 行跳到 0:52，该行高亮放大、相邻行按距离衰减、列表自动补间滚动居中。
- **本环境无法验证**：音频/视频的实际播放（该自动化浏览器媒体解码整体不可用，时长恒显示 `0:00`，与阶段四记录的限制相同）。歌词的 seek + 高亮 + 滚动路径不依赖解码，已独立验证通过；播放本身需要在常规 Chrome 里最终确认。

### 遗留与下一批

- 批 B（任务执行）与批 C（fetch / 歌词识别）未动，`Make` 区段目前只给等效命令。
- `web.test.mjs` 的端口测试硬编码 3000，建议改为先探测空闲端口。
- `/api/thumb` 的缓存目录不做上限清理，靠系统临时目录的回收；素材夹极大时可能堆积，需要时再加 LRU。
