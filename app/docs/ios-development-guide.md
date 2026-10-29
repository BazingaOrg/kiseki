# Kiseki iPhone App 开发说明

基线：2026-10-19，本地 `main` 的 `4cb6866`。目标设备是 iPhone 13 mini；用户自用、无付费 Apple Developer Program 账号。本文是开发目标与验收契约；当前原生实现和已执行的检查以 [实现状态](implementation-status.md) 为准，不能由计划推断已通过真机验证。

## 1. 产品目标与边界

从系统图库选照片，在 iPhone 本机保存草稿、排故事、加声音、预览、导出视频或静态图，再保存到照片或分享。使用 App 不需要 Mac 运行 Kiseki 服务，也不需要选择素材文件夹。

首个完整版本以 1080p、30 fps、默认日记呈现方式为出片目标。首先在 13 mini 上验证 15–40 张照片、约 1–2 分钟作品的真实性能；这些是测试场景，不是已确认的容量上限。60 fps、4K、后台持续出片、离线歌词识别、其他模板和在线音频获取各有独立验收门槛。

交付分为 M0（Step 0–1：真机可行性）、M1（Step 2–4 和 Step 7 的基础成果／备份：可日用的默认模板、本地音频与手动歌词校对）、M2（Step 5–6 的其他模板、在线旁白、自动节拍与识别等增强）。Step 8 对每个交付里程碑执行。功能盘点是目标全集，不能把原型中可点击的所有入口都视为 M1 承诺。M1 不出现尚未实现的在线搜歌或识别按钮。

本机 App 使用 SwiftUI、PhotosUI、AVFoundation、Core Image／Metal 等 iOS 能力。当前桌面的 Node 服务、Python／Whisper 管线、Remotion／Chromium 与 FFmpeg 不直接进入 iOS 安装包。VPN 可以改善在线服务访问，不会改变运行时兼容性。

## 2. 先修正现有设计与架构的两处假设

1. **拖动顺序必须成为出片顺序。** 当前 Web 照片排序只影响浏览视图；`analyzer/plan.py` 在全部有 EXIF 时按拍摄时间，否则按文件名规划。iOS 作品清单必须存储显式、有序的照片 ID；重新排布后，预览和渲染都消费同一个顺序。首次选择可用系统选择顺序，用户之后可拖动或重置为拍摄时间顺序。
2. **原型不是 iOS 控件实现。** [原型](prototype.html)用于核对页面、文案、状态和跳转。真机使用系统照片选择器、导航、分享和文件选择器；安全区域、动态字体、VoiceOver、键盘与深浅色都要在 SwiftUI 中验证。编辑页只固定底部四个入口；预览页的制作按钮在滚动内容里。较大字体时，所有内容与按钮仍必须能滚动到达。

## 3. 当前能力盘点与 iPhone 呈现

| 现有能力 | iPhone 位置 | 首版处理 |
| --- | --- | --- |
| 多照片、按时间浏览、EXIF | 图库选择 → 照片页 → 单张详情 | 选中素材复制进作品；明确手动出片顺序；可查看日期与可用 EXIF |
| 照片视频与静态 PNG | 预览的“视频／静态图”切换；照片详情快捷导出 | 两者均保留；分别记录成果版本 |
| 无声作品 | 声音页“无声影像” | 首个渲染闭环，无需分析组件 |
| 本地音频与歌词 | 声音页、歌词校对页 | 文件导入、试听、LRC、原文／双语／隐藏 |
| 在线歌词 | 声音 → 找歌词 | 候选来源、时长差、译文覆盖、预览和偏移校对后确认 |
| 本地歌词识别 | 声音 → 本机识别；设置 → 模型 | 后续独立功能；模型按需下载、可删除 |
| 在线搜歌 | 声音 → 在线搜歌 | 原型入口保留；来源、授权和 iOS 获取方式验证后才能实现 |
| 单张与批量图片旁白 | 照片详情、照片页“图片旁白” | 手写、线索、生成、重写、删除、补齐缺失、清空全部；发送缩小预览前明确确认 |
| 统一画面 | 画面 → 画幅、旁白与停留时间 | 原图色彩、日记留白排版与轻柔淡入 |
| 签名、片尾、EXIF 展签、暗色、日期卡、开场快放 | 画面 → 文字与展签／节奏与片头 | 保留设置模型，按视觉实现进度开放；不可显示无效开关 |
| 多版本成果、静态图集、重命名与删除 | 成果页 | 删除一个输出不删除原素材或草稿；提供保存到照片与系统分享 |
| `kiseki.toml`、doctor、下载 uv／FFmpeg、CLI 命令提示 | 不进入普通手机流程 | 用作品设置、存储和模型管理代替；不暴露桌面依赖管理 |

