# kiseki macOS 桌面端实施计划

日期：2026-08-12

状态：待实施

目标平台：Apple Silicon macOS

桌面技术栈：Electron + Electron Forge + 现有 React/Node/Python/Remotion

## 1. 决策摘要

kiseki 继续使用当前 GitHub 仓库，不创建新的空仓库，也不嵌套第二个 Git 仓库。桌面端作为新的 `desktop/` 顶层模块加入现有项目，CLI、本地浏览器工作台和 macOS App 共享同一套分析、任务与渲染能力。

首版采用 Electron，不使用 Rust + GPUI，不重写 React UI，不重写 Python Analyzer 或 Remotion Renderer。实施过程中先建立必要的运行时接缝，再加入 Electron 壳；不为了未来可能拆分而提前进行大规模目录迁移。

最终保留三个入口：

```text
CLI
  └── cli → analyzer → renderer

Browser Web
  └── browser → local HTTP service → cli → analyzer → renderer

Desktop
  └── Electron window → same local service → cli → analyzer → renderer
```

产品入口优先级：

1. Desktop：面向普通用户的主要入口。
2. CLI：自动化、高级使用和底层诊断入口。
3. Browser Web：开发、兼容与无桌面安装时的备用入口。

## 2. 当前代码事实

当前项目由四个主要运行层组成：

- `web/`：React + TypeScript 本地工作台，通过同源 `/api`、`/media` 和 SSE 调用服务。
- `cli/`：命令解析、项目扫描、HTTP 服务、任务管理、lease、原子输出、外部进程与退出清理。
- `analyzer/`：Python 3.11–3.12，依赖 librosa、NumPy、faster-whisper，并在 Apple Silicon 上使用 MLX Whisper。
- `renderer/`：Remotion + React，运行时打包 composition，并通过 Headless Chromium 输出视频或静态图。

当前桌面化必须保护的既有边界：

- HTTP 服务只监听 `127.0.0.1`，校验 Host，并为写入或进程端点使用随机 token。
- 所有项目路径必须受启动 root、canonical identity、软链接与冲突检查限制。
- 同一时间只运行一个 Web job；跨进程使用 durable lease 防止重叠写入。
- 产物先写入任务私有 partial，再原子提交到最终路径。
- 取消和退出必须终止完整进程树，无法证明所有权或进程死亡时 fail-closed。
- 页面刷新只重新观察同一服务进程中的任务，不承诺跨进程恢复。

当前打包阻碍：

- 多处通过源码文件位置推导仓库根、Analyzer、Renderer 和 Web dist。
- Web job 通过 `process.execPath` 再启动 CLI；在 Electron 内它将指向 Electron 可执行文件。
- `uv`、`ffmpeg`、`ffprobe`、`yt-dlp` 和 `curl` 主要从系统 PATH 查找。
- Renderer 运行时需要真实文件路径、`node_modules`、字体资源和可执行 Chromium，不能简单全部塞入只读 ASAR。
- Python Analyzer 包含本地动态库、模型下载和平台特定依赖，最终打包方案需要实测后决定。

## 3. 目标目录结构

第一轮只新增 `desktop/`，不立即迁移现有模块：

```text
kiseki/
├── analyzer/
├── cli/
├── renderer/
├── web/
├── desktop/
│   ├── package.json
│   ├── forge.config.mjs
│   ├── src/
│   │   ├── main.mjs
│   │   ├── preload.mjs
│   │   └── runtime.mjs
│   ├── scripts/
│   ├── test/
│   └── docs/
├── docs/
└── examples/
```

边界稳定以后，才评估是否增加：

```text
contracts/    跨 CLI、Service、Web、Desktop 的稳定数据契约
core/         与平台、HTTP、Electron 和外部进程无关的纯 Node 业务逻辑
```

这两个目录不是首轮前置条件。

## 4. 解耦原则

### 4.1 单向依赖

```text
Desktop ─────┐
             ├── Service/CLI ── Analyzer Adapter
Browser Web ─┤                ├─ Renderer Adapter
             │                └─ External Tool Adapter
CLI ─────────┘
```

必须满足：

- `desktop/` 可以依赖现有 Service、CLI 和 Web。
- `web/` 不得 import Electron。
- `cli/` 不得直接 import Electron，也不得判断 `app.isPackaged`。
- Electron import 只能存在于 `desktop/`。
- Desktop 不实现项目扫描、任务锁、素材修改、时间线规划或渲染业务。
- 删除 `desktop/` 后，CLI 和 Browser Web 仍可独立构建、测试和运行。

