"""照片切换规划:在拍点上做全局选择,而不是每 N 拍切一次。

候选只来自节拍网格,不用裸起音,避免踩镲和音节把画面切碎。
每一小节里最强的一拍优先;动态规划同时看停留时长。
最短间隔是这一首歌的一小节;塞不下时才退到一拍。
"""

from __future__ import annotations

from dataclasses import dataclass
import math


HARD_CUT_SCORE = 0.55
_NEG = -1e100


@dataclass(frozen=True)
class PhotoCut:
    time: float
    score: float
    hard: bool


def local_downbeat_times(beat_times: list[float], strength: list[float]) -> list[float]:
    """每一小节里强度最高的拍。不足四拍时原样返回。"""
    times = [float(t) for t in beat_times]
    if len(times) < 4:
        return times
    gaps = [b - a for a, b in zip(times, times[1:]) if b > a]
    interval = sorted(gaps)[len(gaps) // 2] if gaps else 0.5
    bar = interval * 4
    if bar <= 0:
        return times
    bins: dict[int, list[int]] = {}
    origin = times[0]
    for index, time in enumerate(times):
        bins.setdefault(int((time - origin) / bar), []).append(index)
    chosen = []
    for key in sorted(bins):
        group = bins[key]
        best = max(group, key=lambda item: strength[item] if item < len(strength) else 0.0)
        chosen.append(times[best])
    return chosen


def plan_photo_cuts(
    *,
    duration: float,
    n_photos: int,
    beat_times: list[float],
    energy: list[float] | None = None,
    onset: list[float] | None = None,
    low_onset: list[float] | None = None,
    lyric_spans: list[tuple[float, float]] | None = None,
    not_before: float = 0.0,
    head_offset: float = 0.0,
    start_offset: float = 0.0,
    not_after: float | None = None,
    fps: int = 60,
) -> list[PhotoCut]:
    """返回 n_photos-1 个切换。一小节和一拍都塞不下时少返回,由调用方丢掉尾部照片。"""
    if n_photos <= 1 or duration <= 0:
        return []
    times, scores = _prepare_beats(beat_times, energy, onset, low_onset, duration)
    need = n_photos - 1
    interval = _beat_interval(times)
    bar = interval * 4
    lines = lyric_spans or []

    def place(count: int, gap: float):
        gap = max(gap, 1e-3)
        first_lower = max(start_offset + gap, not_before)
        cap = _last_cap(duration, gap, not_after, head_offset, n_photos)
        if count < 1 or first_lower + (count - 1) * gap > cap + 1e-9:
            return None
        target = max((duration - head_offset) / n_photos, gap)
        ideals = [head_offset + index * (duration - head_offset) / n_photos for index in range(1, count + 1)]
        return _search(times, scores, count, start_offset, duration, first_lower, cap, gap, target, ideals, lines)

    chosen = None
    for gap in (bar, interval):
        chosen = place(need, gap)
        if chosen is not None:
            break
        if bar <= interval + 1e-9:
            break
    if chosen is None:
        for count in range(need - 1, 0, -1):
            chosen = place(count, interval)
            if chosen is not None:
                break
    if chosen is None:
        gap = max(interval, 1e-3)
        first_lower = max(start_offset + gap, not_before)
        cap = _last_cap(duration, gap, not_after, head_offset, n_photos)
        chosen = _fallback(need, duration, head_offset, n_photos, first_lower, gap, cap, scores, times)
    quantized = _quantize([time for time, _score in chosen], fps, duration)
    by_time = {time: score for time, score in chosen}
    cuts = []
    for time in quantized:
        score = by_time.get(time, 0.0)
        if score == 0.0:
            nearest = min(by_time, key=lambda item: abs(item - time), default=None)
            if nearest is not None and abs(nearest - time) <= 1 / max(fps, 1):
                score = by_time[nearest]
        cuts.append(PhotoCut(time=time, score=score, hard=score >= HARD_CUT_SCORE))
    return cuts


def _beat_interval(times: list[float]) -> float:
    gaps = [b - a for a, b in zip(times, times[1:]) if b > a]
    if not gaps:
        return 0.5
    return sorted(gaps)[len(gaps) // 2]


def _prepare_beats(beat_times, energy, onset, low_onset, duration: float):
    """丢掉越界拍,同一时刻只留第一次出现的特征。"""
    kept: dict[float, int] = {}
    for index, raw in enumerate(beat_times):
        time = float(raw)
        if not math.isfinite(time) or time < 0 or time > duration or time in kept:
            continue
        kept[time] = index
    times = sorted(kept)
    loud = [_unit_at(energy, kept[time], 0.5) for time in times]
    if isinstance(onset, list):
        attack = [
            loud[index] if kept[time] >= len(onset) else _unit_at(onset, kept[time], 0.5)
            for index, time in enumerate(times)
        ]
    else:
        attack = list(loud)
    low = [_unit_at(low_onset, kept[time], 0.0) for time in times]
    return times, _beat_scores(times, loud, attack, low, _beat_interval(times) * 4)


def _unit_at(values, index: int, default: float) -> float:
    if not isinstance(values, list) or index >= len(values):
        return default
    value = values[index]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return default
    return float(min(1.0, max(0.0, value)))


def _beat_scores(times, loud, attack, low, bar: float) -> list[float]:
    count = len(times)
    rise = [0.0]
    for index in range(1, count):
        rise.append(max(0.0, loud[index] - loud[index - 1]))
    local = [0.0] * count
    if count and bar > 0:
        bins: dict[int, list[int]] = {}
        origin = times[0]
        for index, time in enumerate(times):
            bins.setdefault(int((time - origin) / bar), []).append(index)
        for group in bins.values():
            best = max(group, key=lambda item: 0.6 * attack[item] + 0.4 * low[item] + 0.25 * rise[item])
            local[best] = 1.0
    return [
        0.35 * local[index] + 0.30 * attack[index] + 0.20 * low[index] + 0.15 * rise[index]
        for index in range(count)
    ]


def _last_cap(duration, min_gap, not_after, head_offset, n_photos) -> float:
    """末切不能吃掉最后一张的最短停留。片尾预留不得早于均分网格的末位。"""
    hard = duration - min_gap
    if not_after is None or n_photos <= 1:
        return hard
    ideal_last = head_offset + (n_photos - 1) * (duration - head_offset) / n_photos
    return min(hard, max(ideal_last, not_after))


def _gap_cost(gap: float, target: float) -> float:
    low = 0.6 * target
    high = 1.6 * target
    if gap < low:
        return (low - gap) / target
    if gap > high:
        return (gap - high) / target
    return 0.0


def _lyric_adjust(time: float, lines: list[tuple[float, float]]) -> float:
    adjust = 0.0
    for start, end in lines:
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            continue
        if start + 0.05 < time < end - 0.25:
            adjust -= 0.5
        elif abs(time - end) <= 0.25:
            adjust += 0.15
    return adjust


def _value(score: float, time: float, gap: float, ideal: float, target: float, lines) -> float:
    pull = 0.35 * abs(time - ideal) / target
    return score + _lyric_adjust(time, lines) - 1.2 * _gap_cost(gap, target) - pull


def _search(times, scores, need, start, duration, first_lower, cap, min_gap, target, ideals, lines):
    cands = [(time, score) for time, score in zip(times, scores) if first_lower - 1e-9 <= time <= cap + 1e-9]
    if not cands:
        return None
    count = len(cands)
    dp = [[_NEG] * count for _ in range(need)]
    prev = [[-1] * count for _ in range(need)]
    for index, (time, score) in enumerate(cands):
        latest = _latest(index_in_plan=0, need=need, duration=duration, min_gap=min_gap, cap=cap)
        if time > latest + 1e-9:
            continue
        dp[0][index] = _value(score, time, time - start, ideals[0], target, lines)
    for placed in range(1, need):
        for index in range(count):
            time, score = cands[index]
            latest = _latest(placed, need, duration, min_gap, cap)
            if time > latest + 1e-9:
                continue
            best = _NEG
            best_from = -1
            for earlier in range(index):
                if dp[placed - 1][earlier] <= _NEG / 2:
                    continue
                gap = time - cands[earlier][0]
                if gap + 1e-9 < min_gap:
                    continue
                value = dp[placed - 1][earlier] + _value(score, time, gap, ideals[placed], target, lines)
                if value > best:
                    best = value
                    best_from = earlier
            dp[placed][index] = best
            prev[placed][index] = best_from
    end_row = need - 1
    best_index = max(range(count), key=lambda item: dp[end_row][item])
    if dp[end_row][best_index] <= _NEG / 2:
        return None
    chosen = []
    cursor = best_index
    for placed in range(end_row, -1, -1):
        chosen.append(cands[cursor])
        cursor = prev[placed][cursor]
    chosen.reverse()
    return chosen


def _latest(index_in_plan: int, need: int, duration: float, min_gap: float, cap: float) -> float:
    remaining_cuts = need - 1 - index_in_plan
    latest = cap - remaining_cuts * min_gap
    tail = duration - (remaining_cuts + 1) * min_gap
    return min(latest, tail)


def _fallback(need, duration, head_offset, n_photos, first_lower, min_gap, cap, scores, times):
    points = []
    indexed = {time: score for time, score in zip(times, scores)}
    for index in range(1, need + 1):
        ideal = head_offset + index * (duration - head_offset) / n_photos
        lower = first_lower if index == 1 else points[-1][0] + min_gap
        upper = min(cap, duration - (need - index + 1) * min_gap)
        if lower > upper + 1e-9:
            break
        time = min(max(ideal, lower), upper)
        points.append((time, indexed.get(time, 0.0)))
    return points


def _quantize(times: list[float], fps: int, duration: float) -> list[float]:
    if fps <= 0:
        return times
    frame = 1 / fps
    quantized = []
    previous = 0.0
    for time in times:
        snapped = round(time * fps) / fps
        if snapped <= previous:
            snapped = round((previous + frame) * fps) / fps
        if snapped >= duration:
            break
        quantized.append(snapped)
        previous = snapped
    return quantized
