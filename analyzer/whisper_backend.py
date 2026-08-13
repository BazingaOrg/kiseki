"""Whisper 后端探测与统一接口。

优先级:mlx(arm64 Mac 且可导入)→ faster-whisper CUDA float16 → faster-whisper CPU int8。
三后端收敛到 transcribe(audio) -> (language, [Segment]);探测结果打印一行日志。
模型默认 mlx/CUDA=medium、CPU=small,可用环境变量 KISEKI_WHISPER_MODEL 覆盖(调试用)。
国内网络:HF 直连超时自动切 hf-mirror.com,再失败才提示配代理。
"""

from __future__ import annotations

import importlib.util
import math
import os
import platform
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import term


REPO_ROOT = Path(__file__).resolve().parent.parent


def _model_root() -> Path:
    configured = os.environ.get("KISEKI_MODEL_ROOT")
    return Path(configured).expanduser() if configured else REPO_ROOT / "models"

# 首次下载的体积预期(HF 仓库近似值),下载前提示用,不必精确
_DOWNLOAD_SIZE_HINTS = {
    "tiny": "75 MB",
    "base": "145 MB",
    "small": "500 MB",
    "medium": "1.5 GB",
    "large-v3": "3 GB",
}

# 约定目录完整性必需文件:mlx 权重 + 配置;faster-whisper 是 CTranslate2 目录.
# 缺这些说明目录是半成品(下载中断残留),不能冒充可用模型.
_REQUIRED_MODEL_FILES = {
    "mlx": {"weights.npz", "config.json"},
    "faster": {"model.bin", "config.json"},
}


def _valid_model_dir(backend: str, directory: Path) -> bool:
    required = _REQUIRED_MODEL_FILES["mlx" if backend == "mlx" else "faster"]
    return all((directory / name).is_file() for name in required)


def _local_model_dir(backend: str, model: str) -> Path | None:
    """本地模型目录查找:env 指定的路径 > 配置的 models 约定目录 > 无(走 HF 下载)。

    约定目录名与 HF 仓库同名:models/whisper-<size>-mlx(mlx)、
    models/faster-whisper-<size>(CTranslate2 格式)。约定目录必须内容完整,
    半成品(下载中断残留)不算数;env 指定的路径由用户负责,信任原样。
    """
    p = Path(model).expanduser()
    if p.is_dir():
        return p
    name = f"whisper-{model}-mlx" if backend == "mlx" else f"faster-whisper-{model}"
    cand = _model_root() / name
    if not cand.is_dir():
        return None
    return cand if _valid_model_dir(backend, cand) else None


def _model_repo_id(backend: str, model: str) -> str:
    return f"mlx-community/whisper-{model}-mlx" if backend == "mlx" else f"Systran/faster-whisper-{model}"


def _model_convention_dir(backend: str, model: str) -> Path:
    name = f"whisper-{model}-mlx" if backend == "mlx" else f"faster-whisper-{model}"
    return _model_root() / name


_download_progress_tqdm = None


def _make_download_progress():
    """延迟构造真 tqdm 子类:只有真的开始下载才 import tqdm(分析指纹等路径不该背这个开销)."""
    global _download_progress_tqdm
    if _download_progress_tqdm is None:
        from tqdm import tqdm

        class DownloadProgressTqdm(tqdm):
            """把 hf 的字节进度条翻译成结构化进度事件(节流到整百分比).

            hf 的 snapshot_download 会用同一个 tqdm_class 建"按文件数"的
            thread_map 条(unit='it')和"按字节"的传输/重建条(unit='B'),
            只认字节条;总字节数随文件发现增长,百分比可能回跳,钳制为单调.
            """

            def __init__(self, *args: Any, **kwargs: Any) -> None:
                super().__init__(*args, **kwargs)
                self._last_percent = 0

            def update(self, n: float = 1) -> bool:
                result = super().update(n)
                total = self.total or 0
                if total <= 0 or self.unit != "B":
                    return result
                percent = min(self.n / total * 100, 100.0)
                if percent - self._last_percent >= 1 or percent >= 100:
                    self._last_percent = int(percent)
                    term.progress("下载模型", percent / 100)
                return result

        _download_progress_tqdm = DownloadProgressTqdm
    return _download_progress_tqdm


