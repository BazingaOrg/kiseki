# tsuzuri（綴り）

> 照片 + 一首歌（可选歌词），自动生成踩点影像日记。分析与渲染全程本地，在线备料可选。

**中文** · [English](README.en.md)

## 快速开始

需要 [Node.js 18+](https://nodejs.org/)、[uv](https://docs.astral.sh/uv/) 和 [FFmpeg](https://ffmpeg.org/)。macOS 可通过 `brew install node uv ffmpeg` 安装。

```bash
npm --prefix cli install
npm --prefix renderer install
node cli/tsuzuri.mjs doctor
```

准备一个素材文件夹：

```text
osaka-trip/
├── photo-01.jpg
├── photo-02.jpg
└── audio/
    ├── music.mp3
    └── lyrics.lrc
```

自备素材时，其中应包含若干照片、唯一一份音频，可选一份 `.lrc`。如果缺少音频或歌词，
音频和 `.lrc` 可以放在根目录或 `audio/`，不必迁移旧项目；`fetch` 获取的新素材统一放入
`audio/`。也可以先运行 `node cli/tsuzuri.mjs fetch ./osaka-trip` 交互补齐。然后运行：

```bash
node cli/tsuzuri.mjs ./osaka-trip
```

成片默认写入 `osaka-trip/output/osaka-trip.mp4`。没有 `.lrc` 时，tsuzuri 会在首次运行时下载 Whisper 模型并在本地识别歌词。

## 使用

```bash
node cli/tsuzuri.mjs
node cli/tsuzuri.mjs ./osaka-trip
node cli/tsuzuri.mjs ./osaka-trip -o out.mp4
node cli/tsuzuri.mjs ./osaka-trip --exif --sign --dark
node cli/tsuzuri.mjs ./osaka-trip --draft
node cli/tsuzuri.mjs lyrics ./osaka-trip
node cli/tsuzuri.mjs fetch ./osaka-trip
node cli/tsuzuri.mjs still ./photo.jpg
node cli/tsuzuri.mjs still ./photos --exif --sign --dark
node cli/tsuzuri.mjs doctor
node cli/tsuzuri.mjs web ./osaka-trip
node cli/tsuzuri.mjs help
```

不带参数会打开常驻交互菜单：每个流程完成或报错后都会回到主菜单，输入 `q` 才退出；带参数
命令仍执行一次后退出。常用命令包括：

| 命令 | 用途 |
| --- | --- |
| `<folder>` | 分析音频、规划时间线并渲染视频 |
| `lyrics <folder>` | 预览歌词识别结果，不渲染 |
| `fetch <folder>` | 在线获取音频/歌词到素材夹（交互） |
| `still <photo\|folder>` | 导出同款静态 PNG |
| `doctor` | 检查本地依赖 |
| `web [folder]` | 启动本地网页工作台 |

`tsuzuri web [folder]` 会在本机起一个 HTTP server 并尝试打开默认浏览器：传入
`folder` 时浏览范围锁定在该素材夹内（不能跳出去看别的目录）；不传时浏览范围锁定在用户
主目录，可在网页里逐级选择素材夹。首次使用需要先构建前端：`npm --prefix web install && npm --prefix web run build`，
产物在 `web/dist`，`tsuzuri web` 会直接读取；未构建时会先看到一个提示占位页。

网页分**素材 / 制作 / 成果**三段：素材段列出照片、音乐、歌词并指出缺什么，制作段按素材与
依赖的实际状态决定能不能开工（不能时会写明缺什么、怎么补），成果段用来看成片、跟播歌词、
翻照片（大图带 EXIF 展签）。目前仍是只读的——制作段给出可复制的等效终端命令，在网页里
直接起渲染任务尚未接入。

`still` 支持 `-o`、`--exif`、`--sign`、`--dark`、`--skip-existing` 和 `--scale <1-4>`；视频渲染同样支持 `--exif`、`--sign`、`--dark`，效果与 still 对齐（渲染时覆盖，不写入 timeline.json）。`--draft` 会按正式分辨率的 2/3 快速输出预览（默认配置为 720p）并跳过响度归一；不带 `-o` 时，默认文件名会追加相应变体和 `-draft` 后缀。完整用法以 `node cli/tsuzuri.mjs help` 为准。

`--filter <id>` 和 `--filter-intensity <0-1>`（默认按滤镜自带强度）为 still 与视频渲染通用的滤镜开关，内置：`faded`（褪色）、`warm`（暖阳）、`cool`（冷调）、`mono`（黑白）、`vintage`（怀旧）、`vignette`（暗角）、`teal-orange`（青橙）、`riso`（孔版）、`film`（胶片褪色）。裸命令菜单在渲染/still 流程里也会问一步「选择滤镜」，回车即为无滤镜。

逐张滤镜可写进素材夹根目录的 `tsuzuri.json`（不存在则跳过，不影响原有流程）：

```json
{
  "filter": "mono",
  "intensity": 0.6,
  "perPhoto": {
    "IMG_0001.jpg": {"filter": "riso", "intensity": 0.8}
  }
}
```

`filter`/`intensity` 是全局默认，`perPhoto` 按照片文件名覆盖单张。优先级：命令行 `--filter` > `perPhoto` > 全局默认 > 无滤镜。`perPhoto` 条目内 `filter`、`intensity` 均可省略，省略时分别继承全局的 `filter`/`intensity`（例如只写 `intensity` 则沿用全局滤镜、仅调整强度）。`perPhoto` 的键是照片文件名，需精确匹配且大小写敏感。

视频默认使用可用逻辑 CPU 数减一并发渲染；内存紧张时可用 `TSUZURI_CONCURRENCY=4`
或 `TSUZURI_CONCURRENCY=50%` 临时降低并发，不写入项目配置。

`--sign` 的签名 SVG 可以用 [animated-signature](https://github.com/BazingaOrg/animated-signature)
在浏览器里可视化制作：输入名字、挑选手写字体后，导出**静态 SVG（tight bounds，固定色
或 currentColor）**，放进素材夹并在 `tsuzuri.toml` 里 `signature = "signature.svg"`
即可。不必导出动画版——tsuzuri 只读取路径数据，片头的手写描画由渲染器自己驱动，
路径顺序即书写笔顺。详细约束见 [docs/config.md](docs/config.md)。

[![animated-signature 工作室预览](https://raw.githubusercontent.com/BazingaOrg/animated-signature/main/docs/assets/preview.jpg)](https://github.com/BazingaOrg/animated-signature)

tsuzuri 会自动处理：

- 照片均有 EXIF 时间时按拍摄时间排列，否则按文件名排列
- 优先读取 `.lrc`，否则使用本地 Whisper；纯音乐自动跳过字幕
- 音频、LRC、demucs 设置和当前 Whisper/demucs 运行环境未变时复用分析结果；增删照片只重新规划
- 交互终端下缺音频/歌词时，主动提议在线获取（同 `fetch`）；素材齐备则不打扰
- 根据照片数量和歌曲长度选择踩点节奏，必要时在重拍处裁歌并淡出
- 正式成片响度归一到 −14 LUFS（TP −1.5 dB）；draft 为速度跳过此步

目前支持 `.jpg`、`.jpeg`、`.png`、`.webp` 图片，以及 `.mp3`、`.m4a`、`.wav`、`.flac`、`.aac`、`.ogg` 音频；视频素材暂不支持。

## 架构

![tsuzuri 架构：可选在线备料进入本地分析、规划与双渲染管线](docs/assets/architecture/architecture.png)

`fetch` 只负责把可选的在线素材写入素材夹；照片、音频和 LRC 就绪后，Analyze、Plan、
Remotion 渲染与响度处理都在本地完成。视频与 still 共用画布、字体、照片和配色系统。

## 可选在线备料

```bash
node cli/tsuzuri.mjs fetch ./osaka-trip
```

1. 显式 `fetch` 入口缺音频/缺歌词时，回车默认执行下载/搜索（渲染前的自动提议仍默认跳过）。
   可输入你有权使用的视频 URL，或用关键词从 5 个 yt-dlp 候选中选择，回车默认下载第 1 个。
2. 若素材夹已有多个音频，可选择保留一个；确认后才会删除其余文件，放弃则不改动文件。
3. 下载后确认歌曲名和可选歌手（默认预填来源标题与音频标签，回车即采纳），按
   `audio/歌曲名 - 歌手.ext` 整理文件名；替换已有音频必须确认。
4. [LRCLIB](https://lrclib.net) 按歌曲信息和音频时长搜索同步歌词；时长差超过 3 秒的候选会标出风险。
5. 歌词候选回车默认预览第 1 个；分页检查全部时间戳后再确认保存到 `audio/`。中文优先
   转为简体，英文和日文保持原文。

每个交互问题以青色 `?` 开头并自述可用键（格式统一为 `键 动作`，用 ` · ` 分隔）：回车执行
题目所示的安全默认动作，存在上一步时用 `0` 返回，任意交互问题输入 `q` 退出整个 tsuzuri，
Ctrl+C 中断。未知按键会原地提示，不会被静默当成确认或取消。菜单的路径输入题空回车返回主菜单。

音频下载需要自行安装 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（macOS：`brew install yt-dlp`），
`fetch` 只在实际下载时检查。已有歌词不会静默覆盖；放弃或没有匹配结果不算错误，仍可使用
本地歌词识别（音频不会上传）。退出交互会立即清理尚未确认的临时下载，下次需要重新下载。
只有交互终端会主动提议在线补齐，管道和脚本不会进入联网问答。

## 配置与文档

在素材文件夹中添加 `tsuzuri.toml`，可调整分辨率、帧率、过渡、字幕、背景、歌曲裁剪和片头片尾。
歌长图少并首次触发自动裁剪时，交互终端会询问接受裁剪还是播放完整首歌，并记住选择；
也可用 `--trim auto|full|秒数` 仅覆盖本次运行。

所有产出都保存在 `output/`：成片在其中，分析结果与偏好在 `output/metadata/`。旧项目首次运行会复制原有 `metadata/`，不会删除它。素材未变化时，可直接修改 `output/metadata/timeline.json` 后重跑，tsuzuri 会保留手动时间线并跳过重复分析。

`--portrait` 输出原生 1080×1920 竖版，`--square` 输出 1080×1080；二者只影响本次渲染，不改项目时间线，也可用于 `still`。

所有分析和渲染均在本地完成，不需要 API key。Whisper 会根据 Apple Silicon、NVIDIA CUDA 或 CPU 自动选择后端；模型仅在首次使用时下载。

- [配置参考](docs/config.md)：`tsuzuri.toml` 的全部选项
- [时间线格式](docs/specs/timeline-schema.md)：手动编辑 `timeline.json` 或开发渲染器
- [项目状态](docs/tsuzuri-status.md)：当前能力、约束和待验证事项

## 开发

```bash
cd analyzer && uv run pytest
cd cli && npm test
cd renderer && npm run typecheck
cd renderer && npm run studio
```

## 许可

代码采用 [MIT](LICENSE) 许可；内置 Noto 字体采用 [SIL OFL 1.1](renderer/src/fonts/OFL.txt)。
