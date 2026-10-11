import numpy as np
import pytest

from analyze import beat_energy, beat_onset_features
import librosa
from beat_alloc import allocate_switch_points, dynamic_switch_ideals


def test_energy_is_per_beat_bounded_stable_and_tracks_loudness():
    sr = 100
    y = np.concatenate([np.full(sr, 0.01, dtype=np.float32), np.full(sr, 0.5, dtype=np.float32), np.full(sr, 0.1, dtype=np.float32)])
    beats = np.array([0.0, 1.0, 2.0])
    first = beat_energy(y, sr, beats, 3.0)
    assert len(first) == 3 and all(0 <= value <= 1 for value in first)
    assert first[1] > first[2] > first[0]
    assert beat_energy(y, sr, beats, 3.0) == first


def test_low_onset_is_stronger_on_the_kick_than_on_silence():
    sr = 22050
    y = np.zeros(sr * 2, dtype=np.float32)
    click = np.sin(2 * np.pi * 80 * np.arange(sr // 20) / sr).astype(np.float32)
    y[sr // 2:sr // 2 + click.size] += click
    beat_times = np.array([0.5, 1.5])
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    frames = librosa.time_to_frames(beat_times, sr=sr)
    onset, low = beat_onset_features(y, sr, beat_times, onset_env, frames)
    assert len(onset) == len(low) == 2
    assert low[0] > low[1]


def test_silence_and_constant_energy_use_neutral_half():
    for y in [np.zeros(300, dtype=np.float32), np.ones(300, dtype=np.float32)]:
        assert beat_energy(y, 100, np.array([0.0, 1.0, 2.0]), 3.0) == [0.5, 0.5, 0.5]


def test_dynamic_targets_put_more_switches_in_high_energy_and_keep_constraints():
    beats = [float(i) for i in range(20)]
    energy = [0.0] * 10 + [1.0] * 10
    ideals = dynamic_switch_ideals(20, 8, beats, energy)
    assert ideals is not None and len(ideals) == 7
    assert sum(point >= 10 for point in ideals) > sum(point < 10 for point in ideals)
    switches = allocate_switch_points(20, 8, beats, min_gap=1, ideal_points=ideals)
    assert len(switches) == 7
    assert min(b - a for a, b in zip([0, *switches], switches)) >= 1


def test_dynamic_pacing_keeps_all_switches_when_early_segment_is_sparse():
    duration = 40.0
    n_photos = 12
    beats = [float(index) for index in range(40)]
    energy = [0.0] * 20 + [1.0] * 20
    ideals = dynamic_switch_ideals(duration, n_photos, beats, energy)
    assert ideals is not None

    uniform = allocate_switch_points(duration, n_photos, [], min_gap=2.0)
    dynamic = allocate_switch_points(
        duration, n_photos, [], min_gap=2.0, ideal_points=ideals,
    )
    assert len(uniform) == len(dynamic) == n_photos - 1
    assert sum(point >= 20.0 for point in dynamic) > sum(point >= 20.0 for point in uniform)
    assert sum(point < 20.0 for point in dynamic) < sum(point < 20.0 for point in uniform)
    assert min(b - a for a, b in zip([0.0, *dynamic], dynamic)) >= 2.0 - 1e-9
    assert duration - dynamic[-1] >= 2.0 - 1e-9


def test_dynamic_real_shape_with_downbeats_keeps_all_switches():
    duration = 29.301
    n_photos = 12
    beats = [2.315, 3.008, 3.723, 4.416, 5.109, 5.792, 6.496, 7.189, 7.872, 8.565, 9.259, 9.941, 10.624, 11.317, 12.011, 12.715, 13.365, 14.101, 14.784, 15.477, 16.171, 16.853, 17.547, 18.240, 18.923, 19.627, 20.320, 21.013, 21.696, 22.400, 23.083, 23.776, 24.459, 25.163, 25.856, 26.539, 27.232, 27.925, 28.608, 29.301]
    energy = [0.0] * 16 + [0.464, 0.455, 0.638, 0.450, 0.467, 0.470, 0.512, 0.462, 0.813, 0.786, 0.787, 0.738, 0.681, 0.784, 0.787, 0.668, 0.697, 0.705, 0.723, 0.698, 0.663, 0.582, 0.866, 0.541]
    downbeats = [4.416, 7.189, 9.941, 12.715, 15.477, 18.240, 21.013, 23.776, 26.539]
    ideals = dynamic_switch_ideals(duration, n_photos, beats, energy, head_offset=3.0)
    assert ideals is not None and all(0.0 <= point <= duration for point in ideals)
    switches = allocate_switch_points(duration, n_photos, downbeats, min_gap=2.0, not_before=3.2, head_offset=3.0, not_after=28.051, ideal_points=ideals)
    assert len(switches) == n_photos - 1
    assert switches[0] == pytest.approx(7.189)
    assert min(b - a for a, b in zip([0.0, *switches], switches)) >= 2.0 - 1e-9
    assert duration - switches[-1] >= 2.0 - 1e-9


@pytest.mark.parametrize(
    "energy",
    [
        [1.0] + [0.0] * 19,
        [0.0] + [1.0] * 19,
    ],
)
def test_dynamic_targets_hard_limit_skewed_intervals(energy):
    duration = 20
    n_photos = 8
    ideals = dynamic_switch_ideals(duration, n_photos, [float(i) for i in range(20)], energy)
    assert ideals is not None and len(ideals) == n_photos - 1
    intervals = [end - start for start, end in zip([0, *ideals], [*ideals, duration])]
    average = duration / n_photos
    assert sum(intervals) == pytest.approx(duration)
    assert all(0.6 * average <= interval <= 1.6 * average for interval in intervals)


def test_invalid_energy_falls_back_and_uniform_is_bit_exact():
    beats = [float(i) for i in range(20)]
    baseline = allocate_switch_points(20, 5, beats)
    for invalid in [None, [0.5], [float("nan")] * 20, [2.0] * 20]:
        assert dynamic_switch_ideals(20, 5, beats, invalid) is None
        assert allocate_switch_points(20, 5, beats, ideal_points=None) == baseline
    neutral = dynamic_switch_ideals(20, 5, [0.5 + i for i in range(20)], [0.5] * 20)
    assert neutral == pytest.approx([4.0, 8.0, 12.0, 16.0])
