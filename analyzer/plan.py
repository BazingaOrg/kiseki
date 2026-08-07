"""plan 阶段:beats.json(+ lyrics.json)+ 照片文件夹 → timeline.json。

自动决策:
- 照片顺序:EXIF 拍摄时间优先,无 EXIF 按文件名排序(打印一行告知)
- 快闪模式:平均每张展示 < 2s → 吸附目标从重拍降级为每拍,min_gap 放宽到 0.8s
- 字幕:lyrics.json 存在则并入,否则空数组(纯音乐)
配置:文件夹内可选 tsuzuri.toml(photo_scale / min_gap 等),缺省即默认值。
"""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import math
import re
import sys
import tomllib
from pathlib import Path

from PIL import ExifTags, Image

import term
from atomic_json import write_json_atomic
from beat_alloc import allocate_switch_points, dynamic_switch_ideals

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

DEFAULTS = {
    "width": 1920,
    "height": 1080,
    "fps": 60,
    "background": "#FFFFFF",
    "photo_scale": 0.8,
    "min_gap": 2.0,
    "transition": "album",    # album(透明度切换,默认)| cut(纯硬切)| crossfade
    "album_fade": 0.4,
    "crossfade": 0.6,
    "flash_avg_threshold": 2.0,
    "flash_min_gap": 0.8,
    "trim_avg_threshold": 10.0,  # 平均每张展示超过此值 → 裁剪音频
    "trim_target_avg": 8.0,      # 裁剪目标:平均每张展示秒数
    "trim": "auto",             # auto(自动裁剪)| full(整首)| 正数秒数
    "subtitles": True,           # 字幕轨总开关
    "chapters": True,            # EXIF 跨天时插入日期章节卡
    "pacing": "dynamic",        # dynamic(按能量疏密)|uniform(旧版均匀)
    # 片头/片尾运行默认仅用于规划;展示默认值的单一来源在 renderer/theme.ts
    "outro_text": "",
    "signature": "",             # 空串 = 内置签名;非空为素材夹内 .svg 相对路径
    "intro": True,               # false 时跳过片头且 plan 不预留片头时长
    "demucs": True,              # 分离人声开关;由 analyze 阶段消费
}

DEPRECATED_KEYS = {"motion", "kenburns_from", "kenburns_to"}

# 识别段置信度阈值,与渲染层 SUBTITLE.confidenceThreshold 保持一致(LRC 固定为 1.0)
CONFIDENCE_THRESHOLD = 0.6

# 渲染端片头/片尾遮挡时长镜像——两侧独立维护,改一处需同步另一处:
#   INTRO_DURATION      <- renderer/src/Intro.tsx introDuration
#                          (INTRO.drawDuration + inkDuration + hold + fadeOut)
#   WHITE_FADE_DURATION <- renderer/src/theme.ts ANIMATION.whiteFadeDuration
#   MIN_PHOTO_VISIBLE   <- renderer/src/Diary.tsx showIntro 规则中的 INTRO.minPhotoVisible
INTRO_DURATION = 2.65
WHITE_FADE_DURATION = 2.5
MIN_PHOTO_VISIBLE = 0.8

# 片头预留生效的最短总时长(与渲染端 showIntro 的判定条件对齐)
SHOW_INTRO_MIN_T = INTRO_DURATION + WHITE_FADE_DURATION + MIN_PHOTO_VISIBLE  # 5.95
# 预留生效时,首张照片切换点的下界(经片头覆盖后仍保证可见时长)
SHOW_INTRO_MIN_PHOTO0_END = INTRO_DURATION + MIN_PHOTO_VISIBLE  # 3.45

DATETIME_ORIGINAL = next(k for k, v in ExifTags.TAGS.items() if v == "DateTimeOriginal")