桌面 Web 的制作页目前只开放横／竖版，并将模板、草稿质量、自动裁剪等选项收为固定值；CLI 的能力范围更大。iOS 不应把 CLI 参数直接堆到手机页面，也不应在对应渲染能力未验证前显示方形、其他模板或自动裁剪为可用功能。

## 4. 信息架构与交互契约

```
我的作品 ── 新建 ── 系统图库选择 ── 导入进度 ── 作品编辑
   │                                      ├─ 照片：排序／详情／旁白／静态导出
   ├─ 继续草稿 ───────────────────────────┤─ 声音：无声／本地音频／歌词校对
   │                                      ├─ 画面：画幅／模板／色彩／文字
   ├─ 已完成作品 ── 视频版本／静态图集        └─ 预览：视频／静态图 → 制作
   └─ 设置 ── API Key／模型／存储与备份
```

- 四个编辑入口可直接切换；音乐、歌词和 AI 旁白均可跳过。自动保存草稿，返回首页后显示“继续写”，重新进入时回到上次编辑页。
- 照片从作品中移除，不调用系统图库的删除。重排支持长按跟手移动、边缘自动滚动和落点反馈；为 VoiceOver 提供“移到前面／后面”动作。
- 歌词候选在预览、时长与译文检查之后确认；不因为点中候选就写进作品。置信度不足或时长明显不符要提醒，可手动更换。
- 单张旁白保存与 AI 重写分开。重写已由用户编辑的句子前确认。批量生成仅补缺，不覆盖已有句子。
- 制作前给出照片数、时长、画幅、声音、预计输出空间和缺失项。音乐过短放不下全部照片时提供具体调整路径，不静默丢弃。
- 渲染任务只允许一个。取消、失败或系统中断后保留草稿并删除半成品；完成后把新版本加到作品下，不覆盖旧版本。
- 运行任务时可以查看其他编辑页；首版锁定该作品的素材和设置修改，明确显示“制作中”。渲染快照持有素材引用，清理操作不能删除正在使用的文件。之后若允许边导出边改，须用独立 revision 和素材引用计数实现。
- 导出到系统照片时只在用户触发保存时申请所需权限。分享使用系统分享界面。

### 视觉规则

以照片为主角：暖纸色 `#FFFDF8`、墨色 `#243742`、主操作色 `#31566A`、细线 `#D8D7CF`；暗色下使用对应的深背景与浅蓝强调。正文、控件采用系统字体，编辑性标题采用衬线风格，并测试中日英文混排与缺字回退。使用 4／8／12／16／24 点的间距阶梯；按钮约 12 点圆角、卡片约 14 点、底部弹层约 22 点。SwiftUI 用 Dynamic Type 的语义字体样式，不能把原型里的像素值当成固定字号。

按钮应即时响应；普通页面轻微淡入，弹层沿进入路径退出；照片拖动应跟随手指且随时可反向。只在手势带动的交互中使用轻微回弹。尊重“减少动态效果”和增加对比度设置；减少动态效果时换成短淡入或直接切换。原型里的时长只是设计起点，真机手感以实际测试确定。

## 5. 原生工程与数据边界

在 `app/` 下创建独立 SwiftUI Xcode 工程，建议结构：

```text
app/
  Kiseki.xcodeproj/
  Kiseki/
    App/                 启动、导航、依赖组装
    Domain/              Project、Photo、RenderPlan、OutputVersion
    Persistence/         作品清单、原子保存、版本迁移、备份
    Import/              PhotosPicker 与文件导入、缩略图
    Planning/            照片顺序、时长、节拍、字幕、日期卡
    Rendering/           逐帧绘制、静态图、视频、音频封装
    Readiness/           按操作预检、能力状态、补救动作
    Services/            在线歌词、可选旁白、模型管理
    UI/                  作品、编辑、预览、制作、成果、设置
  KisekiTests/
  docs/
```

`ProjectManifest v1` 存在 `Documents/projects/<UUID>/manifest.json`，至少保存作品 ID／标题、照片稳定 ID 与**显式顺序**、导入副本路径与来源标识、拍摄日期、手写旁白及编辑标记、音频与歌词、画面设置、上次编辑页、输出版本。所有更改原子写入。导出前生成不可变 `RenderPlan` 快照，统一供预览、静态图和视频消费；它可与桌面 `timeline.json` 做字段映射和黄金样例对照，但不要把桌面文件路径与 Python 配置直接当 iOS 数据模型。

