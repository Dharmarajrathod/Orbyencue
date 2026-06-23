import os
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


APP_NAME = "OrbyneAI"
LICENSE_BACKEND_URL = os.getenv(
    "ORBYNE_LICENSE_BACKEND_URL",
    "https://cvolvepro.com/orbyneai/api/verify-license",
)


def resource_path(relative_path: str) -> Path:
    """Return a path that works both from source and from a PyInstaller bundle."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / relative_path
    return Path(__file__).parent / relative_path


def load_environment() -> None:
    """Load local environment settings without requiring secrets at import time."""
    candidate_paths = [
        Path.cwd() / ".env",
        resource_path(".env"),
    ]
    if getattr(sys, "frozen", False):
        candidate_paths.append(Path(sys.executable).parent / ".env")

    for env_path in candidate_paths:
        if env_path.exists():
            load_dotenv(env_path)


def app_config_dir() -> Path:
    if sys.platform == "win32":
        root = os.getenv("APPDATA")
        if root:
            return Path(root) / APP_NAME

    xdg_config_home = os.getenv("XDG_CONFIG_HOME")
    if xdg_config_home:
        return Path(xdg_config_home) / APP_NAME

    return Path.home() / ".config" / APP_NAME


def license_file_path() -> Path:
    return app_config_dir() / "license.json"


def google_credentials_path() -> Optional[Path]:
    explicit_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if explicit_path:
        return Path(explicit_path)

    bundled_path = resource_path("google-credentials.json")
    if bundled_path.exists():
        return bundled_path

    return None


def vosk_model_path() -> Path:
    explicit_path = os.getenv("ORBYNE_VOSK_MODEL_PATH")
    if explicit_path:
        return Path(explicit_path)

    default_path = resource_path("models/vosk-model-small-en-us-0.15")
    if default_path.exists():
        return default_path

    bundled_repo_path = resource_path("New_Rep_ITool/models/vosk-model-small-en-us-0.15")
    if bundled_repo_path.exists():
        return bundled_repo_path

    return default_path


def ensure_vosk_model_path() -> Path:
    model_path = vosk_model_path()
    if model_path.exists():
        return model_path

    try:
        from scripts.ensure_vosk_model import has_vosk_model
        from scripts.ensure_vosk_model import main as ensure_vosk_model
    except ImportError as exc:
        raise RuntimeError(
            "Vosk model not found and the automatic downloader is unavailable. "
            f"Download it to {model_path} or set ORBYNE_VOSK_MODEL_PATH."
        ) from exc

    ensure_vosk_model()
    model_path = vosk_model_path()
    if has_vosk_model(model_path):
        return model_path

    raise RuntimeError(
        "Vosk model not found after automatic download. "
        f"Expected it at {model_path} or set ORBYNE_VOSK_MODEL_PATH."
    )
