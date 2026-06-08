import tkinter as tk
from threading import Thread
from tkinter import filedialog, simpledialog, messagebox
import threading
import time
import sys
import os
from pathlib import Path
from PIL import Image, ImageTk
import re

from license import is_license_valid, load_license, save_license, verify_with_backend
from rag_engine import answer_from_document, answer_from_gemini
from listener import SystemAudioListener
from file_processor import process_file
from streaming_transcriber import StreamingTranscriber


# ======================================================
# PyInstaller-safe resource loader
# ======================================================
def resource_path(relative_path):
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / relative_path
    return Path(__file__).parent / relative_path


class InterviewHelperGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("ORBYNECUE")

        # DPI-safe fixed geometry
        # Get screen dimensions
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()

        # Calculate right half position
        window_width = screen_width // 2
        window_height = screen_height
        x_position = screen_width // 2
        y_position = 0

        # Set geometry to right half of screen
        self.root.geometry(f"{window_width}x{window_height}+{x_position}+{y_position}")
        self.root.minsize(800, 600)
        self.root.resizable(True, True)


        try:
            icon_path = resource_path("orbynecue.ico")
            icon_img = Image.open(icon_path)
            icon_photo = ImageTk.PhotoImage(icon_img)
            self.root.iconphoto(True, icon_photo)
            self._icon_ref = icon_photo
        except Exception:
            pass

        # ================= STATE =================
        self.running = False
        self.stop_event = threading.Event()
        self.speech_buffer = []
        self.last_speech_time = 0
        self.last_live_text = ""
        self.silence_finalize_seconds = 0.45
        self.selected_language = tk.StringVar(value="English")

        # ================= ROOT =================
        self.container = tk.Frame(root, bg="#1e3c72")
        self.container.pack(fill="both", expand=True)

        # ================= CARD =================
        self.card = tk.Frame(self.container, bg="white")
        self.card.pack(fill="both", expand=True, padx=40, pady=30)

        # ================= LOGO =================
        logo_img = Image.open(resource_path("icon.png")).resize((100, 100))
        self.logo = ImageTk.PhotoImage(logo_img)
        tk.Label(self.card, image=self.logo, bg="white").pack(pady=(15, 5))

        # ================= HEADER =================
        tk.Label(
            self.card,
            text="ORBYNECUE ASSISTANT",
            font=("Segoe UI", 20, "bold"),
            bg="white",
            fg="#1e3c72"
        ).pack()

        tk.Label(
            self.card,
            text="Your Real-Time Meeting Intelligence",
            font=("Segoe UI", 11),
            bg="white",
            fg="#666"
        ).pack(pady=(0, 15))

        # ================= LANGUAGE =================
        lang_frame = tk.Frame(self.card, bg="white")
        lang_frame.pack(fill="x", padx=30, pady=(5, 10))

        tk.Label(
            lang_frame,
            text="🎙 Transcription Language:",
            bg="white",
            font=("Segoe UI", 10)
        ).pack(side="left")

        tk.OptionMenu(
            lang_frame,
            self.selected_language,
            "English", "Spanish", "French", "German", "Arabic"
        ).pack(side="left", padx=10, fill="x", expand=True)

        # ================= TEXT AREA (SCROLLABLE) =================
        text_frame = tk.Frame(self.card, bg="white", height=420)
        text_frame.pack(fill="both", expand=False, padx=30, pady=(10, 10))
        text_frame.pack_propagate(False)

        scrollbar = tk.Scrollbar(text_frame)
        scrollbar.pack(side="right", fill="y")

        self.text = tk.Text(
            text_frame,
            wrap=tk.WORD,
            font=("Consolas", 11),
            bg="#f6f8fb",
            fg="#222",
            relief=tk.FLAT,
            yscrollcommand=scrollbar.set
        )
        self.text.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=self.text.yview)

        # ================= TEXT TAGS =================
        self.text.tag_config("status", foreground="#1e88e5")
        self.text.tag_config("question", foreground="#3345E6", font=("Segoe UI", 11, "bold"))
        self.text.tag_config("error", foreground="#c62828")
        self.text.tag_config("live", foreground="#546e7a", font=("Segoe UI", 11, "italic"))
        self.text.tag_config("heading", font=("Segoe UI", 12, "bold"))
        self.text.tag_config("body", font=("Segoe UI", 11), spacing3=10)

        # ================= FILE UPLOAD =================
        tk.Button(
            self.card,
            text="📂 Upload Knowledge File",
            font=("Segoe UI", 10, "bold"),
            bg="#6a1b9a",
            fg="white",
            relief=tk.FLAT,
            padx=20,
            pady=6,
            command=self.upload_file
        ).pack(pady=(5, 10))

        # ================= BUTTON BAR (FIXED) =================
        btn_frame = tk.Frame(self.card, bg="white")
        btn_frame.pack(fill="x", padx=30, pady=(10, 15))

        tk.Button(
            btn_frame,
            text="▶ Start Listening",
            font=("Segoe UI", 11, "bold"),
            bg="#1e88e5",
            fg="white",
            relief=tk.FLAT,
            pady=10,
            command=self.start
        ).pack(side="left", expand=True, fill="x", padx=(0, 10))

        tk.Button(
            btn_frame,
            text="⏹ Stop",
            font=("Segoe UI", 11, "bold"),
            bg="#e53935",
            fg="white",
            relief=tk.FLAT,
            pady=10,
            command=self.stop
        ).pack(side="left", expand=True, fill="x", padx=(10, 0))

        # ================= AUDIO =================
        self.listener = None
        self.transcriber = None

        self.log("UI loaded. Upload a file and choose language.", "status")

        self.root.after(300, self.ensure_license)


    # ================= LICENSE FLOW =================
    def _set_window_disabled(self, disabled: bool):
        try:
            self.root.attributes("-disabled", disabled)
        except tk.TclError:
            # macOS Tk does not support the Windows-only -disabled attribute.
            pass

    def ensure_license(self):
        if os.getenv("ORBYNE_REQUIRE_LICENSE", "false").lower() not in {"1", "true", "yes"}:
            return

        cached = load_license()
        if cached and is_license_valid(cached):
            return

        self._set_window_disabled(True)

        license_key = simpledialog.askstring(
            "License Verification",
            "Enter your ORBYNECUE license key:",
            parent=self.root
        )

        if not license_key:
            self.root.destroy()
            return

        result = verify_with_backend(license_key)

        if result.get("valid"):
            save_license(license_key, result["expires_on"])
            self._set_window_disabled(False)
            return

        messagebox.showerror(
            "Invalid License",
            "This license is invalid or expired.\n\nThe application will now close."
        )
        self.root.destroy()

    # ================= LANGUAGE MAP =================
    def get_language_code(self):
        return {
            "English": "en-US",
            "Spanish": "es-ES",
            "French": "fr-FR",
            "German": "de-DE",
            "Arabic": "ar-SA",
        }.get(self.selected_language.get(), "en-US")

    # ================= FILE UPLOAD =================
    def upload_file(self):
        path = filedialog.askopenfilename(
            title="Select knowledge file",
            filetypes=[("Supported files", "*.pdf *.docx *.pptx *.csv")]
        )
        if not path:
            return

        try:
            count = process_file(path)
            self.log(f"📄 File loaded — {count} chunks indexed", "status")
        except Exception as e:
            self.log(f"❌ File processing error: {e}", "error")

    # ================= STREAM CALLBACK =================
    def on_interim_text(self, text: str):
        self.root.after(0, self._show_live_text, text)

    def on_final_text(self, text: str):
        self.root.after(0, self._handle_text, text)

    def on_transcriber_error(self, message: str):
        self.root.after(0, self._handle_transcriber_error, message)

    def _handle_transcriber_error(self, message: str):
        self.running = False
        self.stop_event.set()
        self._clear_live_text()
        self.log(message, "error")
        self.log("Listening stopped because speech transcription is not available.", "error")

    def _clear_live_text(self):
        ranges = self.text.tag_ranges("live")
        if ranges:
            self.text.delete(ranges[0], ranges[-1])
        self.last_live_text = ""

    def _show_live_text(self, text: str):
        text = text.strip()
        if not text or text == self.last_live_text:
            return

        self._clear_live_text()
        self.last_live_text = text
        self.text.insert(tk.END, f"Listening: {text}\n", "live")
        self.text.see(tk.END)

    def _handle_text(self, text: str):
        self._clear_live_text()
        self.speech_buffer.append(text)
        self.last_speech_time = time.time()
        self.root.after(int(self.silence_finalize_seconds * 1000), self._finalize_if_silent)

    def _finalize_if_silent(self):
        if time.time() - self.last_speech_time < self.silence_finalize_seconds:
            return
        if not self.speech_buffer:
            return

        combined_text = " ".join(self.speech_buffer).strip()
        self.speech_buffer.clear()

        self.log(f"❓ Interpreted Input: {combined_text}", "question")

        answer, confidence = answer_from_document(combined_text)


        # ================= DOCUMENT ANSWER =================
        if answer:
            self.text.insert(
                tk.END,
                f"💡 Answer (Document | Match: {confidence}%):\n",
                "status"
            )

            blocks = answer.split("\n\n")

            for block in blocks:
                lines = [line.strip() for line in block.splitlines() if line.strip()]
                if not lines:
                    continue

                line = lines[0]

                # Match: 1. **Heading**: explanation
                match = re.match(r"(\d+\.\s*)\*\*(.+?)\*\*(.*)", line)

                if match:
                    number = match.group(1)      # "1. "
                    heading = match.group(2)     # "Job Replacement Fear"
                    rest = match.group(3)        # ": explanation text"

                    self.text.insert(tk.END, number, "body")
                    self.text.insert(tk.END, heading, "heading")
                    self.text.insert(tk.END, rest + "\n", "body")
                else:
                    self.text.insert(tk.END, line + "\n", "body")

            self.text.see(tk.END)

        # ================= GEMINI FALLBACK =================
        else:
            try:
                fallback = answer_from_gemini(combined_text)
            except Exception as e:
                self.text.insert(
                    tk.END,
                    f"❌ Gemini error: {e}\n",
                    "error"
                )
                self.text.see(tk.END)
                self.log("─" * 60, "status")
                return

            if not fallback or not fallback.strip():
                self.text.insert(
                    tk.END,
                    "⚠️ Question not found in document. No AI answer generated.\n",
                    "error"
                )
            else:
                self.text.insert(
                    tk.END,
                    "💡 Answer (Gemini):\n",
                    "status"
                )

                blocks = fallback.split("\n\n")

                for block in blocks:
                    lines = [line.strip() for line in block.splitlines() if line.strip()]
                    if not lines:
                        continue

                    line = lines[0]

                    # SAME parsing logic as document answers
                    match = re.match(r"(\d+\.\s*)\*\*(.+?)\*\*(.*)", line)

                    if match:
                        number = match.group(1)   # "1. "
                        heading = match.group(2)  # Heading text
                        rest = match.group(3)     # ": explanation..."

                        self.text.insert(tk.END, number, "body")
                        self.text.insert(tk.END, heading, "heading")
                        self.text.insert(tk.END, rest + "\n", "body")
                    else:
                        self.text.insert(tk.END, line + "\n", "body")


            self.text.see(tk.END)

        self.log("─" * 60, "status")




    # ================= CONTROLS =================
    def start(self):
        if self.running:
            return

        self.running = True
        self.stop_event.clear()

        try:
            self.listener = self.listener or SystemAudioListener()
            self.transcriber = StreamingTranscriber(
                self.on_final_text,
                on_interim_text=self.on_interim_text,
                on_error=self.on_transcriber_error,
                language_code=self.get_language_code()
            )
            self.transcriber.start()
        except Exception as exc:
            self.running = False
            self.log(f"Unable to start listening: {exc}", "error")
            return

        Thread(
            target=self.listener.stream,
            args=(self.transcriber.push_audio, self.stop_event),
            daemon=True
        ).start()

        self.log("🎧 Listening started.", "status")

    def stop(self):
        if not self.running:
            return

        self.running = False
        self.stop_event.set()
        if self.transcriber:
            self.transcriber.stop()
        self.log("🛑 Listening stopped.", "error")

    # ================= UI HELPERS =================
    def log(self, msg, tag="status"):
        self.text.insert(tk.END, msg + "\n", tag)
        self.text.see(tk.END)