首版用 Codable 清单和单一 `ProjectStore` actor 串行写入，无需同时引入 SwiftData 或另一套数据库。清单含 `schemaVersion`、递增 revision；路径全部相对作品目录，导入先写临时副本、校验后加入清单。未知的新版本清单拒绝改写。照片身份与顺序分离：重排不重做 AI，替换图片使相关旁白／缩略图失效。音频、歌词、设置或 planner 版本变化按依赖失效分析和预览；网络回包必须比对提交时 revision，不能覆盖用户之后的修改。

原始导入副本和成果放 `Documents`；可重建缩略图与分析缓存放 `Caches`；进行中的输出放临时目录，成功后原子提交到成果目录。需要用系统文件表示加载选中的照片，按需解码到输出尺寸，避免一次展开全部原图。iCloud 原件未在本地时显示下载进度与失败恢复。若用户删除系统图库中的原件，已经导入作品的副本仍应可出片。API Key 仅存 Keychain，不写清单、日志或备份包。

首版用 Core Image／Metal 或等效原生绘制管线按 `RenderPlan` 生成像素缓冲，交给 AVAssetWriter 编码 H.264／AAC 的 MP4；静态图从同一帧绘制规则导出 PNG。优先复用像素缓冲池、限制同时解码的照片数。字体布局、签名、字幕和转场需要与桌面固定样例逐帧核对，允许记录平台字体差异，不把“可以播放”当视觉验收。

先建立 `FrameRenderer(plan, frameIndex, outputSize)`：Core Graphics／Core Text 缓存文字与签名图层，ImageIO 按目标尺寸解码照片，Core Graphics 绘制照片与文字；只有测得瓶颈再加入自定义 Metal shader。不得逐帧截图 SwiftUI 界面。首版色彩统一为 SDR、明确的色彩空间与方向变换；HEIC／P3／HDR 输入要做正确转换，Live Photo 先只取静态图，视频素材不导入。第一轮只打包默认样式需要且许可已核对的字体，避免复制整个桌面字体目录。

视频时间用整数帧索引和 CMTime 生成，字幕使用明确的半开区间；不能按 UI 定时器推进导出。先产出无声视频，再用 AVFoundation 合并导入的音频，纳入中间文件空间预算；可优化为同一 writer 写音视频，但不得忽略音频解码、采样率、结束点和 AAC 编码。预览按同一 plan 和 frame renderer 降分辨率绘制，可跳帧；PNG 与有损 MP4 以几何、时刻和容差对照，不要求字节一致。

持久化任务的 job ID、作品 revision、输出路径和阶段。系统杀进程未必执行清理回调：下次启动将遗留 running 标为 interrupted，核对并清理未提交文件，展示“上次制作中断，可重新制作”。不要承诺从中间视频帧续跑。成果写入与清单登记须可恢复，防止“文件完成但清单未写”留下不可见文件。备份包要排除密钥、缓存、临时文件与可重下模型；导入时校验清单版本、文件摘要、解压总量和路径，不允许越过作品目录。

运行前能力检查的接口、环境检查清单与 App 呈现见 [环境与能力检查设计](environment-readiness.md)。它是开发任务的一部分，不是发布前才补的诊断页。

## 6. 按步骤开发与验收

### Step 0 — 开发环境与基线

- 在 Xcode 中完成首次启动和协议确认，登录普通 Apple Account；确定 13 mini 的 iOS 版本与剩余空间。
- 本机已发现 `/Applications/Xcode.app` 和 iPhoneOS／iPhoneSimulator 平台，`xcodebuild -version` 使用该目录显示 **Xcode 27.1**。用户已确认 Xcode 协议；SDK 27.1、iOS 26.5 模拟器 runtime 与专用 iPhone 13 mini 模拟器已可使用。命令行默认仍指向 `/Library/Developer/CommandLineTools`，下列命令用临时变量指定 Xcode。用户已安排后续自行进行 iOS 27.2 真机验收。

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl list devices available
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl list runtimes
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -showsdks
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl list devices
```

- 冻结一组桌面样例：无声、带音乐与 LRC、双语、跨日期、竖版、静态图，以及相应的时间线和关键帧。记录样例输入与期望结果，不把旧浏览器画面误当 iOS 实测。
- **通过条件：** Xcode 首次启动完成、目标 SDK／可启动的模拟器 runtime 已确认；样例输入可重复使用；13 mini 的系统版本、容量与配对状态已记录。建立和运行工程由 Step 1 完成。模拟器 runtime 与 SDK 是不同检查项，目录存在不代表能启动。

### Step 1 — 真机渲染可行性样机（先于完整 UI）

- 在 Xcode 用 **File → New → Project → iOS App** 建立 `Kiseki`，界面选 SwiftUI、语言选 Swift。保存后核对工程必须是 `app/Kiseki.xcodeproj`、源码是 `app/Kiseki/`；向导若额外包一层同名目录，调整到该结构后再使用下列命令。共享 scheme，添加测试 target。设置自己的 Personal Team 与唯一且长期保持不变的 Bundle ID；不要在此时加入第三方渲染包。把 Xcode 用户状态与 DerivedData 排除在版本控制之外。
- 先在可用模拟器启动空界面，再选择 13 mini 真机运行；如果设备提示 Developer Mode 或信任电脑，按系统提示完成。工程建立后可用以下命令确认 scheme 和目标设备，具体设备 ID 以本机输出为准：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -list -project app/Kiseki.xcodeproj
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -showdestinations -project app/Kiseki.xcodeproj -scheme Kiseki
```

