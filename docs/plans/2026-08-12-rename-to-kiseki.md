# tsuzuri → kiseki 全量改名与换图标执行计划

日期：2026-08-12
状态：仓库内改名与品牌资产实施中；commit、push、远端仓库改名、本地目录改名与仓库外记忆迁移须分别授权

## Context

产品:照片 + 一首歌(可选歌词)→ 踩点影像日记,本地工作台。现名「tsuzuri(綴り)」含义贴切(把照片与歌词"缀"在一起),但读音拗口、汉字生僻。方向已定:**kiseki(軌跡)× 单线节拍轨迹图标**。用户选择**全量改名**(含技术契约),仓库目录名也改为 `kiseki`。

`kiseki` 单写可能被理解成「奇跡」,因此用户可见品牌第一次出现时使用 `kiseki（軌跡）` 或 `kiseki / 軌跡`;CLI、包名、路径和技术契约使用小写 `kiseki`。`Pulse` 只描述图标概念,不作为产品名或品牌后缀。

既有历史文档 `docs/plans/**`、`docs/decisions/**` **保持原样**(含 `2026-07-10-tsuzuri-implementation.md` 文件名);唯一例外是本执行计划本身。web/dist 是 gitignored 产物,由 build 重新生成,不手动改。

## 范围边界

- **改**:cli/、renderer/、web/、analyzer/、README×2、docs/config.md、docs/tsuzuri-status.md(含文件名)、docs/assets/architecture/(index.html + architecture.png + prompt.md)、包清单与锁文件(8 个)
- **不做品牌替换或提交**:除本计划外的 docs/plans/**、docs/decisions/**,以及 node_modules/**、**/.venv/**、**/dist/**、.git/**、examples/(无命中)、docs/specs/(无命中);`.venv` 只在本地目录移动后按 Phase H 重建,仍保持 gitignored
- **架构图契约**:index.html 是维护源,同步修改 prompt.md,再从 HTML 重新导出 3000×1700 architecture.png;README 不得继续展示含 TSUZURI 的旧图
- **LRCLIB UA**:禁止写占位 URL。实施前先确定远端仓库是否获准改名;获准时使用确认后的真实新 URL,未获准时保留当前真实 URL `https://github.com/BazingaOrg/tsuzuri` 并作为唯一显式残留白名单
- **顺带修复**:cli/config.mjs:2 过时注释(指向不存在的 analyzer/config_schema.py,真实 schema 在 analyzer/plan.py)
- **保留**:cli/menu.mjs:32「把照片和一首歌**缀成**影像日记」——"缀成"是动词非品牌,永不替换

## 授权与冻结边界

- 本计划的实施只授权仓库内代码、文档、锁文件和生成的架构 PNG;不得顺带修改其他用户文件。
- `commit`、`push`、GitHub 仓库改名、本地仓库目录改名、Claude 记忆复制各是独立动作,仅在用户明确授权对应动作后执行。
- GitHub 仓库改名是外部状态变更。实施前必须确认目标为现有 owner 下的准确仓库名(当前 origin 为 `https://github.com/BazingaOrg/tsuzuri.git`),不得猜测 owner 或创建占位链接。
- Claude project 旧目录包含会话 JSONL、subagents 和 tool-results;任何阶段都不得递归删除 `~/.claude/projects/-Users-zhangyouxiu-Downloads-Code-tsuzuri/`。
- 开始实施时记录 `HEAD`、计划文件 hash 和 `git status`;发现基线或范围漂移即停止并重新审查。

## 新品牌对照

| 位置 | 旧 → 新 |
|---|---|
| README 标题 | `tsuzuri（綴り）` → `kiseki（軌跡）` |
| web title | `綴り｜tsuzuri` → `軌跡｜kiseki` |
| 菜单横幅 | `tsuzuri 綴` → `kiseki 軌跡` |
| web-server 页 | `tsuzuri 工作台` / `tsuzuri 本地工作台` → kiseki |
| 架构图页头 | `TSUZURI · LOCAL MEDIA WORKBENCH` → KISEKI |
| CLI 入口 | cli/tsuzuri.mjs、renderer/cli/tsuzuri.mjs → kiseki.mjs |
| 配置 | tsuzuri.toml、tsuzuri.json → kiseki.toml、kiseki.json |
| 回收/原子 | .tsuzuri-trash、.tsuzuri-partial-*、.tsuzuri-backup-* → .kiseki-* |
| 临时前缀 | tsuzuri-fetch-/audio-/demucs-/plan-*、~35 个测试前缀 → kiseki-* |
| 缓存路径 | `tsuzuri/runtime/v1` → `kiseki/runtime/v1` |
| 包名/bin | tsuzuri(-web/-renderer/-analyzer) → kiseki(-*) |
| analyzer 入口 | tsuzuri-analyze/-analysis-fingerprint/-plan → kiseki-* |
| 环境变量 | TSUZURI_* (CONCURRENCY/RENDER_SPEED/TASK_ID/JSON_PROGRESS/LEASE_*/DEBUG) → KISEKI_* |
| HTTP | x-tsuzuri-token + meta tsuzuri-token + `X-Tsuzuri-Token` → x-kiseki-token 等 |
| localStorage | tsuzuri-last-job、tsuzuri:recent-folders、tsuzuri-presets:、tsuzuri-template: → kiseki-* |
| CSS 类 | tsuzuri-lightbox* → kiseki-lightbox* |
| SVG filter id | tsuzuri-filter- → kiseki-filter- |
| 文档 | docs/tsuzuri-status.md → docs/kiseki-status.md |

