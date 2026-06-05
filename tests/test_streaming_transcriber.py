from streaming_transcriber import StreamingTranscriber


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
