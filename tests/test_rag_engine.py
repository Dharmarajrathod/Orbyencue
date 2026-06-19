import numpy as np

import rag_engine


def test_cosine_similarity_handles_zero_vectors():
    assert rag_engine.cosine_similarity(np.array([0, 0]), np.array([1, 2])) == 0.0


def test_answer_from_document_without_chunks_returns_empty_result():
    rag_engine.DOCUMENT_CHUNKS.clear()
    rag_engine.DOCUMENT_EMBEDDINGS.clear()

    assert rag_engine.answer_from_document("What is this?") == (None, 0.0)


def test_answer_from_document_uses_local_fallback_without_embeddings(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        ["Quota billing failure means OpenAI embeddings cannot be created, but local keyword search still works."],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_document("Why did quota billing embeddings fail?")

    assert confidence > 0
    assert "Quota billing failure" in answer


def test_local_fallback_returns_none_for_low_overlap(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        ["Python is a programming language. Django is a web framework. Flask is lightweight."],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_document("Tell me about Kubernetes networking")

    assert confidence == 0.0
    assert answer is None


def test_local_fallback_returns_complete_section_after_matching_question(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        [
            "\n".join(
                [
                    "Tell me about yourself.",
                    "I am a learning and development professional with experience creating digital learning.",
                    "I work with stakeholders, define outcomes, and build practical content for learners.",
                    "Why are you a good fit for this role?",
                    "I match the role because I combine instructional design, communication, and delivery.",
                ]
            )
        ],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_document("tell me about yourself")

    assert confidence > 40
    assert "Tell me about yourself" not in answer
    assert "learning and development professional" in answer
    assert "Why are you a good fit" not in answer


def test_local_fallback_skips_matched_numbered_question(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        [
            "\n".join(
                [
                    "2. How do you convert SME content into learner friendly training?",
                    "I convert SME content into learner friendly training by:",
                    "1. Breaking complex ideas into simple language.",
                    "2. Organizing the content into clear learning steps.",
                    "3. Adding practical examples and checks for understanding.",
                    "3. How do you handle stakeholder feedback?",
                    "I clarify priorities and revise the content.",
                ]
            )
        ],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_document("How do you convert SME content into friendly?")

    assert confidence > 40
    assert "convert SME content into learner friendly training?" not in answer
    assert "Breaking complex ideas into simple language" in answer
    assert "Organizing the content into clear learning steps" in answer
    assert "handle stakeholder feedback" not in answer


def test_local_fallback_accepts_40_percent_match(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        ["quota billing failure creates local search fallback"],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_document("quota billing unrelated extra words")

    assert confidence == 40.0
    assert "quota billing failure" in answer


def test_best_document_answer_allows_low_confidence_when_ai_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        ["Interview answer bank: keep answers concise, practical, and grounded in the uploaded document."],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_best_document("unrelated wording")

    assert confidence == 0.0
    assert "Interview answer bank" in answer


def test_local_fallback_returns_only_one_document_answer(monkeypatch):
    monkeypatch.setattr(
        rag_engine,
        "DOCUMENT_CHUNKS",
        [
            "Quota billing failure means embeddings cannot be created, but local keyword search still works.",
            "Quota billing alerts should be checked before retrying document processing.",
        ],
    )
    monkeypatch.setattr(rag_engine, "DOCUMENT_EMBEDDINGS", [])

    answer, confidence = rag_engine.answer_from_document("Why did quota billing embeddings fail?")

    assert confidence > 40
    assert answer.count("**Complete Answer**") == 1
    assert "\n2." not in answer


def test_answer_from_gemini_uses_configured_client(monkeypatch):
    class Response:
        text = "1. **Gemini Answer**: This came from Gemini."

    class Models:
        def generate_content(self, model, contents):
            assert model == "gemini-2.5-flash-lite"
            assert "Question:" in contents
            return Response()

    class Client:
        models = Models()

    monkeypatch.setattr(rag_engine, "gemini_client", Client())

    assert "Gemini Answer" in rag_engine.answer_from_gemini("Who is the doctor?")