### 4.2 先造接缝，再移动模块

实施顺序是：

1. 在现有模块中加入可注入的 runtime、command 和 lifecycle 边界。
2. 用测试固定普通 Node/CLI 的原行为。
3. Electron 通过这些边界接入。
4. 边界在真实桌面运行中稳定后，再移动纯逻辑或建立独立 package。

不得先把 `cli/` 大规模拆成多个目录，再尝试让桌面端运行。

## 5. 首版范围

### 5.1 首版包含

- Apple Silicon arm64 macOS。
- Electron 窗口承载现有 React 工作台。
- 原生选择项目文件夹。
- 素材浏览、改名、删除和撤销。
- 视频制作与静态图导出。
- 歌词读取、本地识别和在线歌词。
- 任务进度、取消、退出清理和错误恢复。
- macOS 菜单、快捷键、最近项目和 Dock 进度。
- unsigned `.app` 与本地测试用归档。

### 5.2 首版不包含

- Mac App Store。
- iOS/iPadOS。
- Intel x64 或 Universal Build。
- 自动更新。
- 云端渲染、账号、数据库或远程项目同步。
- Rust 或 GPUI 重写。
- 中断后的跨进程任务恢复。
- 在第一轮强制内置 yt-dlp。

## 6. Step-by-step 实施计划

### Step 0：建立实施分支与可复现基线

### 目标

在写桌面代码之前固定仓库、测试、真实媒体和运行环境基线，避免把现有环境问题误判为桌面化回归。

### 工作

1. 从最新 `main` 创建 `codex/macos-desktop` 分支。
2. 确认工作树干净、`main` 与 `origin/main` 同步。
3. 安装当前各模块锁文件指定的依赖，不升级依赖版本。
4. 运行现有自动化：

   ```bash
   npm --prefix cli test
   cd analyzer && uv run pytest
   npm --prefix renderer test
   npm --prefix renderer run typecheck
   npm --prefix web test
   npm --prefix web run typecheck
   npm --prefix web run build
   ```

5. 用 `examples/fixture` 验证：
   - 打开 Browser Web；
   - 扫描项目；
   - 导出一张 still；
   - 输出一段代表性视频；
   - 取消一次渲染；
   - 退出服务后确认没有遗留 Node/Chromium/FFmpeg 进程。
6. 记录 Node、uv、Python、FFmpeg、macOS、CPU 架构、测试数量、渲染时间和输出摘要。

### 验收门

- 所有现有自动化检查通过。
- fixture 的 Browser Web 工作流可完成。
- 基线失败已归因，未通过修改桌面代码掩盖。

### Step 1：抽象运行时布局

### 目标

让核心代码不再假定自己运行在源码仓库中，为开发目录和打包资源提供同一接口。

### 设计

建立普通 JavaScript runtime layout，不包含 Electron 类型：

```text
RuntimeLayout
├── cliEntry
├── webDist
├── analyzerRoot
├── rendererRoot
├── ffmpeg
├── ffprobe
├── ytDlp
├── curl
├── cacheRoot
├── modelRoot
└── tempRoot
```

CLI 默认 resolver 继续从源码位置和 PATH 推导；Desktop resolver 从打包资源和 Application Support/Cache 推导。

### 工作

1. 在 CLI 层建立 runtime layout resolver。
2. 将以下硬编码位置改为从 layout 读取：
   - Web 静态目录；
   - Analyzer 项目目录；
   - Renderer 项目和依赖目录；
   - CLI 子入口；
   - FFmpeg、ffprobe、yt-dlp、curl 命令。
3. 开发模式保持所有现有默认行为和报错文案。
4. 为源码模式、显式覆盖、缺失命令和含空格路径增加测试。
5. 不在这一阶段搬动 `cli/`、`analyzer/` 或 `renderer/`。

### 重点影响区

- `cli/kiseki.mjs`
- `cli/lyrics.mjs`
- `cli/still.mjs`
- `cli/render.mjs`
- `cli/bundle.mjs`
- `cli/doctor.mjs`
- `cli/fetch.mjs`
- `cli/ytdlp.mjs`
- `cli/web-server.mjs`

### 验收门

- 原 CLI 和 Browser Web 的自动化全部保持通过。
- 从非仓库工作目录执行 CLI 仍成功。
- 测试可注入临时 RuntimeLayout，不访问开发机真实 PATH。

### Step 2：抽象任务执行命令

### 目标

