"""Parse a conservative, line-synchronised subset of the LRC format."""

from __future__ import annotations

import re
from pathlib import Path


class LrcError(ValueError):
    """Raised when a user-provided LRC file cannot produce a valid timeline."""


_TIMESTAMP_RE = re.compile(r"\[(\d+):([0-5]?\d)(?:\.(\d{1,3}))?\]")
_OFFSET_RE = re.compile(r"^\s*\[offset:([+-]?\d+)\]\s*$", re.IGNORECASE)
_TRANSLATION_RE = re.compile(r"\[kiseki:translation:zh-CN\]", re.IGNORECASE)
_KANA_RE = re.compile(r"[\u3040-\u30ff]")
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_LATIN_RE = re.compile(r"[A-Za-z]")


def _timestamp_seconds(match: re.Match[str]) -> float:
    minutes = int(match.group(1))
    seconds = int(match.group(2))
    fraction = match.group(3) or ""
    fraction_seconds = int(fraction) / (10 ** len(fraction)) if fraction else 0.0
    return minutes * 60 + seconds + fraction_seconds


def _language(text: str, *, japanese_context: bool) -> str:
    if _KANA_RE.search(text):
        return "ja"
    has_cjk = bool(_CJK_RE.search(text))
    has_latin = bool(_LATIN_RE.search(text))
    if has_cjk and has_latin:
        return "mixed"
    if has_cjk:
        return "ja" if japanese_context else "zh"
    if has_latin:
        return "en"
    return "mixed"


def parse_lrc(path: Path, *, audio_name: str, duration: float) -> dict:
    """Return the same lyrics payload shape as Whisper transcription.

    Positive ``offset`` values delay display; negative values advance it.
    Empty timed lines are retained as boundaries so interludes clear the
    preceding caption without creating an empty subtitle.
    """
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except UnicodeDecodeError as exc:
        raise LrcError(f"{path.name} 不是有效 UTF-8 文本") from exc

    offset_ms = 0
    for line in lines:
        offset_match = _OFFSET_RE.match(line)
        if offset_match:
            offset_ms = int(offset_match.group(1))

    events: list[tuple[float, str, int]] = []
    translations: list[tuple[float, str, int]] = []
    for line_number, line in enumerate(lines, start=1):
        matches = list(_TIMESTAMP_RE.finditer(line))
        if not matches:
            continue
        text = line[matches[-1].end():].strip()
        is_translation = bool(_TRANSLATION_RE.search(text))
        if is_translation:
            text = _TRANSLATION_RE.sub("", text).strip()
        for match in matches:
            start = _timestamp_seconds(match) + offset_ms / 1000
            if start < 0:
                start = 0.0
            if start <= duration:
                if is_translation:
                    translations.append((start, text, line_number))
                else:
                    events.append((start, text, line_number))

    if not events and not translations:
        raise LrcError(f"{path.name} 没有有效的 LRC 时间戳")

    grouped: dict[float, tuple[str, int]] = {}
    for start, text, line_number in events:
        key = round(start, 3)
        existing = grouped.get(key)
        if existing and existing[0] != text:
            raise LrcError(
                f"{path.name}:{line_number} 与第 {existing[1]} 行使用相同时间戳但歌词不同"
            )
        grouped[key] = (text, line_number)

    grouped_translations: dict[float, tuple[str, int]] = {}
    for start, text, line_number in translations:
        key = round(start, 3)
        if not text:
            raise LrcError(f"{path.name}:{line_number} 中文译文为空")
        if key not in grouped:
            raise LrcError(f"{path.name}:{line_number} 中文译文没有对应原文")
        if not grouped[key][0]:
            raise LrcError(f"{path.name}:{line_number} 中文译文不能对应空白时间边界")
        existing = grouped_translations.get(key)
        if existing and existing[0] != text:
            raise LrcError(
                f"{path.name}:{line_number} 与第 {existing[1]} 行使用相同时间戳但中文译文不同"
            )
        grouped_translations[key] = (text, line_number)

    ordered = sorted((start, value[0]) for start, value in grouped.items())
    japanese_context = any(_KANA_RE.search(text) for _, text in ordered if text)
    segments = []
    for index, (start, text) in enumerate(ordered):
        end = ordered[index + 1][0] if index + 1 < len(ordered) else duration
        if not text or end <= start:
            continue
        segment = {
            "text": text,
            "lang": _language(text, japanese_context=japanese_context),
            "start": round(start, 3),
            "end": round(end, 3),
            "confidence": 1.0,
        }
        translation = grouped_translations.get(start)
        if translation:
            segment["translation"] = {"text": translation[0], "lang": "zh"}
        segments.append(segment)

    if not segments:
        raise LrcError(f"{path.name} 没有可显示的歌词行")

    languages = {segment["lang"] for segment in segments}
    return {
        "version": 1,
        "audio": audio_name,
        "language": next(iter(languages)) if len(languages) == 1 else "mixed",
        "backend": "lrc",
        "segments": segments,
    }