## 新图标:单线节拍轨迹

核心隐喻:**一段时间线被音乐推起,落在一个记忆节点**。图标应同时表达轨迹、时间线、音乐节拍与照片切换节奏,避免医疗 ECG 或通用音乐播放器观感。

- 深咖 `#33271F` 圆角方底,既是应用容器,也像一帧照片
- 奶油 `#FAF6EC` 单条连续轨迹从左下进入,形成一次不对称的节拍峰谷后向右上离开
- 金色 `#E2B667` 圆形节点落在轨迹末端,同时表示节拍落点与被保存的记忆瞬间
- 不使用独立八分音符、播放三角、胶片孔、渐变或阴影;减少 16–24px 下的信息竞争
- `viewBox="0 0 32 32"`;底板约 28×28、圆角 6–7,轨迹线宽 2.4–2.6,圆头圆角,节点直径约 4,视觉重心略偏右
- 彩色版用于产品 UI/favicon;结构必须能退化为单色版,并在 16/20/24/32/56/128px 检查轮廓与节点可辨识度

- **web/src/Logo.tsx**:重写 Mark(保留 Mark/Logo API、size/variant,调用点只有 App.tsx:62 hero、Workbench.tsx:289 compact);字标 tsuzuri → kiseki、hero 汉字 綴り → 軌跡;`logo-kana` 改为语义准确的 `logo-kanji`
- **web/index.html**:`<title>` → 軌跡｜kiseki;favicon data URI 换新图形(保留"favicon 固定配色"注释思路)

## 执行阶段

### Phase 0 — 基线与远端决策门
1. 记录 `git status --short --branch`、`git rev-parse HEAD`、本计划 SHA256 与 `git remote -v`;确认除已知计划文件外没有未说明改动。
2. 明确 GitHub 仓库是否在本轮改为 `BazingaOrg/kiseki`。没有明确授权时不改远端、不更新 origin,LRCLIB UA 使用当前真实仓库 URL并进入唯一残留白名单。
3. 固化本轮允许修改的路径;任一新文件或用户改动进入范围前先停下确认。

### Phase A — 文件重命名(先做,git mv,恰好 3 个)
1. `git mv cli/tsuzuri.mjs cli/kiseki.mjs`
2. `git mv renderer/cli/tsuzuri.mjs renderer/cli/kiseki.mjs`
3. `git mv docs/tsuzuri-status.md docs/kiseki-status.md`

### Phase B — 内容替换(委托 fast-worker,显式清单 + 规则)
替换规则(区分大小写,按序执行):
- R0 `TSUZURI` → `KISEKI`(环境变量、TSUZURI_ENTRY 符号、架构图页头、command.test.ts fixture)
- R1 `Tsuzuri` → `Kiseki`(`X-Tsuzuri-Token`,web/src/api.ts、useJob.ts、web-server.test.mjs ~16 处)
- R2 `tsuzuri` → `kiseki`(全部小写形式:文件路径、bin、包名、入口点、配置契约、回收/临时前缀、缓存路径、HTTP meta、localStorage、CSS 类、filter id、LRCLIB UA 品牌名、用法/帮助文本、README、docs、测试;远端 URL 按 Phase 0 决策处理)
- R3 `綴り` → `軌跡`
- R4 `綴` → `軌跡`。menu.mjs:32 是简体 `缀成`,不会命中本规则,保持原样