消除“`process.execPath` 一定是 Node”的假设，同时保持现有 lease、fd 3 进度、detached 子树和取消协议。

### 设计

任务管理器继续负责 spawn、进度、进程身份和回收，只把命令解析交给 executor/command resolver：

```text
CommandSpec
├── executable
├── args
├── env
├── stdio
└── displayName
```

普通 Node 模式：

```text
node cli/kiseki.mjs ...
```

Electron packaged 模式：

```text
ELECTRON_RUN_AS_NODE=1 Kiseki.app/Contents/MacOS/Kiseki cli/kiseki.mjs ...
```

### 工作

1. 让 `buildJobSpec` 接收 CLI command resolver。
2. 将 CLI 子进程、Analyzer、Renderer 和在线下载的命令构造集中到可测试边界。
3. 保留现有结构化 argv 白名单，不引入 shell command string。
4. 保留 fd 3 NDJSON 进度和 yt-dlp stdout 进度协议。
5. 增加 Node executor 与 Electron run-as-node executor 的契约测试。
6. 明确保留 Electron `runAsNode` fuse；若未来禁用该 fuse，必须先迁移到经过验证的独立 Node runner。

### 验收门

- 普通 CLI 与 Web job 的 argv、env、输出 claim 不变。
- Electron executor 的命令可在开发 Electron 中执行一个只读 CLI smoke。
- 任务取消仍能证明并回收完整子进程树。

### Step 3：抽象服务启动与根目录控制

### 目标

让 Browser Web 和 Desktop 共享同一个服务实现，同时保持不同的项目授权方式。

### 设计

```text
createKisekiService({
  rootController,
  runtime,
  executor,
  openBrowser,
})
```

Browser Web：

- 使用不可变 root controller。
- 继续以传入 folder 或用户 Home 为根。
- 继续尝试打开系统浏览器。

Desktop：

- 使用由 Electron main 持有的受控 root controller。
- 只有原生目录选择成功、canonical 校验完成、当前无写任务时才能切换 root。
- Renderer 不能直接提交任意路径扩大 root。
- 不打开外部浏览器。

### 工作

1. 将端口监听、服务创建、shutdown 和浏览器打开拆成可组合函数。
2. 服务 API 从 root controller 读取当前授权根，而不是由 Renderer 提交权限。
3. root 切换前检查当前 job 和资源写锁。
4. root 切换后清除旧项目 UI 状态和只属于旧 root 的临时授权。
5. Browser Web 的现有 root 行为必须保持不变。
6. 增加 Home 内、Home 外、外置磁盘、软链接和任务中切换的测试。

### 验收门

- Browser Web 行为无回归。
- Desktop 可以安全授权 Home 外项目。
- HTTP 请求无法自行切换到未授权路径。
- 任务运行中无法切换项目根。

### Step 4：建立最小 Electron 开发壳

### 目标

先让现有工作台在 Electron 开发窗口中完整运行，不处理最终自包含依赖。

### 工作

1. 创建 `desktop/package.json` 和 Electron Forge 配置。
2. 创建 Electron main process：
   - 单实例锁；
   - 启动 Kiseki Service；
   - 创建 BrowserWindow；
   - macOS activate/window-all-closed 生命周期；
   - App 退出时等待 `killAll` 和 server close。
3. 创建最小 preload：
   - `contextIsolation: true`；
   - `nodeIntegration: false`；
   - 只暴露经过命名和参数校验的窄 API；
   - 不暴露 `ipcRenderer` 原对象、文件系统或任意命令执行。
4. 开发窗口加载本地 Kiseki Service URL，而不是远程站点。
5. 保持现有 token、Host 和同源 API 机制。
6. 增加 main/preload 单元测试和启动 smoke。

### 验收门

- Electron 窗口加载完整工作台。
- 可以打开 fixture、浏览素材和查看成果。
- still 导出成功。
- 视频 job 能启动、显示进度和取消。
- 退出 App 后没有遗留服务和渲染进程。

### Step 5：接入 macOS 原生项目入口

### 目标

用原生文件夹授权代替 Desktop 中的网页目录浏览，同时保留 Browser Web 原选择器。

### 工作

1. preload 暴露 `openProject`，Electron main 调用原生目录选择器。
2. canonical 化选中路径并交给 root controller。
3. Renderer 只接收选择结果，不获得直接文件系统能力。
4. Desktop 模式欢迎页显示原生“打开项目”入口。
5. Browser Web 模式继续使用现有 FolderPicker。
6. 实现拖入项目文件夹，但走与原生选择器相同的授权与校验路径。
7. 最近项目只保存成功打开过的 canonical path；不存在或无权限时从列表移除或显示可恢复错误。

