from pathlib import Path

from PIL import Image
import pytest

import plan


def beats():
    return {"audio": "song.mp3", "duration": 30, "bpm": 120, "beats": list(range(31)), "downbeats": list(range(0, 31, 2)), "first_strong_onset": 0}


def photos(folder: Path, days: list[str]):
    for index, day in enumerate(days):
        image = Image.new("RGB", (4, 4))
        exif = Image.Exif()
        exif[plan.DATETIME_ORIGINAL] = f"2026:{day} 12:00:00"
        image.save(folder / f"{index}.jpg", exif=exif)


def test_cross_day_inserts_stable_card_without_losing_photos(tmp_path):
    photos(tmp_path, ["07:13", "07:14", "07:14"])
    timeline = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    cards = [clip for clip in timeline["photos"] if clip.get("kind") == "chapter"]
    real = [clip for clip in timeline["photos"] if clip.get("kind") == "photo"]
    assert cards[0]["text"] == "7月14日 · 第2天 ♪"
    assert len(real) == 3
    assert timeline["meta"]["chapters"] == {"enabled": True, "day_count": 2, "card_count": 1}
    assert all(endpoint in beats()["downbeats"] for card in cards for endpoint in (card["start"], card["end"]))
    assert max(clip["end"] for clip in timeline["photos"]) == timeline["meta"]["duration"]
    assert all(a["end"] <= b["start"] for a, b in zip(sorted(timeline["photos"], key=lambda c: c["start"]), sorted(timeline["photos"], key=lambda c: c["start"])[1:]))


def test_single_day_missing_exif_and_disabled_do_not_insert(tmp_path):
    photos(tmp_path, ["07:14", "07:14"])
    assert not plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)["meta"]["chapters"]["enabled"]
    photos(tmp_path, ["07:15"])
    cfg = {**plan.DEFAULTS, "chapters": False}
    assert not plan.build_timeline(tmp_path, beats(), [], cfg, None)["meta"]["chapters"]["enabled"]


def test_missing_exif_disables_chapters(tmp_path):
    photos(tmp_path, ["07:13"])
    Image.new("RGB", (4, 4)).save(tmp_path / "missing.jpg")
    timeline = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    assert timeline["meta"]["chapters"] == {"enabled": False, "day_count": 0, "card_count": 0}


def test_chapters_toml_requires_a_boolean(tmp_path, capsys):
    (tmp_path / "kiseki.toml").write_text("chapters = false\n", encoding="utf-8")
    assert plan.load_config(tmp_path)["chapters"] is False

    (tmp_path / "kiseki.toml").write_text('chapters = "false"\n', encoding="utf-8")
    with pytest.raises(SystemExit):
        plan.load_config(tmp_path)
    assert "chapters 必须是 true 或 false" in capsys.readouterr().err


def test_three_and_five_days_cycle_symbols_and_are_stable(tmp_path):
    photos(tmp_path, ["07:13", "07:14", "07:15", "07:16", "07:17"])
    first = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    second = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    cards = [clip for clip in first["photos"] if clip.get("kind") == "chapter"]
    assert [card["text"].split()[-1] for card in cards] == ["♪", "✦", "˖°", ":)"]
    assert [(card["text"], card["start"], card["end"]) for card in cards] == [(card["text"], card["start"], card["end"]) for card in second["photos"] if card.get("kind") == "chapter"]


def test_three_days_label_the_second_and_third_days(tmp_path):
    photos(tmp_path, ["07:13", "07:14", "07:15"])
    timeline = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    cards = [clip for clip in timeline["photos"] if clip.get("kind") == "chapter"]
    assert [card["text"] for card in cards] == ["7月14日 · 第2天 ♪", "7月15日 · 第3天 ✦"]


def test_invalid_dates_and_short_or_sparse_boundaries_leave_photos_unchanged(tmp_path, capsys):
    photos(tmp_path, ["07:13", "07:14"])
    (tmp_path / "1.jpg").unlink()
    image = Image.new("RGB", (4, 4)); exif = Image.Exif(); exif[plan.DATETIME_ORIGINAL] = "2026:02:30 12:00:00"; image.save(tmp_path / "1.jpg", exif=exif)
    timeline = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    assert not timeline["meta"]["chapters"]["enabled"]
    assert "EXIF 时间不完整" in capsys.readouterr().out


def test_chapter_helper_uses_front_then_back_and_never_mutates_when_impossible(tmp_path):
    photos(tmp_path, ["07:13", "07:14"])
    paths = [tmp_path / "0.jpg", tmp_path / "1.jpg"]
    clips = [{"kind": "photo", "start": 0.0, "end": 8.0}, {"kind": "photo", "start": 8.0, "end": 16.0}]
    cards, meta = plan._insert_chapters([dict(clip) for clip in clips], paths, [6.0, 10.0], 2.0)
    chapter = next(clip for clip in cards if clip.get("kind") == "chapter")
    assert (chapter["start"], chapter["end"]) == (6.0, 8.0)
    assert max(clip["end"] for clip in cards) == 16.0
    assert len([clip for clip in cards if clip.get("kind") == "photo"]) == len(clips)

    back, meta = plan._insert_chapters([dict(clip) for clip in clips], paths, [10.0], 2.0)
    back_card = next(clip for clip in back if clip.get("kind") == "chapter")
    assert (back_card["start"], back_card["end"]) == (8.0, 10.0)
    assert max(clip["end"] for clip in back) == 16.0
    assert len([clip for clip in back if clip.get("kind") == "photo"]) == len(clips)

    impossible, meta = plan._insert_chapters([dict(clip) for clip in clips], paths, [1.0, 20.0], 2.0)
    assert impossible == clips and meta["card_count"] == 0
