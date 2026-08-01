# 功能收口后的稳定性优化计划

日期：2026-07-30
状态：已完成；自动化验证通过，待用户运行时 QA
范围：只在现有功能语义内恢复可验证的稳定基线，并在代码事实稳定后更新 README 架构图。

## 目标

- 将当前功能实现收口为可复现的测试、类型检查和构建基线。
- 修复已确认的身份、交互入口、lease/atomic 测试夹具、生命周期和 Web 命令契约漂移。
- 保留既有安全边界：canonical 身份、lease、原子输出、进程 close/reap、executor identity 和 fail-closed 清理。
- 以最终代码事实更新 README 架构图三件套，而不是把 README 扩展为部署或 SaaS 设计文档。

## 非目标

- 不改变已确认的产品功能、CLI 交互意图或 API 对外语义。
- 不重构 `task-lease.mjs` 的运行时协议；批次 2 原则上只迁移测试夹具与断言。
- 不引入登录、多租户、队列、数据库、容器部署或任何公开线上服务能力。
- 不做没有同环境测量依据的性能重写，不删除或覆盖用户现有在途改动。
- 本轮不提交、不推送；浏览器、真实媒体、网络和跨平台运行时验收不由代码静态检查替代。

## 当前基线（实施前记录）

| 检查 | 结果 |
| --- | --- |
| CLI 测试 | 507 / 553 通过 |
| Web 测试 | 39 / 45 通过 |
| Web typecheck | 4 个错误 |
| Analyzer 测试 | 152 通过 |
| Renderer 测试 | 9 通过 |
| Web production build | 通过 |

## 执行批次

### 0. 基线定位与最小回归面

**目的：** 固定失败样本、归因和验收入口，避免把既有在途改动或环境问题误判为本轮缺陷。

**影响文件：** `docs/plans/2026-07-30-post-feature-stabilization.md`，必要时只补充相应测试的明确预期；不修改功能实现。

**工作：**

1. 逐项定位 CLI 46 个失败、Web 6 个失败和 Web 4 个类型错误，标记为实现缺陷、测试夹具漂移、类型配置漂移或环境前提。
2. 为每个后续批次记录最小复现命令、涉及的文件和预期结果；不凭全量失败数字推测根因。
3. 保持当前工作树的其他修改原样，避免格式化或顺手清理造成归属混淆。

**只读基线：已完成。** 当前归因摘要为：CLI 失败集中在 canonical 路径身份、`lyrics --replace` 的 `offerFetch` 入口，以及 lease/atomic/lifecycle 测试夹具与运行时依赖耦合；Web 失败集中在命令契约测试，4 个 typecheck 错误来自测试文件进入生产 TypeScript 检查。Analyzer 152、Renderer 9 和 Web production build 已通过，仍需在对应批次以最小复现验证根因与修复边界。

**风险与回滚边界：** 这是只读归因批次。若失败依赖未确认的用户在途语义，停止该项并仅记录，不以“恢复绿灯”为由改写行为。

**验收命令：**

```bash
npm --prefix cli test
npm --prefix web test
npm --prefix web run typecheck
```

### 1. canonical 路径身份与 lyrics `--replace` 的 `offerFetch` 跳过

**目的：** 统一受控路径的 canonical 身份比较，并让 `lyrics --replace` 不误进入音频缺失的交互补料流程。

**影响文件：** 预计 `cli/lyrics.mjs`、`cli/tsuzuri.mjs`、`cli/web-api/assets.mjs`、`cli/web-api/assets.test.mjs` 与现有合适测试；仅在根因证实需要时触及 canonical 路径辅助函数或调用方。

**工作：**

1. 识别路径比较、锁/素材身份与 CLI 参数之间的 canonical 化边界，复用现有 sandbox/realpath 规则，不引入第二套路径规范。
2. 将 `lyrics --replace` 明确视为替换已有歌词产物的流程；它必须跳过 `offerFetch`，同时保留其他需要备料的 CLI 路径及其保守默认跳过语义。
3. 在现有合适测试中补充窄断言：同一真实路径的等价表示不产生不同身份；`--replace` 不提示或调用 `offerFetch`，非 replace 路径仍维持原契约。

**风险与回滚边界：** canonical 规则若扩散到未经审计的用户路径可能改变符号链接/不存在路径行为。仅修改已证明的比较点；若不能复用既有受控 canonical 化，回退该扩散并保留测试证据。

