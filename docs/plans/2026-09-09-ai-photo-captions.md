# AI 图片旁白生成与渲染集成方案

日期：2026-09-09
状态：待实施
基线：`8d8e12e`（`main == origin/main`，工作区干净）

## 1. 结论

Kiseki 当前正式的主力入口是 CLI 与 `kiseki web`。仓库仍保留 `desktop/`，并且实验性 macOS 壳仍复用 Web 工作台、CLI service、任务租约与本地 runtime；但现行项目状态明确不承诺 Desktop 打包和跨平台支持。本功能的正式实现与验收范围是 Web + CLI，不新增 Desktop 专属设置或发布承诺。共享 Web/CLI 代码在 Desktop 壳中可自然复用，但只能作为回归冒烟项。

图片旁白应作为渲染前的可选准备阶段：

```text
视频：素材校验 → 音频/歌词分析 → 时间线规划 → 可选图片旁白 → 视频渲染 → 响度处理
静态图：素材校验 → 导出任务规划 → 可选图片旁白 → 静态图渲染
```

用户未开启时完全走现有链路，不读取密钥、不生成缩略图、不请求网络。用户开启后，先完成本次需要的全部图片文案并通过本地校验，再启动 Remotion；部分失败时不生成文案残缺的成片，已成功结果保留在缓存中，重试只补失败或失效项。

本方案不把网络请求放进 Python analyzer 或 Remotion renderer，不让 Web 浏览器直接持有 API Key，也不改写 `timeline.json`。在线能力止于独立的旁白准备服务，分析、时间规划和最终渲染仍在本地完成。

## 2. 产品范围

### 2.1 本期包含

- CLI 视频命令和 `still` 命令均支持显式开启图片旁白。
- Web 制作页的视频与静态图流程均支持同一选项。
- 使用 `deepseek-v4-flash-vision-exp` 分析图片。
- 第一版原样采用本文第 5 节的 system prompt 与 user prompt，不擅自改写文风要求。
- 原图不直接上传；AI 专用缩略图必须成功生成 640px JPEG 后才能请求，生成失败禁止回退上传源图。
- 文案逐图缓存，照片、模型或 prompt 变化时精确失效。
- 视频、still、EXIF、签名、歌词、滤镜、暗色、横版、竖版、方形及现有模板共同工作。
- 默认输出名增加稳定的旁白变体后缀，避免覆盖无旁白产物；显式 `-o` 继续原样优先。
- 任务进度、取消、失败、重试和暖缓存路径在 CLI 与 Web 中一致。

### 2.2 本期不包含

- 不提供文案编辑器、批量人工审核或多版本候选。
- 不引入第二家模型供应商，也不预建通用 provider 注册中心。
- 不把 API Key 写入项目、timeline、日志或缓存。
- 不把 Desktop 作为正式发布面，不新增 Desktop 设置窗口或系统密钥链 UI。
- 不因加入 AI 而重写 analyzer、timeline 规划算法或现有任务运行时。
- 不默认开启在线图片分析。

## 3. 用户流程与产品文案

制作页沿用当前克制、直接、不过度技术化的表达。图片旁白在现有视觉开关之后独占一行，辅助说明明确这是在线能力：

```text
图片旁白
为照片补上一句画外之意。会发送低清预览，全部生成后再开始制作。
```

首次发现 `DEEPSEEK_API_KEY` 未配置时，在任务启动前给出可执行提示：

```text
图片旁白尚未配置
设置 DEEPSEEK_API_KEY 后重新打开工作台，或关闭图片旁白继续制作。
```

不使用“智能赋能”“AI 魔法”“一键大片”等与项目气质不符的营销措辞。界面可在辅助信息中说明由 AI 生成，但主标签保持“图片旁白”。

开启后的进度示例：

```text
✓ 分析音频
✓ 规划照片时间线
● 准备图片旁白 18 / 26
  └ 复用 12 条，新生成 6 条
○ 渲染视频
○ 完成
```

静态图示例：

```text
✓ 规划 12 张静态图
● 准备图片旁白 9 / 12
○ 导出静态图
```

任务语义：

- 缓存命中也计入完成数量，但单独报告复用数量。
- 所有必需文案准备完成后自动进入渲染，不要求用户再次点击。
- 429、5xx 或超时可有限重试；最终仍失败时，任务在渲染前失败。
- 失败信息说明成功结果已保存，并提供两个正式 CTA：“重试图片旁白”沿用原 options 再起同类 job；“不加旁白，继续制作”将 `photoCaption` 改为 false 后立即再起同类 job。JobPanel 需要支持可注入的失败动作，不能只改按钮文字或依赖现有单一 reset。
- 取消任务时停止未完成请求，不删除已经原子落盘的有效文案。
- `still --skip-existing` 应先排除不会渲染的已有产物，避免为它们产生无用 API 请求。

## 4. 架构设计

### 4.1 依赖方向

```text
Web options / CLI argv
          │
          ▼
    Kiseki task runtime
          │
          ├── analyzer + plan ──→ timeline.json
          │
          ├── photo caption service
          │      ├── thumbnail materializer
          │      ├── DeepSeek HTTP client
          │      ├── output validator
          │      └── ai-captions.json
          │
          └── render input assembly
                    │
                    ▼
             Remotion renderer
                    │
                    ▼
                MP4 / PNG
```

依赖只能朝下：Renderer 消费已经准备好的字符串，不认识 DeepSeek、HTTP、API Key、重试或缓存；DeepSeek client 不认识 Web、timeline 和 Remotion；任务编排层负责把这些能力按顺序组合。

### 4.2 适度解耦

新增目录控制在四个单一职责模块，另加一个通用原子 JSON 助手，不建立 provider 框架或抽象基类：

```text
cli/ai/
├── photo-caption-prompt.mjs
├── deepseek-vision-client.mjs
├── photo-caption-service.mjs
└── photo-caption-fit.mjs

cli/atomic-json.mjs
```

- `photo-caption-prompt.mjs`：唯一 prompt 来源、prompt 版本/hash、响应规范化与规则校验。
- `deepseek-vision-client.mjs`：只负责请求结构、超时、HTTP 错误和响应解析。
- `photo-caption-service.mjs`：照片身份、缩略图、缓存、并发、有限重试、原子写入和进度。
- `photo-caption-fit.mjs`：渲染驱动侧加载字体后测量文案，在开始媒体帧输出前取得排版结果与跳过统计。所有几何和 fit 规则使用共享纯模块 `renderer/src/photoCaptionLayout.mjs`，Node 与 React 导入同一实现，配套类型声明；不维护两套估算公式。
- `atomic-json.mjs`：Node 侧同目录临时文件、`fsync`、rename/rollback 的小型 JSON 原子写入助手；不依赖 Python `atomic_json.py`，也不使用 `writeFileSync(finalPath)` 截断现有缓存。

