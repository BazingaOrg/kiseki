"""节拍分配算法(plan 阶段核心,实现方案第四节)。

MVP:贪心吸附。理想均匀网格 → 吸附到最近的候选节拍(优先重拍),
约束:严格单调递增、相邻间隔 >= min_gap、首个切换点 >= 首个强 onset。
吸附距离上限为一个网格步长:候选太远时宁可不踩拍也不毁节奏,
回退到未吸附的网格时间(取 prev + min_gap 下界);
极端失配(时长塞不下 N-1 个 min_gap)时输出可能少于 N-1 个,由 plan 层决定丢弃尾部照片。

升级路径(非 MVP):动态规划求全局最优,见计划文档。
"""

from __future__ import annotations

from bisect import bisect_left
import math


def _bounded_intervals(intervals: list[float], average: float) -> list[float]:
    """Project intervals onto [0.6, 1.6] * average while preserving their sum."""
    lower = 0.6 * average
    upper = 1.6 * average
    result = list(intervals)
    free = set(range(len(result)))
    remaining = sum(intervals)

    while free:
        free_total = sum(result[index] for index in free)
        scale = remaining / free_total if free_total > 0 else 1.0
        changed = False
        for index in list(free):
            value = result[index] * scale
            if value < lower:
                result[index] = lower
            elif value > upper:
                result[index] = upper
            else:
                continue
            remaining -= result[index]
            free.remove(index)
            changed = True
        if not changed:
            for index in free:
                result[index] *= scale
            break
    return result


def dynamic_switch_ideals(duration: float, n_photos: int, beats: list[float], energy: object,
                          *, head_offset: float = 0.0) -> list[float] | None:
    """Equal-density targets; invalid optional energy asks the caller to use uniform."""
    if not isinstance(energy, list) or len(energy) != len(beats) or not beats:
        return None
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or not 0 <= value <= 1 for value in energy):
        return None
    segments: list[tuple[float, float, float]] = []
    boundaries = [head_offset, *[float(t) for t in beats if head_offset < float(t) < duration], duration]
    for start, end in zip(boundaries, boundaries[1:]):
        index = max(0, bisect_left(beats, start) - (0 if start in beats else 1))
        index = min(index, len(energy) - 1)
        if end > start:
            density = 1.0 / (1.6 - float(energy[index]))
            segments.append((start, end, density))
    if not segments:
        return None
    total = sum((end - start) * density for start, end, density in segments)
    ideals = []
    for slot in range(1, n_photos):
        target = total * slot / n_photos
        acc = 0.0
        for start, end, density in segments:
            mass = (end - start) * density
            if acc + mass >= target:
                ideals.append(start + (target - acc) / density)
                break
            acc += mass
    if len(ideals) != n_photos - 1:
        return None
    boundaries = [head_offset, *ideals, duration]
    intervals = [end - start for start, end in zip(boundaries, boundaries[1:])]
    bounded = _bounded_intervals(intervals, (duration - head_offset) / n_photos)
    result = []
    elapsed = head_offset
    for interval in bounded[:-1]:
        elapsed += interval
        result.append(elapsed)
    return result


def allocate_switch_points(
    duration: float,
    n_photos: int,
    candidates: list[float],
    *,
    min_gap: float = 2.0,
    not_before: float = 0.0,
    head_offset: float = 0.0,
    start_offset: float = 0.0,
    not_after: float | None = None,
    ideal_points: list[float] | None = None,
) -> list[float]:
    """返回 n_photos - 1 个切换点(秒),严格递增。

    duration: 音频时长;candidates: 节拍候选集(通常传 downbeats,快闪模式传 beats);
    not_before: 首个切换点下界(首个强 onset;或叠加片头预留下界,由调用方决定)。
    min_gap: 相邻切换点最小间隔,任何时候都不可违反(硬约束,优先级最高)。
    head_offset: 理想网格整体右移量(渲染端片头遮挡时长)。0(默认)不改变行为——
        理想网格退化为原始的 [duration/n_photos, 2·duration/n_photos, …]。
        非零时网格变为从 head_offset 起的等距点,使首张照片的"可见"时长
        (切换点 - head_offset)与其余照片相当。
    not_after: 末个切换点的软上界(渲染端片尾白场遮挡前的最小可见时长)。
        实际生效值取 max(网格自身理想末位, not_after)——绝不比"均分网格"本该
        落点更早;仅在候选把末位吸附得比这更晚时才收紧。与 min_gap 冲突时
        min_gap 胜出(不为保留尾部可见时长而丢弃照片)。
    """
    if n_photos < 1:
        raise ValueError("n_photos must be >= 1")
    if n_photos == 1:
        return []
    if duration <= 0:
        raise ValueError("duration must be positive")
    if start_offset < 0 or start_offset >= duration:
        raise ValueError("start_offset must be within the composition")

    # 可用候选:落在 [not_before, duration - min_gap] 内(末张照片也要 >= min_gap)
    first_switch_floor = max(not_before, start_offset + min_gap)
    usable = sorted(c for c in candidates if first_switch_floor <= c <= duration - min_gap)
    # 吸附距离上限半个步长:再远就更靠近相邻槽位了,宁可不踩拍也不毁节奏
    span = duration - head_offset
    max_snap = span / n_photos / 2

    grid = ideal_points if ideal_points is not None else [head_offset + i * span / n_photos for i in range(1, n_photos)]
    if len(grid) != n_photos - 1:
        raise ValueError("ideal_points length must be n_photos - 1")
    last_idx = len(grid) - 1
    upper = max(grid[last_idx], not_after) if not_after is not None else None
    first_lower = max(start_offset + min_gap, not_before)
    reserve_capacity = first_lower <= duration - (n_photos - 1) * min_gap + 1e-9

    result: list[float] = []
    prev = start_offset
    used_idx = -1  # usable 中已消费到的下标,保证单调 + 不重复吸附

    for i, ideal in enumerate(grid):
        lower = max(prev + min_gap, not_before)
        # 为后续每个切换点及最后一张照片各预留一个 min_gap。仅逐点校验
        # lower 会让动态网格在前段吸附过晚，之后即使尚有总时长也无法补回点数。
        if reserve_capacity:
            remaining_gaps = n_photos - 1 - i
            capacity_cap = duration - remaining_gaps * min_gap
            if lower > capacity_cap + 1e-9:
                break
            cap = capacity_cap
            # 片尾预留是软约束：若与 min_gap 下界冲突，仍让 min_gap 胜出。
            if i == last_idx and upper is not None and upper >= lower:
                cap = min(cap, upper)
        else:
            cap = upper if i == last_idx else None
        # 候选区间起点:第一个 >= lower 且未被占用的候选
        start = max(bisect_left(usable, lower), used_idx + 1)
        best = None
        best_dist = None
        for j in range(start, len(usable)):
            c = usable[j]
            if cap is not None and c > cap:
                break  # usable 升序:一旦越过上界,后面全部超界
            d = abs(c - ideal)
            if best_dist is None or d < best_dist:
                best, best_dist = j, d
            elif c > ideal:
                break  # 已越过理想点且距离开始增大,后面只会更远
        if best is not None and best_dist is not None and best_dist <= max_snap:
            result.append(usable[best])
            used_idx = best
            prev = usable[best]
        else:
            # 候选耗尽:回退到未吸附时间,同时保留后续切换和尾图的容量。
            t = max(ideal, lower)
            if cap is not None:
                t = max(lower, min(t, cap))
            if t > duration - min_gap:
                break
            result.append(t)
            prev = t

    return result
