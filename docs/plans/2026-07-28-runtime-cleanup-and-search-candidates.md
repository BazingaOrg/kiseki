# Runtime 清理与搜索候选执行计划

日期：2026-07-28
状态：已实施，待用户 QA
验证分工：用户负责全部运行时、浏览器、媒体和人工 QA；实施者只做静态审查与 `git diff --check`，不运行测试、typecheck、lint、build 或浏览器自动化。

## 原始计划（已确认，保持不改写）

实现“不支持中断恢复”的任务清理协议：取消、服务退出或下次启动发现异常残留即杀掉进程树、清理 partial/temp 并从头重来；页面刷新只能观察同一服务当前任务。lease 仅服务跨进程互斥、owner 身份和清理，owner 活着返回 409，只有证明死亡才能清理，无法证明则 fail-closed。任务独占 temp root，输出以 atomic partial commit 落盘，终止顺序为 TERM→wait→KILL→wait close/reap，分别落实 Unix/Windows 进程树策略。`.tsuzuri-trash`、`.remotion`、模型和缩略图缓存不纳入任务自动清理。

搜索体验同步调整：歌曲/歌词候选由 5 提升至 10，按稳定 ID 去重；重新搜索清空当前选择；补足可滚动候选 UI 与对应文案。

## 范围与非目标

范围包括任务生命周期、跨进程 lease、临时目录与输出提交、fetch/analyzer 子进程清理、回收站/缓存边界，以及素材页的歌曲/歌词搜索候选。

非目标：不实现断点恢复、持久进度、跨服务进度订阅、任务队列或缓存清理工具；不修改 `.tsuzuri-trash` 的用户撤销语义；不运行自动化验证，不提交。

## 执行批次

### 0. runtime lifecycle、lease 与服务退出

候选文件：`cli/web-api/jobs.mjs`、`cli/web-server.mjs`、`cli/web.mjs`、`cli/web-api/jobs.test.mjs`、`cli/web-server.test.mjs`。

- 定义 lease 最小字段：任务 ID、owner PID、进程启动身份/时间、平台、任务私有 temp root 与创建时间；明确它不是进度或恢复数据。
- 启动新任务前检查同项目 lease：owner 可证明存活则 `409`；可证明死亡才做受限清理；任何 PID 重用、平台查询失败或身份不一致无法判定时 fail-closed 并说明需人工处理。
- 将同服务 `/api/jobs/current` 限定为观察活跃内存任务；刷新后不得以旧 SSE/页面状态重建任务或开放恢复入口。
- 服务 shutdown、取消和异常处理统一进入终止/回收路径；确保 lease 只在任务明确结束或残留已确认清理后移除。

风险与验收：lease 判活错误会误杀真实任务或放行竞争。验收时需由用户在两个服务实例、刷新页面、服务退出、PID 重用/无法判定模拟下确认：活 owner 恒为 `409`，无法证明恒不清理，已死亡残留才能受限清理。

### 1. 视频、静态与关键 JSON 的原子输出

候选文件：`cli/render.mjs`、`cli/still.mjs`、`cli/job-argv.mjs`、`cli/analysis-cache.mjs`、`cli/render.test.mjs`、`cli/still.test.mjs`。

- 视频与静态导出均写入任务私有 temp root 下的 `partial`；成功后才以同文件系统内的原子 rename/replace 提交正式文件，失败/取消不暴露半成品。
- 核对关键 JSON 写入点（例如 analysis cache 与任务生成的元数据）：只有确实存在“读取方会将中断文件当有效结果”的路径才改为临时写入后原子替换；若现有写入已经有等价保护，收窄改动并在实施记录说明。
- 不把跨卷复制伪装成原子提交；正式目标与 partial 不具备原子 replace 前提时，显式失败或调整为同卷 staging，而非留下不确定状态。

风险与验收：输出路径、覆盖语义与 Windows rename 行为可能不同。用户以完成、取消、强制终止及同名目标冲突验证：正式结果要么是旧完整文件、要么是新完整文件，从不出现可扫描的 partial 或截断 JSON。

