const elements = {
  answerOutput: document.querySelector("#answerOutput"),
  answerSource: document.querySelector("#answerSource"),
  askQuestion: document.querySelector("#askQuestion"),
  backendToken: document.querySelector("#backendToken"),
  backendUrl: document.querySelector("#backendUrl"),
  clearHistory: document.querySelector("#clearHistory"),
  clearKnowledge: document.querySelector("#clearKnowledge"),
  clearTranscript: document.querySelector("#clearTranscript"),
  connectionStatus: document.querySelector("#connectionStatus"),
  historyList: document.querySelector("#historyList"),
  interimTranscript: document.querySelector("#interimTranscript"),
  knowledgeFile: document.querySelector("#knowledgeFile"),
  knowledgeStatus: document.querySelector("#knowledgeStatus"),
  language: document.querySelector("#language"),
  listeningStatus: document.querySelector("#listeningStatus"),
  manualQuestion: document.querySelector("#manualQuestion"),
  saveSettings: document.querySelector("#saveSettings"),
  speechSupport: document.querySelector("#speechSupport"),
  startListening: document.querySelector("#startListening"),
  stopListening: document.querySelector("#stopListening"),
  testBackend: document.querySelector("#testBackend")
};

const STORAGE_KEYS = {
  backendToken: "orbynecue.backendToken",
  backendUrl: "orbynecue.backendUrl",
  history: "orbynecue.history",
  knowledge: "orbynecue.knowledge"
};

const DOCUMENT_MATCH_THRESHOLD = 50;
const MAX_LOCAL_ANSWER_WORDS = 180;

let recognition = null;
let chunks = [];
let history = [];

function setConnectionStatus(text, state = "neutral") {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.className = `statusPill ${state}`;
}

function setListeningStatus(text, state = "neutral") {
  elements.listeningStatus.textContent = text;
  elements.listeningStatus.className = `statusPill ${state}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function compactText(text, maxWords = MAX_LOCAL_ANSWER_WORDS) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:\s]+$/, "")}...`;
}

function scoreChunk(questionWords, chunk) {
  const chunkWords = new Set(tokenize(chunk));
  let hits = 0;

  for (const word of questionWords) {
    if (chunkWords.has(word)) {
      hits += 1;
    }
  }

  return hits / Math.max(questionWords.length, 1);
}

function getBestChunks(question, count = 4) {
  const questionWords = tokenize(question);
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(questionWords, chunk) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

function extractAnswerSection(question, chunk) {
  const lines = chunk
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return compactText(chunk);
  }

  const questionWords = new Set(tokenize(question));
  let bestIndex = 0;
  let bestScore = -1;

  lines.forEach((line, index) => {
    const hits = tokenize(line).filter((word) => questionWords.has(word)).length;
    if (hits > bestScore) {
      bestScore = hits;
      bestIndex = index;
    }
  });

  const collected = [lines[bestIndex]];
  for (const line of lines.slice(bestIndex + 1)) {
    const lowerLine = line.toLowerCase();
    if (/^(q(uestion)?\s*\d*[:.)-]?|[0-9]+\.)\s+/i.test(line)) {
      break;
    }
    if (lowerLine.endsWith("?") && tokenize(line).length <= 14) {
      break;
    }
    collected.push(line);
    if (collected.join(" ").split(/\s+/).length >= MAX_LOCAL_ANSWER_WORDS) {
      break;
    }
  }

  return compactText(collected.join(" "));
}

function localAnswer(question, scoredChunks) {
  const points = [];
  for (const match of scoredChunks) {
    const section = extractAnswerSection(question, match.chunk);
    if (section && !points.includes(section)) {
      points.push(section);
    }
    if (points.length >= 3) {
      break;
    }
  }

  return points
    .map((point, index) => `${index + 1}. **Document Match**: ${point}`)
    .join("\n");
}

