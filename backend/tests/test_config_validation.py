import importlib

import pytest


def _reload_config(monkeypatch, **values):
    for key in ("REPO_WEIGHT_ATS", "REPO_WEIGHT_PROJECT", "WEIGHT_ATS", "WEIGHT_PROJECT"):
        monkeypatch.delenv(key, raising=False)
    for key, value in values.items():
        monkeypatch.setenv(key, str(value))
    import app.config as config
    return importlib.reload(config)


def test_score_weights_must_sum_to_one(monkeypatch):
    with pytest.raises(RuntimeError, match="sum to 1.0"):
        _reload_config(monkeypatch, REPO_WEIGHT_ATS="0.8", REPO_WEIGHT_PROJECT="0.3")


@pytest.mark.parametrize("value", ["nan", "inf", "-0.1", "1.1", "not-a-number"])
def test_score_weights_reject_invalid_values(monkeypatch, value):
    with pytest.raises(RuntimeError, match="finite number"):
        _reload_config(monkeypatch, REPO_WEIGHT_ATS=value, REPO_WEIGHT_PROJECT="0.6")