### 2. temp root、fetch/analyzer 进程树与异常残留清理

候选文件：`cli/fetch.mjs`、`cli/web-api/fetch.mjs`、`cli/web-api/jobs.mjs`、`cli/web-server.mjs`、`analyzer/analyze.py`、`cli/fetch.test.mjs`、`cli/web-api/fetch.test.mjs`。

- 为每次任务创建唯一且私有的 temp root；子进程的 cwd、临时环境变量、partial 输出均从该 root 派生。
- 抽出统一的“TERM→wait→KILL→wait close/reap”终止协定。Unix 启动独立进程组并向组发送信号；Windows 使用 Job Object 或可靠等价的树终止机制，确保 yt-dlp、ffmpeg、Python/analyzer 等后代不会遗留。
- 在服务启动扫描 lease/temp root：仅对 owner 死亡证明充分的任务执行树终止（若仍有）与目录清理；取消、失败、服务关闭走同一可重复清理路径。

风险与验收：单杀父进程会留下下载/编码后代，过早删目录会让仍运行的子进程写入未知位置。用户需验证 fetch、analyzer、video、still 的取消和服务退出：所有后代已回收后才清目录；下次启动不恢复，只能重做。

### 3. 回收站与失效边界

候选文件：`cli/web-api/assets.mjs`、`cli/web-api/dirs.mjs`、`cli/web-api/thumb.mjs`、`cli/web-api/project.mjs`、相关 `*.test.mjs`。

- 审核 cleanup root 白名单，显式排除 `.tsuzuri-trash`、`.remotion`、模型目录和缩略图缓存；任务清理仅能删除 lease 所属私有 temp root/partial。
- 维持已有素材变更后的 analysis/派生产物失效规则，但不把“失效”扩大为删除用户回收站或共享缓存。
- 若临时目录名与用户素材/缓存目录可能混淆，改为受控任务命名空间并以 realpath/sandbox 校验收口。

风险与验收：路径穿越或根目录计算错误会删除用户数据。用户确认删除/撤销后的 `.tsuzuri-trash` 仍可恢复；任务失败、重启与残留扫描均不删除缓存或模型，正常素材失效规则不回退。

### 4. 歌曲/歌词搜索候选

候选文件：`cli/web-api/fetch.mjs`、`cli/web-api/fetch.test.mjs`、`web/src/Materials.tsx`、`web/src/Lyrics.tsx`、`web/src/App.css`。

- 将歌曲与歌词候选上限从 5 提升至 10；在 API 边界和前端合并展示处以稳定 provider ID 去重，不用标题或歌手字符串猜测同一条目。
- 每次重新搜索先清除已有候选选择和其派生预览/提交状态，避免旧选择与新查询混写；只在新结果返回后允许选择。
- 候选列表采用有限高度、可滚动容器，保留键盘可达性、选中可见性、空/加载/错误文案，并更新“最多 10 条”的准确文案。

风险与验收：不同 provider 的 ID 命名空间或缺失 ID 会影响去重；必须保守处理缺失 ID，不能错误合并。用户验证超过 5 条、重复 ID、重新搜索、慢响应覆盖、滚动、键盘选择及歌词/歌曲两条路径。

### 5. 静态审查与用户 QA 交接

- 实施后逐批核对调用链、错误/取消分支、路径白名单、平台分支、输出提交时机，以及前端 selection reset 和 ARIA 状态。
- 只运行 `git diff --check`；不把它表述为功能、类型、构建或浏览器验证。
- 将下列用户 QA 结果记录到本计划实施记录：双服务竞争与 `409`、刷新观察、服务退出、Unix/Windows 进程树、强制中断、半成品/JSON 原子性、回收站/缓存保留、10 条候选去重/重搜/滚动/键盘与真实下载渲染。

## 实施顺序与依赖

先完成 0 的 lease 判定与 shutdown 收口，再实施 1 的输出协议和 2 的进程/目录清理，之后审计 3 的删除边界；4 仅依赖既有搜索契约，可独立完成但不得绕过当前 busy/锁语义。任何发现需要持久进度、跨服务恢复或自动删除共享目录时，停止并新增 ADR，不在本计划内扩展。

