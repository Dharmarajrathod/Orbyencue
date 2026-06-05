from datetime import datetime, timedelta, timezone

import config
import license as license_store


def test_license_path_uses_xdg_config_home(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))

    assert config.license_file_path() == tmp_path / "OrbyneAI" / "license.json"


def test_save_load_and_validate_license(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    expires_on = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    license_store.save_license("test-key", expires_on)
    cached = license_store.load_license()

    assert cached == {"license_key": "test-key", "expires_on": expires_on}
    assert license_store.is_license_valid(cached) is True


def test_expired_license_is_invalid():
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    assert license_store.is_license_valid({"license_key": "old", "expires_on": expired}) is False


def test_backend_verification_failure_returns_invalid(monkeypatch):
    def fail_post(*args, **kwargs):
        raise license_store.requests.RequestException("network unavailable")

    monkeypatch.setattr(license_store.requests, "post", fail_post)

    assert license_store.verify_with_backend("key") == {"valid": False}
