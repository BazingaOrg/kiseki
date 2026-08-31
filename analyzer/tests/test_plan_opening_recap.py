from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

import plan


def make_photos(folder: Path, count: int) -> None:
    for index in range(count):
        Image.new("RGB", (8, 8), color=(index % 255, 0, 0)).save(folder / f"{index:03d}.jpg")


def make_beats(duration: float, bpm: float = 120.0) -> dict:
    return {
        "version": 1,
        "audio": "song.mp3",
        "duration": duration,
        "bpm": bpm,
        "beats": [index * 0.5 for index in range(int(duration * 2))],
        "downbeats": [float(index) for index in range(0, int(duration), 2)],
        "first_strong_onset": 0.0,
    }


def photo_clips(timeline: dict) -> list[dict]:
    return [clip for clip in timeline["photos"] if clip.get("kind") != "chapter"]


def test_default_recap_uses_a_beat_window_and_moves_the_body_start(tmp_path: Path):
    make_photos(tmp_path, 12)
    timeline = plan.build_timeline(tmp_path, make_beats(60.0), [], dict(plan.DEFAULTS), None)

    recap = timeline["meta"]["opening_recap"]
    clips = photo_clips(timeline)
    assert 2.65 <= recap["start"] < recap["settle_start"] < recap["end"]
    assert recap["end"] in make_beats(60.0)["beats"]
    assert recap["order"] == "reverse"
    assert recap["layout"] == "single"
    assert recap["batch_size"] == 1
    assert clips[0]["start"] == recap["end"]
    assert len(clips) == 12


def test_recap_uses_contact_sheet_batches_when_single_frames_would_be_too_short(tmp_path: Path):
    make_photos(tmp_path, 50)
    timeline = plan.build_timeline(
        tmp_path,
        make_beats(150.0),
        [],
        {**plan.DEFAULTS, "trim": "full"},
        None,
    )

    recap = timeline["meta"]["opening_recap"]
    assert recap["layout"] == "grid"
    assert recap["batch_size"] >= 4
    assert len(photo_clips(timeline)) == 50


def test_recap_is_skipped_for_small_or_time_constrained_projects(tmp_path: Path):
    make_photos(tmp_path, 7)
    small = plan.build_timeline(tmp_path, make_beats(60.0), [], dict(plan.DEFAULTS), None)
    assert "opening_recap" not in small["meta"]
    assert photo_clips(small)[0]["start"] == 0

    for photo in tmp_path.glob("*.jpg"):
        photo.unlink()
    make_photos(tmp_path, 20)
    constrained = plan.build_timeline(tmp_path, make_beats(20.0), [], dict(plan.DEFAULTS), None)
    assert "opening_recap" not in constrained["meta"]
    assert photo_clips(constrained)[0]["start"] == 0


def test_recap_can_be_disabled_and_intro_false_also_disables_it(tmp_path: Path):
    make_photos(tmp_path, 12)
    beats = make_beats(60.0)

    disabled = plan.build_timeline(
        tmp_path,
        beats,
        [],
        {**plan.DEFAULTS, "opening_recap": False},
        None,
    )
    no_intro = plan.build_timeline(
        tmp_path,
        beats,
        [],
        {**plan.DEFAULTS, "intro": False, "_explicit_branding": {"intro"}},
        None,
    )

    assert "opening_recap" not in disabled["meta"]
    assert "opening_recap" not in no_intro["meta"]
    assert photo_clips(disabled)[0]["start"] == 0
    assert photo_clips(no_intro)[0]["start"] == 0


def test_plan_summary_reports_body_average_after_recap(tmp_path: Path, capsys):
    make_photos(tmp_path, 12)
    metadata = tmp_path / "output" / "metadata"
    metadata.mkdir(parents=True)
    (metadata / "beats.json").write_text(json.dumps(make_beats(30.0)), encoding="utf-8")

    assert plan.main([str(tmp_path)]) == 0
    output = capsys.readouterr().out
    assert "平均每张 2.1s" in output
    assert "平均每张 2.5s" not in output
