from scripts.ensure_vosk_model import has_vosk_model


def test_has_vosk_model_requires_core_files(tmp_path):
    model_path = tmp_path / "vosk-model-small-en-us-0.15"

    assert has_vosk_model(model_path) is False

    for relative_file in [
        "am/final.mdl",
        "conf/model.conf",
        "graph/HCLr.fst",
        "graph/Gr.fst",
    ]:
        file_path = model_path / relative_file
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text("ok")

    assert has_vosk_model(model_path) is True
