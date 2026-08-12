"""Whisper 模型下载可见化:约定目录完整性校验、下载目标与进度事件。"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest

import term
import whisper_backend
from whisper_backend import _download_model, _local_model_dir, _model_repo_id, _make_download_progress


def test_convention_dir_without_required_files_is_not_a_model(monkeypatch, tmp_path):
    # 只有 .incomplete 残留(下载中断)的目录不能冒充可用模型
    incomplete = tmp_path / "models" / "faster-whisper-small"
    incomplete.mkdir(parents=True)
    (incomplete / "model.bin.incomplete").write_text("partial")
    monkeypatch.setattr(whisper_backend, "REPO_ROOT", tmp_path)

    assert _local_model_dir("cpu", "small") is None

    # 补齐必需文件后才算数
    (incomplete / "model.bin").write_text("x")
    (incomplete / "config.json").write_text("{}")
    assert _local_model_dir("cpu", "small") == incomplete


def test_path_model_arg_is_trusted_even_if_odd(tmp_path):
    # model 参数直接给路径(env 指定场景)时,信任原样,不做完整性校验
    custom = tmp_path / "custom-model"
    custom.mkdir()
    (custom / "whatever.bin").write_text("x")

    assert _local_model_dir("mlx", str(custom)) == custom


def test_download_targets_convention_dir_with_repo_per_backend(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(whisper_backend, "REPO_ROOT", tmp_path)

    def fake_snapshot_download(repo_id, **kwargs):
        calls.append((repo_id, kwargs))
        target = Path(kwargs["local_dir"])
        target.mkdir(parents=True, exist_ok=True)
        (target / "weights.npz").write_text("x")
        (target / "config.json").write_text("{}")

    import huggingface_hub

    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(whisper_backend, "_make_download_progress", lambda: object)

    mlx_dir = _download_model("mlx", "medium")
    assert calls == [(
        "mlx-community/whisper-medium-mlx",
        {"local_dir": str(tmp_path / "models" / "whisper-medium-mlx"), "tqdm_class": object},
    )]
    assert mlx_dir == tmp_path / "models" / "whisper-medium-mlx"
    assert _local_model_dir("mlx", "medium") == mlx_dir

    calls.clear()
    cpu_dir = _download_model("cpu", "small")
    assert calls[0][0] == "Systran/faster-whisper-small"
    assert cpu_dir == tmp_path / "models" / "faster-whisper-small"


def test_download_progress_throttles_to_whole_percents(monkeypatch):
    monkeypatch.setenv("KISEKI_JSON_PROGRESS", "1")
    events = []
    monkeypatch.setattr(term, "_json_write", events.append)

    tqdm_cls = _make_download_progress()
    bar = tqdm_cls(unit="B", unit_scale=True, total=1000, file=io.StringIO())
    for _ in range(10):
        bar.update(10)  # 每次 1%,应逐点上报
    assert [event["percent"] for event in events] == [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]

    events.clear()
    bar2 = tqdm_cls(unit="B", unit_scale=True, total=1000, file=io.StringIO())
    bar2.update(7)  # 0.7%:不到 1%,不报
    assert events == []
    bar2.update(4)  # 1.1%:跨过 1%,报一次(上报真实百分比,面板显示时取整)
    assert [event["percent"] for event in events] == [0.011]

    events.clear()
    # hf 的 thread_map 文件数条(unit='it')不该产生字节进度事件
    files = tqdm_cls(unit="it", total=2, file=io.StringIO())
    files.update(1)
    assert events == []


def test_download_progress_stays_monotonic_when_total_grows(monkeypatch):
    monkeypatch.setenv("KISEKI_JSON_PROGRESS", "1")
    events = []
    monkeypatch.setattr(term, "_json_write", events.append)

    tqdm_cls = _make_download_progress()
    # 模拟 hf:先知道文件 1 的大小并下载大半,再发现文件 2 让 total 翻倍
    bar = tqdm_cls(unit="B", unit_scale=True, total=1000, file=io.StringIO())
    bar.update(950)
    assert events[-1]["percent"] == 0.95
    bar.total = 2000  # hf 发现文件 2 后追加 total
    bar.update(100)  # n=1050/2000=52%,低于已上报的 95%,不应回跳
    assert events[-1]["percent"] == 0.95
    bar.update(900)  # n=1950/2000=97.5% → 上报 97.5%
    assert events[-1]["percent"] == 0.975


def test_transcribe_downloads_first_then_uses_local_path(monkeypatch, tmp_path):
    downloaded = tmp_path / "models" / "whisper-medium-mlx"
    downloaded.mkdir(parents=True)
    (downloaded / "weights.npz").write_text("x")
    (downloaded / "config.json").write_text("{}")
    monkeypatch.setattr(whisper_backend, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(whisper_backend, "_pick_backend", lambda: ("mlx", "medium"))
    monkeypatch.setattr(
        whisper_backend,
        "_download_model",
        lambda backend, model: downloaded,
    )

    captured = {}

    class FakeMlxWhisper:
        @staticmethod
        def transcribe(audio, path_or_hf_repo, word_timestamps, verbose):
            captured["audio"] = audio
            captured["path_or_hf_repo"] = path_or_hf_repo
            return {
                "language": "en",
                "segments": [{
                    "text": "hello",
                    "start": 0.0,
                    "end": 1.0,
                    "no_speech_prob": 0.0,
                    "avg_logprob": -0.1,
                    "words": [],
                }],
            }

    monkeypatch.setitem(sys.modules, "mlx_whisper", FakeMlxWhisper())

    language, segments, desc = whisper_backend.transcribe(tmp_path / "song.mp3")

    assert captured["path_or_hf_repo"] == str(downloaded), "下载完必须走本地路径,不能二次联网"
    assert language == "en"
    assert segments[0].text == "hello"
    assert "mlx / medium" in desc
