# 开源门面与命令态生命周期

日期：2026-08-13

状态：第 1、2、4、5 步已实施。第 6 步成片素材仍等用户提供。

## 目标

把仓库收成「clone 下来能跑」的 CLI + Web 工作台，并让长任务在终端和网页里呈现为同一套生命周期：进行中（动画 + 状态 + 已用时）→ 结束（勾或叉 + 耗时 + 路径色）。

产品入口只承认 CLI 与 `kiseki web`。`desktop/` 保留代码，降为实验性，本轮不删、不扩展。

## 非目标

- 不上成片、不抽帧、不改 `examples/fixture`（等用户素材）。
- 不做全屏 TUI、主题市场、shimmer、语法高亮、alt-screen。
- 不改菜单键位、doctor 同步语义、lease / 原子输出 / 沙箱。
- 不拆 `cli/`、不上 monorepo、不把 ffmpeg/Python 改成项目级二进制。
- 不做字体子集、手机原图预缩放、预设。
- 不签名、不打包 Desktop。

## 现行事实

- 安装要分别 `npm --prefix` cli / renderer，web 还要再 build；`kiseki web` 在 `web/dist` 缺失时静默回退占位页（`cli/web-server.mjs` 的 `PLACEHOLDER_HTML`）。
- 无 CI。`docs/plans/` 是历史实施笔记，主阅读路径未标明。
- 终端：`term.start` / `term.success` 各印一行；长阶段走 `spawnSync`，进行中终端是死的。渲染已有 `\r` 进度条。
- 结构化进度：`KISEKI_JSON_PROGRESS=1` 时写 fd 3。事件为 `{kind, text}` 或 `{kind:'progress', label, percent}`。Web `JobPanel` 把 start/success 当成两行日志，没有已用时。
- README 已不提 Desktop；`desktop/` 仍在 `main`。

## 阶段依赖

```text
1 开源门面 ──┐
             ├── 2 CI（可与 1 并行）
4 CLI 命令态 ─┴── 5 Web JobPanel
6 成片上车（阻塞：用户素材）
```

1 与 4 文件几乎不重叠，可并行。5 必须等 4 的事件字段稳定。2 不依赖 4/5，但应在 1 的测试改完后跑绿。

---

## 第 1 步：开源门面

### 1.1 `scripts/setup.sh`

新建可执行脚本，仓库根相对路径解析，`set -euo pipefail`。

```bash
npm ci --prefix cli
npm ci --prefix renderer
npm ci --prefix web
uv sync --project analyzer --group dev
npm --prefix web run build
```

前置：找不到 `node` 或 `uv` 时以非零退出，并各打一行中文说明（Node 18+、https://docs.astral.sh/uv/）。结束时提示 `node cli/kiseki.mjs doctor`。不要装 yt-dlp、不要碰 `desktop/`。

### 1.2 `kiseki web` 缺 dist 时失败

在 `cli/web.mjs` 的 `runWeb` 里、起服务之前检查 `runtime.webDist` 下存在文件 `index.html`。否则抛 `CliError`，文案包含：

```text
前端尚未构建。先执行: ./scripts/setup.sh
或: npm --prefix web install && npm --prefix web run build
```

`cli/web-server.mjs` 保留 `PLACEHOLDER_HTML` 作为防御，但 `runWeb` 正常路径不得再依赖占位页当成功。

`cli/web.test.mjs`：

- 现有「starts a server…」改为注入 `runtime`，`webDist` 指向临时目录（内含最小 `index.html`，标题或正文含 `軌跡｜kiseki` 或 `kiseki 本地工作台`）。
- 新增用例：`webDist` 指向空目录时 `runWeb` 拒绝并匹配 `setup.sh`。

### 1.3 文档收口

`README.md` / `README.en.md`：

- 快速开始改为：系统依赖（Node 18+、uv、FFmpeg）+ `./scripts/setup.sh` + `node cli/kiseki.mjs doctor`。
- 保留命令列表；`web` 段删掉「首次使用需手动 build」的散装步骤，改指向 setup。
- 不提 Desktop，不加「即将有成片」。
- 配置与文档链接下增加一句：`docs/plans/` 是历史实施笔记，现行说明以 config / timeline / status 为准。

新建 `docs/plans/README.md`：本目录是按日期归档的实施笔记，不代表现行产品；现行文档是 `docs/config.md`、`docs/specs/timeline-schema.md`、`docs/kiseki-status.md`。不要改 30 份旧计划正文。

`docs/kiseki-status.md`：

- 入口写明：主力是 CLI 与 `kiseki web`；`desktop/` 为实验性 macOS 壳，不承诺打包与跨平台。
- 「约束与待验证」补：缺 `web/dist` 时 `kiseki web` 直接失败；Linux / Windows 仍未验收。
- 不改本轮最终验证数字（那是当时基线）。

### 验证

- `bash -n scripts/setup.sh`
- `npm --prefix cli test`（至少 `web.test.mjs`）
- 目检 README 中英与 status / plans README

