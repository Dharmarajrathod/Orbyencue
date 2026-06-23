import types

import app


class FakeModels:
    def generate_content(self, model, contents):
        assert model == "gemini-2.5-flash-lite"
        assert len(contents) == 2
        return types.SimpleNamespace(text=" What is the renewal price? ")


class FakeGeminiClient:
    models = FakeModels()


def test_transcribe_audio_with_gemini_returns_clean_transcript(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_STT_MODEL", raising=False)
    monkeypatch.setattr(app, "GEMINI_STT_CLIENT", FakeGeminiClient())

    result = app.transcribe_audio_with_gemini(b"fake-wav", "audio/wav")

    assert result["transcript"] == "What is the renewal price?"
    assert result["speechDetected"] is True
    assert result["model"] == "gemini/gemini-2.5-flash-lite"


def test_transcribe_audio_with_gemini_requires_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    try:
        app.transcribe_audio_with_gemini(b"fake-wav", "audio/wav")
    except RuntimeError as exc:
        assert "GEMINI_API_KEY" in str(exc)
    else:
        raise AssertionError("Expected missing API key to raise RuntimeError.")