服务通过函数参数注入 `generateCaption`、缩略图生成器、时钟和文件操作，测试不访问真实网络。只有未来实际接入第二个供应商时，才提取 provider 接口；第一版不增加 factory、registry 或抽象基类。

Renderer 新增共享呈现模块：

```text
renderer/src/PhotoCaption.tsx
renderer/src/photoCaptionLayout.mjs
renderer/src/photoCaptionLayout.d.mts
renderer/src/compositionTiming.ts
```

三种视频 composition 和 Still 共用文本度量、字号回退、颜色、淡入淡出与安全间距。布局差异由纯布局函数返回，不在 Diary、Filmstrip、PolaroidWall 和 Still 中复制四套判断。

### 4.3 数据边界

生成结果写入：

```text
output/metadata/ai-captions.json
```

建议结构：

```json
{
  "version": 1,
  "model": "deepseek-v4-flash-vision-exp",
  "prompt_hash": "...",
  "items": {
    "photos/001.jpg": {
      "source_identity": {
        "relative_path": "photos/001.jpg",
        "dev": "...",
        "ino": "...",
        "size": 123456,
        "mtime_ns": "...",
        "ctime_ns": "...",
        "preview_width": 640
      },
      "preview_sha256": "...",
      "text": "坐得端正，也不耽误心里走神",
      "usage": {
        "input_tokens": 0,
        "output_tokens": 0
      }
    }
  }
}
```

规则：

- 缓存只保存最终通过校验的文案，不保存 API Key、base64 图片或完整响应体。
- 视频 timeline 的 `./001.jpg`、`./photos/001.jpg` 与 Still 的绝对路径必须先走同一个 `normalizePhotoKey(projectRoot, source)`：解析并验证仍在项目根内，再取 project-relative 路径、转换为 `/` 分隔符并去掉开头 `./`。缓存中只允许 `001.jpg`、`photos/001.jpg` 这类规范 key，禁止 basename-only 映射。
- `model + prompt_hash + source identity + preview_sha256` 共同绑定结果。source identity 的规范序列固定为 `[relativePath, dev, ino, size, mtimeNs|mtimeMs, ctimeNs|ctimeMs, 640].join('\0')`，平台缺少纳秒字段时明确回退毫秒字段，语义与现有缩略图身份一致；首次实际发送前再计算生成 JPEG 的 SHA-256 并落盘。暖缓存先用完整 source identity 判定，命中时不重新编码预览；miss 才生成 JPEG 并取得内容 hash。
- 照片原地替换、inode/ctime 变化、大小或时间变化会先使 source identity miss；随后重新生成的预览以新 SHA-256 绑定结果。无关照片、音频、滤镜、画幅以及显示 EXIF 的开关不导致重生成；编辑源文件里的 EXIF 会改变源身份，保守失效。
- 严格 materializer 在编码前后重新读取源身份，必须一致；AI 响应落盘前再次检查，启动视频渲染及每个 Still 导出前再次检查全部相关源身份。任何不一致直接以“照片已变化，请重新制作”结束本次任务，不在本轮自动重新分析或延长重试预算。该张旧响应不落盘、不显示，其他成功缓存保留。
- lease 只协调 Kiseki 任务，无法锁住 Finder 或外部编辑器。渲染后的原子发布前再复核输入身份，变化则不发布该产物。这里承诺检测到变化即拒绝发布，不承诺文件系统不可变快照；本期不复制全部原图。
- service 持有唯一内存 Map，完成回调先合并结果，再通过串行 writer queue 写入递增 revision 的完整快照。只允许一个写操作在途，禁止各回调自行读取旧 JSON 后覆盖。新的 Node `atomic-json.mjs` 使用同目录临时文件、fsync 与 rename，失败保留上一完整版本。
- 渲染前等待 writer queue drain，重新读取最终落盘快照，验证 model、prompt、source identity、revision 和全部 required keys。写入失败属于准备失败。测试必须覆盖乱序完成、延迟 rename、写失败和取消时有写操作在途。
- timeline 继续是可手工编辑的时间规划契约；磁盘 timeline 中即使出现未知 `caption` 也不作为旁白输入。只有开启 `--photo-caption` 时，`render.mjs` 才读取缓存、按规范化 `src` 覆盖注入 `PhotoClip.caption`；关闭时应删除/忽略磁盘输入中的同名未知字段，避免绕过显式开关，也不触发 `plan_checksum` 的手改保护。
- 视频的必需生成集合是已校验 timeline 中按规范 key 去重后的全部真实 photo clip，不含 chapter/未知 kind；即使某个短 clip 在当前视频中因可读性不展示，其有效文案仍进入缓存，供 Still 或后续时间线使用。这个集合全部成功才进入渲染。
- 单张 still 以图片所在目录为项目边界，只为目标图片准备文案；文件夹 still 的必需集合只包含 preflight 后实际待导出的 prepared job。

## 5. 第一版 Prompt 契约

第一版按用户提供内容落地为 JavaScript 模板字符串，不保留聊天消息中的 Swift 代码围栏。除必要的字符串转义外不修改文字：

```text
你是一位为「电子相框」撰写旁白短句的中文文案助手。
你的目标不是描述画面，而是为画面补上一点“画外之意”。

创作原则：
1. 避免使用以下词语：世界、梦、时光、岁月、温柔、治愈、刚刚好、悄悄、慢慢 等（但不是绝对禁止）。
2. 严禁使用如下句式：……里……着整个世界；……里……着整个夏天；……得像……（简单的比喻）; ……比……还……； ……得比……更……。
3. 只基于图片中能确定的信息进行联想，不要虚构时间、人物关系、事件背景。
4. 文案应自然、有趣，带一点幽默或者诗意，但请避免煽情、鸡汤。
5. 不要复述画面内容本身，而是写“看完画面后，心里多出来的一句话”。
6. 可以偏向以下风格之一：
   - 日常中的微妙情绪
   - 轻微自嘲或冷幽默
   - 对时间、记忆、瞬间的含蓄感受
   - 看似平淡但有余味的一句判断
7. 避免小学生作文式的、套路式的模板化表达

格式要求：
1. 只输出一句中文短句，不要换行，不要引号，不要任何解释。
2. 建议长度 8～24 个汉字，最多不超过 30 个汉字。
3. 不要出现“这张照片”“这一刻”“那天”等指代照片本身的词。
```