**验收命令：**

```bash
cd cli && node --test lyrics.test.mjs web-api/assets.test.mjs
```

### 2. lease/atomic 测试夹具迁移

**目的：** 让测试以真实、隔离且可证明的 task/atomic 输出身份运行，消除夹具与当前安全协议的漂移。

**影响文件：** 预计 `cli/task-lease.test.mjs`、`cli/atomic-output.test.mjs`、依赖 lease 或 atomic 输出的相邻测试；原则上不修改 `cli/task-lease.mjs`。

**工作：**

1. 迁移测试夹具，使假任务身份、任务根、manifest、claim 与真实协议一致，避免固定 PID 或伪造状态意外落入真实 registry。
2. 覆盖已有 lease 和 atomic 输出的关键承诺：受控 claim、冲突拒绝、成功提交、取消/失败不暴露 partial，以及无法证明身份时 fail-closed。
3. 只有当夹具无法表达已有契约且能给出可复现实现缺陷时，才最小修改运行时代码；此类偏差必须写入实施记录。

**风险与回滚边界：** 测试为绿而放松 owner/executor 或 atomic claim 检查属于不可接受回归。回滚仅限新的夹具、测试断言和已证实必要的最小实现补丁；不得简化 `task-lease.mjs` 的安全判定。

**验收命令：**

```bash
cd cli && node --test task-lease.test.mjs atomic-output.test.mjs
```

### 3. lifecycle/HTTP 依赖注入与测试迁移

**目的：** 使任务生命周期和 HTTP 测试可控、无环境泄漏，同时不破坏运行时关闭与清理的保守协议。

**影响文件：** 预计 `cli/web-api/jobs.test.mjs`、`cli/web-server.test.mjs`、`cli/web-api/*.test.mjs`；仅在可测性确有必要时最小修改 `cli/web-api/jobs.mjs`、`cli/web-server.mjs` 或明确的 HTTP 依赖边界。

**工作：**

1. 将时间、进程探测、临时根、spawn/HTTP 等外部依赖在测试边界注入或替换，避免测试依赖真实 PID、端口、文件树或本机生命周期状态。
2. 迁移现有测试以验证服务关闭、任务取消、SSE/HTTP 资源释放和错误映射，而非断言私有实现细节。
3. 保留 close/reap 顺序、executor identity 验证和无法证明时的 fail-closed 行为；任何测试便利不得绕过它们。

**风险与回滚边界：** 依赖注入可能意外改变生产默认值或泄漏测试钩子。生产路径必须保持显式默认实现，测试钩子不得从 HTTP 请求参数暴露；如无法维持该边界，停止并记录。

**验收命令：**

```bash
cd cli && node --test web-api/jobs.test.mjs web-server.test.mjs
```

### 4. Web 命令契约与 tsconfig 测试排除

**目的：** 对齐前端请求与后端命令参数契约，并让生产 TypeScript 检查只检查产品源码，不被 Node 测试文件的环境类型污染。

**影响文件：** `web/src/command.test.ts` 与 `web/tsconfig.json`；除非实现证据证明必须修改生产代码，否则不触及其他 Web 源文件。

**工作：**

1. 对照 `cli/job-argv.mjs` 与 Web API，修复已证实的命令字段、默认值或序列化漂移；不凭名称猜测重命名。
2. 将 Web 生产 typecheck 的 include/exclude 边界明确为产品源码；测试继续由其现有测试运行器执行，不通过删除测试或弱化类型规避错误。
3. 增加或修正窄契约测试，覆盖被修复的请求/命令映射与高风险默认值。

**风险与回滚边界：** 配置排除过宽会隐藏真实产品类型错误，命令字段改动会破坏 CLI/Web 兼容性。排除范围仅限测试入口及其专用环境文件；所有生产源码必须继续进入 typecheck。

**验收命令：**

```bash
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
```

### 5. 全量 QA 与计划记录

**目的：** 在每批针对性通过后，复验完整仓库质量门，并把实际结果和偏差写回本计划。

**影响文件：** `docs/plans/2026-07-30-post-feature-stabilization.md`；必要时仅限本轮已修改模块的测试文件。

**工作：**

