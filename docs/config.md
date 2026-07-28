# tsuzuri.toml 配置参考

在素材夹根目录放置 `tsuzuri.toml` 可覆盖默认值。视频 Python 管线和 `still` 的 Node 管线使用同一份 21 键、顶层标量契约和共享 fixture；两者的诊断文案不承诺逐字相同。

配置只接受一行一个顶层 `key = value`。字符串只能用双引号，支持基本转义（如 `\"`、`\\`、`\u4e2d`）；双引号内的 `#` 是内容，行尾 `#` 才是注释。拒绝单引号字符串、table/数组表、数组、内联表、多行字符串、点号键、重复键、日期/时间、未加引号的字符串、带下划线的数字、二/八/十六进制整数、未知键和已弃用键 `motion`、`kenburns_from`、`kenburns_to`。非法配置会停止本次运行，不会回退默认值。

## 全部字段

- `width = 1920`：默认 `1920`；正整数。
- `height = 1080`：默认 `1080`；正整数。
- `fps = 60`：默认 `60`；1–240 的整数，`60.0` 不可用。
- `background = "#FFFFFF"`：默认 `"#FFFFFF"`；必须是带双引号的 `#RRGGBB`。
- `photo_scale = 0.8`：默认 `0.8`；大于 0 且不大于 1 的有限数字。
- `transition = "album"`：默认 `"album"`；`"album"`、`"cut"` 或 `"crossfade"`。
- `album_fade = 0.4`：默认 `0.4`；大于等于 0 的有限数字。
- `crossfade = 0.6`：默认 `0.6`；大于等于 0 的有限数字。
- `min_gap = 2.0`：默认 `2.0`；大于 0 的有限数字。
- `flash_min_gap = 0.8`：默认 `0.8`；大于 0 的有限数字。
- `flash_avg_threshold = 2.0`：默认 `2.0`；大于 0 的有限数字。
- `trim_avg_threshold = 10.0`：默认 `10.0`；大于 0 的有限数字。
- `trim_target_avg = 8.0`：默认 `8.0`；大于 0 的有限数字。
- `pacing = "dynamic"`：默认 `"dynamic"`；`"dynamic"` 或 `"uniform"`。
- `trim = "auto"`：默认 `"auto"`；`"auto"`、`"full"` 或大于 0 的有限秒数。
- `subtitles = true`：默认 `true`；布尔值。
- `chapters = true`：默认 `true`；布尔值。
- `demucs = true`：默认 `true`；布尔值。
- `intro = true`：默认 `true`；布尔值。
- `outro_text = ""`：默认空字符串；不含换行的双引号字符串。
- `signature = ""`：默认空字符串；空字符串，或素材夹内存在的相对 `.svg` 路径。

`--portrait`、`--square` 和 `--dark` 只覆盖本次视频或 still 输出，不写回配置或 timeline。`--trim` 只覆盖本次视频运行；交互式自动裁剪选择保存于 `output/metadata/preferences.json`。

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
```

`tsuzuri.toml` 会参与项目输入摘要；配置改变会重新分析和规划。分析缓存另有按 LRC 与 demucs 实际路径计算的运行时 v2 指纹，见[项目状态](tsuzuri-status.md)。