user prompt：

```text
请基于这张照片，生成一句符合规则的中文文案。
```

请求固定使用 Chat Completions。图片只能出现在 `user` 消息；`system` 必须是纯文本。第一版不把多张图片塞进一个请求，避免图片与文案错配以及整批重试。完整请求骨架锁定为：

```json
{
  "model": "deepseek-v4-flash-vision-exp",
  "messages": [
    {
      "role": "system",
      "content": "<上面的完整 system prompt>"
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "请基于这张照片，生成一句符合规则的中文文案。"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,<640px JPEG>",
            "detail": "low"
          }
        }
      ]
    }
  ],
  "thinking": {
    "type": "disabled"
  },
  "max_tokens": 64,
  "stream": false
}
```

请求地址固定为 `https://api.deepseek.com/chat/completions`，单次请求超时固定为 `45000ms`。第一版不开放自定义 base URL、模型名、detail、temperature 或超时配置，避免扩大配置与 SSRF 边界。

客户端只做确定性的格式守门，不擅自改写文风：

- 去除首尾空白后必须非空。
- 不能包含换行或包裹整句的引号。
- 最多 30 个 Unicode 码点，使用 `[...text].length` 计数；标点也计 1，不能使用 UTF-16 `text.length`。
- 不能包含明确禁止的照片指代词。
- 不能命中 prompt 中明确严禁的句式模式。
- 不直接截断不合规输出；携带违规原因重试一次，仍不合规则本次准备失败。

Prompt 的内容调整必须增加版本并改变 `prompt_hash`，保证旧缓存不会冒充新规则结果。文案质量在真实照片样本评审后再迭代，不在实现过程中凭开发者偏好改写。

## 6. 图片输入、并发与失败策略

- 从 `thumb.mjs` 抽出的只能是无回退的底层 JPEG 生成函数与 source identity 组成逻辑。现有 `/api/thumb` 继续使用自己的 HTTP 回源行为；AI adapter 调用严格模式，FFmpeg 失败、输出不存在、不是 JPEG 或超过约定尺寸时本张立即失败，绝不能返回源图。
- AI 预览使用独立缓存目录和独立 `AI_PREVIEW_CONCURRENCY = 2` 调度器，不复用 Web 全局 `THUMB_CONCURRENCY = 4` 槽；制作任务不会饿死素材页滚动和 Lightbox 预览。
- 生成 640px JPEG 后计算 SHA-256，再 base64 内联发送；服务端仍显式传 `detail: "low"`。
- 单次请求只对应一张照片，DeepSeek 请求并发固定为 4；AI 并发与 `KISEKI_CONCURRENCY` 的 Chromium 渲染并发分开，并且整个 caption 阶段结束后才启动 Chromium。
- 单次调用使用第 5 节固定的非思考、非流式请求和 `45000ms` 超时。
- 每张照片共享一个严格的额外尝试预算：初次请求之外最多再发 2 次，因此单张最多 3 个 HTTP 请求。网络错误、超时、429、5xx 和一次格式修复都消耗同一预算；格式违规最多修复 1 次，预算耗尽后不得继续。这样“HTTP 重试”和“格式重试”不会相乘。
- 401/403 属于整批身份失败：收到第一条后立即 abort 整批共享 controller、停止调度剩余照片并等待在途请求收束，不继续把剩余几十张跑完。其他不可重试 4xx 同样立即结束当前任务；429/5xx/超时才按张退避重试。
- Web 取消最终通过现有任务树向 CLI 子进程发送终止信号。CLI 的 caption 阶段建立作用域内的 `AbortController`，把任务终止信号转成 `abort()` 并将 signal 传入每个 `fetch`，同时停止队列调度；清理后恢复/移除作用域信号监听，不能只是不再取下一项而任由在途请求继续。
- API 响应和日志不得包含 Authorization、base64、完整文件路径或服务端原始响应体。
- 记录本轮缓存命中、新生成、失败、耗时和 API 返回 usage；不自行估算成账单金额。

## 7. 排版与视觉层级

### 7.1 共同原则

- 文案是“画外题签”，不是歌词、EXIF 或图片内字幕。
- 不覆盖照片像素，不放半透明黑条、胶囊、描边或装饰卡片。
- 使用当前 palette、模板 font family 与视觉缩放规则。
- 字重低于新闻标题。可编码默认值固定为：1080p 基准字号 32px、最小字号 24px、字重 400、普通字距 `0.08em`、超过 18 个码点改用 `0.04em`。
- 始终单行，最大文本宽度固定为当前 caption 区域的 86%。先切换紧凑字距，再使用字体加载后的实际文字测量选择能容纳的最大字号，最低 24px；以上字号、间距均乘 visualScale。临时测量节点使用最终 font family、字重和字距，测量结束后移除。
- 在准备图片预览时获取按 EXIF 方向校正后的像素宽高，渲染驱动根据原图比例确定实际照片框；maxWidth/maxHeight 不等同于实际列宽。
- 文案生成全部完成后，使用 Remotion 的同一个已加载字体的浏览器执行轻量排版预检，按实际 font family、字重、码点和字距测量宽度。预检不是媒体帧渲染；此步骤之后才 renderMedia/renderStill。复用浏览器，禁止为每张图重新启动。
- 共享布局函数接受实际图片尺寸、画布、模板、photoScale、EXIF 面板尺寸、签名尺寸、文字测量宽度和运动包围盒，返回 `captionLayout | null`，明确 x/y/width/height/fontSize/letterSpacing。运行时 input props 增加该非业务布局字段，React 消费 caption 字符串及确定的布局，不读缓存、不发请求。
- 水平宽度或垂直空间不足、签名安全间距不足时返回 null；本输出隐藏旁白并汇总原因，缓存保留、任务成功。合法小 photoScale 导致扣除 reserve 后尺寸非正时，也返回 null 并恢复该图片原有无旁白布局。字号下限不突破。
- 文案、歌词、EXIF 和签名必须拥有不同的空间区域和清晰层级。

### 7.2 视频布局

Diary：

- 图片旁白放在照片上方的实际留白带，水平居中。画布顶部安全边距固定为 `24 × visualScale`，照片/运动包围盒上缘再扣 `24 × visualScale` 间距作为题签带下界。文字行高为 `1.35 × fontSize`，在此带内垂直居中；带高度不足时返回 null。不得再用 `(height × (1 - photoScale)) / 4`。photoScale=1 且图片满高时隐藏旁白。
- 歌词继续使用照片下方的现有字幕带。
- 开启签名时不改变图片旁白位置；底部签名继续与歌词共用既有安全区计算。
- 只有 Diary 当前拥有 `Photo.tsx` 的 EXIF 面板。开启 EXIF 时仍保留题签与信息面板分区，横版照片左/参数右，竖版沿用现有堆叠；使用照片与面板联合包围盒验证题签带，不能把横版 0.72 高度假设套给竖版。slow-cinema 需要计入全部可见运镜位置的上界。

