import io
import wave

from fastapi.testclient import TestClient

import app


def wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes((100).to_bytes(2, "little", signed=True) * 1600)
    return buffer.getvalue()


def test_transcribe_endpoint_skips_transient_stt_errors(monkeypatch):
    def fail_transcription(*args, **kwargs):
        raise RuntimeError("upstream unavailable")

    monkeypatch.setenv("ORBYNE_MEETING_STT_PROVIDER", "vosk")
    monkeypatch.setattr(app, "transcribe_streaming_audio", fail_transcription)

    client = TestClient(app.app)
    response = client.post(
        "/transcribe-audio",
        files={"file": ("chunk.wav", wav_bytes(), "audio/wav")},
        data={
            "language": "auto",
            "session_id": "meeting-1",
            "chunk_number": "1",
            "duration": "0.1",
            "sample_rate": "16000",
            "audio_energy": "0.01",
            "voice_activity": "true",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["discarded"] is True
    assert payload["reason"] == "stt_unavailable"


def test_transcribe_endpoint_returns_partial_streaming_text(monkeypatch):
    def partial_transcription(*args, **kwargs):
        return {
            "speechDetected": True,
            "language": "english",
            "iso639_1": "en",
            "languageConfidence": 0.7,
            "transcript": "what is",
            "transcriptionConfidence": 0.65,
            "meaningful": False,
            "model": "vosk/streaming-partial",
            "isFinal": False,
        }

    monkeypatch.setenv("ORBYNE_MEETING_STT_PROVIDER", "vosk")
    monkeypatch.setattr(app, "transcribe_streaming_audio", partial_transcription)

    client = TestClient(app.app)
    response = client.post(
        "/transcribe-audio",
        files={"file": ("chunk.wav", wav_bytes(), "audio/wav")},
        data={
            "language": "auto",
            "session_id": "meeting-1",
            "chunk_number": "1",
            "duration": "0.1",
            "sample_rate": "16000",
            "audio_energy": "0.01",
            "voice_activity": "true",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["transcript"] == "what is"
    assert payload["isFinal"] is False
    assert payload["discarded"] is False