## 实施记录

状态：已实施，待用户 QA。本节只追加实际变更、偏离原因、静态审查问题和用户 QA 结果；不得改写上方“原始计划”或既有批次内容。

### 0B2：claim 路径身份复核（进行中，待静态检查）

- 目标：将文件系统操作路径与不访问文件系统的稳定 claim key 分离；v2 manifest/claim 持久化 key，并让 v1 遗留 claim 在 owner 未证实死亡时继续阻塞，在已死时仅按 taskId + stable key 精确恢复。
- 涉及：`cli/task-lease.mjs`、`cli/atomic-output.mjs`、相邻测试及会忽略 `release() === false` 的 direct/Web 调用方。保持现有 search 工作区改动不变。
- 风险：迁移时若将 v1 误当成 v2 或接受目录/链接 final，可能错误并发写入或破坏用户文件；因此未知、缺失、重复、畸形记录一律 busy，输出最终目标在任何 mutation 前要求是 regular file 或不存在。
- 验收边界：只做 `node --check` 与 `git diff --check`；不运行测试、构建、浏览器、网络、真实进程终止或 registry 清理。用户后续验证跨平台路径别名、v1 stale recovery、原子事务 crash window 与 release 失败传播。

### 0B2 实施与复核（已实施，待用户 QA）

- `identityVersion: 2` manifest 保留 acquire-time 的 filesystem `resources`/输出 artifact 路径，并额外持久化平行 `claimKeys`；v2 claim 持久化 `resourcePath` 与 `claimKey`。stable key 只对 lexical absolute path 做平台规则归一：Linux 保留大小写，Darwin 全路径 NFC+lowercase，Windows 分隔符标准化后 NFC+lowercase，不读取文件系统。
- output artifact 仍只在 acquire 时 realpath 已存在的父路径，并保留未解析的 final basename；existing final 若不是普通文件（含目录、special 或 symlink）在 lease/atomic mutation 前拒绝。partial 也必须为普通文件。
- v1 claim 不会被 v2 忽略：live/unknown 继续 busy；dead owner 的 legacy 恢复按 task id + stable key 扫描，并要求每个 required claim 恰有一份可解析记录，否则 fail-closed。v2/legacy 混写同一 manifest 同样 busy。已提交事务仍走既有保留 final、清 partial/backup 路径。
- direct CLI 与 Web mutation/save caller 不再静默丢弃 `release()` 的 false，而是使当前成功流程失败；未扩大到无成功响应的其他路径。
- 增加了相邻 static tests：Darwin 非存在路径、NFC/NFD/parent symlink、Linux/Windows case 以及 directory final。受本轮边界限制，未运行这些或既有 tests。
- 静态检查：`node --check`（修改的 8 个生产/测试 JS 模块）与 `git diff --check` 均通过。未运行测试、build、browser、network、kill 或 registry mutation。
- 复核根因：旧 claim identity 把 filesystem realpath/case folding 混入 claim hash，导致不存在路径和跨平台 spelling 的 key 不稳定；部分 release 调用忽略 false，可能把残留 claim 后的操作报告为成功。用户 QA 需覆盖 Darwin mixed-case create/finalize/release、NFC/NFD 和 ancestor spelling、Windows/ Linux case、final symlink/dir/special、v1 live/dead/duplicate/missing、committed crash recovery 和 release-failure 响应。

### 0B2 复核修正（已实施，待用户 QA）

