# timeline.json v1

`output/metadata/timeline.json` 是 planner 产物，也是可手动编辑的渲染输入。CLI 的 validator 是**只读边界检查**：不补默认值、不排序、不修复、不写回；它不是完整 JSON Schema，也不保证照片或字幕的连续性、排序或首尾覆盖。

校验发生在两个入口：主 CLI 读取 timeline 后、统计照片前，以及内部 `render.mjs` 加载 Remotion 前。错误带精确 JSON path，例如 `$.photos[2].transition.duration`。

## 根对象与 meta

根对象必须包含对象 `meta`、数组 `photos` 和数组 `subtitles`。

`meta` 必填：

- `version`：正整数
- `duration`：正有限数
- `audio`：字符串
- `width`、`height`、`fps`：正整数
- `background`：字符串
- `photo_scale`：正有限数

可选 `meta.sign` 是布尔值；`meta.filter` 为 `null` 或对象 `{ "id": string, "intensity"?: 0..1 }`，其中 `id` 不能空。

可选 `meta.trim` 必须有 `mode`（`"auto"`、`"full"` 或 `"seconds"`）、`applied`（布尔）、`full_duration` 与 `trimmed_duration`（正有限数），且后者不大于前者。可选 `meta.chapters` 必须有 `enabled`（布尔）、`day_count` 与 `card_count`（非负整数）。可选 `meta.branding` 的 `outro_text`、`signature` 为字符串，`intro` 为布尔。

## photos

每个 `photos[i]` 是对象，且 `start`、`end` 都是非负有限数，`end > start` 且不超过 `$.meta.duration`。

- 省略 `kind` 仍按旧版照片处理。
- `kind: "photo"` 必须有非空 `src`；可选 `transition` 是 `{ "type": "album" | "crossfade" | "cut" | "none", "duration": 非负有限数 }`，其中 `cut` 与 `none` 的 duration 必须为 0。可选 `motion` 的 type 是 `"kenburns"` 或 `"none"`，`from`、`to` 为正有限数。可选 `filter` 服从 `meta.filter` 的形状。
- `kind: "chapter"` 必须有字符串 `text`。
- 任何未知字符串 `kind` 保留并跳过其余字段校验，以兼容未来事件；这不表示旧渲染器一定理解它。

## subtitles 与 beats

每个 `subtitles[i]` 必须是对象：`text` 为字符串，`lang` 为 `"ja"`、`"zh"`、`"en"` 或 `"mixed"`，`start`/`end` 服从同一时间边界，`confidence` 为有限数。

可选 `beats` 是对象：`bpm` 为正有限数，`downbeats` 为非负有限数数组。它可供调试或其他消费者使用；validator 不推断节奏语义。

`input_hash`、`plan_checksum` 及其他未被当前渲染器读取的字段可保留；validator 不将它们扩展为完整 schema 契约。