def _download_model(backend: str, model: str) -> Path:
    """把模型下到配置的 models 约定目录,之后可完全离线.

    用 snapshot_download 的 local_dir + 自定义 tqdm:失败残留 .incomplete 文件,
    下次自动续传;_local_model_dir 的完整性校验保证半成品不会冒充可用模型.
    """
    from huggingface_hub import snapshot_download

    target = _model_convention_dir(backend, model)
    snapshot_download(
        _model_repo_id(backend, model),
        local_dir=str(target),
        tqdm_class=_make_download_progress(),
    )
    return target


@dataclass
class Segment:
    text: str
    start: float
    end: float
    confidence: float  # exp(avg_logprob),约 0–1


# 单行长度上限(全角等效;超过则按词级时间戳拆行,防止渲染超出画布)
MAX_LINE_UNITS = 30.0
# 词间静默超过此秒数视为乐句边界,直接断行
GAP_SPLIT_SECONDS = 1.0
# 超长回溯断行时,认定为乐句停顿的最小词间隙
PHRASE_GAP_SECONDS = 0.3
# 乐句起点特征:大写开头的词(Whisper 按句首大写;[A-Z][a-z] 排除恒大写的 "I")
_PHRASE_START_RE = re.compile(r"^[A-Z][a-z]")
# 乐句终点特征:标点收尾
_PHRASE_END_RE = re.compile(r"[.!?,;、。!?,]$")

_CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿]")


def _units(text: str) -> float:
    return sum(1.0 if _CJK_RE.search(ch) else 0.5 for ch in text)


def _split_segment(
    text: str, start: float, end: float, confidence: float,
    words: list[tuple[str, float, float]],
) -> list[Segment]:
    """歌词段按词级时间戳拆成不超过 MAX_LINE_UNITS 的行。

    Whisper 在歌曲上常把多句词并成一段(段可长达十几秒/近百字符),
    整段渲染既不像图注也会超宽;无词级信息时原样返回。
    """
    if _units(text) <= MAX_LINE_UNITS or not words:
        return [Segment(text, start, end, confidence)]

    lines: list[Segment] = []
    cur: list[tuple[str, float, float]] = []

    def emit(ws: list[tuple[str, float, float]]) -> None:
        t = "".join(w[0] for w in ws).strip()
        if t:
            lines.append(Segment(t, ws[0][1], ws[-1][2], confidence))

    for w in words:
        if cur and w[1] - cur[-1][2] > GAP_SPLIT_SECONDS:
            emit(cur)
            cur = []
        elif cur and _units("".join(x[0] for x in cur) + w[0]) > MAX_LINE_UNITS:
            # 优先回溯到最近的乐句边界断行(断点不能太靠前),找不到才按长度硬切。
            # 边界特征:词间停顿 / 下一词大写开头 / 当前词标点收尾
            best = None
            for i in range(len(cur) - 1):
                is_boundary = (
                    cur[i + 1][1] - cur[i][2] >= PHRASE_GAP_SECONDS
                    or _PHRASE_START_RE.match(cur[i + 1][0].strip())
                    or _PHRASE_END_RE.search(cur[i][0].strip())
                )
                if is_boundary and _units("".join(x[0] for x in cur[: i + 1])) >= MAX_LINE_UNITS * 0.35:
                    best = i + 1
            if best is not None:
                emit(cur[:best])
                cur = cur[best:]
            else:
                emit(cur)
                cur = []
        cur.append(w)
    emit(cur)
    return lines or [Segment(text, start, end, confidence)]