- v2 acquire 与 extend output claim 现在均在任何 v2 manifest/claim 写入前扫描 legacy claim JSON；命中 requested stable key 的 v1 task 只有 owner 已证实死亡、每个 required key 恰好一份可解析 legacy claim 时才恢复。live、unknown、duplicate、missing、malformed 与 v1/v2 混写均 busy。恢复沿用已提交事务保留 final、清理本 task partial/backup 与 exact legacy claim/task 的路径。
- manifest 的 resources、pending resources、outputs、transaction entries 与 inherited attach 均按持久化 stable key 判断归属；验证后使用 manifest 保存的 operation path，不再把重新 realpath 的 spelling 当作唯一合法值。v2 pending claim key 同时在 acquisition/extension intent 中验证，stable-key 重复拒绝。
- release 先预检全部 required claim，之后才清理 artifact/删除 claim；CLI finally 只在已成功返回的路径将 release failure 变成失败，原始异常和非成功返回不被覆盖。save-lyrics 将成功后的 release failure 转为结构化 500，原有失败响应保持。
- 追加未运行测试覆盖 legacy live block、dead committed recovery、Darwin lexical key、Linux/Windows case 与 atomic directory/symlink mutation guard。仍未运行 tests/build/browser/network/kill/registry mutation；本轮仅可报告静态语法和 diff 检查。

### 0B2 第三轮复核修正（已实施，待用户 QA）

- 根因：仅扫描 legacy claim 文件会让“manifest 已声明但 claim 缺失”的 v1 task 在 v2 创建前不可见；持久化路径的 string equality 也会把大小写/NFC 变化与真实 symlink redirect 混为一谈。
- 修正：v2 写入前同时扫描 legacy tasks manifest 与全部 claim JSON；命中 requested stable key 的 manifest 要求每个 declared key 具唯一、同 task 且 stable-key 一致的 old claim，否则 busy。owner live/unknown 保持 busy，dead 才复用 exact recovery。
- 每次 manifest/release/recovery 验证都重新 canonicalize stored project、artifact-resolve stored output，并只比较 stable key；通过后仍使用持久 operation path。release 在任何 artifact/claim/task mutation 前预检 durable 与 pending claim 集合。
- 本轮只做 `node --check` 和 `git diff --check`；未运行测试或其他禁止的验证。新增 fixture 覆盖仍需由后续 test run 确认。

### 0B2 第四轮复核修正（已实施，待用户 QA）

- legacy pre-scan 现以完整 declared set（resources、pendingClaims、pendingOutputClaims）验证 task manifest 与旧 claim 的 1:1 对应；requested key 的 orphan legacy claim 同样 fail-closed，不能因缺少 manifest 而隐形。
- 修正 v2 fixture 使用 `stableClaimKey` 与其 hash，而非依赖 raw path 恰好等价。新增未运行 fixture 覆盖 requested pending legacy claim 与 orphan claim 均在 v2 写入前阻断。
- 仅执行静态语法及 diff 检查；未运行 tests、registry/service 或其他运行态操作。

### 0B2 第五轮复核修正（已实施，待用户 QA）

- legacy recovery 前建立跨全部 verified legacy manifest/claim 的 stable-key 索引；requested key 若被多个 task 声明或有多份 old claim，任何 recovery/delete 前直接 busy。新增两个 dead legacy task 同 key 的未运行 fixture，断言 task/claim 均保留。
- stable-key 大小写折叠只适用于 Darwin 与 Windows；AIX、FreeBSD 与其他平台保持 case-sensitive，并新增未运行断言。

### 0B2 第六轮复核修正（已实施，待用户 QA）

- 修正 transitive legacy conflict：requested key 命中的可恢复 task 会先对其完整 declared key 集合做全局唯一 task/claim 对应预检；任何输出 key 连接到另一 task 都在 recovery 前 busy，不扩展或部分清理。
- 新增未运行 A(X,Y)/B(Y) fixture，断言 request X 时两 task、claims 与 Y final 保留。仅静态 syntax/diff 检查。

### 2A 事务恢复复核修正（已实施，待用户 QA）

- `prepared` 是仅持久化 intent 的阶段，不再与 `committing` 共用回滚：stale recovery 保留当前所有 final（含外部写入），只删除本 task partial；prepared 阶段出现 backup 视为不可能状态并 fail-closed。`committing` 与 `committed` 语义不变。
- 新增未运行 fixture 覆盖 prepared 后外部 final 出现及原 final 外部消失均不被恢复逻辑重写。仅完成静态检查。

### 1A：视频/still 正式产物的同目录原子提交（已实施，未运行验证）