function formatAnswer(answer) {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  const numbered = lines.every((line) => /^\d+\.\s+/.test(line));
  if (!numbered) {
    return `<p>${escapeHtml(answer)}</p>`;
  }

  return `<ol>${lines
    .map((line) => line.replace(/^\d+\.\s+/, ""))
    .map((line) => `<li>${escapeHtml(line).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</li>`)
    .join("")}</ol>`;
}

function renderAnswer(answer, source) {
  elements.answerOutput.innerHTML = formatAnswer(answer);
  elements.answerSource.textContent = source;
}

function getBackendSettings() {
  return {
    token: elements.backendToken.value.trim(),
    url: elements.backendUrl.value.trim().replace(/\/+$/, "")
  };
}

async function callGeminiBackend(question) {
  const { token, url } = getBackendSettings();
  if (!url) {
    throw new Error("Set your Gemini backend URL first.");
  }

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${url}/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Backend request failed with ${response.status}`);
  }

  return response.json();
}

async function answerQuestion(question) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  elements.interimTranscript.textContent = trimmed;
  elements.answerOutput.textContent = "Thinking...";
  elements.answerSource.textContent = "Processing";

  const matches = getBestChunks(trimmed);
  const confidence = matches.length ? Math.round(matches[0].score * 10000) / 100 : 0;

  try {
    if (matches.length && confidence >= DOCUMENT_MATCH_THRESHOLD) {
      const answer = localAnswer(trimmed, matches);
      renderAnswer(answer, `Document | Match: ${confidence}%`);
      addHistory(trimmed, `Document match ${confidence}%`);
      return;
    }

    const result = await callGeminiBackend(trimmed);
    renderAnswer(result.answer, `Gemini | ${result.model || "backend"}`);
    addHistory(trimmed, "Gemini backend");
  } catch (error) {
    elements.answerOutput.textContent = `Error: ${error.message}`;
    elements.answerSource.textContent = "Error";
    addHistory(trimmed, "Error");
  }
}

function addHistory(question, source) {
  history = [{ question, source, at: new Date().toLocaleTimeString() }, ...history].slice(0, 20);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  if (!history.length) {
    elements.historyList.textContent = "No questions yet.";
    return;
  }

  elements.historyList.innerHTML = history
    .map(
      (item) => `<button type="button" class="historyItem" data-question="${escapeHtml(item.question)}">
        <strong>${escapeHtml(item.question)}</strong>
        <span>${escapeHtml(item.source)} · ${escapeHtml(item.at)}</span>
      </button>`
    )
    .join("");
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error("Speech recognition is available in Chrome and Edge. Use manual questions in this browser.");
  }

  const nextRecognition = new SpeechRecognition();
  nextRecognition.lang = elements.language.value;
  nextRecognition.continuous = true;
  nextRecognition.interimResults = true;

  nextRecognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (!text) {
        continue;
      }

      elements.interimTranscript.textContent = text;
      if (result.isFinal) {
        answerQuestion(text);
      }
    }
  };

  nextRecognition.onerror = (event) => {
    setListeningStatus("Speech error", "error");
    elements.answerOutput.textContent = event.error || "Speech recognition failed.";
  };

  nextRecognition.onend = () => {
    elements.startListening.disabled = false;
    elements.stopListening.disabled = true;
    setListeningStatus("Idle", "neutral");
  };

  return nextRecognition;
}

function loadState() {
  elements.backendUrl.value = localStorage.getItem(STORAGE_KEYS.backendUrl) || "";
  elements.backendToken.value = localStorage.getItem(STORAGE_KEYS.backendToken) || "";
  chunks = JSON.parse(localStorage.getItem(STORAGE_KEYS.knowledge) || "[]");
  history = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");

  elements.knowledgeStatus.textContent = chunks.length ? `${chunks.length} chunks` : "No file";
  setConnectionStatus(elements.backendUrl.value ? "Backend saved" : "Backend not set", elements.backendUrl.value ? "" : "neutral");
  renderHistory();

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  elements.speechSupport.textContent = SpeechRecognition ? "Supported" : "Manual only";
}

elements.saveSettings.addEventListener("click", () => {
  const { token, url } = getBackendSettings();
  localStorage.setItem(STORAGE_KEYS.backendUrl, url);
  localStorage.setItem(STORAGE_KEYS.backendToken, token);
  setConnectionStatus(url ? "Backend saved" : "Backend not set", url ? "" : "neutral");
});

elements.testBackend.addEventListener("click", async () => {
  const { token, url } = getBackendSettings();
  if (!url) {
    setConnectionStatus("Backend not set", "error");
    return;
  }

  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${url}/health`, { headers });
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    setConnectionStatus("Backend online");
  } catch (error) {
    setConnectionStatus("Backend error", "error");
    elements.answerOutput.textContent = error.message;
  }
});

elements.knowledgeFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  const text = await file.text();
  chunks = chunkText(text);
  localStorage.setItem(STORAGE_KEYS.knowledge, JSON.stringify(chunks));
  elements.knowledgeStatus.textContent = `${chunks.length} chunks`;
});

elements.clearKnowledge.addEventListener("click", () => {
  chunks = [];
  localStorage.removeItem(STORAGE_KEYS.knowledge);
  elements.knowledgeFile.value = "";
  elements.knowledgeStatus.textContent = "No file";
});

elements.askQuestion.addEventListener("click", () => {
  answerQuestion(elements.manualQuestion.value);
});

elements.manualQuestion.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    answerQuestion(elements.manualQuestion.value);
  }
});

elements.startListening.addEventListener("click", () => {
  try {
    recognition = createRecognition();
    recognition.start();
    elements.startListening.disabled = true;
    elements.stopListening.disabled = false;
    setListeningStatus("Listening");
  } catch (error) {
    elements.answerOutput.textContent = error.message;
  }
});

elements.stopListening.addEventListener("click", () => {
  if (recognition) {
    recognition.stop();
  }
});

elements.clearTranscript.addEventListener("click", () => {
  elements.interimTranscript.textContent = "Waiting for speech or a typed question.";
});

elements.clearHistory.addEventListener("click", () => {
  history = [];
  localStorage.removeItem(STORAGE_KEYS.history);
  renderHistory();
});

elements.historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".historyItem");
  if (item) {
    elements.manualQuestion.value = item.dataset.question;
    answerQuestion(item.dataset.question);
  }
});

loadState();