文件清单:post-rename 树上用 `rg`,每个扩展名单独传 `-g`,不要把多个扩展名写进单个 glob:

```sh
rg -l '(tsuzuri|Tsuzuri|TSUZURI|綴り|綴)' . \
  -g '*.mjs' -g '*.js' -g '*.ts' -g '*.tsx' -g '*.py' \
  -g '*.json' -g '*.toml' -g '*.md' -g '*.html' -g '*.css' \
  -g '!node_modules/**' -g '!**/dist/**' -g '!**/.venv/**' \
  -g '!docs/plans/**' -g '!docs/decisions/**'
```

从输出中扣除编排者文件(web/src/Logo.tsx、web/index.html、docs/assets/architecture 三文件)与清单批(cli、web、renderer 的 package.json + package-lock.json、analyzer/pyproject.toml + uv.lock),把剩余显式路径交给 fast-worker;不依赖约数判断是否完整。

fast-worker 规则:只做替换,不改格式、不修其他问题(报告即可)、不改测试期望值(替换后断言自然正确)、不跑 git、不 stage。

**硬后置条件**:用同一套 `rg` glob/排除规则扫描:
- `Tsuzuri|TSUZURI|綴り|綴` → 0 命中
- `tsuzuri` → 0 命中;若 Phase 0 未授权远端改名,只允许 cli/fetch.mjs 与 cli/web-api/fetch.mjs 中完全相同的当前真实 GitHub URL 两处命中
- `rg -n '缀成' cli/menu.mjs` → 恰好 1 个命中;不绑定可能因编辑漂移的绝对行号

### Phase C — 清单/锁文件(8 个,fast-worker 第二批)
- cli/package.json:name → kiseki;bin `{"kiseki": "./kiseki.mjs"}`;cli/package-lock.json 第 2、8、15 行同步
- web、renderer 的 package.json + lock:tsuzuri-web → kiseki-web、tsuzuri-renderer → kiseki-renderer(lock 第 2、8 行)
- analyzer/pyproject.toml:name、description、[project.scripts] 三个入口点
- analyzer/uv.lock:先记录该文件基线,再运行 `uv lock --project analyzer` 并检查精确 diff;若出现无关依赖 churn则停止,恢复仅限本命令产生且已核实的 uv.lock 变化,再采用最小一致性更新,不得覆盖并发用户改动

### Phase D — 编排者手改(不委托)
1. web/src/Logo.tsx 新图标(见上)
2. web/index.html title + favicon
3. cli/config.mjs:2 过时注释修正
4. docs/assets/architecture/index.html 与 prompt.md 同步新品牌,从 index.html 重新导出 3000×1700 architecture.png;确认 PNG 新于 HTML、无外部请求/脚本、无裁切/重叠,README 中英文 alt 文本也改为 kiseki
5. LRCLIB UA 按 Phase 0 选择写入真实 URL;不得写 `https://github.com/kiseki` 之类占位地址

### Phase E — 独立验证(qa-runner,最终未变 diff)
先运行 Web production build,再运行任何会读取 `web/dist` 的 CLI/Web 测试;否则 CLI 的 `web.test.mjs` 会把旧构建标题误报为源码失败。

| 命令 | 期望 |
|---|---|
| `npm --prefix web run build` | 成功;必须是本阶段第一条构建/测试命令,重新生成 dist 避免旧标题陷阱 |
| `npm --prefix cli test` | 全绿(当前基线约 583 用例) |
| `npm --prefix renderer run typecheck` + `npm --prefix renderer test` | exit 0 |
| `uv lock --project analyzer --check` + `uv run --project analyzer pytest` | lock 一致且测试全绿(当前基线约 161 用例) |
| `npm --prefix web run typecheck` | exit 0 |
| `npm --prefix web test` | 全绿 |
| `node --check cli/kiseki.mjs` + `node cli/kiseki.mjs help` | 新主入口语法与 help smoke 通过 |
| `(cd renderer && node cli/kiseki.mjs help)` | renderer 容错入口能转发到新主入口 |
| `uv run --project analyzer kiseki-analysis-fingerprint` + `uv run --project analyzer kiseki-analyze --help` + `uv run --project analyzer kiseki-plan --help` | 三个新 analyzer console scripts 可解析执行 |
| 残留扫描(复用 Phase B 的完整 glob/排除规则) | 符合三个硬后置条件 |
| Logo hero/compact、favicon、README architecture.png 浏览器/图片目检 | 新图形、字标、尺寸与深浅主题正常,架构图无旧品牌 |
| `git diff --check` / `git status --short` | 工作树 diff 无空白错误,只有冻结范围内文件 |

