from __future__ import annotations

from pathlib import Path

import pytest

from lyrics_input import LrcError, parse_lrc


def write_lrc(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "song.lrc"
    path.write_text(content, encoding="utf-8-sig")
    return path


def test_parses_common_timestamps_metadata_repeats_and_blank_boundaries(tmp_path: Path):
    path = write_lrc(
        tmp_path,
        "[ar:Artist]\n[00:01.20][00:05.200]Hello\n[00:03.000]\n[00:07]再见\n",
    )

    result = parse_lrc(path, audio_name="song.mp3", duration=10.0)

    assert result["backend"] == "lrc"
    assert result["language"] == "mixed"
    assert result["segments"] == [
        {"text": "Hello", "lang": "en", "start": 1.2, "end": 3.0, "confidence": 1.0},
        {"text": "Hello", "lang": "en", "start": 5.2, "end": 7.0, "confidence": 1.0},
        {"text": "再见", "lang": "zh", "start": 7.0, "end": 10.0, "confidence": 1.0},
    ]


def test_offset_and_japanese_context(tmp_path: Path):
    path = write_lrc(tmp_path, "[offset:+500]\n[00:00.00]夜空\n[00:01.00]ひかり\n")

    result = parse_lrc(path, audio_name="song.mp3", duration=3.0)

    assert [(line["start"], line["end"], line["lang"]) for line in result["segments"]] == [
        (0.5, 1.5, "ja"),
        (1.5, 3.0, "ja"),
    ]


def test_negative_offset_clamps_to_zero(tmp_path: Path):
    path = write_lrc(tmp_path, "[offset:-500]\n[00:00.20]First\n[00:01.00]Second\n")

    result = parse_lrc(path, audio_name="song.mp3", duration=2.0)

    assert result["segments"][0]["start"] == 0.0
    assert result["segments"][0]["end"] == 0.5


def test_duplicate_timestamp_with_different_text_is_rejected(tmp_path: Path):
    path = write_lrc(tmp_path, "[00:01.00]One\n[00:01.00]Two\n")

    with pytest.raises(LrcError, match="相同时间戳"):
        parse_lrc(path, audio_name="song.mp3", duration=3.0)


def test_attaches_chinese_translation_and_preserves_blank_boundary(tmp_path: Path):
    path = write_lrc(
        tmp_path,
        "[00:01.234]君の歌\n[00:01.234][kiseki:translation:zh-CN]你的歌\n[00:03.000]\n",
    )

    result = parse_lrc(path, audio_name="song.mp3", duration=5.0)

    assert result["segments"] == [{
        "text": "君の歌",
        "lang": "ja",
        "start": 1.234,
        "end": 3.0,
        "confidence": 1.0,
        "translation": {"text": "你的歌", "lang": "zh"},
    }]


def test_translation_without_original_or_with_ambiguous_duplicate_is_rejected(tmp_path: Path):
    orphan = write_lrc(tmp_path, "[00:01.00][kiseki:translation:zh-CN]中文\n")
    with pytest.raises(LrcError, match="没有对应原文"):
        parse_lrc(orphan, audio_name="song.mp3", duration=3.0)

    duplicate = write_lrc(
        tmp_path,
        "[00:01.00]One\n[00:01.00]Two\n[00:01.00][kiseki:translation:zh-CN]中文\n",
    )
    with pytest.raises(LrcError, match="相同时间戳"):
        parse_lrc(duplicate, audio_name="song.mp3", duration=3.0)

    blank = write_lrc(tmp_path, "[00:01.00]\n[00:01.00][kiseki:translation:zh-CN]间奏\n")
    with pytest.raises(LrcError, match="空白时间边界"):
        parse_lrc(blank, audio_name="song.mp3", duration=3.0)


def test_translation_uses_the_same_offset_as_original(tmp_path: Path):
    path = write_lrc(
        tmp_path,
        "[offset:+500]\n[00:01.000]原文\n[00:01.000][kiseki:translation:zh-CN]译文\n[00:02.000]\n",
    )
    result = parse_lrc(path, audio_name="song.mp3", duration=4.0)
    assert result["segments"][0]["start"] == 1.5
    assert result["segments"][0]["end"] == 2.5
    assert result["segments"][0]["translation"] == {"text": "译文", "lang": "zh"}


@pytest.mark.parametrize("content", ["[ar:Only metadata]\n", "[00:01.00]\n"])
def test_requires_displayable_timed_lyrics(tmp_path: Path, content: str):
    path = write_lrc(tmp_path, content)

    with pytest.raises(LrcError):
        parse_lrc(path, audio_name="song.mp3", duration=3.0)
