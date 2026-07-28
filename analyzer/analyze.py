"""analyze 阶段:音频 → beats.json + lyrics.json。

librosa 提取节拍和前奏起算点;用户 LRC 优先,否则用 Whisper 识别歌词。
Whisper 低置信度时可选 demucs 人声分离重跑一次,纯音乐输出空 segments。
"""

from __future__ import annotations

import argparse
import importlib.util
import statistics
import subprocess
import sys
import tomllib
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

import term
from beat_features import BEAT_FEATURES_VERSION
from lyrics_input import LrcError, parse_lrc
from atomic_json import write_json_atomic
from task_temp import temporary_directory


def load_audio(audio_path: Path) -> tuple[np.ndarray, int]:
    """读取单声道音频;soundfile 不支持的容器先由 FFmpeg 解为临时 WAV。"""
    try:
        samples, sr = sf.read(str(audio_path), dtype="float32", always_2d=True)
    except sf.SoundFileError:
        with temporary_directory(prefix="tsuzuri-audio-") as tmp:
            decoded = tmp / "decoded.wav"
            try:
                result = subprocess.run(
                    [
                        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(audio_path), "-vn", "-ac", "1",
                        "-c:a", "pcm_f32le", str(decoded),
                    ],
                    capture_output=True,
                    text=True,
                )
            except FileNotFoundError as exc:
                raise RuntimeError("找不到 FFmpeg,无法解码此音频格式") from exc
            if result.returncode != 0:
                detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "未知错误"
                raise RuntimeError(f"FFmpeg 音频解码失败:{detail}")
            samples, sr = sf.read(str(decoded), dtype="float32", always_2d=True)
    return np.mean(samples, axis=1, dtype=np.float32), int(sr)


def beat_energy(y: np.ndarray, sr: int, beat_times: np.ndarray, duration: float) -> list[float]:
    """Per-beat RMS energy, robustly normalized within one song."""
    frame_length = max(16, min(2048, round(sr * 0.05)))
    hop_length = max(1, frame_length // 2)
    frame_rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length, center=False)[0]
    frame_times = librosa.frames_to_time(np.arange(len(frame_rms)), sr=sr, hop_length=hop_length)
    values = []
    bounds = [*map(float, beat_times), duration]
    for start, end in zip(bounds, bounds[1:]):
        selected = frame_rms[(frame_times >= start) & (frame_times < end)]
        values.append(float(np.mean(selected)) if len(selected) else 0.0)
    if not values:
        return []
    db = 20 * np.log10(np.asarray(values, dtype=np.float64) + 1e-10)
    low, high = np.percentile(db, [10, 90])
    if not np.isfinite(low) or not np.isfinite(high) or high - low < 1e-6:
        return [0.5] * len(values)
    return [round(float(v), 6) for v in np.clip((db - low) / (high - low), 0, 1)]


def analyze_beats(audio_path: Path) -> dict:
    y, sr = load_audio(audio_path)
    duration = float(librosa.get_duration(y=y, sr=sr))

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    bpm = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)

    # downbeat 启发式(madmom 升级前的 MVP):按 4 拍一小节,
    # 取节拍点 onset 强度按相位求和最大的相位作为重拍相位
    if len(beat_frames) >= 4:
        idx = np.minimum(beat_frames, len(onset_env) - 1)
        strengths = onset_env[idx]
        phase = int(np.argmax([strengths[p::4].sum() for p in range(4)]))
        downbeat_times = beat_times[phase::4]
    else:
        downbeat_times = beat_times

    # 首个强 onset:避开前奏静音/弱起,首个切换点从这里起算
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="frames")
    first_strong_onset = 0.0
    if len(onset_frames) > 0:
        onset_times = librosa.frames_to_time(onset_frames, sr=sr)
        strengths = onset_env[np.minimum(onset_frames, len(onset_env) - 1)]
        threshold = float(np.mean(onset_env) + np.std(onset_env))
        strong = onset_times[strengths >= threshold]
        first_strong_onset = float(strong[0]) if len(strong) > 0 else float(onset_times[0])

    return {
        "version": 1,
        "audio": audio_path.name,
        "duration": round(duration, 3),
        "bpm": round(bpm, 2),
        "beats": [round(float(t), 3) for t in beat_times],
        "energy": beat_energy(y, sr, beat_times, duration),
        "downbeats": [round(float(t), 3) for t in downbeat_times],
        "first_strong_onset": round(first_strong_onset, 3),
    }


LOW_CONFIDENCE = 0.5  # 整体置信度低于此值触发 demucs 重跑
KNOWN_LANGS = {"ja", "zh", "en"}


def _demucs_enabled(audio_path: Path) -> bool:
    candidates = [audio_path.parent / "tsuzuri.toml"]
    if audio_path.parent.name == "audio":
        candidates.append(audio_path.parent.parent / "tsuzuri.toml")
    for toml_path in candidates:
        if toml_path.is_file():
            with toml_path.open("rb") as f:
                return bool(tomllib.load(f).get("demucs", True))
    return True


