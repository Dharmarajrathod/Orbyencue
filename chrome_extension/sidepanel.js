const elements = {
  answer: document.querySelector("#answer"),
  askQuestion: document.querySelector("#askQuestion"),
  clearKnowledge: document.querySelector("#clearKnowledge"),
  knowledgeFile: document.querySelector("#knowledgeFile"),
  knowledgeStatus: document.querySelector("#knowledgeStatus"),
  language: document.querySelector("#language"),
  manualQuestion: document.querySelector("#manualQuestion"),
  startListening: document.querySelector("#startListening"),
  statusBadge: document.querySelector("#statusBadge"),
  stopListening: document.querySelector("#stopListening"),
  transcript: document.querySelector("#transcript")
};

const storageKey = "orbynecueKnowledge";
let recognition = null;
let chunks = [];

function setStatus(text) {
  elements.statusBadge.textContent = text;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function chunkText(text, maxWords = 220) {
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const result = [];
  let buffer = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    if (buffer.length + words.length > maxWords && buffer.length) {
      result.push(buffer.join(" "));
      buffer = [];
    }
    buffer.push(...words);
  }

  if (buffer.length) {
    result.push(buffer.join(" "));
  }

  return result;
}

function scoreChunk(questionWords, chunk) {
  const chunkWords = new Set(tokenize(chunk));
  let score = 0;

  for (const word of questionWords) {
    if (chunkWords.has(word)) {
      score += 1;
    }
  }

  return score / Math.max(questionWords.length, 1);
}

function getBestChunks(question, count = 3) {
  const questionWords = tokenize(question);
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(questionWords, chunk) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

function sentenceMatches(question, chunk) {
  const questionWords = new Set(tokenize(question));
  const sentences = chunk.match(/[^.!?]+[.!?]*/g) || [chunk];

  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => ({
      sentence,
      hits: tokenize(sentence).filter((word) => questionWords.has(word)).length
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((item) => item.sentence);
}

function renderAnswer(question) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  const matches = getBestChunks(trimmed);
  if (!matches.length) {
    elements.answer.textContent = "No matching knowledge found. Upload a relevant text, markdown, CSV, or JSON file first.";
    return;
  }

  const points = [];
  for (const match of matches) {
    for (const sentence of sentenceMatches(trimmed, match.chunk)) {
      if (!points.includes(sentence)) {
        points.push(sentence);
      }
      if (points.length >= 3) {
        break;
      }
    }
    if (points.length >= 3) {
      break;
    }
  }

  const list = document.createElement("ol");
  for (const point of points.length ? points : matches.map((item) => item.chunk.slice(0, 240))) {
    const item = document.createElement("li");
    item.textContent = point;
    list.appendChild(item);
  }

  elements.answer.replaceChildren(list);
}

async function loadStoredKnowledge() {
  const saved = await chrome.storage.local.get(storageKey);
  chunks = saved[storageKey] || [];
  elements.knowledgeStatus.textContent = chunks.length ? `${chunks.length} chunks loaded` : "No file loaded";
}

async function saveKnowledge(nextChunks) {
  chunks = nextChunks;
  await chrome.storage.local.set({ [storageKey]: chunks });
  elements.knowledgeStatus.textContent = chunks.length ? `${chunks.length} chunks loaded` : "No file loaded";
}

function appendTranscript(text) {
  const current = elements.transcript.textContent.trim();
  elements.transcript.textContent = current ? `${current}\n${text}` : text;
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error("Chrome Speech Recognition is not available in this browser.");
  }

  const nextRecognition = new SpeechRecognition();
  nextRecognition.lang = elements.language.value;
  nextRecognition.continuous = true;
  nextRecognition.interimResults = true;

  nextRecognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (result.isFinal && text) {
        appendTranscript(text);
        renderAnswer(text);
      }
    }
  };

  nextRecognition.onerror = (event) => {
    setStatus("Error");
    elements.answer.textContent = event.error || "Speech recognition failed.";
  };

  nextRecognition.onend = () => {
    elements.startListening.disabled = false;
    elements.stopListening.disabled = true;
    setStatus("Idle");
  };

  return nextRecognition;
}

elements.knowledgeFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  const text = await file.text();
  await saveKnowledge(chunkText(text));
});

elements.clearKnowledge.addEventListener("click", async () => {
  await saveKnowledge([]);
  elements.knowledgeFile.value = "";
  elements.answer.textContent = "";
});

elements.askQuestion.addEventListener("click", () => {
  renderAnswer(elements.manualQuestion.value);
});

elements.startListening.addEventListener("click", () => {
  try {
    recognition = createRecognition();
    recognition.start();
    elements.startListening.disabled = true;
    elements.stopListening.disabled = false;
    setStatus("Listening");
  } catch (error) {
    elements.answer.textContent = error.message;
  }
});

elements.stopListening.addEventListener("click", () => {
  if (recognition) {
    recognition.stop();
  }
});

loadStoredKnowledge();