- 先用 3 张照片导出一张 PNG 和 10 秒无声 MP4：读照片 → 绘制一帧 → 输出 H.264 → 系统播放器打开。接着做 30 张、90 秒、1080p／30 fps，记录总耗时、峰值内存、温度与临时／最终空间。
- 确认取消、低空间、锁屏、切到后台和进程终止时的结果；首版承诺前台完成，后台持续出片另作验证。
- 同时实现最小的导出预检：当前请求的编码配置、素材可解码、空间和独占任务；检查结果走统一能力接口。调试时用 Instruments 记录峰值内存与系统 thermalState，不把 thermalState 当温度摄氏值。
- **通过条件：** 13 mini 真机连续两次导出可播放文件；帧数／时长正确；无崩溃与遗留半成品；指标被记录。模拟器成功不能替代此关。

### Step 2 — 作品、图库与草稿

- `PhotosPicker` 多选并保留选择顺序；将可供日后离线出片的素材导入应用容器，同时制作小缩略图。处理 HEIC、JPEG、PNG、方向、拍摄日期、iCloud 下载失败和重复选择。
- 实现清单版本、原子保存、首页草稿、重进恢复、从作品移除与存储统计。原型四个编辑入口先用真实草稿数据连接。
- PhotosPicker 的临时文件 URL 必须在有效期内复制；文件导入在安全作用域有效时复制并释放访问。只有持久副本就绪才标记“已导入”，取消下载或部分失败不得生成可用的空资产记录。
- **通过条件：** 强制退出重开后，排序、旁白和选项不丢；删除图库原件后已有作品仍可出片；移除作品照片不影响系统图库。

### Step 3 — 默认无声日记与静态图

- 实现照片明确顺序、每张默认停留、默认转场、横／竖版、片尾和基础预览。静态 PNG 与 MP4 必须共用画面几何和字体规则。
- 预览页只固定编辑入口；制作按钮随内容滚动。较大字体和键盘出现时，操作仍可到达。
- **通过条件：** 静态图与视频关键帧的版式、色彩和时间语义在记录的容差内一致；照片拖动后预览／成片顺序一致；失败或取消后可重新制作。

### Step 4 — 音乐、节拍与歌词

- 先完成“文件”导入音频、试听、时长检查和音视频封装；M1 使用明确标注的均匀节奏，首版照片时长与选中音乐长度由 plan 统一决定。当前 Python `analyze.py` 的 BPM、onset、低频特征、能量与 downbeat 依赖 librosa，AVFoundation 不自动提供这些分析。M2 再选定原生 DSP 实现或经评估的库，以同一音频黄金样例验证；不可只换 API 名称就宣称保留自动踩点效果。受保护或不能解码的音频明确拒绝并允许换歌。
- 支持 LRC 导入、原文／双语／隐藏；再做 LRCLIB／AMLL 候选、预览、时长差提示和手动偏移。当前 `cli/web-api/lyrics-validation.mjs` 用识别文本锚点推断偏移；M1 尚无本机识别时，仅提供时长提示与试听手动校对，不标记“自动校对通过”。自动校对在识别能力完成后独立接入。在线不可用时保留本地音频与无歌词制作路径。
- **通过条件：** 音画时长、切换点、字幕时间和取消恢复通过固定样例；错误候选不会被单次误点写入作品。

### Step 5 — 视觉能力逐项移植