- 新增 `cli/atomic-output.mjs`：partial 命名固定为同目录隐藏 `.tsuzuri-partial-<taskId>-<name>.<ext>`，保留真实扩展；任务 ID 优先使用 lease 环境，直接调用回退随机 ID。提交只使用同目录 rename；覆盖既有 final 时先 rename 到唯一隐藏 backup，替换失败则 rollback 旧 final，成功后删除 backup，不使用 copy fallback。
- `render.mjs` 现在让 Remotion 只写 video partial；正式渲染在 partial 上完成响度检查/归一后才提交 final，草稿跳过归一也仍在同一提交边界内。`tsuzuri.mjs` 不再在 final 已可见后处理响度。
- `still.mjs` 逐张只写 partial，单张 render 成功后即提交对应 final；中断/失败的 finally 仅删除当前任务当前未完成 partial。未实现 resume；下一次默认仍从头，`--skip-existing` 只检查已提交 final。
- `/api/project` 的 output 扫描排除 `.tsuzuri-partial-` 文件，防止中间产物进入项目 API；关键 JSON 未发现本批中会暴露中断写入的改动点，故未扩大范围。
- 新增 helper 相邻单测但按分工未运行；本批仅允许后续人工调用链/rollback 审查、引用搜索与 `git diff --check`，用户 QA 仍需验证完成、取消、强制终止和同名覆盖。

### 1A 补充：stale lease 的已知媒体产物恢复清理（已实施，未运行验证）

- partial 与 backup 现在都只由 `taskId + final output claim` 推导，且同目录隐藏；backup 不再含随机值。lease manifest 持久记录 canonical `outputPaths`，因此不需要、也不允许扫描输出目录。
- 已确认 owner 已死且 executor 已终止的 stale lease，以及正常 release，都会逐个核对 output claim、绝对 canonical 路径和 final/partial/backup 的 `lstat` 普通文件身份。仅删除本 task partial；backup 在 final 缺失时同目录 rename 恢复，否则删除。任何 manifest、claim、路径或文件类型不一致均 fail-closed，不清 task 或碰其他 task 文件。
- 新增/调整相邻测试但未运行；仅完成静态调用链与 rollback 审查及 `git diff --check`，用户 QA 仍需覆盖强杀在 backup 窗口和 partial 窗口的下次启动恢复。

### 1B：Analyzer/Planner 关键 JSON 原子提交与任务临时目录（已实施，未运行验证）

- 新增 analyzer 侧同目录 JSON 写入 helper：`beats.json`、`lyrics.json`、`timeline.json` 及 planner 的临时 status JSON 都先写唯一 `.tsuzuri-partial-...`，flush/fsync 后才用 `os.replace` 提交；任意写入、replace 或取消异常都会仅清理本次 partial，既有正式文件不被打开或截断。
- timeline 的既有手改保护未改：检测到手改或匹配素材但 beats 缺失时，仍直接保留原 timeline；仅成功生成新规划时才通过原子 replace 替换它。
- analyzer 的 FFmpeg 解码和 demucs 临时目录优先使用经存在性、目录与符号链接检查的 `TSUZURI_LEASE_TASK_ROOT`，其次 `TMPDIR`；各次 `TemporaryDirectory` 都是该根下的唯一子目录并由 context/finally 清理。两个环境变量都未提供时保留 Python 原本的系统临时目录行为。
- direct CLI lease 现在也向 analyzer 子进程传递 `TSUZURI_LEASE_TASK_ROOT`，并在流程 finally 恢复该环境变量；Web 既有任务根传递不变。未清理 analysis、preferences、手改 timeline、`.remotion`、模型、缩略图或 `.tsuzuri-trash`。
- 新增相邻原子失败/临时目录边界测试但未运行；本批仅做写入路径、异常清理和环境传递的人工审查，用户 QA 仍需覆盖取消、强制中断、既有 JSON 覆盖与任务根清理。

### 0A：Web job 进程树终止与 async shutdown（已实施，未运行验证）

