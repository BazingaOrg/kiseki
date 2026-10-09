"""plan.main() 的手改保护 / 自动升级集成测试。

核心不变式:素材(input_hash)没变时——
- 文件内容自身校验和(plan_checksum)吻合 → 从未被手动碰过 → 放心用最新
  算法覆盖刷新(悄悄升级,解决"改了 plan.py 算法但旧文件夹不生效"的问题)。
- 校验和不吻合 → 内容与"某次 plan 本该产出的结果"不一致 → 判定手改,
  原样保留,绝不覆盖(即使这意味着退回保留一份算法过时的文件)。

校验和覆盖整份文档(除 plan_checksum 自身外),而非挑选字段——
否则手改 meta 里的字段(如 photo_scale)会被静默覆盖丢失,见
test_edited_meta_field_is_preserved(这是本文件最重要的一条护栏测试)。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

import plan
from plan import _content_checksum

DEFAULT_HASH = "deadbeef12345678"


def make_photos(folder: Path, n: int) -> None:
    for i in range(n):
        Image.new("RGB", (4, 4), color=(i % 255, 0, 0)).save(folder / f"{i:03d}.jpg")


def make_dated_photos(folder: Path) -> None:
    for i, day in enumerate(["2026:07:13", "2026:07:14"]):
        image = Image.new("RGB", (4, 4), color=(i, 0, 0))
        exif = Image.Exif()
        exif[plan.DATETIME_ORIGINAL] = f"{day} 12:00:00"
        image.save(folder / f"{i:03d}.jpg", exif=exif)


def _frange(start: float, stop: float, step: float):
    t = start
    while t < stop:
        yield round(t, 3)
        t += step


def write_beats(folder: Path, duration: float, *, bpm: float = 120.0) -> None:
    metadata = folder / "output" / "metadata"
    metadata.mkdir(parents=True, exist_ok=True)
    data = {
        "version": 1,
        "audio": "song.mp3",
        "duration": duration,
        "bpm": bpm,
        "beats": list(_frange(0.0, duration, 0.5)),
        "downbeats": list(_frange(0.0, duration, 2.0)),
        "first_strong_onset": 0.0,
    }
    (metadata / "beats.json").write_text(json.dumps(data), encoding="utf-8")


def run_plan(folder: Path, *, input_hash: str = DEFAULT_HASH) -> int:
    return plan.main([str(folder), "--input-hash", input_hash])


def timeline_path(folder: Path) -> Path:
    return folder / "output" / "metadata" / "timeline.json"


def read_timeline(folder: Path) -> dict:
    return json.loads(timeline_path(folder).read_text(encoding="utf-8"))


def write_timeline(folder: Path, timeline: dict) -> None:
    timeline_path(folder).write_text(json.dumps(timeline), encoding="utf-8")


class TestFreshGeneration:
    def test_writes_self_consistent_checksum(self, tmp_path: Path):
        make_photos(tmp_path, 3)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0
        tl = read_timeline(tmp_path)
        assert tl["meta"]["plan_checksum"] == _content_checksum(tl)

    def test_planner_detail_counts_only_real_photos(self, tmp_path: Path, capsys):
        make_dated_photos(tmp_path)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0
        assert "plan: 2 photos / 30.0s (平均每张 15.0s" in capsys.readouterr().out


class TestUntouchedAutoUpgrade:
    def test_rerun_with_unchanged_untouched_file_regenerates(self, tmp_path: Path):
        make_photos(tmp_path, 3)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0
        first = read_timeline(tmp_path)

        # 素材未变、文件未被手动碰过 → 走覆盖分支重新生成(而非提前退出)
        assert run_plan(tmp_path) == 0
        second = read_timeline(tmp_path)
        assert second["meta"]["plan_checksum"] == _content_checksum(second)
        assert second["photos"] == first["photos"]  # 算法未变,内容理应一致


class TestHandEditPreservation:
    def test_edited_photo_timing_is_preserved(self, tmp_path: Path):
        make_photos(tmp_path, 3)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0

        tl = read_timeline(tmp_path)
        tl["photos"][0]["end"] = 999.0
        write_timeline(tmp_path, tl)

        assert run_plan(tmp_path) == 0  # 应当保留,不报错
        assert read_timeline(tmp_path)["photos"][0]["end"] == 999.0

    def test_edited_meta_field_is_preserved(self, tmp_path: Path):
        # 护栏测试:只校验 {photos,subtitles,beats} 三元组会漏掉这类改动,
        # 必须对整份文档(除 plan_checksum 外)算校验和才能捕获
        make_photos(tmp_path, 3)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0

        tl = read_timeline(tmp_path)
        tl["meta"]["photo_scale"] = 0.42
        write_timeline(tmp_path, tl)

        assert run_plan(tmp_path) == 0
        assert read_timeline(tmp_path)["meta"]["photo_scale"] == 0.42

    def test_edited_chapter_text_is_preserved(self, tmp_path: Path):
        make_dated_photos(tmp_path)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0

        tl = read_timeline(tmp_path)
        chapter = next(clip for clip in tl["photos"] if clip.get("kind") == "chapter")
        chapter["text"] = "手改章节文案"
        write_timeline(tmp_path, tl)

        assert run_plan(tmp_path) == 0
        assert next(clip for clip in read_timeline(tmp_path)["photos"] if clip.get("kind") == "chapter")["text"] == "手改章节文案"

    def test_edited_chapter_timing_is_preserved(self, tmp_path: Path):
        make_dated_photos(tmp_path)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0

        tl = read_timeline(tmp_path)
        chapter = next(clip for clip in tl["photos"] if clip.get("kind") == "chapter")
        chapter["start"], chapter["end"] = 11.0, 13.0
        write_timeline(tmp_path, tl)

        assert run_plan(tmp_path) == 0
        edited = next(clip for clip in read_timeline(tmp_path)["photos"] if clip.get("kind") == "chapter")
        assert (edited["start"], edited["end"]) == (11.0, 13.0)


class TestBootstrap:
    def test_pre_feature_file_without_plan_checksum_is_preserved(self, tmp_path: Path):
        # 没有 plan_checksum 字段的旧文件(功能上线前生成)——校验和永远算不出
        # 匹配值,保守起见视为"可能手改过",原样保留,不静默覆盖
        make_photos(tmp_path, 3)
        write_beats(tmp_path, 30.0)
        old_timeline = {
            "meta": {"version": 1, "audio": "./song.mp3", "duration": 30.0, "input_hash": DEFAULT_HASH},
            "photos": [{
                "src": "./000.jpg", "start": 0.0, "end": 15.0,
                "transition": {"type": "none", "duration": 0},
                "motion": {"type": "none", "from": 1.0, "to": 1.0},
            }],
            "subtitles": [],
            "beats": {"bpm": 120.0, "downbeats": []},
        }
        write_timeline(tmp_path, old_timeline)

        assert run_plan(tmp_path) == 0
        assert read_timeline(tmp_path) == old_timeline  # 一字未改


class TestMaterialChanged:
    def test_input_hash_mismatch_regenerates_regardless_of_checksum(self, tmp_path: Path):
        make_photos(tmp_path, 3)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path, input_hash="aaa") == 0

        # 素材变化(哈希不同)→ 即便文件自洽也应正常重新生成,
        # 不会误走"手改保留"分支
        assert run_plan(tmp_path, input_hash="bbb") == 0
        second = read_timeline(tmp_path)
        assert second["meta"]["input_hash"] == "bbb"
        assert second["meta"]["plan_checksum"] == _content_checksum(second)


class TestMissingBeatsFallback:
    def test_hand_edited_file_preserved_even_without_beats_json(self, tmp_path: Path):
        make_dated_photos(tmp_path)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0

        tl = read_timeline(tmp_path)
        chapter = next(clip for clip in tl["photos"] if clip.get("kind") == "chapter")
        chapter["text"] = "缺拍点时保留的手改章节"
        write_timeline(tmp_path, tl)
        (tmp_path / "output" / "metadata" / "beats.json").unlink()  # 模拟被手动删除

        assert run_plan(tmp_path) == 0  # 不应报错(手改保留分支不依赖 beats.json)
        assert next(clip for clip in read_timeline(tmp_path)["photos"] if clip.get("kind") == "chapter")["text"] == "缺拍点时保留的手改章节"

    def test_untouched_file_falls_back_to_preserve_when_beats_missing(self, tmp_path: Path):
        make_dated_photos(tmp_path)
        write_beats(tmp_path, 30.0)
        assert run_plan(tmp_path) == 0
        first = read_timeline(tmp_path)

        (tmp_path / "output" / "metadata" / "beats.json").unlink()

        # 本想刷新(文件未被手动改过)但 beats.json 缺失 → 退回保留现状,而非报错
        assert run_plan(tmp_path) == 0
        assert read_timeline(tmp_path) == first