- 统一原图色彩与日记排版；签名与片尾、EXIF 展签、暗色、日期卡、开场快放作为默认关闭的附加效果。每项核对成片关键帧，而不是只检查参数存在。
- 若某项在 13 mini 上明显增加包体、发热或内存，保留默认路径并记录单独优化方案；界面不要提前露出无效开关。
- **通过条件：** 每个开放选项有真实 iPhone 输出及人工视觉核对；深浅色界面与画面成片分别验收。

### Step 6 — AI 旁白与可选模型

- 手写旁白随 Step 2–3 完成，本步接入在线生成。在线生成须先展示“缩小预览将发送到服务商”，保留用户改过的内容；Keychain 管理密钥，取消、超时与失败可重试且不会写入半成品。模型名称、API 兼容性和缩图规则在接入时复核，不读取仓库 `.env` 作为 App 默认密钥。
- 本机歌词识别模型在实际选型、内存和空间测量后再开放按需下载／删除。模型是数据文件；不设计在手机上下载可执行的桌面依赖。在线搜歌需确认可持续的来源与获取规则后独立实施。
- **通过条件：** 没有 Key 和网络仍可无声／本地音乐出片；密钥不进日志、清单或备份；模型可删除且不破坏作品。

### Step 7 — 成果、备份与日常使用

- 作品下保留多个视频和静态版本，支持播放、保存到照片、分享、重命名与单独删除。提供草稿和素材的可验证导出／导入备份，供免费签名周期性重装前保存。
- 设置中显示 App、作品、模型与可清理缓存的实际空间；出片前按当前素材和输出估算空间，查询系统对用户主动操作可用的容量。预算以真机测量修正，不先宣称固定安装包大小。
- **通过条件：** 备份导入后照片顺序、旁白、音乐、歌词和设置一致；删除输出不删除草稿；手机空间不足时不会留下损坏成果。

### Step 8 — 签名、回归和验收

- 真机签名和首装在 Step 1 完成，本步验证日常重新部署：免费配置到期后用同一 Team／Bundle ID 重新构建安装，不要求先卸载；卸载会删除本地应用容器，操作前备份。普通 Personal Team 目前采用 7 天配置，App 内不能可靠代替 Xcode 管理签名或保证倒计时准确。App Store／TestFlight 发布不在本阶段范围。
- 运行单元测试、模拟器 UI 检查与 13 mini 真机组合测试：无声、音乐、跨日期、中文签名、长歌词、HEIC／iCloud、低空间、取消、深浅色、较大字体、VoiceOver。记录包体、首次启动、渲染时间、峰值内存、耗电／发热和作品占用。
- 执行 [环境与能力检查验收案例](environment-readiness.md)：用可注入的检查提供者覆盖 unknown、权限拒绝、模型损坏、网络 API 错误、空间变化和任务冲突；设备上验证对应实际失败。纯函数检查测试不能代替真实编码、权限和资源行为。
- **通过条件：** 真实设备从图库选择到保存成片闭环通过；文档中未通过或尚未实施的能力保持明确状态。

## 7. 尚待决定的事项

- 用户说明 13 mini 使用 iOS 27.2，容量和可用空间尚未核对。工程当前 deployment target 为 iOS 17；真机安装、签名和性能由用户后续验收。
- 在线搜歌的 iOS 数据来源、下载方式及使用约束尚未验证。不能把桌面 `yt-dlp` 流程视为 iOS 已有能力。
- Whisper 的 iOS 模型／推理方案、包体和发热尚未测试。首次版本不以它为前置条件。
- 1080p／30 fps 是首轮目标，是否开放 60 fps、方形高画质和较长作品由 Step 1 的真机数据决定。
- 原型中的照片和歌曲是示例内容；视觉稿不能代替系统选择器外观、真实照片颜色及 iOS 27 真机交互验收。

## 8. 参考

- 本仓库：[当前状态](../../docs/kiseki-status.md)、[时间线契约](../../docs/specs/timeline-schema.md)、[配置](../../docs/config.md)、[原型](prototype.html)。
- Apple：[Personal Team 与 7 天配置](https://developer.apple.com/help/account/basics/about-your-developer-account)、[PhotosPicker](https://developer.apple.com/documentation/photosui/photospicker)、[有序选片](https://developer.apple.com/documentation/photosui/photospickerselectionbehavior/ordered)、[AVAssetWriter](https://developer.apple.com/documentation/avfoundation/avassetwriter)、[Keychain](https://developer.apple.com/documentation/Security/using-the-keychain-to-manage-user-secrets)、[可用容量检查](https://developer.apple.com/documentation/foundation/checking-volume-storage-capacity)、[后台长任务](https://developer.apple.com/documentation/BackgroundTasks/performing-long-running-tasks-on-ios-and-ipados)。