- `jobs.mjs` 将直接 child 的 `exit` 收窄为仅缓存退出码；只有 stdio 全部关闭且 child 被 reap 的 `close` 才最终执行 finalize、释放并发锁、清理 SSE 监听器并发出唯一 `end`。
- 取消先把状态设为 `stopping`，Unix 向独立进程组和已快照后代发送 TERM，宽限期后才向仍可证明身份一致的后代和尚未 close 的进程组发送 KILL。后代快照使用 `pid + lstart`，KILL 前重新核验，证据不足不按旧 PID 快照杀进程。
- Windows 不使用负 PID；改走 `taskkill /T`，宽限期后 `taskkill /F /T`。两阶段 taskkill 失败会记录任务 error 事件，不会伪报已终止。
- `killAll()` 现为 async，等待所有活跃 job 的 `close`。fetch 临时目录仍由 close 后的现有 finalize 清理，不在仍可能写入时提前删除。
- 新增 `runtime-lifecycle.mjs`，`web.mjs` 对 SIGINT、SIGTERM、SIGHUP 安装一次性 shutdown：先 `server.close()` 停止接新请求，再并行等待 server close 与 `killAll()`，最后设置 `process.exitCode`，不在异步收尾前调用 `process.exit()`。
- 仅新增/调整静态测试预期，未运行任何测试、typecheck、lint、build、浏览器自动化或真实进程终止。实施者仅完成引用检查与 `git diff --check`；用户仍需验证 Unix/Windows 进程树、SIGINT/SIGTERM/SIGHUP、SSE close、强制终止与临时目录清理。

### 0B1：task lease 核心与 Web job 接入（已实施，未运行验证）

- 新增用户级 runtime registry：macOS 使用 `~/Library/Caches/tsuzuri/runtime/v1`；Linux 优先仅在 owner/权限可证明安全的 `XDG_RUNTIME_DIR` 下使用运行目录，否则回退用户 state；Windows 使用 `LOCALAPPDATA`。registry、tasks 与 claims 均要求私有目录、拒绝异常所有者、符号链接和 group/world writable 权限。
- 每个 Web job 在 spawn 前以 canonical project path 的 SHA-256 claim key 创建 `wx` claim，并在 `tasks/<id>/manifest.json` 中保存 task root、资源、Web 父 owner 的 pid/start identity、executor identity、spawn intent 与 token hash；原始 token 只经 child env 传递，不落盘。claim key 排序创建，`outputPaths` 已作为 lease API 参数保留；本子批次只 claim project。
- 遇到活 owner、权限/身份/manifest/claim 不可证明的状态一律映射为 busy；owner 已死且 executor 仍可证明存活时才走既有 TERM/KILL 进程树路径，确认消失后才清该 task namespace。spawn intent 尚未登记 executor 同样 fail-closed；服务重启不恢复旧任务。
- `createJob` 在 lease 后建立 spec，fetch-audio 中转目录改为 taskRoot；spawn 前标记 intent，spawn 后登记 executor，env 传递 `TSUZURI_LEASE_TASK_ID`、`TSUZURI_LEASE_TASK_TOKEN`、`TSUZURI_LEASE_TASK_ROOT`。所有 close/error 终态均先 finalize（含临时目录清理）再 token ownership 校验 release；启动异常回滚 lease。
- 本轮未运行测试、typecheck、lint、build、浏览器自动化或真实 kill。仅做导入/调用链人工审查与 `git diff --check`；用户 QA 需覆盖双服务竞争、活/死/未知 owner、spawn 异常、fetch 取消/完成、服务重启后残留和 Unix/Windows 回收。

### 2A：音频/歌词安装的 lease 原子事务（已实施，未运行验证）

