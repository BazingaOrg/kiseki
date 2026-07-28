from __future__ import annotations

import io
import sys

import pytest

import plan
import term


class Stream(io.StringIO):
    def __init__(self, is_tty: bool):
        super().__init__()
        self._is_tty = is_tty

    def isatty(self) -> bool:
        return self._is_tty


def install_streams(monkeypatch: pytest.MonkeyPatch, *, stdout_tty: bool, stderr_tty: bool):
    stdout = Stream(stdout_tty)
    stderr = Stream(stderr_tty)
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(sys, "stderr", stderr)
    return stdout, stderr


def test_tty_colors_and_streams(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setenv("TERM", "xterm-256color")
    stdout, stderr = install_streams(monkeypatch, stdout_tty=True, stderr_tty=True)

    term.info("信息")
    term.start("开始")
    term.success("完成")
    term.warn("提醒")
    term.error("失败")
    term.detail("细节")

    assert stdout.getvalue() == (
        "\x1b[39m●\x1b[0m 信息\n"
        "\x1b[38;2;217;119;87m●\x1b[0m 开始\n"
        "\x1b[32m●\x1b[0m 完成\n"
        "\x1b[2m└ 细节\x1b[0m\n"
    )
    assert stderr.getvalue() == "\x1b[33m●\x1b[0m 提醒\n\x1b[31m●\x1b[0m 失败\n"


def test_color_follows_destination_stream(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setenv("TERM", "xterm")
    stdout, stderr = install_streams(monkeypatch, stdout_tty=True, stderr_tty=False)

    term.start("stdout")
    term.warn("stderr")

    assert stdout.getvalue().startswith("\x1b[")
    assert stderr.getvalue() == "● stderr\n"


@pytest.mark.parametrize(
    ("is_tty", "environment"),
    [
        (False, {}),
        (True, {"NO_COLOR": ""}),
        (True, {"TERM": "dumb"}),
    ],
    ids=["non-tty", "no-color", "term-dumb"],
)
def test_plain_output(monkeypatch: pytest.MonkeyPatch, is_tty: bool, environment: dict[str, str]):
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("TERM", raising=False)
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    stdout, stderr = install_streams(monkeypatch, stdout_tty=is_tty, stderr_tty=is_tty)

    term.start("运行")
    term.success("完成")
    term.warn("提醒")
    term.detail("明细")

    assert "\x1b[" not in stdout.getvalue() + stderr.getvalue()


def test_multiline_cjk_repeats_prefix(monkeypatch: pytest.MonkeyPatch):
    stdout, stderr = install_streams(monkeypatch, stdout_tty=False, stderr_tty=False)

    term.info("第一行\n第二行")
    term.error("错误甲\n错误乙")
    term.detail("细节一\n细节二")

    assert stdout.getvalue() == "● 第一行\n● 第二行\n└ 细节一\n└ 细节二\n"
    assert stderr.getvalue() == "● 错误甲\n● 错误乙\n"


def test_deprecated_motion_config_is_rejected(tmp_path, monkeypatch):
    (tmp_path / "tsuzuri.toml").write_text(
        'motion = "kenburns"\nkenburns_from = 1.0\nkenburns_to = 1.1\n',
        encoding="utf-8",
    )
    stdout, stderr = install_streams(monkeypatch, stdout_tty=False, stderr_tty=False)

    with pytest.raises(SystemExit):
        plan.load_config(tmp_path)
    assert stdout.getvalue() == ""
    assert "motion" in stderr.getvalue()
    assert "已弃用且不再生效" in stderr.getvalue()


def test_new_timeline_always_uses_static_motion(monkeypatch, tmp_path):
    photos = [tmp_path / "one.jpg", tmp_path / "two.jpg"]
    monkeypatch.setattr(plan, "ordered_photos", lambda _folder: photos)
    beats = {
        "audio": "song.mp3",
        "duration": 5.0,
        "bpm": 120,
        "beats": [0.5, 1.0, 1.5, 2.0],
        "downbeats": [2.0, 4.0],
    }

    timeline = plan.build_timeline(tmp_path, beats, [], dict(plan.DEFAULTS), None)

    assert timeline["meta"]["version"] == 1
    assert all(
        photo["motion"] == {"type": "none", "from": 1.0, "to": 1.0}
        for photo in timeline["photos"]
    )
    assert timeline["photos"][1]["transition"] == {"type": "album", "duration": 0.4}