### Phase F — 提交
仅在用户明确授权 commit 后执行。全量改名是不可拆开的跨组件契约,使用单个语义化 commit:
1. 用显式允许路径 stage,包括 3 个 git mv、实现/测试/清单、README、docs/config.md、docs/kiseki-status.md、架构三文件和本计划;禁止 `git add -A`。
2. 检查 `git diff --cached --name-status`、完整 staged diff 和 `git diff --cached --check`;此检查必须发生在 stage 之后。
3. commit 信息记录契约层改名与图标/架构资产同步;不得声称存在已移除的 architecture.png 遗留或使用占位 UA。

### Phase G — 发布与远端仓库(独立授权)
1. 未收到明确 `push` 授权时停在本地 commit;commit 不蕴含 push。
2. 仅授权 push、未授权 GitHub 仓库改名时,推送当前 origin/main,再比较 `HEAD`、`origin/main` 与 `git ls-remote origin main`。
3. 若另行明确授权 GitHub 仓库改名:先核对 owner、仓库、目标名和权限,推送当前 commit;再执行外部改名,把 origin 更新为确认后的新 URL,重新 fetch并比较 `HEAD`、tracking ref 与 `git ls-remote`。任一步失败即停止,不猜测或创建替代仓库。

### Phase H — 本地目录改名与新路径复验(独立授权,最后一步)
1. 仅在用户明确授权目录改名、提交已完成且工作树干净后,把 `/Users/zhangyouxiu/Downloads/Code/tsuzuri` 精确移动为同级 `kiseki`;移动前确认目标目录不存在。
2. 当前 `analyzer/.venv/bin/*` shebang 硬编码旧绝对路径,因此移动后先在新目录重建 analyzer `.venv`(`uv sync --project analyzer --locked`),不得沿用旧环境宣称成功。
3. 在新路径重跑 Phase E 的全部自动命令与三个入口 smoke,再验证 `git -C .../kiseki status`、HEAD 和 git log。目录移动前的绿灯不替代新路径复验。
4. 告知用户当前会话路径已失效,重启会话并进入新目录。

### Phase I — Claude 记忆复制(可选,独立授权)
1. 仅在用户明确要求迁移 Claude 记忆时,把旧 project 的 `memory/` 4 个文件复制到新 project 的 `memory/`;逐文件核对内容后再在副本中改名 `tsuzuri-roadmap-decisions.md` 并更新 frontmatter、MEMORY.md 索引与 push-to-main-and-delegate.md 引用。
2. 只对新 memory 副本做残留扫描。保留旧 `-Code-tsuzuri` project 目录及其中所有 JSONL、subagents、tool-results 和原 memory,不得递归删除或把 Claude memory 迁移表述为 Codex memory 已迁移。

## 风险要点
- 混合大小写 Tsuzuri 易漏 → R1 专条 + 后置 `rg`
- `缀成` 动词与繁体品牌字混淆 → 分别扫描 `綴` 为 0、`缀成` 恰一处
- 多扩展名被错误写成一个 glob → 使用多个 `rg -g` 并让发现扫描与后置扫描共享同一范围
- CLI web.test.mjs 与 Web 测试都会读取 dist → Web build 必须先于 CLI/Web 测试
- uv.lock 漂移 → 先 uv lock 看 diff,必要时手改单行
- README 架构图仍露出旧品牌 → index.html、architecture.png、prompt.md 三文件同步并目检 PNG
- 目录移动让 analyzer/.venv shebang 失效 → 新路径重建环境并重跑验证
- 远端改名、push、目录移动、记忆复制权限不同 → 每项独立授权,不可互相推导
- Claude 旧 project 不只 4 个 memory 文件 → 只复制所需文件,永不删除旧会话目录
- 既有素材夹的 tsuzuri.toml/.tsuzuri-trash 与旧缓存/localStorage 键成为孤儿 → 用户已接受全量改名的代价,无迁移
