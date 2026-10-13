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


def test_chapter_plan_reuses_photo_dates_from_ordering(tmp_path, monkeypatch):
    photos(tmp_path, ["07:13", "07:14", "07:14"])
    original = plan.exif_datetime
    calls = []

    def read_date(photo):
        calls.append(photo)
        return original(photo)

    monkeypatch.setattr(plan, "exif_datetime", read_date)
    plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    assert len(calls) == 3


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


def test_opening_recap_leads_into_the_first_day_card(tmp_path):
    photos(tmp_path, ["07:13"] * 4 + ["07:14"] * 4)
    song = {**beats(), "duration": 60, "beats": list(range(61)), "downbeats": list(range(0, 61, 2))}
    timeline = plan.build_timeline(tmp_path, song, [], dict(plan.DEFAULTS), None)
    recap = timeline["meta"]["opening_recap"]
    cards = [clip for clip in timeline["photos"] if clip.get("kind") == "chapter"]
    real = [clip for clip in timeline["photos"] if clip.get("kind") == "photo"]
    assert [card["text"] for card in cards] == ["7月13日 · 第1天 :)", "7月14日 · 第2天 ♪"]
    assert cards[0]["start"] == recap["end"]
    assert cards[0]["end"] == real[0]["start"]
    assert len(real) == 8
    assert timeline["meta"]["chapters"] == {"enabled": True, "day_count": 2, "card_count": 2}


def test_invalid_dates_and_short_or_sparse_boundaries_leave_photos_unchanged(tmp_path, capsys):
    photos(tmp_path, ["07:13", "07:14"])
    (tmp_path / "1.jpg").unlink()
    image = Image.new("RGB", (4, 4)); exif = Image.Exif(); exif[plan.DATETIME_ORIGINAL] = "2026:02:30 12:00:00"; image.save(tmp_path / "1.jpg", exif=exif)
    timeline = plan.build_timeline(tmp_path, beats(), [], dict(plan.DEFAULTS), None)
    assert not timeline["meta"]["chapters"]["enabled"]
    assert "EXIF 时间不完整" in capsys.readouterr().out


def test_chapter_helper_uses_front_then_back_and_a_short_card_when_a_beat_card_does_not_fit(tmp_path, capsys):
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
    assert meta == {"enabled": True, "day_count": 2, "card_count": 1}
    short = next(clip for clip in impossible if clip.get("kind") == "chapter")
    assert short["text"] == "7月14日 · 第2天 ♪"
    assert (short["start"], short["end"]) == (7.5, 8.5)
    photos_only = [clip for clip in impossible if clip.get("kind") == "photo"]
    assert [(clip["start"], clip["end"]) for clip in photos_only] == [(0.0, 7.5), (8.5, 16.0)]
    assert all("day_mark" not in clip for clip in impossible)
    assert "写在照片上" not in capsys.readouterr().out

    tight, tight_meta = plan._insert_chapters(
        [{"kind": "photo", "start": 0.0, "end": 0.5}, {"kind": "photo", "start": 0.5, "end": 1.0}],
        paths,
        [],
        2.0,
    )
    assert tight_meta["card_count"] == 1
    assert [(clip["start"], clip["end"]) for clip in tight] == [(0.0, 0.2), (0.2, 0.8), (0.8, 1.0)]

    with pytest.raises(SystemExit):
        plan._insert_chapters(
            [{"kind": "photo", "start": 0.0, "end": 0.25}, {"kind": "photo", "start": 0.25, "end": 0.5}],
            paths,
            [],
            0.25,
        )
    assert "无法保留日期卡和照片" in capsys.readouterr().err

    with pytest.raises(SystemExit):
        plan._insert_chapters(
            [{"kind": "photo", "start": 0.0, "end": 0.5}, {"kind": "photo", "start": 0.5, "end": 8.0}],
            paths,
            [2.0],
            2.0,
            include_first_day=True,
        )
    assert "无法保留日期卡和照片" in capsys.readouterr().err


def test_dense_consecutive_days_each_get_a_card(tmp_path):
    photos(tmp_path, ["07:13", "07:14", "07:15", "07:16"])
    paths = [tmp_path / f"{index}.jpg" for index in range(4)]
    clips = [{"kind": "photo", "start": index * 0.8, "end": (index + 1) * 0.8} for index in range(4)]
    timeline, meta = plan._insert_chapters(clips, paths, [], 0.8, include_first_day=True)
    cards = [clip for clip in timeline if clip.get("kind") == "chapter"]
    real = [clip for clip in timeline if clip.get("kind") == "photo"]
    assert meta == {"enabled": True, "day_count": 4, "card_count": 4}
    assert [clip["text"].split()[0] for clip in cards] == ["7月13日", "7月14日", "7月15日", "7月16日"]
    assert len(real) == 4
    assert all(clip["end"] - clip["start"] >= 0.2 - 1e-9 for clip in real)
    assert all(a["end"] <= b["start"] for a, b in zip(timeline, timeline[1:]))
