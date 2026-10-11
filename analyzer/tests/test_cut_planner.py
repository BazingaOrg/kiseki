"""切换规划:强拍、停留、快歌和歌词句中。"""

from pathlib import Path

from PIL import Image

import plan
from cut_planner import local_downbeat_times, plan_photo_cuts


def _grid(step: float, duration: float) -> list[float]:
    count = int(duration / step)
    return [round(index * step, 3) for index in range(count + 1)]


def test_cuts_land_on_bar_accents_not_every_beat():
    beats = _grid(0.5, 8)
    onset = [1.0 if time in {2.0, 4.0, 6.0} else 0.05 for time in beats]
    cuts = plan_photo_cuts(duration=8, n_photos=3, beat_times=beats, onset=onset, fps=60)
    assert [cut.time for cut in cuts] == [2.0, 4.0] or [cut.time for cut in cuts] == [2.0, 6.0] or [cut.time for cut in cuts] == [4.0, 6.0]
    assert min(b - a for a, b in zip([0, *[cut.time for cut in cuts]], [cut.time for cut in cuts])) >= 2 - 1e-9
    assert all(cut.hard for cut in cuts)


def test_clustered_hits_do_not_become_three_quick_cuts():
    beats = _grid(0.5, 10)
    onset = [1.0 if time in {2.0, 2.5, 3.0} else 0.1 for time in beats]
    times = [cut.time for cut in plan_photo_cuts(duration=10, n_photos=4, beat_times=beats, onset=onset)]
    assert len(times) == 3
    assert min(b - a for a, b in zip([0, *times], times)) >= 2 - 1e-9
    assert any(time in {2.0, 2.5, 3.0} for time in times)


def test_fast_song_can_cut_every_bar_instead_of_waiting_two_seconds():
    beats = _grid(0.25, 4.5)
    cuts = plan_photo_cuts(duration=4.5, n_photos=4, beat_times=beats)
    times = [cut.time for cut in cuts]
    assert len(times) == 3
    assert min(b - a for a, b in zip([0, *times], times)) >= 1 - 1e-9


def test_lyric_line_pushes_the_cut_off_the_middle_of_the_phrase():
    beats = _grid(0.5, 8)
    onset = [1.0 if time == 2.5 else 0.7 if time == 4.0 else 0.05 for time in beats]
    cuts = plan_photo_cuts(
        duration=8,
        n_photos=2,
        beat_times=beats,
        onset=onset,
        lyric_spans=[(1.0, 4.0)],
    )
    assert cuts[0].time == 4.0


def test_missing_beats_keep_the_tail_visible():
    cuts = plan_photo_cuts(
        duration=14,
        n_photos=2,
        beat_times=[],
        not_before=3.45,
        head_offset=2.65,
        not_after=10.7,
        fps=60,
    )
    assert len(cuts) == 1
    assert cuts[0].time != 11.0
    assert 14 - cuts[0].time >= 3.3
    assert cuts[0].hard is False


def test_timeline_hard_cuts_the_accent_and_fades_the_quiet_beat(tmp_path: Path):
    for index in range(3):
        Image.new("RGB", (4, 4), color=(index, 0, 0)).save(tmp_path / f"{index:03d}.jpg")
    beats = [round(index * 0.5, 3) for index in range(25)]
    onset = [1.0 if time in {4.0, 8.0} else 0.05 for time in beats]
    timeline = plan.build_timeline(tmp_path, {
        "version": 1,
        "audio": "song.mp3",
        "duration": 12.0,
        "bpm": 120.0,
        "beats": beats,
        "energy": [0.4] * len(beats),
        "onset": onset,
        "downbeats": [4.0, 8.0],
        "first_strong_onset": 0.0,
    }, [], {**plan.DEFAULTS, "trim": "full", "chapters": False, "intro": False}, None)
    photos = [clip for clip in timeline["photos"] if clip["kind"] == "photo"]
    assert [clip["start"] for clip in photos[1:]] == [4.0, 8.0]
    assert [clip["transition"]["type"] for clip in photos[1:]] == ["cut", "cut"]


def test_local_downbeat_follows_each_bar_instead_of_one_global_phase():
    times = [index * 0.5 for index in range(8)]
    strength = [0.1, 0.2, 0.9, 0.2, 0.8, 0.1, 0.2, 0.1]
    assert local_downbeat_times(times, strength) == [1.0, 2.0]


def test_packed_song_relaxes_to_one_beat_before_dropping_a_photo():
    beats = _grid(0.5, 16)
    cuts = plan_photo_cuts(
        duration=16,
        n_photos=9,
        beat_times=beats,
        not_after=16 - 2.5 - 0.8,
    )
    times = [cut.time for cut in cuts]
    assert len(times) == 8
    gaps = [b - a for a, b in zip([0, *times], times)]
    assert min(gaps) >= 0.5 - 1e-9


def test_timeline_keeps_every_photo_when_a_bar_does_not_fit(tmp_path: Path):
    for index in range(9):
        Image.new("RGB", (4, 4), color=(index, 0, 0)).save(tmp_path / f"{index:03d}.jpg")
    beats = _grid(0.5, 16)
    timeline = plan.build_timeline(tmp_path, {
        "version": 1,
        "audio": "song.mp3",
        "duration": 16.0,
        "bpm": 120.0,
        "beats": beats,
        "energy": [0.4] * len(beats),
        "onset": [0.2] * len(beats),
        "downbeats": [float(index * 2) for index in range(9)],
        "first_strong_onset": 0.0,
    }, [], {**plan.DEFAULTS, "trim": "full", "chapters": False, "intro": False}, None)
    photos = [clip for clip in timeline["photos"] if clip["kind"] == "photo"]
    assert len(photos) == 9


def test_a_beat_past_the_song_does_not_throw_away_onset():
    beats = _grid(0.5, 8)
    onset = [1.0 if time in {2.0, 4.0, 6.0} else 0.05 for time in beats]
    cuts = plan_photo_cuts(
        duration=8,
        n_photos=3,
        beat_times=[*beats, 30.0],
        onset=[*onset, 1.0],
        fps=60,
    )
    assert all(cut.time in {2.0, 4.0, 6.0} for cut in cuts)
    assert all(cut.hard for cut in cuts)


def test_duplicate_beat_keeps_the_first_onset():
    beats = _grid(0.5, 8)
    onset = [1.0 if time == 4.0 else 0.05 for time in beats]
    cuts = plan_photo_cuts(
        duration=8,
        n_photos=2,
        beat_times=[*beats, 4.0],
        onset=[*onset, 0.0],
    )
    assert len(cuts) == 1
    assert cuts[0].time == 4.0
    assert cuts[0].hard is True