def _content_checksum(timeline: dict) -> str:
    """整份 timeline(除 meta.plan_checksum 自身外)的内容校验和。

    用途:区分"素材没变、文件也没被手动碰过"(校验和吻合 → 可放心用最新
    算法覆盖刷新)和"素材没变但文件被手改过"(校验和不吻合 → 手改优先,
    原样保留)。故意覆盖整份文档而非挑选字段——防止漏掉某个字段(例如
    meta.photo_scale 这类用户可能直接手改的值)导致手改被静默覆盖;
    以后 build_timeline 加新字段也自动纳入,不用记得同步维护校验范围。
    """
    meta = {k: v for k, v in timeline.get("meta", {}).items() if k != "plan_checksum"}
    payload = {**timeline, "meta": meta}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _write_status(path: Path | None, outcome: str) -> None:
    """向 Node CLI 报告 plan 是否真的生成了 timeline；不进入项目产物。"""
    if path is None:
        return
    write_json_atomic(path, {"outcome": outcome})


def _is_trim_seconds(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and float(value) > 0
    )


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= 2**53 - 1


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _non_decimal_integer_key(text: str) -> str | None:
    """返回首个使用 0x/0o/0b 的顶层配置键，镜像 Node 标量子集。"""
    for line in text.splitlines():
        match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=\s*[+-]?0[xob]", line, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _literal_string_key(text: str) -> tuple[str, int] | None:
    """返回首个单引号标量字符串的 bare key 与行号。

    tomllib 解析后会丢失字符串引号形式；这里只镜像产品配置允许的 bare
    key = scalar 词法边界。值从等号后开始检查，双引号字符串内的 # 不会被
    当作注释或重新扫描。
    """
    for line_no, line in enumerate(text.splitlines(), start=1):
        match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=\s*", line)
        if match and line[match.end() :].startswith("'"):
            return match.group(1), line_no
    return None


