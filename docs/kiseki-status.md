# kiseki 项目状态

kiseki 是本地工作台：读取照片、可选的一首歌和可选 LRC。有歌时分析并规划时间线；没有歌时按每张照片 4 秒写成无声时间线，不运行音频分析。输出是视频或静态 PNG。`fetch` 是可选在线备料；音频分析与渲染仍在本机完成。用户显式开启图片旁白时，任务会在渲染前把缩小后的预览发给 DeepSeek，文案写入 `output/metadata/ai-captions.json`。DeepSeek API Key 在环境面板保存到被忽略的 `.env`，并立即进入当前进程；它不进入 `kiseki.toml`、页面回显或 Renderer。

给普通人的入口是安装包。`desktop/` 用系统窗口打开同一套网页，安装包里有 Node 和渲染器。FFmpeg 与分析组件在「准备这台电脑」里点下载，优先走国内镜像，存到本机应用数据，不写进安装包，也不装到系统里。本机已有 Chrome、Chromium 或 Edge 时，出片直接用它；否则第一次渲染仍会下载 Remotion 的浏览器，那个地址在国内可能连不上。识别模型优先走国内镜像。YouTube 和在线歌词站本身不在国内镜像里，连不上时提示网络原因，可以把歌或 `.lrc` 放进素材夹。macOS 与 Windows 在各自系统上执行 `npm --prefix desktop run build`，得到不同的安装包。开发时仍可双击 `启动.command` 或 `启动.bat`，CLI 仍可用。

## 本地工作台

`web [folder]` 启动素材、制作、成果三段工作台。素材可改名或删除；服务端按启动时根目录与 token 限制写入，并继续检查扫描身份、软链接、冲突和任务锁。删除先移入 `.kiseki-trash`，撤销仅在当前 server 进程中可用。

视频与 still 可从同一素材夹制作；无音频但有照片时可以渲染无声视频，也可以导出 still，只有 still 时也可进入成果。无声视频不需要 uv 或分析组件，仍需要 FFmpeg 和渲染器。制作页上签名在片尾文字前面，两个输出里用同一个名称。片尾白场默认是 `Thanks for watching :)`，留空则不显示；输入名字生成本次成片的片头签名。导出静态图时，同一个名字作为签名落款。这些只作用于这一次制作，不改写 `kiseki.toml` 或 `timeline.json`。名字里有汉字时用毛笔签名体，否则用拉丁签名体。视频与 still 共用画布、字体、照片和配色；still 的 `--scale 1-4` 表示静态导出像素倍率，不是增强。

默认在手写签名片头后加入自适应序章闪回：不少于 8 张照片且正文时长足够时，从节拍窗口内倒序回看到第一张，再在拍点进入正文；图片密度过高时使用分组联系印，避免把单张压缩到不可辨认的帧数。默认展陈、新闻快切、胶片带与拍立得 composition 分别沿用自身照片容器；`opening_recap = false` 可关闭。

服务内同一时间只允许一个 job，第二个创建请求返回 409。任务创建或运行时禁用换素材夹，但可在三段间切换而不丢进度、错误或取消入口。刷新同一 server、同一素材夹时会重新挂接当前 job 并回放事件；这不是 server 重启后的恢复。

歌词优先读取 LRC，否则本地 Whisper 识别。多音频或多歌词会显示歧义；在线歌词候选先选中，再明确确认保存，确认前不写入素材。

## 数据与缓存

默认视频写入 `output/<folder>.mp4`，still 写入 `output/stills/`；显式 `-o` 优先。分析、timeline 与偏好位于 `output/metadata/`，旧 `metadata/` 首次运行时会复制保留。时间线的读取边界见 [timeline schema](specs/timeline-schema.md)。

分析缓存为 v2：音频和 LRC 内容仍参与摘要，运行时指纹只包含实际执行路径所需的 LRC、Whisper 与 demucs 信息；v1 manifest 自然 miss 后重建，不兼容读取。缩略图使用强 ETag 与 `private, no-cache`，相同资源可返回 304；原地替换后身份改变会重新生成。

Web doctor 异步检查外部依赖，成功结果短暂缓存并合并同时请求；CLI doctor 保持同步语义。`doctor` 只报告环境状态，不替代真实媒体或浏览器验收。

## 约束与待验证

- 支持 JPG、JPEG、PNG、WebP 和常见音频格式；视频素材暂不支持。
- 照片全有 EXIF 时间时按拍摄时间排序，否则按文件名排序。
- 缺少 `web/dist` 时 `kiseki web` 直接失败。
- Linux、Windows 与更多真实歌曲/照片组合仍需验证；浏览器真实媒体播放与成片视觉质量由人工验收。
- 配置为严格的 22 键契约，见 [config.md](config.md)；非法或未知配置不会静默回退。

## 本轮最终验证

2026-08-31，基线 HEAD 为 `c2ffca9`，序章闪回改动验证：CLI `631/631`、Analyzer `169/169`、Renderer `34/34` 加 typecheck 均通过；用 12 张照片与真实 30 秒音频完成 301 帧 Diary 开场编码，并逐帧核对 Diary、Filmstrip、PolaroidWall 在闪回到正文边界没有空帧、重复淡入或二次旋转；默认 Diary、Filmstrip、PolaroidWall 的交界关键帧 SSIM 均为 `1.000`，slow-cinema 在交界后只发生预期的 Ken Burns 运镜且没有亮度下坠；50 张照片的分组联系印关键帧也已渲染目检。Web 未改动，本轮未重复运行 Web 测试、typecheck 或 build；更多真实歌曲、照片与完整成片的主观节奏仍需人工验收。

历史方案中“只读画廊”和 `Cache-Control: private, max-age=86400` 是当时审计/性能基线的保留文字，不代表当前工作台或缩略图实现；当前行为以上文的本地工作台与 `private, no-cache`、ETag/304 说明为准。