Filmstrip：

- Filmstrip 没有 EXIF 面板，不描述或实现任何右侧参数布局。
- 底部走带与歌词已经占用下沿，旁白固定使用顶部画布题签，安全带计算规则与 Diary 相同，但使用 Filmstrip 实际主图包围盒。
- 开启旁白时将 `MAIN_PHOTO_FACTOR` 的可编码默认值从 `0.92` 收紧为 `0.86`；未开启时保持 `0.92`，避免无旁白成片发生布局回归。
- 主照片、顶部题签、底部歌词和走带分别占用独立区域；若最小字号仍不满足宽度，只隐藏该照片旁白，不再继续缩小主图。

Polaroid：

- Polaroid 没有 EXIF 面板，第一版不扩展卡片下沿，也不把文案塞进卡片。
- 旁白固定使用顶部画布题签并水平居中。安全带使用包含 padding 的卡片外框，计入入场及退出期间最大旋转；矩形旋转包围盒按 `w'=|w cosθ|+|h sinθ|`、`h'=|w sinθ|+|h cosθ|` 计算。空间不足返回 null，不采用卡片下沿回退。
- 开启旁白时，卡片内照片的 `0.9` 尺寸因子固定收紧为 `0.84`；未开启时保持现状，给题签和旋转后的卡片边界留出稳定间距。

视频时序：

- 序章闪回、片头、章节卡与片尾不显示图片旁白。
- 正文进入当前照片后淡入，切换前淡出；交叉淡化期间只允许一条旁白可读，不能两句叠加。
- 图片旁白跟随每张正文照片的有效展示窗口；不因照片较短而整体跳过。序章闪回、片头、章节卡和片尾白场仍不显示旁白。
- 末张照片进入白场前提前结束旁白，不能与谢幕语叠加。
- 时间规则集中到 `compositionTiming.ts` 的 `photoCaptionPresentation`。输入为原始 visualClips 顺序、frame/fps、实际 showIntro/introEnd、recapEnd、durationInFrames 及 whiteFadeDuration（使用现有 2.5 秒白场时长）。按实际 frame 边界计算，避免秒浮点重叠。
- 每张正文照片起点为 `ceil(max(clip.start, showIntro ? introEnd : 0, recapEnd) × fps)`；终点为 `min(ceil(clip.end × fps), ceil(nextVisual.start × fps), whiteFadeStartFrame)`，无 nextVisual 时忽略该项，采用左闭右开区间。chapter 占用的帧强制为空；自定义 timeline 重叠时最后一个符合条件的 photo 在原始数组顺序中获胜，始终最多一条。
- 不设置照片旁白的最小时长阈值。淡入和淡出均为 `round(0.2 × fps)` 帧并钳入独占区间；caption 归属不随模板照片淡化沿延伸。测试短 clip、切换前一帧、切换帧、后一帧、chapter、recap、白场及低 fps。

### 7.3 静态图布局

无 EXIF：

- 照片和旁白组成纵向展陈组，旁白位于照片下方并居中。
- 整组最大高度仍为 `height × photoScale`。caption 预留固定为 `72px × visualScale`，照片 `maxHeight` 改为 `safeHeight - captionReserve`，照片与旁白 gap 固定为 `24px × visualScale`，不能把现有安全框向外撑破。
- 签名仍在更低层级的底部区域。开启签名时，照片＋旁白展陈组固定上移 `16px × visualScale`；旁白与签名的计算间距不得小于 `24px × visualScale`，不足则按“本输出不显示旁白、任务成功”处理，不临时改变对齐或字号下限。

有 EXIF，横版或方形：

- 左侧形成“照片 + 下方旁白”的纵向列，右侧仍为 EXIF 参数面板。
- 旁白宽度跟随照片列，不跨到 EXIF 面板下方。
- EXIF 参数维持左对齐；旁白固定水平居中，不保留实现时再选左对齐的分支。
- 左侧照片 `maxHeight` 固定为现有 `layout.photoMaxHeight - 72px × visualScale`，照片与旁白 gap 为 `24px × visualScale`；左右列之间继续使用现有 `layout.gap`。
- 签名继续留在 EXIF 面板内，不与旁白竞争照片下方空间。

有 EXIF，竖版：

- 顺序为“照片 → 图片旁白 → EXIF 面板”。
- 实现为“照片＋旁白”的左/上方展陈列再接 EXIF 面板：照片同样从现有 `photoMaxHeight` 扣除 `72px × visualScale`，照片与旁白 gap 为 `24px × visualScale`，该展陈列与 EXIF 之间继续使用现有竖版 `layout.gap`。
- 旁白固定居中，EXIF 固定左对齐；不随照片或文案动态改变对齐方式。
- 不允许通过裁切照片、隐藏 EXIF 字段或缩小到不可读字号来勉强容纳。

## 8. CLI 契约

建议统一使用：

```bash
kiseki <folder> --photo-caption
kiseki still <photo|folder> --photo-caption
```

`--photo-caption` 默认为 false。CLI 解析、Web job options、等效命令和实际 argv 必须继续由同一 `job-argv.mjs` 映射产生。

CLI 在进入音频分析、Still EXIF preflight 或缩略图生成前先检查 `DEEPSEEK_API_KEY` 是否为非空字符串；缺失时快速失败，不做昂贵准备。该检查只是本地存在性守门，真实 401/403 仍按第 6 节在首个响应后中止整批。

裸命令交互菜单也是正式 CLI 入口：视频与 Still 问完 EXIF/签名/背景后增加一次默认否的确认：

```text
为照片生成图片旁白？会发送低清预览。
```

`menu.mjs` 的 choices、`buildArgvFromChoices`、等效命令和菜单测试必须同时加入 `photoCaption`；不能要求 TTY 用户退出菜单后手打 flag。

默认输出命名增加 `-caption`：

```text
trip/output/trip-caption.mp4
output/stills/001-caption.png
```

后缀顺序锁定为：

```text
exif → sign → caption → dark → portrait|square → draft → template → filter
```

因此 `-caption` 固定紧跟 `-sign`、位于 `-dark` 之前。它应与画幅、草稿、模板和动态滤镜后缀稳定组合；显式 `-o` 不追加后缀。