---

## 第 2 步：CI

新建 `.github/workflows/ci.yml`。

- 触发：`push`、`pull_request`
- 跑在 `macos-latest`
- Node 20、`astral-sh/setup-uv`
- `npm ci`：cli、renderer、web
- `uv sync --project analyzer --group dev`
- `npm --prefix cli test`
- `uv run --project analyzer pytest`
- `npm --prefix renderer test` 与 `typecheck`
- `npm --prefix web test`、`typecheck`、`build`
- 不安装 ffmpeg、不渲真片、不跑 desktop、不跑 `setup.sh`（workflow 自己装依赖）

### 验证

工作流 YAML 字段齐全；本地可先把上述命令跑一遍。合入后看 GitHub Actions。

---

## 第 4 步：CLI 命令态

学 Grok/Claude 的是工作单元生命周期，不是全屏 TUI。菜单、`help`、doctor、管道保持可脚本。

### 4.1 颜色与时长

`cli/term.mjs`：

- `COLORS` 增加 `path: '36'`（与 prompt 同槽，路径专色）。`paint('path', text)` 已有通用入口。
- 导出 `formatDuration(ms)`：`< 60s` 为一位小数秒（`4.2s`、`0.1s`）；`≥ 60s` 为 `m:ss`（`1:05`）。
- 导出 `SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']`。

### 4.2 `term.task(label)`

`createTerminal` 增加 `task(label)`，返回 `{succeed, fail}`。

进行中（TTY）：同一行 `\r\x1b[2K` 重写为 `spinner + 空格 + label + 空格 + dim(已用时)`，间隔 80ms，锈橙色 spinner（`COLORS.start`）。

进行中（非 TTY）：印一行 `● label`，不刷帧。

JSON（`KISEKI_JSON_PROGRESS=1`）：

- 开始：`{kind:'start', text:label, stage:label}`
- 成功：`{kind:'success', text, stage:label, durationMs}`
- 失败：`{kind:'error', text, stage:label, durationMs}`

`text` 默认等于 `label`。`succeed` / `fail` 可传入覆盖文案。结束时清 interval，TTY 把同一行改成：

- 成功：绿 `●` + 文案 + dim(`  ` + duration)
- 失败：红 `●` 写到 stderr，同样带 duration

保留圆点 `●` 作结束态，不换 ✓/✗，避免和现有 `term.success` 两套子弹。进行中才用 braille spinner。

`start` / `success` / `warn` / `error` / `detail` 行为字节级不变，给 doctor、菜单回显、一次性说明用。

任务进行中若再 `detail`/`info`：先 `endLine`（TTY 把当前任务行落到下一行），打印 detail，再恢复任务行。否则进度条和 `└` 会糊在一起。渲染阶段已有 `createPercentProgress`，task 行在进度条出现前 `succeed` 或先 `endLine`。

### 4.3 异步 spawn，spinner 才能转

`spawnSync` 会卡住事件循环。`cli/run-command.mjs`：

- `runCommand` / `runCommandSpec` 改为返回 `Promise<number>`，内部用 `spawn`（可注入）。
- 等 `close`，错误语义与现在相同（ENOENT → 中文、退出码透传、`STAGE_DETAILS`）。
- `stdio` 规则不变：`KISEKI_JSON_PROGRESS=1` 时为 `['inherit','inherit','inherit',3]`。
- 注入的 spawn 若同步返回 `{status}` / `{error}`，用 `Promise.resolve` 包一层，现有测试夹具不必改成真子进程。

调用方一律 `await`：

- `cli/kiseki.mjs` 的 `runResolvedCommand` 与三处 analyze / plan / render
- `cli/lyrics.mjs` 的识别
- `cli/still.mjs` 的导出包一层 task（still 内部已是 async Remotion，不经 `runCommand`）
- `cli/fetch.mjs` 的搜索、下载（已有 spawn 的保持异步，只包 task）

`runCommandImpl` 允许返回 number 或 Promise；调用处 `await Promise.resolve(...)`。

### 4.4 接上生命周期的阶段

| 阶段 | 任务 label（稳定，作 `stage`） | 成功文案 |
|---|---|---|
| 分析音频 | `分析音频` | 同 label |
| 规划时间线 | `规划照片时间线` | 同 label |
| 渲染视频 | `渲染视频`（flag 摘要可放 detail，不进 label） | 同 label |
| 识别歌词 | `识别歌词` | 同 label |
| 导出 still | `导出 still` | 同 label，张数放 detail |
| fetch 搜索/下载 | 现有 `搜索「…」` / `下载音频` / `搜索同步歌词…` | 同 label |

最终行保持 `term.success`，但路径用 `paint('path', outPath)`：

```text
● 完成 → trips/osaka/output/osaka.mp4    28.1s
```

总耗时：`runCommandFromArgv` 视频路径在认领 lease 后记 `t0`，成功那一行带 `formatDuration(Date.now()-t0)`。still / lyrics / fetch 若有单一成功出口，同样带总耗时。

