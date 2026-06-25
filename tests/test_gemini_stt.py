import types

import app


class FakeModels:
    def generate_content(self, model, contents):
        assert model == "gemini-2.5-flash-lite"
        assert len(contents) == 2
        return types.SimpleNamespace(text=" What is the renewal price? ")


class FakeGeminiClient:
    models = FakeModels()


class FakeNoSpeechModels:
    def generate_content(self, model, contents):
        return types.SimpleNamespace(
            text="I'm sorry, I cannot fulfill this request. The audio provided contains no clear English speech for me to transcribe"
        )


class FakeNoSpeechGeminiClient:
    models = FakeNoSpeechModels()


def test_transcribe_audio_with_gemini_returns_clean_transcript(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_STT_MODEL", raising=False)
    monkeypatch.setattr(app, "GEMINI_STT_CLIENT", FakeGeminiClient())

    result = app.transcribe_audio_with_gemini(b"fake-wav", "audio/wav")

    assert result["transcript"] == "What is the renewal price?"
    assert result["speechDetected"] is True
    assert result["model"] == "gemini/gemini-2.5-flash-lite"


def test_transcribe_audio_with_gemini_discards_no_speech_message(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(app, "GEMINI_STT_CLIENT", FakeNoSpeechGeminiClient())

    result = app.transcribe_audio_with_gemini(b"fake-wav", "audio/wav")

    assert result["transcript"] == ""
    assert result["speechDetected"] is False
    assert result["iso639_1"] == "unknown"


def test_transcribe_audio_with_gemini_requires_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    try:
        app.transcribe_audio_with_gemini(b"fake-wav", "audio/wav")
    except RuntimeError as exc:
        assert "GEMINI_API_KEY" in str(exc)
    else:
        raise AssertionError("Expected missing API key to raise RuntimeError.")


def test_meeting_stt_provider_prefers_gemini_for_gemini_backend(monkeypatch):
    monkeypatch.delenv("ORBYNE_MEETING_STT_PROVIDER", raising=False)
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    assert app.get_meeting_stt_provider() == "gemini"


def test_meeting_stt_provider_forces_gemini_over_stale_vosk_setting(monkeypatch):
    monkeypatch.setenv("ORBYNE_MEETING_STT_PROVIDER", "vosk")
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    assert app.get_meeting_stt_provider() == "gemini"


def test_meeting_stt_provider_uses_non_vosk_explicit_override(monkeypatch):
    monkeypatch.setenv("ORBYNE_MEETING_STT_PROVIDER", "hybrid")
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    assert app.get_meeting_stt_provider() == "hybrid"


def test_meeting_stt_provider_uses_vosk_without_hosted_gemini(monkeypatch):
    monkeypatch.setenv("ORBYNE_MEETING_STT_PROVIDER", "vosk")
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    assert app.get_meeting_stt_provider() == "vosk"