Still 当前 `ALL_VARIANT_SUFFIXES` 只枚举展示 × 画幅，已经无法表达动态滤镜，不能在旧数组上机械增加 caption。实施时将跨变体碰撞检测改为使用 `output-naming.mjs` 同一套有序 token 生产/识别规则，caption 进入规范 token；当前任务的最终输出路径仍做大小写无关去重，历史合法变体不能被另一源文件名伪装覆盖。

视频编排和注入链锁定为：

```text
kiseki.mjs
  → plan/trim 完成并读取已校验 timeline
  → photo-caption-service 准备 ai-captions.json
  → 调用内部 render.mjs --photo-caption
  → render.mjs 读取缓存并按 normalizePhotoKey(publicDir, clip.src) 注入 PhotoClip.caption
  → React 只消费 caption 字符串
```

`render.mjs` 的 `applyRenderVariants` 与 EXIF/滤镜同属内存覆盖入口。禁止写临时 timeline，禁止 `PhotoCaption.tsx` 读取缓存文件，禁止 Renderer 自行访问文件系统或网络。`docs/specs/timeline-schema.md` 只说明 `caption` 是受 flag 控制的运行时注入字段，不把它列为手改核心字段；validator 保持对未知字段宽容。

Still 不是简单增加一次 service 调用，控制流改为：

```text
resolveJobs
  → acquire lease（仍声明完整候选输出）
  → 先按 --skip-existing 排除已有输出
  → 若 --exif，预提取 EXIF 并排除信息不足、最终不会导出的 job
  → 得到 preparedJobs
  → 若为空，直接汇总并结束，不 bundle、不启 Chromium、不请求 AI
  → 若开启旁白，为 preparedJobs 准备缓存
  → bundleRenderer + openBrowser
  → 循环复用预提取的 exifProps 与 caption 渲染
```

这样不会为已有产物或 EXIF 不足的照片请求 AI；EXIF 只提取一次，连同 source identity 保存。外部修改按第 4.3 节的编码、响应、渲染和发布身份复核处理，不能依赖 lease 阻止外部编辑。

进度通道分开定义：

- 长任务折叠：`term.task('准备图片旁白')`，通过 fd3 发中文 start/success/error，并由现有 stage 折叠。
- 百分比：`progress.update('Photo captions', completed / total)`；英文 label 不超过 18 个字符，适配终端 `padEnd(18)`。
- 汇总：缓存复用数、新生成数、因短 clip/排版跳过数使用 `term.detail`，不伪装成新的 task。
- Web `JobPanel.STAGE_LABELS` 增加 `'Photo captions': '准备图片旁白'`，保留现有“先精确、再英文前缀”的翻译规则，与 `Rendering still 1/3` 一致。

## 9. Web 契约

`JobOptions` 增加 `photoCaption?: boolean`，视频和 still 默认值都显式为 false。`Make.tsx` 两种任务共享同一控件和说明，不实现 Web 专属 AI 请求。预设保存前写出明确布尔值，读取旧预设时将缺失字段规范化为 false，避免旧数据产生三态行为。

Web 只把布尔选项交给本地 job API：

```text
Web → POST /api/jobs → job-spec → job-argv → CLI child
```

API Key 只由本地服务/CLI 进程从环境读取。`/api/runtime` 的 `RuntimeResponse` 增加只读布尔 `photoCaptionConfigured`，不能返回密钥、长度或掩码片段。`capabilities.ts` 增加独立的图片旁白能力并接收 runtime 状态；它同时检查 key 已配置与 doctor 的 FFmpeg 可用状态；loading/unavailable 时旁白保持不可提交，missing 时显示安装提示。它只控制旁白选项，不阻断普通 `renderVideo`/`exportStill`。若没有密钥，制作页保留选项的可发现性但禁用勾选/提交，旁边显示配置说明；`job-spec` 还要对绕过页面直接提交的 `photoCaption: true` 做同样的服务端快速拒绝，CLI 入口再做一次防御性检查。

进度继续通过现有 fd3 JSON 事件与 SSE 返回，不另建第二套轮询接口或让浏览器直连 DeepSeek。按现有双通道约定，task stage 固定为中文 `准备图片旁白`，percent label 固定为英文 `Photo captions`；Web 通过 `STAGE_LABELS` 翻译 percent label，不引入第三个阶段名字。

失败区不能只保留现有单一 reset。`JobPanel` 增加可选、通用的失败 action 描述，不在组件内硬编码 AI：

- `重试图片旁白`：以失败前保存的相同 kind/options 重启；有效缓存会自动命中。
- `不加旁白，继续制作`：复制失败前 options，仅将 `photoCaption` 设为 false 后重启。
- 普通任务失败仍保持现有 reset 行为；只有旁白任务失败时传入两个 CTA。

## 10. Desktop 边界

当前 `desktop/` 仍存在并可启动实验性 macOS 壳；它创建本地 service、加载相同 Web 页面，并用相同 command resolver 拉起 CLI 子进程。因此 Web 控件和 CLI 参数会自然进入 Desktop 代码路径。

但本期只做以下 Desktop 回归：

- 未开启图片旁白时，实验性 Desktop 原流程不回归。
- 若启动 Desktop 的进程环境已有 `DEEPSEEK_API_KEY`，共享任务链可完成一次旁白 smoke。
- 页面、preload、视频 render.mjs 子进程、Chromium/FFmpeg 子进程环境拿不到 API Key。`command-resolver` 增加显式 omitEnvKeys 能力，对 renderer/analyzer/tool command 过滤 `DEEPSEEK_API_KEY`；Web 启动 CLI child 时仍保留供 caption service 使用。
- Still 在 CLI 进程内加载渲染器：caption 阶段从入口捕获 key 到局部服务依赖，结束后在加载 Remotion/openBrowser 前移除 process.env 中的 key，finally 恢复供常驻菜单下一轮使用。子进程显式传过滤后的 env；HTTP adapter 不向 renderer 导出 key。测试必须覆盖视频子进程、Still 同进程加载和后代环境，不能只验证 inputProps。

本期不把“从 Finder 启动并安全配置密钥”纳入完成标准。若之后要正式支持，应单独设计 Electron main 持有的加密凭据存储和设置页，不能把 key 放进 localStorage、query、preload 全局对象或素材目录。

## 11. Step-by-step 实施计划

### Step 0：基线与样本

- 记录当前 CLI、Web、Renderer、Analyzer 测试基线和构建状态。
- 准备不含隐私信息的代表性图片集：人物、风景、室内、食物、文字较多、低光、方图、横图、竖图。
- 准备 10 张与 50 张两组，用于冷缓存、暖缓存和取消/续跑测量。
- 保存现有无旁白视频/still 关键帧，作为布局和无功能回归基线。

