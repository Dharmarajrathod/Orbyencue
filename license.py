import json
from datetime import datetime

import requests

from config import LICENSE_BACKEND_URL, license_file_path


def save_license(license_key: str, expires_on: str):
    license_file = license_file_path()
    license_file.parent.mkdir(parents=True, exist_ok=True)
    with license_file.open("w", encoding="utf-8") as f:
        json.dump({
            "license_key": license_key,
            "expires_on": expires_on
        }, f)


def load_license():
    license_file = license_file_path()
    if not license_file.exists():
        return None
    with license_file.open(encoding="utf-8") as f:
        return json.load(f)


def verify_with_backend(license_key: str):
    try:
        response = requests.post(
            LICENSE_BACKEND_URL,
            json={"license_key": license_key},
            timeout=10
        )
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return {"valid": False}


def is_license_valid(data=None):
    data = data or load_license()
    if not data:
        return False

    try:
        expires = datetime.fromisoformat(
            data["expires_on"].replace("Z", "+00:00")
        )

        now = datetime.now(expires.tzinfo)
        return now < expires
    except Exception as e:
        print("License validation error:", e)
        return False
