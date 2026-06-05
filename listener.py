import os
import sys
import threading
import time

CHUNK = 512
RATE = 16000
CHANNELS = 1
FORMAT = None


class SystemAudioListener:
    def __init__(self):
        self.mode = "windows"
        self.p = None
        self.device_index = None

        if sys.platform == "win32":
            self._init_windows_loopback()
        else:
            self._init_default_input()

    def _init_windows_loopback(self):
        try:
            import pyaudiowpatch as pyaudio
        except ImportError as exc:
            raise RuntimeError("PyAudioWPatch is required for Windows system audio capture.") from exc

        global FORMAT
        FORMAT = pyaudio.paInt16
        self.p = pyaudio.PyAudio()

        for i in range(self.p.get_device_count()):
            dev = self.p.get_device_info_by_index(i)
            if "cable output" in dev["name"].lower() and dev["maxInputChannels"] > 0:
                self.device_index = i
                print("Using device:", dev["name"])
                break

        if self.device_index is None:
            raise RuntimeError("VB-Audio Virtual Cable not found.")

    def _init_default_input(self):
        try:
            import sounddevice as sd
        except ImportError as exc:
            raise RuntimeError("sounddevice is required for microphone capture on macOS/Linux.") from exc

        self.mode = "sounddevice"
        self.sd = sd
        configured_device = os.getenv("ORBYNE_AUDIO_DEVICE")
        if configured_device:
            self.device_index = int(configured_device) if configured_device.isdigit() else configured_device

    def stream(self, callback, stop_event: threading.Event):
        if self.mode == "sounddevice":
            self._stream_default_input(callback, stop_event)
            return

        stream = self.p.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            input_device_index=self.device_index,
            frames_per_buffer=CHUNK,
        )

        try:
            while not stop_event.is_set():
                data = stream.read(CHUNK, exception_on_overflow=False)
                callback(data)
                time.sleep(0.01)
        finally:
            stream.stop_stream()
            stream.close()

    def _stream_default_input(self, callback, stop_event: threading.Event):
        def on_audio(indata, frames, time_info, status):
            if status:
                print("Audio input warning:", status)
            callback(indata.tobytes())

        try:
            with self.sd.InputStream(
                samplerate=RATE,
                blocksize=CHUNK,
                channels=CHANNELS,
                dtype="int16",
                device=self.device_index,
                callback=on_audio,
            ):
                while not stop_event.is_set():
                    time.sleep(0.05)
        except Exception as exc:
            raise RuntimeError(f"Unable to open microphone input: {exc}") from exc

    def close(self):
        if self.p:
            self.p.terminate()