def _numeric_underscore_key(text: str) -> tuple[str, int] | None:
    """返回首个含下划线的 bare 数字标量的 key 与行号。"""
    for line_no, line in enumerate(text.splitlines(), start=1):
        match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=\s*([+-]?\d[^\s#]*)", line)
        if match and "_" in match.group(2):
            return match.group(1), line_no
    return None


def _signature_is_in_folder(value: object, folder: Path) -> bool:
    if not isinstance(value, str):
        return False
    if value == "":
        return True
    candidate = (folder / value).resolve()
    return (
        value.lower().endswith(".svg")
        and candidate.is_file()
        and candidate.is_relative_to(folder.resolve())
    )


# 与 cli/config.mjs 保持字段、默认值和约束一致。tomllib 负责完整 TOML
# 语法;本表随后将其收窄到产品约定的顶层标量子集,防止 Python 侧悄悄接受
# Node 侧拒绝的 table/array/date 等 TOML 值。
CONFIG_SCHEMA = {
    "width": ("正整数", lambda v, _folder: _is_int(v) and v > 0),
    "height": ("正整数", lambda v, _folder: _is_int(v) and v > 0),
    "fps": ("1–240 之间的整数(不接受 60.0 这样的小数字面量)", lambda v, _folder: _is_int(v) and 1 <= v <= 240),
    "background": ("6 位十六进制颜色字符串(如 '#FFFFFF')", lambda v, _folder: isinstance(v, str) and bool(re.fullmatch(r"#[0-9A-Fa-f]{6}", v))),
    "photo_scale": ("0–1 之间的数字(不含 0)", lambda v, _folder: _is_number(v) and 0 < v <= 1),
    "transition": ('"album"、"cut" 或 "crossfade"', lambda v, _folder: isinstance(v, str) and v in {"album", "cut", "crossfade"}),
    "album_fade": ("大于等于 0 的数字", lambda v, _folder: _is_number(v) and v >= 0),
    "crossfade": ("大于等于 0 的数字", lambda v, _folder: _is_number(v) and v >= 0),
    "min_gap": ("大于 0 的数字", lambda v, _folder: _is_number(v) and v > 0),
    "flash_min_gap": ("大于 0 的数字", lambda v, _folder: _is_number(v) and v > 0),
    "flash_avg_threshold": ("大于 0 的数字", lambda v, _folder: _is_number(v) and v > 0),
    "trim_avg_threshold": ("大于 0 的数字", lambda v, _folder: _is_number(v) and v > 0),
    "trim_target_avg": ("大于 0 的数字", lambda v, _folder: _is_number(v) and v > 0),
    "pacing": ('"dynamic" 或 "uniform"', lambda v, _folder: isinstance(v, str) and v in {"dynamic", "uniform"}),
    "trim": ('"auto"、"full" 或正数秒数', lambda v, _folder: (isinstance(v, str) and v in {"auto", "full"}) or _is_trim_seconds(v)),
    "subtitles": ("布尔值 true/false", lambda v, _folder: isinstance(v, bool)),
    "chapters": ("true 或 false", lambda v, _folder: isinstance(v, bool)),
    "demucs": ("布尔值 true/false", lambda v, _folder: isinstance(v, bool)),
    "intro": ("布尔值 true/false", lambda v, _folder: isinstance(v, bool)),
    "outro_text": ("不含换行符的字符串", lambda v, _folder: isinstance(v, str) and "\n" not in v),
    "signature": ("空字符串,或以 .svg 结尾且存在于素材夹内的相对路径", _signature_is_in_folder),
}


def _parse_trim_arg(value: str) -> str | float:
    if value in {"auto", "full"}:
        return value
    try:
        seconds = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('--trim 必须是 auto、full 或正数秒数') from exc
    if not _is_trim_seconds(seconds):
        raise argparse.ArgumentTypeError('--trim 必须是 auto、full 或正数秒数')
    return seconds


def load_config(folder: Path) -> dict:
    cfg = dict(DEFAULTS)
    explicit_branding: set[str] = set()
    toml_path = folder / "tsuzuri.toml"
    if toml_path.is_file():
        text = toml_path.read_text(encoding="utf-8")
        literal_string = _literal_string_key(text)
        if literal_string:
            key, line_no = literal_string
            term.error(
                f"tsuzuri.toml 第 {line_no} 行: {key}: 字符串只允许双引号字符串,请改用 \"...\""
            )
            raise SystemExit(1)
        numeric_underscore = _numeric_underscore_key(text)
        if numeric_underscore:
            key, line_no = numeric_underscore
            term.error(
                f"tsuzuri.toml 第 {line_no} 行: {key}: 数字不允许下划线,请改用不带下划线的十进制"
            )
            raise SystemExit(1)
        try:
            user = tomllib.loads(text)
        except tomllib.TOMLDecodeError as exc:
            term.error(f"tsuzuri.toml 语法错误: {exc}")
            raise SystemExit(1) from exc
        non_decimal_key = _non_decimal_integer_key(text)
        if non_decimal_key:
            term.error(
                f"tsuzuri.toml: {non_decimal_key} 不支持 0x/0o/0b 进制整数,请改用十进制"
            )
            raise SystemExit(1)
        deprecated = set(user) & DEPRECATED_KEYS
        if deprecated:
            term.error(f"tsuzuri.toml 配置 {sorted(deprecated)} 已弃用且不再生效,请删除该行")
            raise SystemExit(1)
        unknown = set(user) - set(CONFIG_SCHEMA)
        if unknown:
            term.error(f"tsuzuri.toml 中存在未知配置项: {sorted(unknown)}")
            raise SystemExit(1)
        for key, value in user.items():
            expected, validator = CONFIG_SCHEMA[key]
            if not validator(value, folder):
                term.error(f"tsuzuri.toml: {key} 必须是 {expected},收到 {value!r}")
                raise SystemExit(1)
        cfg.update(user)
        explicit_branding = set(user) & {"outro_text", "signature", "intro"}
    cfg["_explicit_branding"] = explicit_branding
    return cfg


def exif_datetime(path: Path) -> str | None:
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            value = exif.get(DATETIME_ORIGINAL)
            if not value:
                value = exif.get_ifd(ExifTags.IFD.Exif).get(DATETIME_ORIGINAL)
            return str(value) if value else None
    except Exception:
        return None


def _is_valid_image(path: Path) -> bool:
    try:
        with Image.open(path) as im:
            im.verify()
        return True
    except Exception:
        term.warn(f"图片损坏,已跳过: {path.name}")
        return False


def ordered_photos(folder: Path) -> list[Path]:
    photos = sorted(
        p
        for p in folder.iterdir()
        if p.suffix.lower() in IMAGE_EXTS and _is_valid_image(p)
    )
    if not photos:
        term.error(f"{folder} 中没有图片(支持 {'/'.join(sorted(IMAGE_EXTS))})")
        raise SystemExit(1)
    stamps = {p: exif_datetime(p) for p in photos}
    if all(stamps.values()):
        term.detail(f"photo order: EXIF 拍摄时间({len(photos)} 张)")
        return sorted(photos, key=lambda p: (stamps[p], p.name))
    term.detail(f"photo order: 文件名排序({len(photos)} 张,EXIF 时间不完整)")
    return photos


CHAPTER_SYMBOLS = [":)", "♪", "✦", "˖°"]


def _photo_days(photos: list[Path]) -> list[str] | None:
    """Return sortable YYYY-MM-DD days only when every DateTimeOriginal is usable."""
    days = []
    for photo in photos:
        stamp = exif_datetime(photo)
        if not stamp:
            return None
        try:
            days.append(datetime.strptime(stamp, "%Y:%m:%d %H:%M:%S").date().isoformat())
        except (ValueError, TypeError):
            return None
    return days


def _insert_chapters(clips: list[dict], photos: list[Path], beats: list[float], min_gap: float) -> tuple[list[dict], dict]:
    days = _photo_days(photos)
    if days is None or len(set(days)) < 2:
        if days is None:
            term.detail("日期章节未启用: EXIF 时间不完整或无效")
        return clips, {"enabled": False, "day_count": len(set(days or [])), "card_count": 0}
    day_number = {day: index + 1 for index, day in enumerate(dict.fromkeys(days))}
    cards: list[dict] = []
    for index in range(1, len(clips)):
        if days[index] == days[index - 1]:
            continue
        boundary = clips[index]["start"]
        before = clips[index - 1]
        after = clips[index]
        prior = [beat for beat in beats if before["start"] + min_gap <= beat < boundary and 1 <= boundary - beat <= 3]
        later = [beat for beat in beats if boundary < beat <= after["end"] - min_gap and 1 <= beat - boundary <= 3]
        if prior:
            cut = min(prior, key=lambda beat: abs(beat - (boundary - 2)))
            before["end"] = round(cut, 3)
            start, end = cut, boundary
        elif later:
            cut = min(later, key=lambda beat: abs(beat - (boundary + 2)))
            after["start"] = round(cut, 3)
            start, end = boundary, cut
        else:
            term.detail(f"日期章节跳过: {days[index]} 两侧照片时长不足")
            continue
        month, day = (int(part) for part in days[index].split("-")[1:])
        ordinal = day_number[days[index]]
        cards.append({"kind": "chapter", "text": f"{month}月{day}日 · 第{ordinal}天 {CHAPTER_SYMBOLS[(ordinal - 1) % len(CHAPTER_SYMBOLS)]}", "start": round(start, 3), "end": round(end, 3)})
    merged = sorted([*clips, *cards], key=lambda clip: (clip["start"], clip.get("kind") == "chapter"))
    return merged, {"enabled": bool(cards), "day_count": len(day_number), "card_count": len(cards)}


def build_timeline(folder: Path, beats: dict, lyrics: list[dict], cfg: dict,
                   input_hash: str | None) -> dict:
    photos = ordered_photos(folder)
    full_duration = float(beats["duration"])
    duration = full_duration
    n = len(photos)
    avg = duration / n

    trim_value = cfg["trim"]
    trim_mode = "seconds" if _is_trim_seconds(trim_value) else trim_value
    target = float(trim_value) if trim_mode == "seconds" else n * cfg["trim_target_avg"]
    should_trim = (
        (trim_mode == "seconds" and target < full_duration)
        or (trim_mode == "auto" and avg > cfg["trim_avg_threshold"])
    )
    # 图少歌长或显式秒数:在目标时长附近的重拍处截断
    # (渲染端按 duration 收尾淡出,无需真裁音频)。
    if should_trim:
        candidates = [
            d for d in beats["downbeats"]
            if n * cfg["min_gap"] <= d < full_duration
        ]
        if candidates:
            duration = min(candidates, key=lambda d: abs(d - target))
            avg = duration / n
            term.info(f"裁剪模式: 歌长图少,在 {duration:.1f}s 重拍处截断并淡出,平均每张 {avg:.1f}s")
        else:
            term.info("裁剪模式: 找不到满足最小照片间隔的重拍点,保留完整歌曲")

    is_flash = avg < cfg["flash_avg_threshold"]
    if is_flash:
        candidates, min_gap = beats["beats"], cfg["flash_min_gap"]
        term.info(f"快闪模式: 平均每张 {avg:.1f}s < {cfg['flash_avg_threshold']}s,吸附每拍,min_gap={min_gap}s")
    else:
        candidates, min_gap = beats["downbeats"], cfg["min_gap"]

    # 首个切换点避开前奏,但最多让出一个网格槽位:
    # 强 onset 阈值在响度起伏大的歌里可能落到很晚,不设上限会把全部照片挤进后段
    # (牺牲整体节奏比前奏内多切一刀更伤,取更安全的失败方式)
    not_before = min(float(beats.get("first_strong_onset", 0.0)), duration / n)

    # 片头预留:非快闪且总时长够长(与渲染端 showIntro 判定对齐)时,把理想网格
    # 整体右移 INTRO_DURATION,并抬高首个切换点下界,保证片头盖完后首张照片仍
    # 有意义的可见时长。快闪模式天然产出很短的首段(<3s),渲染端会自动跳过片头,
    # 强行预留反而会挤占本就紧张的切换空间,故不预留。
    # intro=false 时两端都不挂片头,也不预留(单一事实来源是 toml)。
    #
    # n == 2 时只有一个切换点,须同时满足头(>= SHOW_INTRO_MIN_PHOTO0_END)与
    # 尾(<= duration - WHITE_FADE_DURATION - MIN_PHOTO_VISIBLE)两个约束,可行
    # 窗口非空要求 duration >= SHOW_INTRO_MIN_T + MIN_PHOTO_VISIBLE(6.75s),
    # 比 n>=3 时头尾分属不同切换点的门槛(5.95s)更紧;否则窄窗口内找不到候选
    # 会直接丢弃第二张照片(min_gap 优先于预留,详见 beat_alloc 回退分支)。
    intro_enabled = bool(cfg.get("intro", True))
    min_duration_for_reserve = SHOW_INTRO_MIN_T + (MIN_PHOTO_VISIBLE if n == 2 else 0.0)
    head_offset = 0.0
    if (
        intro_enabled
        and not is_flash
        and duration >= min_duration_for_reserve
        and n >= 2
    ):
        not_before = max(not_before, SHOW_INTRO_MIN_PHOTO0_END)
        head_offset = INTRO_DURATION

    # 片尾预留:任何时长都尝试让末张照片在片尾白场开始前留有可见时间,
    # 但绝不比"均分网格"本该落点更早(allocate_switch_points 内部取 max 兜底)
    not_after = duration - WHITE_FADE_DURATION - MIN_PHOTO_VISIBLE

    ideal_points = None
    if not is_flash and cfg["pacing"] == "dynamic":
        ideal_points = dynamic_switch_ideals(duration, n, beats["beats"], beats.get("energy"), head_offset=head_offset)
    switches = allocate_switch_points(
        duration, n, candidates,
        min_gap=min_gap, not_before=not_before,
        head_offset=head_offset, not_after=not_after,
        ideal_points=ideal_points,
    )
    if len(switches) < n - 1:
        dropped = n - 1 - len(switches)
        term.warn(f"时长塞不下全部照片,丢弃末尾 {dropped} 张")
        photos = photos[: len(switches) + 1]
        n = len(photos)

    if cfg["transition"] == "crossfade":
        later_transition = {"type": "crossfade", "duration": cfg["crossfade"]}
    elif cfg["transition"] == "cut":
        later_transition = {"type": "cut", "duration": 0}
    else:
        later_transition = {"type": "album", "duration": cfg["album_fade"]}
    motion = {"type": "none", "from": 1.0, "to": 1.0}

    bounds = [0.0, *switches, duration]
    clips = []
    for i, p in enumerate(photos):
        clips.append({
            "kind": "photo",
            "src": f"./{p.relative_to(folder)}",
            "start": round(bounds[i], 3),
            "end": round(bounds[i + 1], 3),
            "transition": {"type": "none", "duration": 0} if i == 0 else dict(later_transition),
            "motion": dict(motion),
        })

    chapter_meta = {"enabled": False, "day_count": 0, "card_count": 0}
    if cfg["chapters"]:
        clips, chapter_meta = _insert_chapters(clips, photos, [float(beat) for beat in candidates], min_gap)

    explicit_branding = cfg.get("_explicit_branding", set())
    branding: dict = {}
    if "outro_text" in explicit_branding:
        branding["outro_text"] = cfg["outro_text"]
    if "intro" in explicit_branding:
        branding["intro"] = bool(cfg["intro"])
    if "signature" in explicit_branding:
        branding["signature"] = cfg["signature"]

    meta = {
        "version": 1,
        "audio": f"./{beats['audio']}",
        "duration": round(duration, 3),
        "width": cfg["width"],
        "height": cfg["height"],
        "fps": cfg["fps"],
        "background": cfg["background"],
        "photo_scale": cfg["photo_scale"],
        "trim": {
            "mode": trim_mode,
            "applied": duration < full_duration,
            "full_duration": round(full_duration, 3),
            "trimmed_duration": round(duration, 3),
        },
        "chapters": chapter_meta,
    }
    if branding:
        meta["branding"] = branding
    if input_hash:
        meta["input_hash"] = input_hash

    # 歌长图少裁剪时,落在截断点之后的歌词行必须过滤、跨过截断点的行把 end
    # 收敛到 duration——否则 timeline 校验(subtitles.end <= meta.duration)会
    # 拒绝整份时间线,渲染端也本就不该有超出最后一帧的字幕。
    if duration < full_duration and lyrics:
        kept_lyrics = [
            {**line, "end": min(line["end"], duration)}
            for line in lyrics
            if line["start"] < duration
        ]
        dropped = len(lyrics) - len(kept_lyrics)
        if dropped:
            term.info(f"歌词: 裁剪到 {duration:.1f}s,过滤 {dropped} 行超出部分的歌词")
        lyrics = kept_lyrics

    result = {
        "meta": meta,
        "photos": clips,
        "subtitles": lyrics,
        "beats": {"bpm": beats["bpm"], "downbeats": beats["downbeats"]},
    }
    result["meta"]["plan_checksum"] = _content_checksum(result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="tsuzuri plan: beats/lyrics -> timeline.json")
    parser.add_argument("folder", type=Path, help="素材文件夹(照片 + 音频)")
    parser.add_argument("--beats", type=Path, default=None, help="beats.json(默认 folder/output/metadata/beats.json)")
    parser.add_argument("--lyrics", type=Path, default=None, help="lyrics.json(默认 folder/output/metadata/lyrics.json,可选)")
    parser.add_argument("--input-hash", default=None, help="输入素材 hash,由 CLI 计算传入")
    parser.add_argument("--trim", type=_parse_trim_arg, default=None, help="本次裁剪模式:auto、full 或正数秒数")
    parser.add_argument("--status-output", type=Path, default=None, help=argparse.SUPPRESS)
    parser.add_argument("-o", "--output", type=Path, default=None, help="默认 folder/output/metadata/timeline.json")
    args = parser.parse_args(argv)

    folder = args.folder.resolve()
    if not folder.is_dir():
        term.error(f"不是文件夹: {folder}")
        return 1

    metadata_dir = folder / "output" / "metadata"
    out = args.output or metadata_dir / "timeline.json"
    existing = None
    if out.is_file():
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
        except Exception:
            existing = None

    # 素材是否与现有 timeline.json 匹配(input_hash 相同,即"这份文件是不是
    # 针对当前这批素材算出来的")。只有匹配时,才有资格判断"要不要用最新
    # 算法刷新它"——素材本身变了,理应完整重新规划,与手改保护无关。
    material_matches = bool(
        existing and args.input_hash and existing.get("meta", {}).get("input_hash") == args.input_hash
    )

    if material_matches:
        if _content_checksum(existing) != existing.get("meta", {}).get("plan_checksum"):
            # 校验和对不上 = 文件内容与"某次 plan 本该产出的结果"不一致 → 手改过。
            # 手改优先,原样保留,不读 beats.json、不触碰任何依赖
            term.warn("timeline.json 内容已被手动修改,保留手改结果,不重新生成")
            _write_status(args.status_output, "preserved_manual_edit")
            return 0
        term.detail("timeline.json 未被手动修改,使用最新算法重新生成")

    beats_path = args.beats or metadata_dir / "beats.json"
    if not beats_path.is_file():
        if material_matches:
            # 本来打算用最新算法刷新,但 beats.json 缺失(如被手动删除)——
            # 退回保留现有文件,而不是报错中断(它仍是对应当前素材的有效结果)
            term.warn(f"找不到 beats.json: {beats_path},保留现有 timeline.json(正常流程由 tsuzuri <folder> 自动生成;单独调试可用 uv run tsuzuri-analyze)")
            _write_status(args.status_output, "preserved_missing_beats")
            return 0
        term.error(f"找不到 beats.json: {beats_path}(正常流程由 tsuzuri <folder> 自动生成;单独调试可用 uv run tsuzuri-analyze)")
        return 1
    beats = json.loads(beats_path.read_text(encoding="utf-8"))

    lyrics: list[dict] = []
    lyrics_path = args.lyrics or metadata_dir / "lyrics.json"
    if lyrics_path.is_file():
        lyrics = json.loads(lyrics_path.read_text(encoding="utf-8")).get("segments", [])

    cfg = load_config(folder)
    if args.trim is not None:
        cfg["trim"] = args.trim
    if not cfg["subtitles"] and lyrics:
        term.info("已按 tsuzuri.toml 关闭字幕轨")
        lyrics = []

    # 置信度过滤在 plan 层做并明确告知,timeline 即所见即所得
    # (渲染层保留同阈值兜底;0.6 与 whisper 幻觉风险的权衡见计划文档第四节)
    kept = [s for s in lyrics if s["confidence"] >= CONFIDENCE_THRESHOLD]
    if len(kept) < len(lyrics):
        term.warn(
            f"lyrics: {len(lyrics) - len(kept)} 行置信度 < {CONFIDENCE_THRESHOLD} 被过滤"
            "(宁可漏不可错,防识别幻觉)"
        )
    lyrics = kept

    timeline = build_timeline(folder, beats, lyrics, cfg, args.input_hash)

    write_json_atomic(out, timeline)
    _write_status(args.status_output, "generated")
    n = sum(clip.get("kind") == "photo" for clip in timeline["photos"])
    term.detail(
        f"plan: {n} photos / {timeline['meta']['duration']}s "
        f"(平均每张 {timeline['meta']['duration'] / n:.1f}s, 字幕 {len(lyrics)} 行)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
