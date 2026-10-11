import analysis_fingerprint


def test_fingerprint_tracks_effective_backend_model_and_demucs(monkeypatch):
    monkeypatch.setattr(analysis_fingerprint, "_pick_backend", lambda: ("cpu", "small"))
    monkeypatch.setattr(
        analysis_fingerprint.importlib.util,
        "find_spec",
        lambda name: object() if name == "demucs" else None,
    )

    assert analysis_fingerprint.build_fingerprint() == {
        "version": 1,
        "beat_features_version": 2,
        "backend": "cpu",
        "model": "small",
        "demucs_available": True,
    }