def _try_demucs(audio_path: Path, workdir: Path) -> Path | None:
    """人声分离,返回 vocals.wav 路径;demucs 未安装或失败返回 None。

    设备:demucs 自动 CUDA-else-CPU(MPS 算子不全,不折腾)。每首歌至多一次。
    """
    if importlib.util.find_spec("demucs") is None:
        term.warn("demucs 未安装,跳过人声分离(可 uv sync --extra separation 启用)")
        return None
    term.start("识别置信度低,启用 demucs 人声分离重跑")
    r = subprocess.run(
        [sys.executable, "-m", "demucs.separate", "--two-stems", "vocals",
         "-n", "htdemucs", "-o", str(workdir), str(audio_path)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        term.warn(f"demucs 失败,沿用原始识别结果: {r.stderr.strip()[-200:]}")
        return None
    vocals = workdir / "htdemucs" / audio_path.stem / "vocals.wav"
    if vocals.is_file():
        term.success("demucs 人声分离完成")
        return vocals
    term.warn("demucs 未生成 vocals.wav,沿用原始识别结果")
    return None


def analyze_lyrics(audio_path: Path) -> dict:
    from whisper_backend import transcribe

    language, segments, backend = transcribe(audio_path)

    avg_conf = statistics.fmean(s.confidence for s in segments) if segments else 0.0
    if (not segments or avg_conf < LOW_CONFIDENCE) and _demucs_enabled(audio_path):
        with temporary_directory(prefix="tsuzuri-demucs-") as tmp:
            vocals = _try_demucs(audio_path, tmp)
            if vocals is not None:
                language2, segments2, backend2 = transcribe(vocals)
                avg2 = statistics.fmean(s.confidence for s in segments2) if segments2 else 0.0
                if avg2 > avg_conf:
                    language, segments, backend = language2, segments2, f"{backend2} + demucs"
                    avg_conf = avg2

    lang = language if language in KNOWN_LANGS else "mixed"
    if not segments:
        term.warn("未识别到人声,按纯音乐处理并跳过字幕轨")
    return {
        "version": 1,
        "audio": audio_path.name,
        "language": language,
        "backend": backend,
        "segments": [
            {
                "text": s.text,
                "lang": lang,
                "start": round(s.start, 3),
                "end": round(s.end, 3),
                "confidence": s.confidence,
            }
            for s in segments
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="tsuzuri analyze: audio -> output/metadata/*.json")
    parser.add_argument("audio", type=Path, help="音频文件路径")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="beats.json 输出路径(默认项目 output/metadata/beats.json)",
    )
    parser.add_argument(
        "--lyrics-output",
        type=Path,
        default=None,
        help="lyrics.json 输出路径(默认 folder/output/metadata/lyrics.json)",
    )
    parser.add_argument("--lyrics-file", type=Path, default=None, help="用户提供的单行时间轴 LRC 歌词")
    parser.add_argument("--no-lyrics", action="store_true", help="跳过歌词识别(调试用)")
    parser.add_argument(
        "--lyrics-only",
        action="store_true",
        help="只识别歌词,跳过节拍分析(不写 beats.json,调试/预览用)",
    )
    args = parser.parse_args(argv)

    if args.no_lyrics and args.lyrics_file:
        parser.error("--no-lyrics 与 --lyrics-file 不能同时使用")
    if args.lyrics_only and args.no_lyrics:
        parser.error("--lyrics-only 与 --no-lyrics 不能同时使用")

    if not args.audio.is_file():
        term.error(f"找不到音频文件: {args.audio}")
        return 1

    if args.lyrics_only:
        samples, sr = load_audio(args.audio)
        duration = float(librosa.get_duration(y=samples, sr=sr))
        project_root = args.audio.parent.parent if args.audio.parent.name == "audio" else args.audio.parent
        lyrics_out = args.lyrics_output or project_root / "output" / "metadata" / "lyrics.json"
    else:
        result = analyze_beats(args.audio)
        duration = float(result["duration"])
        audio_project_root = args.audio.parent.parent if args.audio.parent.name == "audio" else args.audio.parent
        out = args.output or audio_project_root / "output" / "metadata" / "beats.json"
        project_root = out.parent.parent.parent if out.parent.name == "metadata" and out.parent.parent.name == "output" else out.parent.parent
        try:
            result["audio"] = args.audio.resolve().relative_to(project_root.resolve()).as_posix()
        except ValueError:
            result["audio"] = args.audio.name
        write_json_atomic(out, result)
        term.detail(
            f"beats: bpm={result['bpm']} beats={len(result['beats'])} "
            f"downbeats={len(result['downbeats'])} first_onset={result['first_strong_onset']}s"
        )
        lyrics_out = args.lyrics_output or out.parent / "lyrics.json"

    if not args.no_lyrics:
        if args.lyrics_file:
            if not args.lyrics_file.is_file():
                term.error(f"找不到 LRC 歌词: {args.lyrics_file}")
                return 1
            try:
                lyrics = parse_lrc(
                    args.lyrics_file,
                    audio_name=args.audio.name,
                    duration=duration,
                )
            except LrcError as exc:
                term.error(str(exc))
                return 1
            term.info(f"使用用户歌词: {args.lyrics_file.name}")
        else:
            lyrics = analyze_lyrics(args.audio)
        write_json_atomic(lyrics_out, lyrics)
        term.detail(f"lyrics: {len(lyrics['segments'])} 行({lyrics['backend']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