验收：未改功能前基线可重复，任何已有失败单独记录，不归因于本功能。

### Step 1：Prompt、响应与缓存契约

- 新增版本化 prompt 常量和 hash。
- 按第 5 节固定 Chat Completions 消息结构、字段、`max_tokens = 64` 和 `45000ms` 超时。
- 实现输出规范化、Unicode 码点长度、换行、引号、指代词和禁止句式校验。
- 实现 project-relative 规范 key；统一 timeline `./...`、Still 绝对路径和平台分隔符。
- 复用缩略图强身份字段并增加实际 640px JPEG SHA-256，定义 `ai-captions.json` v1 读取与精确失效。
- 新增 Node `atomic-json.mjs`，以同目录 temp + fsync + rename/rollback 写入，禁止截断正式缓存。
- 写视频/Still 同 key、缓存命中、inode/ctime/照片变化、preview hash、prompt 变化、损坏缓存和部分续跑测试。

验收：不访问网络即可完整验证数据契约；损坏缓存保守 miss，不能导致旧文案误用。

### Step 2：DeepSeek adapter 与图片准备

- 从现有缩略图模块只抽出无回退 JPEG 生成与身份 helper；HTTP 路由保留原回源语义，AI 严格路径禁止回源。
- 为 AI 预览建立独立缓存和并发 2 的 FFmpeg 调度器，不占 Web `THUMB_CONCURRENCY`。
- 实现固定消息骨架、base64 低清单图请求、非思考模式、超时、错误分类和 usage 解析。
- 实现请求并发 4、单图最多 3 次总调用、格式修复与 HTTP 共享预算、401/403 整批快速失败、逐条原子保存和共享 AbortSignal 取消。
- 测试全部使用本地 fake HTTP server，不把真实 API Key 放进测试或 fixture。
- 补充严格 materializer 编码前后、响应提交前及渲染前的源身份复核；模拟外部原地替换，变化时本任务失败且不发布错配产物。
- 串行 writer queue 和单一 Map 是并发实现前提；以乱序响应、延迟 rename 验证缓存不丢项，渲染前 drain 并读回全部 required keys。

验收：图片只在 user message；system 是纯文本；并发不超过上限；401/403 取消整批；429/5xx/超时按预算重试；FFmpeg 失败不产生网络请求；日志无密钥、图片内容和完整路径。

### Step 3：CLI 视频与 still 纵向闭环

- `options.mjs` 为 render/still 增加同名 flag。
- `job-argv.mjs` 统一校验并映射 Web 与 CLI。
- `menu.mjs` 为视频/Still 增加默认否的隐私确认，并覆盖 choices → argv → 等效命令。
- 视频在 plan/trim 后准备缓存，把 `--photo-caption` 传给内部 renderer；`render.mjs` 统一清理磁盘未知 caption 并按规范 src 做内存注入。
- Still 按第 8 节重排为 lease → skip-existing → EXIF preflight → caption → bundle/browser，循环复用预提取数据。
- 把输出顺序锁定为 exif → sign → caption → dark → canvas → draft → template → filter，并以同一 token 规则替换 Still 旧硬编码碰撞列表。
- 实现中文 task、英文 `Photo captions` percent label 和 detail 汇总。
- 补齐缺 key、全缓存、部分缓存、失败、取消、单图 still、文件夹 still、EXIF 不足与 `--skip-existing` 零请求测试。
- 完成第 10 节的密钥环境过滤与 Still 同进程生命周期隔离，再执行 renderer 加载和子进程环境测试。

验收：未开启时调用图与输出字节路径不变；开启后所有文案完成才出现第一帧渲染进度。

### Step 4：共享 Renderer 文案层

- `PhotoClip` 与 `StillProps` 增加可选 caption 输入。
- 实现共享文本度量、字号回退、palette/font 路由和视频时序。
- 按第 7 节落实图片尺寸预读、共享几何模块及同浏览器字体测量预检，返回 captionLayout/null；覆盖极窄竖图、photoScale=1、极小 photoScale、旋转和签名，不复制 Node/React fit 公式。
- Diary、Filmstrip、PolaroidWall 和 Still 只传布局上下文，不复制规则。
- 按第 7 节的确定性默认值实现：Diary 顶部题签；Filmstrip 顶部题签 + caption-only `MAIN_PHOTO_FACTOR = 0.86`；Polaroid 顶部题签 + caption-only 图片因子 0.84；Still 使用 72px reserve、24px gap 和固定居中对齐。
- 只有 Diary/Still 接触 EXIF；Filmstrip/Polaroid 测试明确断言不存在 EXIF 面板分支。
- 24px 紧凑字距仍超宽时只跳过该照片旁白，任务成功且汇总告警；不得把排版不足混成 AI 准备失败。
- 给短 clip、交叉淡化、章节卡、序章闪回和片尾白场加确定性时序测试。

验收：任何帧最多一条图片旁白；图片旁白不覆盖照片、歌词、EXIF、签名或谢幕语。

### Step 5：Web 制作流程

- 视频与 still 默认 options 增加 `photoCaption: false`。
- `/api/runtime` 只返回 `photoCaptionConfigured` 布尔；`capabilities.ts` 增加只约束旁白选项的能力。
- 增加符合第 3 节语气的控件、隐私说明与缺 key 状态。
- 新旧预设都规范化为明确的 `photoCaption` 布尔，默认 false。
- 等效命令必须出现 `--photo-caption`。
- JobPanel 以中文 task 折叠阶段，以 `Photo captions` 英文前缀翻译百分比进度。
- 为旁白失败注入“重试图片旁白”和“不加旁白，继续制作”两个 CTA；普通失败仍走现有 reset，不新增孤立状态机。
- 图片旁白 capability 合并 key 与 FFmpeg 状态，覆盖 loading/unavailable/missing，普通 Still 无 FFmpeg 时仍可使用。
- 同批实施第 15 节的旁白独立设置区、折叠摘要、阶段状态、恢复快照与键盘焦点；新增请求字段必须经过 job-argv 白名单校验。

验收：Web 发出的 options、显示的等效命令和实际 CLI argv 完全一致；关闭选项时无 AI 网络流量。

### Step 6：文档与架构图