- fetch 不再在项目 `audio/` 内创建或依赖 `.tsuzuri-fetch-*` staging 目录；yt-dlp 下载仍在 lease 的 `taskRoot` 下。历史遗留的未知 `.tsuzuri-fetch-*` 不会被扫描或自动删除，需人工确认后处理。
- 安装前，authenticated lease owner 通过 `extendOutputClaims` 按 canonical 路径排序、`wx` 创建的方式扩展 audio/lrc 新增、替换和删除路径；扩展失败会回滚本次已创建 claims。manifest token 不匹配时拒绝操作。
- fetched source 复制到 final 同目录且可推导的 partial 后会 fsync；同一安装事务先将所有既有 final 移至 taskId 可推导 backup，再 rename 全部 staged final，只有全成功才删除 backup。失败会按事务清单恢复已有 final 并删除 partial。
- stale lease cleanup 继续仅依据 output claims 派生 partial/backup：删除 partial；final 缺失时 restore backup，final 存在时删除 backup。Web fetch finalize 在 release 前完成该事务；direct `fetch` 同样持有 lease 至整个交互流程结束。
- 本批未运行测试、build、下载或自动化验证；只允许后续人工事务/rollback/路径审查、引用搜索和 `git diff --check`。用户 QA 负责真实下载、取消和强杀窗口验证。

### 2A P2：多文件安装的事务级崩溃恢复（已实施，未运行验证）

- fetch 安装在移动任意 final 前，将完整、排序的 audio/lrc 新增、替换和删除集合及每项 `hadFinal` 持久写入 lease manifest 的 `outputTransaction`，阶段依次为 `prepared`、`committing`、`committed`。
- stale cleanup 对 `prepared`/`committing` 先完整校验所有 claim、路径和 regular-file 状态，再将整个集合恢复到事务前；对 `committed` 则完整校验新集合后只删除其 backup/partial。不会再按单个文件的 final/backup 状态混合决定保留或恢复；任一不一致 fail-closed。
- 正常安装异常复用相同 rollback，全部 final 完成且 durable `committed` marker 写入后才清理 backup/partial 并清 marker。render/still 单文件输出协议未迁移。
- 新增相邻 crash-window 测试但未运行；本批仅做崩溃点/路径人工审查与 `git diff --check`，用户 QA 负责强杀恢复验证。

### 3A：素材回收站操作完整性与清理边界（已实施，未运行验证）

- 删除和改名现在都生成各自 UUID operation 目录及 version 2 manifest。manifest 完整记录主文件、音频同 stem 配对歌词、被失效的 derived metadata；改名同时记录项目内新文件位置，照片 `perPhoto` 配置的原始 `tsuzuri.json` 另存于该 operation 的 metadata 备份。
- 改名不再使用没有 manifest/进程内撤销记录的 `invalidate-*` 目录。当前服务进程内，改名和删除都会返回 undoId；服务重启后仍不从磁盘重建 undo record，且不自动清理任何回收站 operation。
- 撤销先对全部文件、derived metadata、配置备份及其父路径做 preflight，任何冲突、符号链接或 realpath 漂移都会拒绝，未开始移动。通过后恢复全部原文件和 derived metadata，再以同目录临时替换恢复照片配置；只在所有恢复成功后精确删除该 operation 目录。回收站根仅在此时已空才尝试移除；恢复或清理失败不会删除 undo record 或其他 operation。
- 未撤销 operation 长期保留，清空回收站需要未来显式用户操作；历史未知 `.tsuzuri-fetch-*` 同样不扫描或自动删除。未触及用户唯一素材、手改 timeline、`.remotion`、模型或缩略图缓存。
- 新增相邻回收站 manifest/改名撤销测试但按分工未运行；本批仅做人工 rollback/preflight/path/symlink 审查、引用搜索与 `git diff --check`。用户 QA 仍负责真实删除/改名、撤销冲突、服务重启与回收站保留验收。

### 0A 补充：P1 取消终态与 shutdown deadline 修复（已实施，未运行验证）

- Web job 取消现在为每任务唯一的 termination promise；`close` 只确认直接 child 已 reap，只有快照后代身份均确认消失后才 finalize、release lease 和发送唯一终态。`close` 不再取消强杀定时器。
- Unix 仍先 TERM 进程组与身份快照后代；宽限期后仅对仍可证明匹配的组/后代 KILL。身份/树退出无法确认或强杀失败时发送人工介入 error 终态，并保留 lease/claims，避免仍在写入的孤儿被新任务覆盖。
- shutdown 停止接单并复用各任务 termination promise；全局 deadline 后尝试最后一次强杀、结束活跃 HTTP/SSE，且以非零 exitCode 保留 stale cleanup 线索，不无限等待。
- 新增 jobs 相邻测试覆盖 child close 非终态与重复取消/killAll 复用；本子批严格未运行测试、build、typecheck、lint、浏览器自动化或真实 kill，仅完成静态修改与调用链审查。

