# tsuzuri（綴り）

> 照片 + 一首歌（可选歌词），生成踩点影像日记。本地工作台可整理素材、制作视频或静态图并查看成果；分析与渲染在本机完成，在线备料可选。

**中文** · [English](README.en.md)

## 快速开始

需要 [Node.js 18+](https://nodejs.org/)、[uv](https://docs.astral.sh/uv/) 和 [FFmpeg](https://ffmpeg.org/)。

```bash
npm --prefix cli install
npm --prefix renderer install
node cli/tsuzuri.mjs doctor
node cli/tsuzuri.mjs ./osaka-trip
```

素材夹包含照片、唯一音频，以及可选 `.lrc`；音频和歌词可放在根目录或 `audio/`。没有 `.lrc` 时，首次使用可能下载所需模型并在本地识别歌词。

## 使用

```bash
node cli/tsuzuri.mjs
node cli/tsuzuri.mjs ./osaka-trip
node cli/tsuzuri.mjs ./osaka-trip -o out.mp4
node cli/tsuzuri.mjs lyrics ./osaka-trip
node cli/tsuzuri.mjs fetch ./osaka-trip
node cli/tsuzuri.mjs still ./photo.jpg
node cli/tsuzuri.mjs doctor
node cli/tsuzuri.mjs templates
node cli/tsuzuri.mjs web ./osaka-trip
node cli/tsuzuri.mjs help
```

不带参数会打开常驻交互菜单；每个流程完成、取消或报错后回到菜单，输入 `q` 退出。带参数的命令执行一次后退出。`<folder>` 制作视频，`lyrics` 只预览歌词，`fetch` 交互补齐在线音频或歌词，`still` 导出 PNG，`doctor` 检查依赖，`templates` 列出呈现模板，`web [folder]` 启动本地工作台；完整语法以 `help` 为准。视频可用 `--template <id>` 选呈现模板（转场/字幕/章节卡的"长相"），`templates` 可查看可用模板；滤镜、暗色等素材基调选项与模板互相独立。

默认视频为 `osaka-trip/output/osaka-trip.mp4`，静态图默认位于 `output/stills/`。未使用 `-o` 时，EXIF、签名、暗色、画幅、草稿、模板和实际生效的滤镜会追加到默认文件名；显式 `-o` 保持原样优先。

`web` 首次使用需构建前端：`npm --prefix web install && npm --prefix web run build`。网页可查看和制作素材，也可改名或删除资产；写入受启动时的素材根目录、服务 token、冲突与任务检查保护，删除先移入回收区并仅提供进程内撤销。详见[项目状态](docs/tsuzuri-status.md)。

## 架构

本地工作台和 CLI 共享受控任务运行时；在线备料只写入素材项目边界，分析与渲染始终在本机完成。

![tsuzuri 本地媒体工作台架构](docs/assets/architecture/architecture.png)

## 配置与文档

- [配置参考](docs/config.md)：严格的 `tsuzuri.toml` 21 键契约
- [时间线格式](docs/specs/timeline-schema.md)：`timeline.json` 的只读校验边界
- [项目状态](docs/tsuzuri-status.md)：工作台、缓存与已知限制

## 开发

```bash
cd analyzer && uv run pytest
cd cli && npm test
cd renderer && npm run typecheck
cd renderer && npm run studio
```

## 许可

代码采用 [MIT](LICENSE) 许可；内置 Noto 字体采用 [SIL OFL 1.1](renderer/src/fonts/OFL.txt)。