- README/README.en 增加可选图片旁白、密钥配置、隐私边界、CLI 示例和输出后缀。
- `docs/kiseki-status.md` 明确 CLI/Web 是主力入口，Desktop 仍为实验壳。
- 不改架构图左侧 Fetch/Optional online prep 节点：它表示把在线音频/歌词写入素材夹，而图片旁白发生在 plan 之后并写入 `output/metadata/`，两者不是同一边界。
- README/README.en 与 `docs/kiseki-status.md` 用 prose 增加“任务运行时的可选在线图片旁白准备”，说明只发送低清预览以及产物位置；九节点架构图保持现状。
- 更新配置/时间线说明：API Key 不属于 `kiseki.toml`；caption 是渲染时注入字段，不是手工 timeline 核心字段。

验收：文档不再笼统声称所有分析都只在本地；必须精确写成音频/时间线分析与渲染本地，图片旁白为任务运行时、用户显式开启的在线准备，且不与 Fetch 素材写入边界混写。

### Step 7：性能、视觉和完整验证

- 测量 10/50 张图片冷缓存与暖缓存：缩略图耗时、API 阶段 wall time、请求数、缓存命中数和峰值并发。
- 验证暖缓存不会请求 DeepSeek，且进入渲染前的额外耗时接近缓存读取成本。
- 同时打开 Web 素材页快速滚动，在 AI 预览 miss 下确认 Web thumb 的独立队列仍能响应，不被制作任务占满。
- 对比未开启旁白的渲染时长，确认新增代码不会拖慢原路径。
- 使用真实渲染帧做视觉验收，而不是只跑 TypeScript 或快照测试。
- 运行 CLI、Web、Renderer、Analyzer、Desktop smoke 与 `git diff --check`。

验收：功能、性能、隐私、错误恢复和视觉矩阵全部有记录，真实 API 只用于受控冒烟，不进入自动测试。

## 12. 视觉验收矩阵

至少覆盖以下代表性组合，避免全笛卡尔积但保证成对覆盖主要冲突：

| 输出 | 模板/布局 | 画幅 | EXIF | 签名 | 歌词 | 背景 | 重点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 视频 | Diary 默认 | 横版 | 关 | 关 | 有 | 明 | 顶部旁白与底部歌词平衡 |
| 视频 | slow-cinema | 横版 | 开 | 开 | 有 | 暗 | 旁白、EXIF、签名、歌词四层共存 |
| 视频 | Filmstrip | 竖版 | 关 | 关 | 有 | 明 | 顶部旁白与底部走带不挤压主图 |
| 视频 | Polaroid | 方形 | 关 | 关 | 无 | 明 | 固定顶部题签、卡片收紧及长文案跳过 |
| 视频 | news-cut | 横版 | 开 | 关 | 无 | 暗 | sans 字族与醒目模板仍不喧宾夺主 |
| still | 默认 | 横版 | 关 | 开 | 不适用 | 明 | 照片、旁白、底部签名间距 |
| still | 展签 | 横版 | 开 | 开 | 不适用 | 暗 | 左照片+居中旁白、右 EXIF+签名 |
| still | 展签 | 竖版 | 开 | 开 | 不适用 | 明 | 照片→旁白→EXIF 安全区 |
| still | 默认 | 方形 | 关 | 关 | 不适用 | 暗 | 24–30 字单行与最小字号 |

每项记录画布尺寸、元素 bounding box、最小间距、是否溢出和关键帧截图。视觉验收必须包含 8 字、24 字和 30 字样本，以及短 clip。

补充边界：photoScale=1、合法极小 photoScale、超窄竖图、横图放入竖画布、Polaroid 最大旋转、最长 EXIF/签名、短 clip、chapter 与白场裁剪。预检返回 null 时，成片必须正常完成并正确汇总旁白省略数。

## 13. 完成标准

- Web 与 CLI 的视频、still 均可选择开启或跳过图片旁白。
- 开启后，全部必要文案完成并校验通过才启动渲染。
- 第一版使用用户指定 prompt，模型名为 `deepseek-v4-flash-vision-exp`。
- Chat Completions 请求严格满足 system 纯文本、图片只在 user、`thinking.disabled`、`detail.low`、`max_tokens = 64` 和 `45000ms` 超时。
- AI 预览生成失败即失败，绝不回退上传原图；API Key 不进入页面、项目文件、日志或 Renderer。
- 视频/Still 通过同一个 project-relative key 命中缓存，source identity 与实际 JPEG hash 共同绑定结果。
- `timeline.json` 不因 AI 缓存被改写，现有手工编辑保护保持有效；视频 caption 由 `render.mjs`、Still caption 由 `still.mjs` 内存注入；排版预检返回 captionLayout/null，React 不读缓存。
- 缓存可增量失效、失败可续跑、取消可回收，默认无旁白路径没有网络和性能回归。
- 视频文案与歌词、EXIF、签名、模板、序章和片尾没有遮挡或双文案叠加。
- Still 在无 EXIF、有 EXIF、横/竖/方画幅下保持完整安全区和清晰层级。
- 排版在 24px 最小字号仍不成立时只跳过该输出中的旁白并明确汇总，任务不失败。
- `--skip-existing` 和 EXIF 不足的 Still 在 caption、bundle、Chromium 前排除，不产生 AI 请求。
- 输出后缀严格按 exif → sign → caption → dark → canvas → draft → template → filter 排列。
- CLI/Web/Renderer/Analyzer 自动检查通过，代表性真实成片和静态图完成视觉验收。
- Desktop 仅记录实验性共享路径 smoke，不被表述为本期正式支持面。

## 14. 风险与守门

- 模型带 `exp`，行为可能变化：缓存必须绑定模型和 prompt；真实样本需要保留一组回归评审集。
- 文案虽然格式合规，仍可能平庸或与项目气质不符：第一版先忠实落地指定 prompt，再依据成片样本调整 prompt 版本，不在客户端偷偷改写句子。
- 低清预览可能丢失细节：本功能只要求确定的画面联想，不做 OCR/微小物体识别；第一版固定 640px JPEG + `detail: low`，遇到明显质量不足另起方案，不在本期开放 detail 配置。
- 视频短 clip 无法读完长句：以可读性优先，短 clip 不显示，不改变音乐节奏和照片时长来迁就文案。
- EXIF、签名、歌词和文案同时开启会压缩空间：使用第 7 节锁定的 reserve/factor/gap；到达 24px 仍不成立时隐藏该旁白并汇总，不隐藏 EXIF、不覆盖图片。
- AI 网络阶段会拉长冷启动：以缩略图、并发 4、逐图缓存和续跑控制；不与 Chromium 渲染同时争用资源。
- HTTP 与格式重试若各自独立会放大请求：它们共享额外两次尝试预算，单图总调用上限为 3；401/403 立即停止整批。
- Desktop 缺少正式密钥设置：保持实验边界，不能为了看似支持而把 key 暴露给 Renderer 或 Web 页面。

