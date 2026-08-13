from __future__ import annotations

import json
import shutil
import subprocess
import warnings
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import analyze


def write_tone(path: Path, *, duration: float = 2.0, sr: int = 22050) -> None:
    time = np.arange(int(duration * sr), dtype=np.float32) / sr
    sf.write(str(path), 0.2 * np.sin(2 * np.pi * 440 * time), sr)


def test_load_audio_reads_wav_directly(tmp_path: Path):
    source = tmp_path / "tone.wav"
    write_tone(source)

    samples, sr = analyze.load_audio(source)

    assert sr == 22050
    assert samples.ndim == 1
    assert len(samples) == 44100


def test_load_audio_uses_configured_ffmpeg_path(monkeypatch, tmp_path: Path):
    source = tmp_path / "song.m4a"
    source.touch()
    reads = 0
    command = []

    def fake_read(_path, **_options):
        nonlocal reads
        reads += 1
        if reads == 1:
            raise sf.SoundFileError(1)
        return np.zeros((10, 1), dtype=np.float32), 22050

    def fake_run(args, **_options):
        command.extend(args)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setenv("KISEKI_FFMPEG_BIN", "/Tools With Spaces/ffmpeg")
    monkeypatch.setattr(analyze.sf, "read", fake_read)
    monkeypatch.setattr(analyze.subprocess, "run", fake_run)

    analyze.load_audio(source)

    assert command[0] == "/Tools With Spaces/ffmpeg"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg 未安装")
def test_m4a_uses_ffmpeg_without_audioread_warnings(tmp_path: Path):
    wav = tmp_path / "tone.wav"
    m4a = tmp_path / "tone.m4a"
    write_tone(wav)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), str(m4a)],
        check=True,
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        samples, sr = analyze.load_audio(m4a)

    assert sr == 22050
    assert len(samples) > 0
    assert not any("audioread" in str(item.message).lower() for item in caught)
    assert not any("pysoundfile" in str(item.message).lower() for item in caught)


def test_main_preserves_nested_audio_path_in_beats(tmp_path: Path, monkeypatch):
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir()
    source = audio_dir / "tone.wav"
    write_tone(source)
    output = tmp_path / "output" / "metadata" / "beats.json"
    monkeypatch.setattr(analyze, "analyze_lyrics", lambda _path: {
        "version": 1, "audio": "tone.wav", "language": "unknown",
        "backend": "test", "segments": [],
    })

    assert analyze.main([str(source), "-o", str(output)]) == 0

    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["audio"] == "audio/tone.wav"


def test_main_defaults_nested_audio_to_output_metadata(tmp_path: Path, monkeypatch):
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir()
    source = audio_dir / "tone.wav"
    write_tone(source)
    monkeypatch.setattr(analyze, "analyze_lyrics", lambda _path: {
        "version": 1, "audio": "tone.wav", "language": "unknown",
        "backend": "test", "segments": [],
    })

    assert analyze.main([str(source)]) == 0

    result = json.loads((tmp_path / "output" / "metadata" / "beats.json").read_text(encoding="utf-8"))
    assert result["audio"] == "audio/tone.wav"


def test_nested_audio_still_reads_project_demucs_setting(tmp_path: Path):
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir()
    source = audio_dir / "tone.wav"
    source.touch()
    (tmp_path / "kiseki.toml").write_text("demucs = false\n", encoding="utf-8")

    assert analyze._demucs_enabled(source) is False