跳过分析时不要起 task，继续 `term.detail('音频和歌词未变,跳过音频分析')`。

### 4.5 测试

`cli/term.test.mjs` 增补：

- 非 TTY：`task` → `succeed` 打出开始行和带 duration 的成功行
- TTY：`succeed` 后输出含 `\r` 与 `\x1b[2K`，结束行含 duration
- JSON：start 带 `stage`；success/error 带 `durationMs`（整数）
- `formatDuration(4200) === '4.2s'`，`formatDuration(65000) === '1:05'`
- `NO_COLOR` / `TERM=dumb` 无 ANSI
- 原有 `start`/`success` 字节断言不得改

`cli/run-command.test.mjs` 全部改 `async`，注入 spawn 仍返回 `{status}` / `{error}`。

`cli/lyrics.test.mjs` 等对 `runLyrics` 的同步调用改为 `await`（`runLyrics` 变为 async）。

断言「音频分析完成」的测试改为断言 stage label `分析音频`（若有）。

### 验证

`npm --prefix cli test`。抽一眼 TTY：`node cli/kiseki.mjs lyrics <fixture>` 或 doctor 不受影响。

---

## 第 5 步：Web JobPanel 对齐

依赖第 4 步事件。`useJob` 的 `JobEvent` 放宽为：

```ts
| {kind: 'start' | 'info' | 'success' | 'warn' | 'error' | 'detail'; text: string; stage?: string; durationMs?: number; path?: string}
| {kind: 'progress'; label: string; percent: number}
```

未知字段忽略。旧事件（无 `stage` / `durationMs`）仍能渲染。

`JobPanel.tsx`：

- 顶栏 running：`正在${verb}…` + 本地已用时（从进入 running 起每秒刷新，`m:ss`）。结束：`完成了。` / `失败了。` / `已取消。`，可附最后一次 success 的 `durationMs`。
- 阶段行：按 `stage ?? text` 折叠同一阶段的 start+success/error。进行中 spinner，结束勾/叉 + `formatDuration`。不要并排留「开始」「完成」两行。
- 无 `stage` 的 info/detail/warn 仍按时间追加。
- `text` 里 `→` 后面的路径，或事件 `path` 字段，用与 CLI 相同的青蓝色（`--job-path`）。
- 进度条、取消、note、reduced-motion 合同不变。

`web/src/JobPanel` 抽纯函数 `collapseJobEvents(events)`，在 `web/src/command.test.ts` 旁新增 `job-events.test.ts`（或现有测试文件）覆盖：start+success 合成一行、无 stage 不折叠、duration 格式。

不要改 Materials / Make 表单 / Results 播放器 / FolderPicker。

### 验证

`npm --prefix web test` 与 `typecheck`。有 dev server 时手点一次制作，看顶栏秒数与阶段行。

---

## 第 6 步：成片上车（阻塞）

用户稍后提供 18–24 张带 EXIF 的照片 + 一首 2:30–4:00 可公开的歌 + 可选 `.lrc`。到时另开一轮：本机渲染 `slow-cinema`、抽 8–12 秒循环预览、1–2 张 still，再改 README。本文件不实施。

---

## 分工

| 步 | 谁 | 文件 |
|---|---|---|
| 1 | fast-worker | `scripts/setup.sh`，`cli/web.mjs`，`cli/web.test.mjs`，`README.md`，`README.en.md`，`docs/plans/README.md`，`docs/kiseki-status.md` |
| 2 | fast-worker | `.github/workflows/ci.yml`（可与 1 同一工人） |
| 4 | general-purpose | `cli/term.mjs`，`cli/term.test.mjs`，`cli/run-command.mjs`，`cli/run-command.test.mjs`，`cli/kiseki.mjs`，`cli/lyrics.mjs`，`cli/lyrics.test.mjs`，`cli/still.mjs`，`cli/fetch.mjs`；断言受影响的其它 cli 测试 |
| 5 | fast-worker | `web/src/useJob.ts`，`web/src/JobPanel.tsx`，`web/src/App.css`，新测试文件；第 4 步完成且事件字段已落地之后 |
| 6 | 主会话 | 等素材 |

工人不得改 `desktop/`、不得改 `analyzer/` / `renderer/` 业务、不得提交、不得加与本步无关的重构。

实施时额外修了 `cli/web-api/sandbox.mjs`：授权根已经是 `realpath` 时，客户端若仍传 macOS 的 `/var` 词法路径，不再误判 403。否则第 2 步 CI 会红。

---

## 完成标准

- clone 后按 README 能 `setup` + `doctor`；未 build 时 `kiseki web` 失败并指出 setup。
- CI 在 macOS 上跑通测试与 web build。
- 长阶段在 TTY 下同一行从 spinner 变成带耗时的结束态；非 TTY 与 `NO_COLOR` 仍可脚本。
- Web 任务顶栏有已用时，阶段不重复 start/success。
- Desktop 无新承诺。成片未上之前 README 不假装有样片。