## 15. Web 排版与交互调整

本节基于 `Make.tsx`、`JobPanel.tsx`、`Workbench.tsx`、`PhotoGrid.tsx`、`lastJob.ts` 和 `App.css` 的静态核查。尚未运行真实浏览器，因此下列现状是代码证据，几何尺寸与感知效果需在实施时实际验证。参考 emil-design-eng 的信息层级、反馈与渐进展示原则，沿用现有字体、色板、圆角、按钮和 reduced-motion 规则。

### 15.1 现状与改动

| Before | After | Why |
| --- | --- | --- |
| Make 参数默认折叠，折叠区外仅显示“素材齐了，可以开工” | 参数按钮旁增加只读单行摘要，如“横版 · 图片旁白开启”；开关及隐私说明在展开区内 | 用户开始前能确认会发生在线请求，应用预设后也不会漏看 |
| EXIF、签名、暗色集中在紧凑的 flex-wrap checkbox 行 | 图片旁白采用单独完整一行，紧邻这些选项；标签、说明、可用状态纵向排列 | 长隐私说明不会挤坏现有短选项，也能区分在线步骤与视觉开关 |
| JobPanel 顶部仅按 verb 显示“正在渲染…” | 旁白阶段显示“正在写图片旁白…”；到 Remotion 后显示“正在渲染画面…” | AI 等待期间还未开始编码，状态应反映真实阶段 |
| 单一 reset 按钮，job-actions 仅设置 margin-top | 旁白阶段失败显示主按钮“重试图片旁白”、次按钮“不加旁白，继续制作”；宽屏 flex-wrap，≤600px 纵排 | 两个恢复动作可发现、可点击，长文字不溢出 |
| 参数区在任务运行时被 JobPanel 替换，提交 options 仅留在卡片局部 state | Workbench 保存实际提交的不可变请求快照，并在同任务刷新重连后恢复可公开的 options | 重试使用失败任务的参数，不使用已变化的默认值或其他任务参数 |
| 调整参数后展开面板，但未显式恢复键盘焦点 | “调整参数”后聚焦参数标题/首个控件；重试开始后聚焦状态标题，状态更新不持续抢焦点 | 动态替换内容后键盘用户能继续操作 |
| PhotoGrid 懒加载 Lightbox 的 Suspense fallback 为 null | 打开时提供轻量“正在打开照片…”可取消状态；加载失败提供重试，关闭后归还焦点 | 首次下载组件较慢时点击不再表现为无反馈 |

### 15.2 设置区与缺依赖状态

- 固定顺序：成片风格 → 现有视觉开关 → 图片旁白独立行 → 画幅/时长/速度 → 滤镜。Still 使用相同旁白行，隐藏视频专属设置。
- 说明固定为“为照片补上一句画外之意。开启后会将低清预览发送给 DeepSeek，全部生成后再开始制作。”这是决策信息，直接显示，不只放 tooltip。
- 沿用 native checkbox；关联 label 与 `aria-describedby`。辅助说明继承现有正文次级颜色，配置错误使用现有 hint-error；状态不只靠颜色表达。
- key 或 FFmpeg 缺失时显示具体原因和配置/环境帮助。选项仍可见，阻止从 false 开启。若旧预设带 true，始终允许取消勾选；不能因 disabled checkbox 把用户锁在不可提交状态。
- 无法确定 runtime/doctor 状态时显示“正在检查图片旁白环境…”或“暂时无法检查，请重试”，仅拦旁白提交。密钥“已配置”仅表示存在，不冒充账户可用或余额足够。
- 参数折叠摘要只呈现真实选择，不显示推测的已缓存条数、费用或预计耗时。所有实际缓存数在准备阶段产生。

### 15.3 任务反馈与恢复

- 保持 fd3 task 中文、percent label 英文的双通道契约。增加可选 count 数据（completed/total/reused/generated），贯穿进度发送、useJob 校验和 JobPanel；终端 label 仍为 `Photo captions`，Web 展示“已准备 18 / 26 张”，不从自然语言日志解析数字。
- 百分比明确为当前阶段进度，不能把旁白完成的 100% 当成整体完成；进入 render 阶段切换名称并按新阶段百分比显示。汇总使用 tabular-nums；不把每个计数更新播报到 live region，只播报阶段变化、失败和完成。
- 失败双 CTA 只针对确认为 caption 阶段失败的任务。新增可选结构化 failureStage/code（服务端允许列表），保存至任务状态并在重连快照中返回，避免靠中文错误字符串识别；渲染阶段失败保持“调整参数再渲染”。
- 服务端任务摘要只公开经过白名单投影的 kind/folder/options，不返回 spec.env、argv 或密钥。Workbench 用该快照重试；服务重启、快照缺失或校验失败时仅提供“返回参数”，不猜测参数立即重跑。
- 两个 CTA 必须等服务确认释放租约后才可用；发起请求后立即禁用，复用已有 start 防重复与 jobLock 检查。取消请求发出后显示“正在取消…”，仍持锁直到实际终态；HTTP 请求已由供应商接收时，取消不承诺撤销计费。
- 若显式 -o 指定同一路径，“不加旁白”仍遵守该输出契约；默认路径重新调用统一命名函数移除 caption 后缀。

### 15.4 视觉克制与验收

- 保留现有两张制作卡片和素材/制作/成果导航。无需增加 AI 独立 Tab、装饰渐变、发光边框、弹窗确认链或会遮住按钮的固定底栏。
- 新设置行和状态摘要使用正常文档流。错误可换行、API Key 配置名可断行；不以固定高度截断错误。不向 App.css 添加全局标签选择器。
- 失败操作在 ≤600px 下纵排，触摸点击区域至少 44px；焦点轮廓、Enter/Space、Tab 顺序可用。复用现有参数展开 transition；数字/文案切换不新增逐字动画，reduced-motion 下不引入位移动画。
- 验证 1280×720、900×640、390×844、320×568：展开全部参数、24 字预设名、两行错误、长恢复按钮、环境加载失败、预设 true 但缺 key、运行中切 Tab、刷新重连、连续点击重试、取消。
- Lightbox 反馈作为独立小步骤实施，验证首次慢加载、加载失败、取消、Escape、焦点回到原照片；保留现有缩略图尺寸、懒加载和相邻预加载数量。
- 本轮不因静态审查认定全站排版或性能已经合格。落地后通过浏览器实际 bounding box、焦点和网络行为确认；照片文案的 MP4/PNG 排版仍单独按第 12 节验收。
