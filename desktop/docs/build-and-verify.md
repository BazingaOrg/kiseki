# macOS Desktop 构建与验证

## 可复现构建输入

所有输入必须是 Apple Silicon arm64、版本固定且已完成许可证审核的本地路径：

```bash
export KISEKI_FFMPEG_BIN=/absolute/path/to/ffmpeg
export KISEKI_FFPROBE_BIN=/absolute/path/to/ffprobe
export KISEKI_UV_BIN=/absolute/path/to/uv
export KISEKI_CHROMIUM_BIN=/absolute/path/to/chromium-distribution
export KISEKI_PYTHON_RUNTIME=/absolute/path/to/python-runtime
export KISEKI_ANALYZER_WHEELHOUSE=/absolute/path/to/offline-wheelhouse
export KISEKI_RUNTIME_LICENSES=/absolute/path/to/licenses
```

Chromium 目录必须包含 `bin/chrome-headless-shell`；Python 目录必须包含
`bin/python3`。Analyzer wheelhouse 必须与 `analyzer/uv.lock` 完全匹配。

先按各模块锁文件安装依赖，再构建：

```bash
npm ci --prefix cli
npm ci --prefix renderer
npm ci --prefix web
npm ci --prefix desktop
npm --prefix web run build
npm --prefix desktop run make
```

staging 会拒绝缺失输入、符号链接、空 wheelhouse、空许可证目录、不可执行文件和
哈希不一致，并生成 `runtime-files.json`。Forge 只把 runtime 复制到
`Contents/Resources/kiseki-runtime`，不会把 staging 再塞进 ASAR。

## 用户验证清单

按实施计划 Step 12 执行 CLI、Analyzer、Renderer、Web 与 Desktop 全量检查，并重点验证：

- 将 `.app` 移出仓库后启动；
- 清空系统 PATH 中的 Node、Python、uv、FFmpeg 和 Chrome 后完成 fixture 工作流；
- Home 外、外置磁盘、中文与空格路径；
- still、视频、歌词识别、取消、关闭窗口、退出、睡眠与唤醒；
- 退出后无 Node、Chromium、FFmpeg 孤儿进程；
- 深浅色、键盘焦点、最小窗口和 reduced-motion；
- `runtime-files.json`、第三方许可证、二进制版本和 arm64 架构。

在线音频下载仍是可选能力，未内置 yt-dlp 时其余功能必须保持可用。
