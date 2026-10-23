# 胶片模拟验证记录

日期：2026-10-21。实现基线为 `bc1f777`，本次完善保存队列、跨工作流程的设置状态、预览日期与 seed、颗粒缓存和照片重命名。

## 自动检查

- `node --test cli/*.test.mjs cli/web-api/*.test.mjs`：774 通过，1 跳过，0 失败。
- `npm --prefix film test`：31 通过。
- `npm --prefix web test`：108 通过。
- `npm --prefix renderer test`：67 通过。
- `npm --prefix web run typecheck`、`npm --prefix renderer run typecheck`、`npm --prefix web run build`、`git diff --check`：通过。

新增回归覆盖：连续强度修改后等待保存、前一请求失败后继续保存、单张选择捕获、同步异常后的重试、Web/CLI seed 一致，以及照片重命名、写入失败回滚、租约失败恢复、设置冲突和不安全路径拒绝。

## 浏览器与渲染

使用临时素材副本和独立本地服务。Playwright 检查关闭后重开、收起参数后展开、单张覆盖与撤销、模拟 HTTP 500 后继续修改、切到素材再回制作保留胶片选择、滑块方向键调整后 Escape 关闭并保存，以及 1200×818 与 390×844 暗房布局。一次性相机的拍摄日期已在暗房大图和 PNG 中目检。故障注入产生一条预期的 HTTP 500 控制台错误。

实际执行静态导出：

```sh
node cli/kiseki.mjs still /tmp/kiseki-film-acceptance/a.jpg --film disposable --film-strength 1 --scale 1 -o /tmp/kiseki-film-results/disposable.png
```

输出为 1920×1080 PNG。使用两张照片、无音乐、6 秒临时时间线，分别执行默认日记、`--template filmstrip`、`--template polaroid`：

```sh
node cli/render.mjs /tmp/kiseki-film-results/timeline.json /tmp/kiseki-film-results/film-diary.mp4 /tmp/kiseki-film-acceptance --film disposable --film-strength 1
```

三份输出均由 ffprobe 确认为 H.264、1920×1080、30 fps、180 帧，视频流时长 6 秒，容器时长约 6.059 秒。已提取第 2 秒关键帧检查照片与日期戳。无声样例末尾日志提示响度归一失败并保留原始输出，没有阻止编码完成。

临时证据位于 `/tmp/kiseki-film-results/` 和 `/tmp/kiseki-film-acceptance/.playwright-cli/`，不作为长期归档。未修改原照片或既有服务。

## 复核

2026-10-22 继续核对时，基线仍为 `bc1f777`；此前的生产代码候选保持不变，`git diff --check` 通过。

## 边界

本轮没有重新拟合 RAW，也没有对全部 16 款风格做实拍色准验收、长片性能测量或桌面安装包验证。预览使用缩略图，成片使用原图缩放；视频采用动态颗粒，不承诺与静态 PNG 逐像素相同。

[经典铬汇总](../../film/validation/classic-chrome-summary.json)来自已有本地拟合报告：解码 284 对、使用 272 对、留出 64 对。指标依赖该工具的中性解码与色调归一化，不是任意 JPEG 的还原精度。本轮只核对并归档统计，没有重跑实验。


## 2026-10-22 主题与划线对比

本轮实现范围：`web/src/Darkroom.tsx`、`web/src/App.css` 的暗房区，以及新增 `web/src/FilmCompare.tsx`、`web/src/FilmCompare.css`。保存 API、胶片算法和渲染输出不变。

主题与组件分别委托执行；主模型完成集成与修正。独立 QA 对同一源码候选执行 `npm --prefix web test`（108 通过）、`npm --prefix web run typecheck`、`npm --prefix web run build`、`git diff --check`，均通过，四份源码前后摘要一致。独立代码复核代理因额度限制中断，未取得本轮最终代码复核结论。

Playwright 在临时素材副本上实际验证：

- 默认左右对比；拖动到 30%，交换后图像 URL 与标签同步互换、裁切位置保持。
- 对比分界线的方向键、Home、End；未触发胶片切换。
- 按住看原图、松开恢复，完整效果模式，新选胶片自动回到对比，原片禁用对比。
- 拖动／交换／切换查看模式期间，`POST /api/film` 请求数为 0。
- EXIF 与缩略图分别模拟 HTTP 503；不显示虚假的完成效果，重新预览后恢复。
- 延迟大图编码回调后连续选胶片，只展示最终选择；连续切照片后展示最后一张。
- 竖图实际展示宽高比约 0.8；390×844 无横向溢出，390×568 控件可滚动到达。
- 浅色背景 RGB(255,255,255)，深色 RGB(26,25,23)，减少动态效果时入场动画为 none。
- Chromium 触摸模拟拖动至 75%，第二触点不抢占拖动；pointercancel 后可再次拖动。

截图保存在临时目录 `/tmp/kiseki-film-results/compare-light.png`、`compare-mobile.png`、`compare-dark.png`。这是浏览器触摸模拟结果，不代表实体手机／Safari 已验收。故障注入产生的 HTTP 503 控制台错误属于预期结果。


### 加载提示闪现修复

加载文字延迟 250ms 出现，移到照片下方固定预留行，去除白色背景与描边。实际浏览器验证：缓存胶片快速互切没有出现加载文字；延迟编码时提示背景透明且位于图片之外；加载前后图片高度一致；编码失败信息和重新预览仍可用。Web 108 项测试、类型检查、构建和 diff 检查通过。


### 对比交互简化

对比改为图片下方与「按住看原图」同款、并排的开关按钮。中轴固定等分，移除拖动与独立交换入口；点击中轴中央按钮交换左右图像及标签。浏览器验证开关、两种模式下按住恢复、中央点击与 Enter／空格交换、拖动中轴不改变等分、查看操作没有保存请求，以及 390×844 双按钮等高同行且无横向溢出。Web 108 项测试、类型检查、构建与 diff 检查通过。


## 2026-10-23 三态查看与预览连续性

三态按钮循环、中轴同步、按钮固定宽度、换胶片／照片保留查看模式、按住恢复均经浏览器验证；查看操作没有保存请求。延迟编码时保留旧图及旧标签，完成后同时更新；失败保持已完成预览，切走后返回可恢复。独立 QA：Web 110 项测试、类型检查、构建、diff 检查通过。

退出测试先前在 React 更新可见状态前读值导致失败，等待实际退出状态后复验通过：底层 opacity 保持 1，退出中点击可重新打开并执行操作。减少动态效果检查以 transition-property: none 为准，较高优先级的 duration 值不表示实际仍有过渡。


### 缩略图边缘跟随

新增基于容器实际几何的跟随目标计算、可打断的 200ms 滚动、照片位置计数和两端渐隐。Web 112 项测试、类型检查、构建与 diff 检查通过。24 张临时照片的浏览器验证：桌面连续点击右侧可见照片可到第 24 张，再反向点回第 1 张；中间点击不移动，轮式手动滚动打断且不会被拉回，键盘切图保持可见，减少动态效果立即定位。390×844 下同样能连续点击到末张，没有横向页面溢出。


### 胶卷卡片排版与完整介绍

缩略图改为 88px 方形，正文垂直居中，厂商与灵感来源移到通栏，特殊提示独立通栏；移除图片上的品牌覆盖与简介两行省略。保留完整文案，来源允许自然换行。浏览器在 1280、390、320px 下检查全部 17 张卡片，无简介裁切和横向溢出；键盘选择正常且选中前后卡片高度一致。Web 112 项测试、类型检查、构建和 diff 检查通过。