1. 由独立 QA 执行全部测试、typecheck、build 与差异检查；失败返回对应批次修复，直到可归因项关闭或明确阻塞。
2. 区分已执行的静态/自动化检查与仍由用户负责的浏览器、真实媒体、网络、取消/重启和跨平台验收。
3. 追加实施记录与复审问题、根因、修复/未修复决定；不重写原计划。

**风险与回滚边界：** 全量绿不等于真实渲染或进程树 QA。若发现与本轮无关的既有失败，只记录证据和隔离范围，不能通过修改无关代码掩盖。

**验收命令：**

```bash
npm --prefix cli test
uv run --project analyzer pytest
npm --prefix renderer test
npm --prefix renderer run typecheck
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
git diff --check
```

### 6. Kami 架构图三件套与 README 检查

**目的：** 在功能和验证稳定后，按最终代码事实维护 README 架构图及其源资产。

**影响文件：** `docs/assets/architecture/prompt.md`、`docs/assets/architecture/index.html`、同名 PNG、`README.md`；必要时仅使用 Kami 的图表维护流程和现有导出脚本。

**工作：**

1. 先完成证据检查：依次读取现有 `prompt.md`、`index.html`、当前 PNG 和最终代码边界，确认组件、数据流、本地依赖与已实现成熟度。
2. 同步维护三件套：HTML 为源，prompt 描述与 HTML/PNG 一致；明确本地工作台边界、外部工具依赖和已实现能力，不绘制尚未实施的线上 SaaS 架构。
3. 每次 HTML 改动后重新导出 PNG；在 README 实际显示宽度及 100% 原图下检查裁切、字体、箭头、连线和留白。

**风险与回滚边界：** 图示可能错误暗示功能、边界或部署能力。事实无法确认时保留或删去该节点，不以推测补全；不得手工编辑 PNG，必须由维护的 HTML 重新导出。

**验收命令：**

```bash
git diff --check -- README.md docs/assets/architecture/prompt.md docs/assets/architecture/index.html docs/assets/architecture
# 使用项目现有的图像导出与浏览器检查路径，确认 PNG 已由 index.html 重新生成。
```

## 实施记录（完成后追加）

- [已完成] 批次 0：确认初始失败来自 canonical 路径身份、`lyrics --replace` 的 `offerFetch` 入口、lease/atomic/lifecycle 夹具与运行时 registry 耦合，以及 Web 命令测试和生产 tsconfig 边界漂移。
- [已完成] 批次 1：统一已审计调用点的 canonical 身份比较；`lyrics --replace` 跳过 `offerFetch`，非 replace 流程保持原有补料契约。
- [已完成] 批次 2：迁移 lease/atomic 夹具至真实 task/claim/manifest 协议，未放宽 owner、executor identity、claim 或 fail-closed 判定。
- [已完成] 批次 3：将 lifecycle/HTTP 测试改为隔离的 runtime/registry 夹具与依赖边界，保留 close/reap、终止和安全清理协议。
- [已完成] 批次 4：补齐 Web command 契约覆盖；`tsconfig` 仅排除 Node 测试入口，生产源码继续纳入 typecheck。
- [已完成] 批次 5：最终 QA 连续两次 CLI `556 / 556` 通过且无 ProjectBusy/IPC；Analyzer `152`、Renderer `9 + typecheck`、Web `45 + typecheck + build` 全部通过，且 `git diff --check` 通过。仓库无 lint 脚本。
- [已完成] 批次 6：README 架构图三件套（`prompt.md`、`index.html`、PNG）已同步，并完成源资产、导出 PNG 与 README 显示检查。

## 复审记录（完成后追加）

- 初始根因已在批次 0 收敛；P1/P2 级别的测试污染均通过 fixture/依赖注入与窄契约测试修复，而非放松生产协议。
- 安全协议未放宽：canonical 身份、lease/claim、executor identity、原子输出、close/reap 和无法证明时 fail-closed 均保留；测试不可再依赖真实 registry、PID 或 IPC 状态。
- 自动化回归证据：CLI 连续最终两次 `556 / 556` 且无 ProjectBusy/IPC；Analyzer `152`；Renderer `9` 与 typecheck；Web `45`、typecheck 与 production build；`git diff --check`；架构图三件套 QA 均为 PASS。
- 未解决风险与用户 QA：真实媒体、浏览器交互、网络/外部 provider、取消/重启进程树和跨平台行为仍须由用户验收；全绿自动化不替代这些运行时检查。
