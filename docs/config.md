# kiseki.toml 配置参考

在素材夹根目录放置 `kiseki.toml` 可覆盖默认值。视频 Python 管线和 `still` 的 Node 管线使用同一份 22 键、顶层标量契约和共享 fixture；两者的诊断文案不承诺逐字相同。

配置只接受一行一个顶层 `key = value`。字符串只能用双引号，支持基本转义（如 `\"`、`\\`、`\u4e2d`）；双引号内的 `#` 是内容，行尾 `#` 才是注释。拒绝单引号字符串、table/数组表、数组、内联表、多行字符串、点号键、重复键、日期/时间、未加引号的字符串、带下划线的数字、二/八/十六进制整数、未知键和已弃用键 `motion`、`kenburns_from`、`kenburns_to`。非法配置会停止本次运行，不会回退默认值。

## 全部字段

- `width = 1920`：默认 `1920`；正整数。
- `height = 1080`：默认 `1080`；正整数。
- `fps = 60`：默认 `60`；1–240 的整数，`60.0` 不可用。
- `background = "#FFFFFF"`：默认 `"#FFFFFF"`；必须是带双引号的 `#RRGGBB`。
- `photo_scale = 0.8`：默认 `0.8`；大于 0 且不大于 1 的有限数字。
- `transition = "album"`：默认 `"album"`；`"album"`、`"cut"` 或 `"crossfade"`。
- `album_fade = 0.25`：默认 `0.25`；大于等于 0 的有限数字。相册淡入从切换时刻开始，并在这段时间里完成。`crossfade` 仍以切换时刻为中点。日记和胶片带在渲染时，若淡化不短于这张照片的停留，会把淡化收到停留减去 0.12 秒；短到放不下就改成硬切。拍立得的卡片入场不变。规划仍按这里的时长写时间线。
- `crossfade = 0.6`：默认 `0.6`；大于等于 0 的有限数字。
- `min_gap = 2.0`：默认 `2.0`；大于 0 的有限数字。裁剪落点和日期章节卡使用的最短停留。照片切换的最短间隔是这一首的一小节，塞不下全部照片时退到一拍。
- `flash_min_gap = 0.8`：默认 `0.8`；大于 0 的有限数字。平均每张短于 `flash_avg_threshold` 时，开场回顾是否放得下，以及日期章节卡，用这个最短停留。
- `flash_avg_threshold = 2.0`：默认 `2.0`；大于 0 的有限数字。平均每张短于这个值时不预留片头，日期章节卡改用每拍。
- `trim_avg_threshold = 10.0`：默认 `10.0`；大于 0 的有限数字。
- `trim_target_avg = 8.0`：默认 `8.0`；大于 0 的有限数字。
- `pacing = "dynamic"`：默认 `"dynamic"`；`"dynamic"` 或 `"uniform"`。`dynamic` 让响度变化参与选哪一拍；`uniform` 不看响度。两者都在拍点上选。
- `trim = "full"`：默认 `"full"`；`"auto"`、`"full"` 或大于 0 的有限秒数。 `auto` 会在照片偏少时于合适节拍处收尾。
- `subtitles = true`：默认 `true`；布尔值。
- `chapters = true`：默认 `true`；布尔值。每张照片都有拍摄日期、并且跨过至少两天时，换日处尽量插入整屏日期卡。卡放不下时照片仍全部保留，日期改写在当天第一张照片上。
- `demucs = true`：默认 `true`；布尔值。
- `intro = true`：默认 `true`；布尔值。
- `opening_recap = true`：默认 `true`；布尔值。片头开启、照片不少于 8 张且正文仍能容纳全部照片时，在签名后把全部照片从最后一张快放到第一张，一次一张，再停在第一张进入正文。窗口最长 2.8 秒。`false` 时保留原片头与正文节奏。
- `outro_text = ""`：不写这个键时，片尾白场显示 `Thanks for watching :)`。写成空字符串则不显示这句。不含换行。有音乐且能读到歌名或作者时，这句下面另起一行显示「歌名 · 作者」；这一行不写进片尾文字。制作页的「片尾文字」只覆盖这一次渲染。
- `signature = ""`：默认空字符串，用内置片头签名；或素材夹内存在的相对 `.svg` 路径。制作页可以输入名字，生成本次成片的片头签名；导出静态图时，这份签名作为落款。不改这个键。

`--portrait`、`--square` 和 `--dark` 只覆盖本次视频或 still 输出，不写回配置或 timeline。`--trim` 只覆盖本次视频运行；交互式自动裁剪选择保存于 `output/metadata/preferences.json`。`--photo-caption` 同样只覆盖本次运行；`DEEPSEEK_API_KEY` 不属于 `kiseki.toml`。在工作台环境面板填写后会写入仓库根目录的 `.env`（已被 gitignore）并立即生效。shell 里已有的同名变量不会被文件覆盖。

## 示例

```toml
fps = 30
background = "#000000" # 深色背景
photo_scale = 0.85
transition = "crossfade"
trim = "full"
subtitles = false
outro_text = "谢谢观看 #1"
signature = "signature.svg"
intro = false
opening_recap = false
```

`kiseki.toml` 会参与项目输入摘要；配置改变会重新分析和规划。分析缓存另有按 LRC 与 demucs 实际路径计算的运行时 v2 指纹，见[项目状态](kiseki-status.md)。
