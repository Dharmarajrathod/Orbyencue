import json
import os
import queue
import threading
import time

from config import ensure_vosk_model_path, google_credentials_path


class StreamingTranscriber:
    def __init__(self, on_final_text, on_interim_text=None, on_error=None, language_code="en-US"):
        self.audio_queue = queue.Queue()
        self.client = None
        self.on_final_text = on_final_text
        self.on_interim_text = on_interim_text
        self.on_error = on_error
        self.last_interim = ""
        self.language_code = language_code
        self.provider = os.getenv("ORBYNE_STT_PROVIDER", "vosk").lower()
        self.running = False

        if self.provider == "google":
            self._init_google()
        elif self.provider == "vosk":
            self._init_vosk()
        else:
            raise RuntimeError("ORBYNE_STT_PROVIDER must be 'vosk' or 'google'.")

    def _init_google(self):
        from google.cloud import speech
        from google.oauth2 import service_account

        creds_path = google_credentials_path()
        if creds_path:
            if not creds_path.exists():
                raise RuntimeError(f"Google credentials file not found: {creds_path}")
            credentials = service_account.Credentials.from_service_account_file(creds_path)
            self.client = speech.SpeechClient(credentials=credentials)
        else:
            self.client = speech.SpeechClient()
        self.speech = speech

    def _init_vosk(self):
        try:
            from vosk import KaldiRecognizer, Model
        except ImportError as exc:
            raise RuntimeError("Vosk is required for free local speech recognition. Run: python -m pip install -r requirements.txt") from exc

        model_path = ensure_vosk_model_path()
        if not model_path.exists():
            raise RuntimeError(
                "Vosk model not found. Download it to "
                f"{model_path} or set ORBYNE_VOSK_MODEL_PATH."
            )

        self.vosk_recognizer = KaldiRecognizer(Model(str(model_path)), 16000)
        self.vosk_recognizer.SetWords(False)

    # ---------- Audio input ----------
    def push_audio(self, chunk: bytes):
        if self.running:
            self.audio_queue.put(chunk)

    def _audio_generator(self):
        if self.provider != "google":
            raise RuntimeError("Audio generator is only used by Google Speech.")

        while self.running:
            chunk = self.audio_queue.get()
            if chunk is None:
                return
            yield self.speech.StreamingRecognizeRequest(audio_content=chunk)

    # ---------- Streaming control ----------
    def start(self):
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def stop(self):
        self.running = False
        self.audio_queue.put(None)

    # ---------- Streaming loop ----------
    def _run(self):
        if self.provider == "vosk":
            self._run_vosk()
        else:
            self._run_google()

    def _run_vosk(self):
        while self.running:
            chunk = self.audio_queue.get()
            if chunk is None:
                return

            if self.vosk_recognizer.AcceptWaveform(chunk):
                text = json.loads(self.vosk_recognizer.Result()).get("text", "").strip()
                if text and not self._looks_like_music(text):
                    self.last_interim = ""
                    self.on_final_text(text)
            else:
                text = json.loads(self.vosk_recognizer.PartialResult()).get("partial", "").strip()
                if text and text != self.last_interim and not self._looks_like_music(text):
                    self.last_interim = text
                    if self.on_interim_text:
                        self.on_interim_text(text)

    def _run_google(self):
        from google.api_core import exceptions as google_exceptions

        config = self.speech.RecognitionConfig(
            encoding=self.speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=16000,
            language_code=self.language_code,
            enable_automatic_punctuation=True,
            model="latest_short",
            use_enhanced=False,
        )

        streaming_config = self.speech.StreamingRecognitionConfig(
            config=config,
            interim_results=True,
            single_utterance=False,
        )

        while self.running:
            requests = self._audio_generator()

            try:
                responses = self.client.streaming_recognize(
                    streaming_config,
                    requests
                )

                for response in responses:
                    for result in response.results:
                        if not result.alternatives:
                            continue

                        text = result.alternatives[0].transcript.strip()

                        if self._looks_like_music(text):
                            continue

                        if result.is_final:
                            confidence = getattr(result.alternatives[0], "confidence", 0.0) or 0.0
                            detected_language = getattr(result, "language_code", "") or self.language_code
                            if detected_language and not detected_language.lower().startswith("en"):
                                continue
                            if confidence < 0.7:
                                continue
                            self.last_interim = ""
                            self.on_final_text(text)
                        else:
                            if text != self.last_interim:
                                self.last_interim = text
                                if self.on_interim_text:
                                    self.on_interim_text(text)

            except google_exceptions.PermissionDenied as exc:
                self._fail(f"Google Speech permission error: {self._short_error(exc)}")
                return
            except google_exceptions.FailedPrecondition as exc:
                self._fail(f"Google Speech setup error: {self._short_error(exc)}")
                return
            except google_exceptions.GoogleAPICallError as exc:
                self._fail(f"Google Speech API error: {self._short_error(exc)}")
                return
            except Exception as e:
                print("Streaming reset:", e)
                time.sleep(0.5)

    def _fail(self, message: str):
        self.running = False
        self.audio_queue.put(None)
        if self.on_error:
            self.on_error(message)

    def _short_error(self, exc: Exception) -> str:
        text = str(exc).splitlines()[0]
        if "Enable it by visiting" in text:
            return "Cloud Speech-to-Text API is disabled for this Google project. Enable speech.googleapis.com and try again after a few minutes."
        return text

    # ---------- Filters ----------
    def _looks_like_music(self, text: str) -> bool:
        words = text.lower().split()

        if not words:
            return True

        if len(words) >= 4 and len(set(words)) <= 2:
            return True

        return False
