from streaming_transcriber import StreamingTranscriber


def test_vosk_model_path_falls_back_to_checked_in_model(monkeypatch, tmp_path):
    import config

    monkeypatch.delenv("ORBYNE_VOSK_MODEL_PATH", raising=False)
    monkeypatch.setattr(config, "resource_path", lambda relative_path: tmp_path / relative_path)
    fallback_model = tmp_path / "New_Rep_ITool/models/vosk-model-small-en-us-0.15"
    fallback_model.mkdir(parents=True)

    assert config.vosk_model_path() == fallback_model


def test_streaming_stt_requires_sessioned_wav_chunks():
    from app import should_use_streaming_stt

    assert should_use_streaming_stt("auto", "audio/wav", "meeting-1") is True
    assert should_use_streaming_stt("en", "audio/wav", "meeting-1") is True
    assert should_use_streaming_stt("auto", "audio/webm", "meeting-1") is False
    assert should_use_streaming_stt("auto", "audio/wav", "") is False
    assert should_use_streaming_stt("es", "audio/wav", "meeting-1") is False


def test_decode_wav_pcm16_returns_raw_pcm_and_rate():
    import io
    import wave

    from app import decode_wav_pcm16

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes((100).to_bytes(2, "little", signed=True))

    pcm, sample_rate = decode_wav_pcm16(buffer.getvalue())

    assert sample_rate == 16000
    assert pcm == (100).to_bytes(2, "little", signed=True)


def test_music_filter_allows_short_questions_without_repeated_words():
    transcriber = object.__new__(StreamingTranscriber)

    assert transcriber._looks_like_music("what is python") is False
    assert transcriber._looks_like_music("") is True


def test_music_filter_still_blocks_repetitive_long_audio():
    transcriber = object.__new__(StreamingTranscriber)

    assert transcriber._looks_like_music("music music music music") is True


def test_short_error_explains_disabled_speech_api():
    transcriber = object.__new__(StreamingTranscriber)
    exc = Exception("403 Cloud Speech-to-Text API has not been used. Enable it by visiting https://example.com")

    message = transcriber._short_error(exc)

    assert "speech.googleapis.com" in message
