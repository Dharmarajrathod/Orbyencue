from pathlib import Path

import file_processor


def test_normalize_text_collapses_whitespace():
    raw = "First line\n\n\nSecond\t\tline"

    assert file_processor.normalize_text(raw) == "First line\nSecond line"


def test_stream_chunks_keeps_non_empty_paragraphs():
    text = "\n".join([
        "short",
        "This paragraph is long enough to be considered meaningful content for indexing.",
        "Another paragraph with enough words to survive the minimum length filter.",
    ])

    chunks = list(file_processor.stream_chunks(text, max_words=20))

    assert len(chunks) == 2
    assert "short" in chunks[0]
    assert "meaningful content" in chunks[0]


def test_extract_text_from_csv(tmp_path):
    csv_file = Path(tmp_path) / "data.csv"
    csv_file.write_text("name,role\nAda,Engineer\n", encoding="utf-8")

    assert "Ada Engineer" in file_processor.extract_text(str(csv_file))


def test_process_file_keeps_chunks_without_openai_key(tmp_path, monkeypatch):
    csv_file = Path(tmp_path) / "data.csv"
    csv_file.write_text(
        "name,role,notes\nAda,Engineer,This row has enough detail to create a chunk for embedding validation.\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(file_processor, "client", None)

    count = file_processor.process_file(str(csv_file))

    assert count == 1
    assert file_processor.DOCUMENT_CHUNKS
    assert file_processor.DOCUMENT_EMBEDDINGS == []


def test_process_file_keeps_chunks_when_embeddings_fail(tmp_path, monkeypatch):
    csv_file = Path(tmp_path) / "data.csv"
    csv_file.write_text(
        "topic,notes\nQuota,This document should still be searchable when embeddings fail badly.\n",
        encoding="utf-8",
    )

    class BrokenEmbeddings:
        def create(self, **kwargs):
            raise RuntimeError("quota exceeded")

    class BrokenClient:
        embeddings = BrokenEmbeddings()

    monkeypatch.setattr(file_processor, "get_openai_client", lambda: BrokenClient())

    count = file_processor.process_file(str(csv_file))

    assert count == 1
    assert file_processor.DOCUMENT_CHUNKS
    assert file_processor.DOCUMENT_EMBEDDINGS == []
