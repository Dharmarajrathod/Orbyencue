from __future__ import annotations

import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


DEFAULT_MODEL_NAME = "vosk-model-en-us-0.22-lgraph"


def model_path() -> Path:
    model_name = os.getenv("ORBYNE_VOSK_MODEL_NAME", DEFAULT_MODEL_NAME)
    explicit_path = os.getenv("ORBYNE_VOSK_MODEL_PATH")
    if explicit_path:
        return Path(explicit_path)
    return Path(__file__).resolve().parents[1] / "models" / model_name


def has_vosk_model(path: Path) -> bool:
    required_files = [
        path / "am" / "final.mdl",
        path / "conf" / "model.conf",
        path / "graph" / "HCLr.fst",
        path / "graph" / "Gr.fst",
    ]
    return all(required_file.exists() for required_file in required_files)


def main() -> None:
    destination = model_path()
    if has_vosk_model(destination):
        print(f"Vosk model already available at {destination}")
        return

    model_name = destination.name
    model_url = os.getenv("ORBYNE_VOSK_MODEL_URL", f"https://alphacephei.com/vosk/models/{model_name}.zip")
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        zip_path = tmp_path / f"{model_name}.zip"
        extract_path = tmp_path / "extract"

        print(f"Downloading Vosk model from {model_url}")
        urllib.request.urlretrieve(model_url, zip_path)

        print(f"Extracting Vosk model to {destination}")
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extract_path)

        extracted_model = extract_path / model_name
        if not has_vosk_model(extracted_model):
            raise RuntimeError(f"Downloaded archive did not contain a valid {model_name} model.")

        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(extracted_model), str(destination))

    print(f"Vosk model ready at {destination}")


if __name__ == "__main__":
    main()