### 验收门

- 原生选择、拖放和最近项目使用同一授权路径。
- Home 外和外置磁盘项目可使用。
- Browser Web 无 Electron API 时仍正常工作。
- Renderer 无法用伪造 IPC 打开任意文件或启动任意命令。

### Step 6：macOS 生命周期与原生体验

### 目标

让 Desktop 具备符合 macOS 习惯的窗口、菜单、任务和反馈，而不是只把网页放进窗口。

### 工作

1. 菜单：
   - 打开项目；
   - 最近项目；
   - 切换项目；
   - 显示输出目录；
   - 取消当前任务；
   - 重新检查环境；
   - 标准 Edit/View/Window 菜单。
2. 快捷键：
   - `Command+O` 打开项目；
   - `Command+,` 设置入口预留；
   - `Command+W` 关闭窗口；
   - 标准刷新和 DevTools 仅在开发模式开放。
3. 任务状态：
   - Dock 进度；
   - 渲染时退出提示；
   - 正常退出走受限 TERM → KILL → close/reap；
   - 系统睡眠和唤醒后重新确认任务状态。
4. UI：
   - 标题栏和 traffic lights 安全区域；
   - 窗口最小尺寸；
   - 深浅色；
   - 键盘焦点；
   - reduced-motion；
   - 拖放反馈。
5. 动画继续以 `opacity` 和 `transform` 为主；只有拖动、排序等直接操控使用可中断 spring。

### 验收门

- 所有主流程可用键盘完成。
- 渲染中关闭窗口、退出 App、休眠/唤醒不会遗留孤儿进程或错误解锁项目。
- reduced-motion 下无大幅位移，状态反馈仍可读。

### Step 7：生成可移动的开发安装包

### 目标

生成可以移出仓库运行的 arm64 unsigned `.app`，此时仍允许依赖开发机上的 uv/FFmpeg。

### 工作

1. 使用 Electron Forge package/make。
2. 设计资源布局：

   ```text
   Kiseki.app/Contents/Resources/
   ├── app.asar
   └── kiseki-runtime/
       ├── cli/
       ├── web/dist/
       ├── renderer/
       └── licenses/
   ```

3. 将需要真实路径、运行时读取或执行的内容放到 ASAR 外。
4. 构建前创建 staging runtime，禁止打包脚本直接修改源码目录。
5. 打包完成后将 `.app` 移动到另一个目录进行 smoke。
6. 检查应用资源内没有用户素材、缓存、模型、密钥或绝对开发机路径。

### 验收门

- `.app` 离开仓库仍能启动。
- UI、Service、CLI 和 Renderer 资源均从 packaged layout 解析。
- 使用开发机外部 uv/FFmpeg 时可完成 fixture 视频导出。

### Step 8：内置 FFmpeg 与媒体工具

### 目标

移除普通用户对系统 FFmpeg/ffprobe 的依赖。

### 工作

1. 选择固定、可再现的 arm64 FFmpeg/ffprobe 构建。
2. 审核 LGPL/GPL、codec 和再分发要求。
3. 将二进制放入 `kiseki-runtime/bin/`。
4. RuntimeLayout 始终使用绝对路径。
5. Analyzer 的 FFmpeg fallback 同样使用内置路径或受控 PATH。
6. 增加版本探测、执行权限、空格路径和损坏二进制测试。
7. 生成第三方许可证与版本清单。

### 验收门

- 临时移除系统 FFmpeg/ffprobe 后，doctor、音频读取、still 和视频导出仍正常。
- 内置二进制版本可从诊断界面读取。

### Step 9：确定并实现 Python Analyzer 打包方案

### 目标

在实测基础上选定 Analyzer 的自包含方式，而不是预先押注某个打包器。

### Spike 候选

1. PyInstaller one-folder。
2. 内置 Python runtime + 固定虚拟环境。
3. 内置 uv + 离线 wheelhouse，由首次启动在 Application Support 建立环境。

### 对比指标

- arm64 构建成功率。
- librosa、soundfile、faster-whisper、MLX Whisper 可用性。
- 冷启动和首次分析时间。
- App 与运行时体积。
- dylib 数量和签名难度。
- 模型下载、升级与清理能力。
- 崩溃日志和错误诊断质量。
- 离线首次运行能力。

### 工作

