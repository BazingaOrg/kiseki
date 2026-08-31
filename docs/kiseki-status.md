# kiseki 项目状态

kiseki 是本地工作台：读取照片、唯一音频和可选 LRC，分析并规划时间线，输出视频或静态 PNG。`fetch` 是可选在线备料；分析和渲染仍在本机完成。

主力入口是 CLI 与 `kiseki web`。`desktop/` 是实验性 macOS 壳，不承诺打包与跨平台。

## 本地工作台

`web [folder]` 启动素材、制作、成果三段工作台。素材可改名或删除；服务端按启动时根目录与 token 限制写入，并继续检查扫描身份、软链接、冲突和任务锁。删除先移入 `.kiseki-trash`，撤销仅在当前 server 进程中可用。

视频与 still 可从同一素材夹制作；无音频但有照片时仍可导出 still，只有 still 时也可进入成果。视频与 still 共用画布、字体、照片和配色；still 的 `--scale 1-4` 表示静态导出像素倍率，不是增强。

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