### 0A 补充二：P1 spawn 登记竞争与跨平台终止证据（已实施，未运行验证）

- Web 父进程现在在 child 的事件/终止状态建立后才登记 executor。CLI 若先以同一 PID/start identity 自登记，lease 的既有幂等登记保持成功；任何其他登记失败均会把已 spawn 的 child 送入同一 termination promise，且在确认 close 与树消失前绝不 release lease。
- Unix 的 TERM/KILL 改由 runtime lifecycle 的统一、已验证 identity 的正 PID tree signal helper 发送，不再由 jobs 假定负 PID 进程组可靠；TERM/KILL 后以有界轮询等待 direct child close 及快照 identity 消失，给进程表传播滞后留出窗口，超时保留 lease 并写 error。
- Windows 不读取 `ps` 快照或以其缺席判死；仅使用 taskkill `/T`、`/F /T` 的结果，以及平台 executor liveness 与 direct child close。相邻静态测试覆盖登记失败不直接 release、Windows 不调用 ps。
- 本补充未运行测试、typecheck、lint、build、浏览器自动化或真实 kill；仅完成静态源代码审查和 `git diff --check`。用户 QA 仍需实际覆盖父/child 登记竞态、fetch-audio、Windows taskkill、Unix 后代与进程表滞后。

### 最终实施说明与静态审查（已实施，待用户 QA）

- 不支持真正的 resume：同服务页面刷新仅重新观察仍存活的 in-memory job；取消或正常退出后清理并从头开始，不重放进度、命令或中断状态。
- 可处理的服务 shutdown 走有界 TERM→等待→KILL→等待 close/reap；SIGKILL 会使服务无法执行 finally。durable lease 因此继续阻止重叠写入；下次启动只会清理可证明归属的已知 group/snapshot，不能绝对保证发现独立 daemonize 且未被观察到的后代。
- `.tsuzuri-trash` 不自动清空，只在完整 undo 成功后精确删除单次 operation；显式 empty-trash 尚未实现。历史 `.tsuzuri-fetch-*` 不扫描、不盲删。
- 歌曲与歌词候选均为最多 10 条；稳定 provider ID 去重，缺失 ID 不做猜测性合并。
- final static review：PASS。发现并修复的根因包括 direct interactive render 对已持有 task 的 reattach、TERM 后 root 已死时漏掉已验证 descendants 的 KILL、spawn PID/start probe 与登记竞态、Windows taskkill 缺少 canonical identity/liveness gate，以及 jobs 单测固定假 PID 却落到真实 task lease/runtime registry。
- QA 未运行 tests、build、browser、render、network 或真实 signals；用户负责双服务/刷新观察、取消与正常退出、SIGKILL 后 stale cleanup、Unix/Windows 后代、原子输出、回收站/旧 staging 保留，以及歌曲/歌词 10 条候选和重搜交互验收。

### 2026-08-01 真实回归与 fixture 迁移（不改写上述历史结论）

- 后续稳定性批次将原先会落入真实 runtime registry、PID 或 IPC 的 lease/atomic/lifecycle 测试迁移为隔离 fixture；生产 lease、executor identity、claim、TERM→wait→KILL→close/reap 与 fail-closed 协议未放宽。
- 自动化真实回归通过：CLI 连续两次 `556 / 556` 且无 ProjectBusy/IPC；Analyzer `152`；Renderer `9` 与 typecheck；Web `45`、typecheck 与 production build；`git diff --check` 通过。仓库没有 lint 脚本。
- 这补充的是自动化回归证据，不取代本计划保留给用户的真实媒体、浏览器、网络、信号/进程树和跨平台 QA。