1. 为三个候选建立最小 analyzer/fingerprint/plan smoke。
2. 使用同一 fixture 测量。
3. 记录失败和签名风险。
4. 选定一个方案并实现 RuntimeLayout adapter。
5. 模型放在 Application Support 或 Cache，不写入 `.app`。
6. 失败或取消时不留下可被误判为完成环境的 partial runtime。

### 验收门

- 在没有系统 Python 和 uv 的干净用户环境中可运行 fingerprint、analyze 和 plan。
- 有 LRC、无 LRC、MLX 与 CPU fallback 路径均有验证。
- 安装包移动或升级后不破坏已有模型与缓存。

### Step 10：固化 Remotion 与 Chromium 运行时

### 目标

让视频和 still 渲染不依赖仓库 `renderer/node_modules` 或用户浏览器。

### 工作

1. 将 Renderer runtime、依赖、字体和模板资源纳入 staging。
2. 明确 Headless Chromium 的来源、版本、缓存和下载策略。
3. bundle 输出、Remotion cache 和临时目录写入用户 Cache/任务 temp root。
4. App 资源保持只读，任何运行时写入不得落在 `.app`。
5. 保持 Renderer 与 Electron UI Chromium 为两个明确用途的运行时，不假设 Electron BrowserWindow 可代替 Remotion Headless Chromium。
6. 验证应用路径包含空格、中文和移动后的场景。
7. 验证并发档位、批量 still 共用浏览器和取消清理。

### 验收门

- 删除仓库 `renderer/node_modules` 后，packaged App 仍能渲染。
- 没有系统 Chrome 时仍可渲染。
- 视频、still、模板、字体、滤镜与 EXIF 输出与基线一致。
- 取消和退出后无遗留 Chromium 进程。

### Step 11：处理可选在线音频功能

### 目标

不让 yt-dlp 阻塞核心 Desktop 发布，同时为完整功能保留明确路径。

### 第一版策略

- 在线歌词继续使用受控网络请求。
- yt-dlp 保持可选，Doctor 明确说明未安装时只有在线音频获取不可用。
- 用户手动放入音频不受影响。

### 后续评估

1. 是否允许用户选择系统 yt-dlp。
2. 是否内置固定版本。
3. 如何更新 provider 兼容性频繁变化的 yt-dlp。
4. 二进制、Python runtime、FFmpeg 和 provider 使用的许可与产品风险。

### 验收门

- 未安装 yt-dlp 时，其余功能完全可用。
- 安装或内置 yt-dlp 时，搜索、下载、进度、取消和原子安装保持现有契约。

### Step 12：完整 Desktop QA

### 自动化矩阵

- CLI：全量测试。
- Analyzer：pytest、fingerprint、fixture analyze/plan。
- Renderer：测试、typecheck、still/video smoke。
- Web：测试、typecheck、production build。
- Desktop：main/preload/runtime/root controller 测试。
- Packaging：package、make、移动后启动 smoke。
- 静态检查：`git diff --check`，检查构建产物未进入 Git。

### 真实场景矩阵

- Home 内项目。
- Home 外项目。
- 外置磁盘项目。
- 路径含中文、空格和较长文件名。
- 只有照片。
- 照片 + 音频。
- 有 LRC。
- 无 LRC、首次 Whisper 模型下载。
- 多音频、多歌词歧义。
- still 单张、批量和多倍率。
- landscape、portrait、square 视频。
- 渲染取消。
- 渲染中关闭窗口。
- 渲染中退出 App。
- App 强制结束后的下次启动 lease 清理。
- 睡眠和唤醒。
- 无网络。
- 无系统 Node、Python、uv、FFmpeg、Chrome。

### 视觉矩阵

- 最小窗口、常用窗口和全屏。
- 浅色、深色。
- 键盘导航和焦点。
- reduced-motion。
- 拖放、进度、错误、完成和取消反馈。
- 成片与基线逐帧或代表帧对照。

### 验收门

- 干净 Apple Silicon Mac 可独立完成 fixture 工作流。
- CLI 和 Browser Web 未回归。
- 所有已知限制在 App 和文档中可见。

### Step 13：unsigned 发布与未来签名

### 无开发者会员阶段

1. 生成 arm64 unsigned `.app`。
2. 生成供自己测试的 zip 或 DMG。
3. 不启用自动更新。
4. 文档明确说明 Gatekeeper 限制，仅用于本机或受控测试。

### 获得 Apple Developer Program 后

