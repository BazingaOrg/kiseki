"""plan 将 kiseki.toml 的 branding 键透传到 meta.branding。"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

import plan
from plan import build_timeline, load_config


def make_photos(folder: Path, n: int = 3) -> None:
    for i in range(n):
        Image.new("RGB", (4, 4), color=(i % 255, 0, 0)).save(folder / f"{i:03d}.jpg")


def make_beats(duration: float = 60.0) -> dict:
    downbeats = [round(t, 3) for t in frange(0.0, duration, 2.0)]
    beats = [round(t, 3) for t in frange(0.0, duration, 0.5)]
    return {
        "version": 1,
        "audio": "song.mp3",
        "duration": duration,
        "bpm": 120.0,
        "beats": beats,
        "downbeats": downbeats,
        "first_strong_onset": 0.0,
    }


def frange(start: float, stop: float, step: float):
    t = start
    while t < stop:
        yield t
        t += step


class TestBrandingPassthrough:
    def test_defaults_leave_branding_to_renderer(self, tmp_path: Path):
        make_photos(tmp_path)
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, make_beats(), [], cfg, None)
        assert "branding" not in timeline["meta"]

    def test_toml_outro_and_intro_false(self, tmp_path: Path):
        make_photos(tmp_path)
        (tmp_path / "kiseki.toml").write_text(
            'outro_text = "谢谢观看"\nintro = false\n', encoding="utf-8"
        )
        cfg = load_config(tmp_path)
        timeline = build_timeline(tmp_path, make_beats(), [], cfg, None)
        branding = timeline["meta"]["branding"]
        assert branding["outro_text"] == "谢谢观看"
        assert branding["intro"] is False
        assert "signature" not in branding

    def test_toml_empty_outro_hides_copy(self, tmp_path: Path):
        make_photos(tmp_path)
        (tmp_path / "kiseki.toml").write_text('outro_text = ""\n', encoding="utf-8")
        cfg = load_config(tmp_path)
        timeline = build_timeline(tmp_path, make_beats(), [], cfg, None)
        assert timeline["meta"]["branding"]["outro_text"] == ""

    def test_signature_svg_must_exist(self, tmp_path: Path):
        make_photos(tmp_path)
        (tmp_path / "kiseki.toml").write_text(
            'signature = "missing.svg"\n', encoding="utf-8"
        )
        with pytest.raises(SystemExit):
            load_config(tmp_path)

    def test_signature_must_be_svg(self, tmp_path: Path):
        make_photos(tmp_path)
        (tmp_path / "sig.png").write_bytes(b"x")
        (tmp_path / "kiseki.toml").write_text('signature = "sig.png"\n', encoding="utf-8")
        with pytest.raises(SystemExit):
            load_config(tmp_path)

    def test_valid_signature_written_to_meta(self, tmp_path: Path):
        make_photos(tmp_path)
        (tmp_path / "signature.svg").write_text(
            '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>',
            encoding="utf-8",
        )
        (tmp_path / "kiseki.toml").write_text(
            'signature = "signature.svg"\n', encoding="utf-8"
        )
        cfg = load_config(tmp_path)
        timeline = build_timeline(tmp_path, make_beats(), [], cfg, None)
        assert timeline["meta"]["branding"]["signature"] == "signature.svg"

    def test_background_must_be_a_string(self, tmp_path: Path):
        (tmp_path / "kiseki.toml").write_text("background = 123\n", encoding="utf-8")
        with pytest.raises(SystemExit):
            load_config(tmp_path)

    def test_intro_false_does_not_reserve_head(self, tmp_path: Path):
        make_photos(tmp_path, 6)
        beats = make_beats(60.0)
        on = build_timeline(tmp_path, beats, [], dict(plan.DEFAULTS), None)
        off_cfg = dict(plan.DEFAULTS)
        off_cfg["intro"] = False
        off_cfg["_explicit_branding"] = {"intro"}
        off = build_timeline(tmp_path, beats, [], off_cfg, None)
        # 同素材:开片头时预留抬高首切;关片头时不预留,首切更早
        assert on["photos"][0]["end"] >= plan.SHOW_INTRO_MIN_PHOTO0_END
        assert off["photos"][0]["end"] < on["photos"][0]["end"]
        assert off["meta"]["branding"]["intro"] is False
