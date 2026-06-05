import pytest


def test_core_modules_import_without_runtime_secrets():
    import config  # noqa: F401
    import file_processor  # noqa: F401
    import license  # noqa: F401
    import listener  # noqa: F401
    import rag_engine  # noqa: F401
    import streaming_transcriber  # noqa: F401


def test_gui_imports_when_tkinter_is_available():
    try:
        import _tkinter  # noqa: F401
    except ModuleNotFoundError:
        pytest.skip("Python interpreter is not built with Tk support")

    import gui  # noqa: F401
