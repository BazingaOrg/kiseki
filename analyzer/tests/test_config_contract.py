"""跨 Node/Python 的 kiseki.toml 标量配置 fixture。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import plan


FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "examples" / "config-cases.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_config_cases_match_node_contract(tmp_path: Path, case: dict, capsys: pytest.CaptureFixture[str]):
    (tmp_path / "kiseki.toml").write_text(case["toml"], encoding="utf-8")
    for file in case.get("files", []):
        (tmp_path / file["name"]).write_text(file["content"], encoding="utf-8")

    if case["expect"] == "error":
        with pytest.raises(SystemExit):
            plan.load_config(tmp_path)
        if case["name"] in {"single-quoted-string-rejected", "numeric-underscore-rejected"}:
            output = capsys.readouterr().err
            assert case["key"] in output
            assert f"第 {case['line']} 行" in output
        return

    config = plan.load_config(tmp_path)
    assert {key: config[key] for key in FIXTURE["defaults"]} == case["config"]


def test_missing_file_returns_shared_defaults(tmp_path: Path):
    config = plan.load_config(tmp_path)
    assert {key: config[key] for key in FIXTURE["defaults"]} == FIXTURE["defaults"]