1. 配置 Developer ID Application。
2. 启用 Hardened Runtime。
3. 签名 Electron app、helpers、FFmpeg、Python、dylib 和所有嵌套可执行资源。
4. 使用 `notarytool` notarize 并 staple。
5. 在无开发证书的干净 Mac 验证 Gatekeeper。
6. 生成正式 DMG 和 GitHub Release。
7. 签名与公证稳定后再设计自动更新。

Mac App Store 不作为当前路线；其 App Sandbox 与外部工具、动态运行时、文件夹工作流存在额外约束，必须另行立项。

## 7. 每轮实施纪律

每个 Step 都遵循：

1. 固定本轮允许修改的文件和行为。
2. 先补窄测试或记录可复现基线。
3. 实施最小改动。
4. 自审本轮 diff 并修复发现项。
5. 重跑受影响测试。
6. 涉及进程、资源写入、打包或签名时增加独立 QA。
7. 当前 Step 验收未通过，不进入依赖它的下一 Step。

任何实现改动都不得：

- 放宽 canonical path、token、Host、lease、atomic output 或 fail-closed 边界。
- 将任意命令执行能力暴露给 Electron Renderer。
- 将用户项目、模型、缓存或运行时 partial 写进 `.app`。
- 修改或删除用户既有素材和未相关的工作树改动。
- 因 Desktop 需要而破坏 CLI 或 Browser Web 的独立运行能力。

## 8. 主要风险与控制

| 风险 | 控制 |
| --- | --- |
| Electron `process.execPath` 不再是 Node | Command resolver + `ELECTRON_RUN_AS_NODE` 契约测试 |
| Renderer/Chromium 无法在 ASAR 中执行 | 独立 runtime staging，真实文件放 ASAR 外 |
| Python/MLX/CTranslate2 打包失败或体积过大 | Step 9 独立 spike，以实测选择方案 |
| App 退出遗留 Chromium/FFmpeg | 复用现有身份、树快照、TERM/KILL、close/reap 协议 |
| 原生文件选择扩大服务端文件权限 | root controller 只由 Electron main 更新，Renderer 无授权能力 |
| 桌面逻辑侵入 Web/CLI | Electron import 只允许在 `desktop/`，Browser Web 回归门 |
| unsigned App 被 Gatekeeper 阻止 | 仅作为开发包；公开发布前签名和 notarize |
| 内置 FFmpeg/Python 许可遗漏 | 固定构建来源、版本清单、licenses staging 和发布审计 |
| yt-dlp 更新频繁拖累核心发布 | 首版保持可选，与核心导出能力解耦 |
| 为未来拆分过度重构 | 先注入边界，真实复用稳定后再移动目录 |

## 9. 后续拆分准备度

只有同时满足以下条件，才考虑将模块拆成独立 package 或 repo：

- RuntimeLayout、CommandSpec、Job、Project、Progress、Timeline 契约稳定。
- CLI、Browser Web、Desktop 各自有独立构建和消费测试。
- Analyzer 与 Renderer 可通过明确版本化接口调用，不依赖源码相对路径。
- Desktop 不读取未发布的 CLI 内部文件。
- 拆分主要是移动目录和调整发布，而不是重写调用关系。
- 独立团队、许可证、发布节奏或公开范围确实需要拆分。

在此之前，同一 repo 是默认且推荐的组织方式。

## 10. 完成定义

macOS Desktop v1 只有在以下条件全部满足时才算完成：

- CLI、Browser Web 和 Desktop 三个入口同时可用。
- Desktop 使用现有核心服务与任务安全边界，没有第二套业务实现。
- Apple Silicon 用户无需安装 Node、Python、uv、FFmpeg 或 Chrome，即可完成本地视频制作。
- 原生文件夹选择、菜单、快捷键、Dock 进度和退出清理可用。
- 项目路径、任务互斥、取消、原子输出和残留清理没有降级。
- 测试、类型检查、生产构建、packaged smoke 和真实 fixture QA 通过。
- unsigned 开发包限制有文档；正式公开发布前完成 Developer ID 签名与 notarization。

## 11. 官方参考

- Electron Forge：https://www.electronjs.org/docs/latest/tutorial/forge-overview
- Electron packaging：https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging
- Electron process model：https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron environment variables：https://www.electronjs.org/docs/latest/api/environment-variables/
- Electron code signing：https://www.electronjs.org/docs/latest/tutorial/code-signing
- Apple membership：https://developer.apple.com/support/compare-memberships/
- Apple notarization：https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
