"""plan 的裁剪模式、校验、说明元数据与命令行覆盖。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

import plan


def make_photos(folder: Path, n: int = 3) -> None:
    for i in range(n):
        Image.new("RGB", (4, 4), color=(i, 0, 0)).save(folder / f"{i:03d}.jpg")


def make_beats(duration: float = 60.0, downbeats: list[float] | None = None) -> dict:
    return {
        "version": 1,
        "audio": "song.mp3",
        "duration": duration,
        "bpm": 120.0,
        "beats": [i * 0.5 for i in range(int(duration * 2))],
        "downbeats": downbeats if downbeats is not None else [float(i) for i in range(0, int(duration), 2)],
        "first_strong_onset": 0.0,
    }


@pytest.mark.parametrize("value", ['"auto"', '"full"', "12", "12.5"])
def test_trim_config_accepts_supported_values(tmp_path: Path, value: str):
    (tmp_path / "kiseki.toml").write_text(f"trim = {value}\n", encoding="utf-8")
    assert plan.load_config(tmp_path)["trim"] in {"auto", "full", 12, 12.5}


@pytest.mark.parametrize("value", ['"never"', "0", "-1", "true", "[]"])
def test_trim_config_rejects_invalid_values(tmp_path: Path, value: str):
    (tmp_path / "kiseki.toml").write_text(f"trim = {value}\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        plan.load_config(tmp_path)


@pytest.mark.parametrize("value", ['"adaptive"', "1", "[]"])
def test_pacing_config_rejects_invalid_values_with_clear_error(tmp_path: Path, value: str, capsys):
    (tmp_path / "kiseki.toml").write_text(f"pacing = {value}\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        plan.load_config(tmp_path)
    assert 'pacing 必须是 "dynamic" 或 "uniform"' in capsys.readouterr().err


def test_auto_trim_applies_and_writes_meta(tmp_path: Path):
    make_photos(tmp_path)
    timeline = plan.build_timeline(tmp_path, make_beats(), [], dict(plan.DEFAULTS), None)
    assert timeline["meta"]["duration"] == 24.0
    assert timeline["meta"]["trim"] == {
        "mode": "auto",
        "applied": True,
        "full_duration": 60.0,
        "trimmed_duration": 24.0,
    }


def test_auto_trim_not_triggered(tmp_path: Path):
    make_photos(tmp_path)
    timeline = plan.build_timeline(tmp_path, make_beats(24.0), [], dict(plan.DEFAULTS), None)
    assert timeline["meta"]["duration"] == 24.0
    assert timeline["meta"]["trim"]["applied"] is False


def test_full_mode_keeps_complete_song(tmp_path: Path):
    make_photos(tmp_path)
    cfg = {**plan.DEFAULTS, "trim": "full"}
    timeline = plan.build_timeline(tmp_path, make_beats(), [], cfg, None)
    assert timeline["meta"]["duration"] == 60.0
    assert timeline["meta"]["trim"]["mode"] == "full"
    assert timeline["meta"]["trim"]["applied"] is False


def test_seconds_mode_snaps_to_nearest_downbeat(tmp_path: Path):
    make_photos(tmp_path)
    cfg = {**plan.DEFAULTS, "trim": 31}
    timeline = plan.build_timeline(tmp_path, make_beats(), [], cfg, None)
    assert timeline["meta"]["duration"] == 30.0
    assert timeline["meta"]["trim"]["mode"] == "seconds"
    assert timeline["meta"]["trim"]["applied"] is True


@pytest.mark.parametrize("seconds", [60, 120])
def test_seconds_at_or_beyond_song_duration_keeps_complete_song(
    tmp_path: Path, seconds: int
):
    make_photos(tmp_path)
    cfg = {**plan.DEFAULTS, "trim": seconds}
    timeline = plan.build_timeline(tmp_path, make_beats(), [], cfg, None)
    assert timeline["meta"]["duration"] == 60.0
    assert timeline["meta"]["trim"]["mode"] == "seconds"
    assert timeline["meta"]["trim"]["applied"] is False


def test_seconds_shorter_than_photo_constraints_drops_photos_with_warning(
    tmp_path: Path, capsys
):
    make_photos(tmp_path, 10)
    cfg = {**plan.DEFAULTS, "trim": 5}
    timeline = plan.build_timeline(tmp_path, make_beats(), [], cfg, None)
    assert timeline["meta"]["duration"] == 20.0
    assert len(timeline["photos"]) == 9
    assert "时长塞不下全部照片,丢弃末尾 1 张" in capsys.readouterr().err


def test_dynamic_pacing_does_not_drop_photos_when_uniform_fits(tmp_path: Path, capsys):
    make_photos(tmp_path, 12)
    beats = make_beats(29.301, downbeats=[])
    beats["beats"] = [2.315, 3.008, 3.723, 4.416, 5.109, 5.792, 6.496, 7.189, 7.872, 8.565, 9.259, 9.941, 10.624, 11.317, 12.011, 12.715, 13.365, 14.101, 14.784, 15.477, 16.171, 16.853, 17.547, 18.240, 18.923, 19.627, 20.320, 21.013, 21.696, 22.400, 23.083, 23.776, 24.459, 25.163, 25.856, 26.539, 27.232, 27.925, 28.608, 29.301]
    beats["downbeats"] = [4.416, 7.189, 9.941, 12.715, 15.477, 18.240, 21.013, 23.776, 26.539]
    beats["energy"] = [0.0] * 16 + [0.464, 0.455, 0.638, 0.450, 0.467, 0.470, 0.512, 0.462, 0.813, 0.786, 0.787, 0.738, 0.681, 0.784, 0.787, 0.668, 0.697, 0.705, 0.723, 0.698, 0.663, 0.582, 0.866, 0.541]
    beats["first_strong_onset"] = 2.304
    base = {**plan.DEFAULTS, "trim": "full"}

    uniform = plan.build_timeline(tmp_path, beats, [], {**base, "pacing": "uniform"}, None)
    dynamic = plan.build_timeline(tmp_path, beats, [], {**base, "pacing": "dynamic"}, None)

    assert len(uniform["photos"]) == len(dynamic["photos"]) == 12
    assert "丢弃末尾" not in capsys.readouterr().err


def test_missing_legal_trim_candidate_is_reported(tmp_path: Path, capsys):
    make_photos(tmp_path)
    timeline = plan.build_timeline(
        tmp_path, make_beats(downbeats=[0.0, 2.0, 4.0]), [], dict(plan.DEFAULTS), None
    )
    assert timeline["meta"]["duration"] == 60.0
    assert timeline["meta"]["trim"]["applied"] is False
    assert "找不到满足最小照片间隔的重拍点" in capsys.readouterr().out


def test_main_trim_override_wins_over_toml(tmp_path: Path):
    make_photos(tmp_path)
    metadata = tmp_path / "output" / "metadata"
    metadata.mkdir(parents=True)
    (metadata / "beats.json").write_text(json.dumps(make_beats()), encoding="utf-8")
    (tmp_path / "kiseki.toml").write_text('trim = "auto"\n', encoding="utf-8")

    assert plan.main([str(tmp_path), "--trim", "full"]) == 0
    timeline = json.loads((metadata / "timeline.json").read_text(encoding="utf-8"))
    assert timeline["meta"]["duration"] == 60.0
    assert timeline["meta"]["trim"]["mode"] == "full"


def test_main_status_distinguishes_generated_from_preserved_hand_edit(tmp_path: Path):
    make_photos(tmp_path)
    metadata = tmp_path / "output" / "metadata"
    metadata.mkdir(parents=True)
    (metadata / "beats.json").write_text(json.dumps(make_beats()), encoding="utf-8")
    status = tmp_path / "plan-status.json"
    args = [str(tmp_path), "--input-hash", "same", "--status-output", str(status)]

    assert plan.main(args) == 0
    assert json.loads(status.read_text(encoding="utf-8"))["outcome"] == "generated"

    timeline_path = metadata / "timeline.json"
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    timeline["photos"][0]["end"] = 999.0
    timeline_path.write_text(json.dumps(timeline), encoding="utf-8")

    assert plan.main(args) == 0
    assert json.loads(status.read_text(encoding="utf-8"))["outcome"] == "preserved_manual_edit"
    assert json.loads(timeline_path.read_text(encoding="utf-8"))["photos"][0]["end"] == 999.0


@pytest.mark.parametrize("value", ["0", "-2", "never"])
def test_main_rejects_invalid_trim_override(tmp_path: Path, value: str):
    with pytest.raises(SystemExit) as exc:
        plan.main([str(tmp_path), "--trim", value])
    assert exc.value.code == 2


def test_trim_clips_lyrics_beyond_the_cut(tmp_path: Path):
    """歌长图少裁剪时,截断点之后的歌词行被过滤,跨线行的 end 收敛到 duration。"""
    make_photos(tmp_path, n=2)
    (tmp_path / "kiseki.toml").write_text('trim = "auto"\n', encoding="utf-8")
    beats = make_beats(duration=60.0)
    lyrics = [
        {"start": 0.0, "end": 3.0, "text": "line in range", "lang": "zh", "confidence": 0.9},
        {"start": 15.0, "end": 20.0, "text": "crossing the cut", "lang": "zh", "confidence": 0.9},
        {"start": 50.0, "end": 55.0, "text": "after cut", "lang": "zh", "confidence": 0.9},
        {"start": 55.5, "end": 58.0, "text": "far after cut", "lang": "zh", "confidence": 0.9},
    ]

    timeline = plan.build_timeline(tmp_path, beats, lyrics, plan.load_config(tmp_path), None)

    duration = timeline["meta"]["duration"]
    assert duration < 60.0, "裁剪必须生效"
    assert [line["text"] for line in timeline["subtitles"]] == ["line in range", "crossing the cut"]
    for line in timeline["subtitles"]:
        assert line["end"] <= duration, "任何字幕行的 end 都不能超过时间线时长"
    crossing = timeline["subtitles"][1]
    assert crossing["end"] == duration, "跨线行的 end 收敛到截断点"
