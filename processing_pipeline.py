import hashlib
import re
import time
from collections import OrderedDict


FILLER_WORDS = {
    "ah",
    "ahh",
    "eh",
    "erm",
    "hmm",
    "like",
    "okay",
    "right",
    "uh",
    "uhh",
    "um",
    "umm",
    "you know",
}

QUESTION_TERMS = {
    "can",
    "could",
    "describe",
    "did",
    "do",
    "does",
    "explain",
    "how",
    "is",
    "should",
    "tell",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "would",
}

FILLER_ONLY_PATTERNS = [
    r"^(hi|hello|hey|good morning|good afternoon|good evening)\b",
    r"^(thanks|thank you|yeah|yes|no|ok|okay|sure|great|fine|cool)\.?$",
    r"^(my name is|i am|i'm|this is)\b",
    r"^(nice to meet you|good to meet you)\.?$",
]


class RecentTranscriptCache:
    def __init__(self, max_items=128, ttl_seconds=900):
        self.max_items = max_items
        self.ttl_seconds = ttl_seconds
        self._items = OrderedDict()

    def seen_or_add(self, text: str) -> bool:
        key = transcript_hash(text)
        now = time.time()
        expired = [item for item, timestamp in self._items.items() if now - timestamp > self.ttl_seconds]
        for item in expired:
            self._items.pop(item, None)

        if key in self._items:
            self._items.move_to_end(key)
            self._items[key] = now
            return True

        self._items[key] = now
        while len(self._items) > self.max_items:
            self._items.popitem(last=False)
        return False


def transcript_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def clean_transcript(text: str) -> str:
    clean = text
    clean = re.sub(r"\[[^\]]+\]|\([^\)]+\)", " ", clean)
    clean = re.sub(
        r"\b(?:%s)\b" % "|".join(re.escape(word) for word in sorted(FILLER_WORDS, key=len, reverse=True)),
        " ",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(r"\b(\w+)(?:\s+\1\b){1,}", r"\1", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\b(\w+\s+\w+)(?:\s+\1\b){1,}", r"\1", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s+", " ", clean).strip(" .,;:-")

    sentences = re.split(r"(?<=[.!?])\s+", clean)
    meaningful = [sentence.strip() for sentence in sentences if len(tokenize(sentence)) >= 3]
    if meaningful:
        clean = " ".join(meaningful)

    if clean and text.strip().endswith("?") and not clean.endswith("?"):
        clean += "?"
    return clean


def tokenize(text: str):
    return [word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 1]


def is_meaningful_question_or_request(text: str) -> bool:
    clean = re.sub(r"\s+", " ", text).strip().lower()
    if not clean:
        return False

    for pattern in FILLER_ONLY_PATTERNS:
        if re.match(pattern, clean):
            return False

    words = tokenize(clean)
    if len(words) < 3:
        return False

    if clean.endswith("?"):
        return True

    first_word = words[0]
    if first_word in QUESTION_TERMS:
        return True

    request_pattern = r"\b(tell me|explain|describe|walk me through|help me|give me|show me|summarize|compare|define)\b"
    return bool(re.search(request_pattern, clean))