def ensure_hf_reachable(timeout: float = 3.0) -> None:
    """HuggingFace 连通性检测:不可达则自动设 HF_ENDPOINT 指向国内镜像。"""
    if os.environ.get("HF_ENDPOINT"):
        return
    try:
        req = urllib.request.Request("https://huggingface.co", method="HEAD")
        urllib.request.urlopen(req, timeout=timeout)
    except Exception:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        term.warn("hf: 直连超时,已切换镜像 hf-mirror.com(仍失败请配置代理)")


def _pick_backend() -> tuple[str, str]:
    """返回 (backend, model)。backend: mlx | cuda | cpu"""
    override = os.environ.get("KISEKI_WHISPER_MODEL")
    if (
        sys.platform == "darwin"
        and platform.machine() == "arm64"
        and importlib.util.find_spec("mlx_whisper") is not None
    ):
        return "mlx", override or "medium"
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", override or "medium"
    except Exception:
        pass
    return "cpu", override or "small"  # 精度换速度


def _confidence(avg_logprob: float) -> float:
    return round(min(1.0, max(0.0, math.exp(avg_logprob))), 3)


def transcribe(audio: Path) -> tuple[str, list[Segment], str]:
    """统一转写接口。返回 (language, segments, backend_desc)。

    word-level timestamps 用于控制歌词行长和断句。
    no_speech_prob > 0.6 的段直接丢弃(Whisper 在音乐场景会幻觉编词,宁可漏不可错)。
    """
    backend, model = _pick_backend()
    desc = f"{backend} / {model}"
    term.detail(f"whisper backend: {desc}")

    # 本地模型:KISEKI_WHISPER_MODEL 指向目录,或放在配置的 models/ 约定目录,
    # 均跳过联网;否则从 HF 下载(mlx:weights.npz + config.json;
    # faster-whisper:CTranslate2 格式目录)
    local_dir = _local_model_dir(backend, model)
    if local_dir is None:
        ensure_hf_reachable()
        approx = _DOWNLOAD_SIZE_HINTS.get(model, "数百 MB")
        term.info(
            f"模型 {model} 本机未缓存,首次识别将自动下载(约 {approx});"
            "提前放入 models/ 目录可完全离线"
        )
        term.start("下载模型")
        try:
            local_dir = _download_model(backend, model)
        except Exception:
            term.error(
                "模型下载失败:网络需要代理、磁盘空间不足或镜像不可用;"
                "重试会从断点继续,也可把模型手动放入 models/ 目录"
            )
            raise
        term.success(f"模型 {model} 已就绪: {local_dir}")
    else:
        term.detail(f"whisper model: 本地 {local_dir}")

    if backend == "mlx":
        import mlx_whisper

        result = mlx_whisper.transcribe(
            str(audio),
            path_or_hf_repo=str(local_dir) if local_dir else f"mlx-community/whisper-{model}-mlx",
            word_timestamps=True,
            verbose=None,
        )
        language = result.get("language", "unknown")
        segments = [
            line
            for s in result["segments"]
            if s["text"].strip() and float(s.get("no_speech_prob", 0.0)) <= 0.6
            for line in _split_segment(
                s["text"].strip(),
                float(s["start"]),
                float(s["end"]),
                _confidence(float(s.get("avg_logprob", -10.0))),
                [(w["word"], float(w["start"]), float(w["end"])) for w in s.get("words", [])],
            )
        ]
        return language, segments, desc

    from faster_whisper import WhisperModel

    wm = WhisperModel(
        str(local_dir) if local_dir else model,
        device="cuda" if backend == "cuda" else "cpu",
        compute_type="float16" if backend == "cuda" else "int8",
    )
    raw_segments, info = wm.transcribe(str(audio), word_timestamps=True)
    segments = [
        line
        for s in raw_segments
        if s.text.strip() and float(s.no_speech_prob) <= 0.6
        for line in _split_segment(
            s.text.strip(),
            float(s.start),
            float(s.end),
            _confidence(float(s.avg_logprob)),
            [(w.word, float(w.start), float(w.end)) for w in (s.words or [])],
        )
    ]
    return info.language, segments, desc
