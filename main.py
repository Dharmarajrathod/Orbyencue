import tkinter as tk
from gui import InterviewHelperGUI
import ctypes


def run():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    root.app = InterviewHelperGUI(root)
    root.mainloop()

if __name__ == "__main__":
    run()
