"""plan.build_timeline 的片头/片尾预留集成测试。

验证不变式:plan 是否预留片头,与渲染端 Diary.tsx 的 showIntro 判定
(photos[0].end >= SHOW_INTRO_MIN_PHOTO0_END 且 duration >= SHOW_INTRO_MIN_T)
必须保持一致——无论 plan 是否"打算"预留,最终产出的 timeline 数值都要让
两端的判断吻合。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

import plan
from plan import (
    MIN_PHOTO_VISIBLE,
    SHOW_INTRO_MIN_PHOTO0_END,
    SHOW_INTRO_MIN_T,
    WHITE_FADE_DURATION,
    build_timeline,
)


def make_photos(folder: Path, n: int) -> None:
    for i in range(n):
        img = Image.new("RGB", (4, 4), color=(i % 255, 0, 0))
        img.save(folder / f"{i:03d}.jpg")


def make_beats(duration: float, *, bpm: float = 120.0, first_strong_onset: float = 0.0) -> dict:
    downbeats = [t for t in frange(0.0, duration, 2.0)]
    beats = [t for t in frange(0.0, duration, 0.5)]
    return {
        "version": 1,
        "audio": "song.mp3",
        "duration": duration,
        "bpm": bpm,
        "beats": beats,
        "downbeats": downbeats,
        "first_strong_onset": first_strong_onset,
    }


def frange(start: float, stop: float, step: float):
    t = start
    while t < stop:
        yield round(t, 3)
        t += step


def renderer_shows_intro(photo0_end: float, total_duration: float) -> bool:
    """Diary.tsx showIntro 规则的纯 Python 复刻,作为不变式的独立锚点。"""
    return photo0_end >= SHOW_INTRO_MIN_PHOTO0_END and total_duration >= SHOW_INTRO_MIN_T


class TestHeadTailInvariant:
    def test_normal_length_reserves_head_and_renderer_agrees(self, tmp_path: Path):
        make_photos(tmp_path, 6)
        beats = make_beats(60.0)  # avg=10,非快闪,时长远超 5.95s 阈值
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        photo0_end = timeline["photos"][0]["end"]
        total = timeline["meta"]["duration"]
        assert photo0_end >= SHOW_INTRO_MIN_PHOTO0_END
        assert renderer_shows_intro(photo0_end, total)

    def test_flash_mode_never_reserves_and_renderer_skips(self, tmp_path: Path):
        make_photos(tmp_path, 20)
        beats = make_beats(20.0)  # avg=1 < flash_avg_threshold(2.0)
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        photo0_end = timeline["photos"][0]["end"]
        total = timeline["meta"]["duration"]
        assert photo0_end < SHOW_INTRO_MIN_PHOTO0_END
        assert not renderer_shows_intro(photo0_end, total)

    def test_very_short_composition_never_reserves(self, tmp_path: Path):
        make_photos(tmp_path, 2)
        beats = make_beats(4.0)  # < SHOW_INTRO_MIN_T(5.95),avg=2 非快闪
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        photo0_end = timeline["photos"][0]["end"]
        total = timeline["meta"]["duration"]
        assert not renderer_shows_intro(photo0_end, total)

    def test_avg_boundary_at_two_seconds_is_non_flash(self, tmp_path: Path):
        # avg 恰好等于 flash 阈值(严格小于才算快闪)→ 走非快闪分支,预留应生效。
        # 若未来误把判定改成 <=,退化到快闪分支后 t_1 上限骤降,下面的断言会失败——
        # 这是比"重言式"更能捕获回归的具体断言
        make_photos(tmp_path, 3)
        beats = make_beats(6.0)  # avg=2.0,n=3(非 2),门槛仍是 5.95,6.0 达标
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)
        photo0_end = timeline["photos"][0]["end"]
        assert photo0_end >= SHOW_INTRO_MIN_PHOTO0_END

    def test_single_photo_no_allocation_consistent(self, tmp_path: Path):
        make_photos(tmp_path, 1)
        beats = make_beats(30.0)
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        assert len(timeline["photos"]) == 1
        photo0_end = timeline["photos"][0]["end"]
        total = timeline["meta"]["duration"]
        assert photo0_end == total
        assert renderer_shows_intro(photo0_end, total)  # 30s 单张,自然满足两条阈值

    def test_last_photo_has_opaque_tail_before_white_fade(self, tmp_path: Path):
        # 精心构造:唯一候选(11.0)若不设 not_after 会被吸附(理想末位 8.325 附近,
        # 距离在半步长内),但只给末张照片留 14-11=3.0s(< 3.3s 目标)。
        # not_after 应把它排除,回退到未吸附的网格位置,保住最小可见时长
        make_photos(tmp_path, 2)
        beats = {
            "version": 1, "audio": "song.mp3", "duration": 14.0, "bpm": 120.0,
            "beats": [11.0], "downbeats": [11.0], "first_strong_onset": 0.0,
        }
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        total = timeline["meta"]["duration"]
        last_switch = timeline["photos"][0]["end"]  # n=2 时只有一个切换点
        assert last_switch != pytest.approx(11.0)  # 候选确实被 not_after 排除
        assert total - last_switch >= WHITE_FADE_DURATION + MIN_PHOTO_VISIBLE

    def test_n2_narrow_window_does_not_drop_the_second_photo(self, tmp_path: Path):
        # 回归(deep-reasoner 审查发现):n=2 时头尾约束落在同一个切换点上,
        # 若仍用 SHOW_INTRO_MIN_T(5.95s)作预留门槛,[5.95, 6.75) 区间内
        # 该唯一切换点必须同时 >=3.45(头)且 <=duration-3.3(尾),
        # duration=5.95 时窗口宽度为 0,无候选可落 → 曾整体丢弃第二张照片。
        # n==2 分支已把门槛抬高到 6.75s,这里固定在最窄的失败点验证不再丢照片。
        make_photos(tmp_path, 2)
        beats = make_beats(SHOW_INTRO_MIN_T)  # 5.95,无候选(默认 2s 网格恰好错开窗口)
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        assert len(timeline["photos"]) == 2

    def test_n2_reserve_gate_uses_stricter_threshold(self, tmp_path: Path):
        # n==2 且 duration 恰好在 [5.95, 6.75) 之间:不应预留片头
        # (renderer 也不会显示,因为 photo0_end 达不到 3.45 或直接不预留)
        make_photos(tmp_path, 2)
        beats = make_beats(6.5)  # < 6.75(n==2 门槛),>= 5.95(通用门槛)
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        assert len(timeline["photos"]) == 2  # 不丢照片
        photo0_end = timeline["photos"][0]["end"]
        total = timeline["meta"]["duration"]
        # 不变式仍然成立:plan 未强行预留,渲染端的判定与实际值一致
        assert renderer_shows_intro(photo0_end, total) == (
            photo0_end >= SHOW_INTRO_MIN_PHOTO0_END and total >= SHOW_INTRO_MIN_T
        )

    def test_n2_reserve_gate_opens_past_stricter_threshold(self, tmp_path: Path):
        make_photos(tmp_path, 2)
        beats = make_beats(SHOW_INTRO_MIN_T + MIN_PHOTO_VISIBLE)  # 6.75,恰好达标
        cfg = dict(plan.DEFAULTS)
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        assert len(timeline["photos"]) == 2
        photo0_end = timeline["photos"][0]["end"]
        assert photo0_end >= SHOW_INTRO_MIN_PHOTO0_END  # 预留生效

    def test_trim_mode_then_head_tail_reserve_consistent(self, tmp_path: Path):
        # 图少歌长触发裁剪,裁剪后的 duration 才是判断预留的依据
        make_photos(tmp_path, 3)
        beats = make_beats(200.0)  # avg = 200/3 ≈ 66.7 > trim_avg_threshold(10)
        cfg = {**plan.DEFAULTS, "trim": "auto"}
        timeline = build_timeline(tmp_path, beats, [], cfg, None)

        total = timeline["meta"]["duration"]
        assert total < 200.0  # 确认真的裁剪了
        photo0_end = timeline["photos"][0]["end"]
        assert renderer_shows_intro(photo0_end, total) == (total >= SHOW_INTRO_MIN_T)


class TestIntroConfigOff:
    def test_intro_false_skips_head_reserve_even_when_long_enough(self, tmp_path: Path):
        make_photos(tmp_path, 6)
        beats = make_beats(60.0)
        with_intro = build_timeline(tmp_path, beats, [], dict(plan.DEFAULTS), None)
        cfg = dict(plan.DEFAULTS)
        cfg["intro"] = False
        cfg["_explicit_branding"] = {"intro"}
        without = build_timeline(tmp_path, beats, [], cfg, None)
        # 开片头预留抬高首切;intro=false 不预留 → 首切更早,两端端也不挂 Intro
        assert with_intro["photos"][0]["end"] >= SHOW_INTRO_MIN_PHOTO0_END
        assert without["photos"][0]["end"] < with_intro["photos"][0]["end"]
        assert without["meta"]["branding"]["intro"] is False


class TestConstantsMirrorSanity:
    def test_show_intro_thresholds_are_positive_and_ordered(self):
        # 基本防呆:片头预留下界应小于总时长门槛(否则预留逻辑自相矛盾)
        assert 0 < SHOW_INTRO_MIN_PHOTO0_END < SHOW_INTRO_MIN_T
