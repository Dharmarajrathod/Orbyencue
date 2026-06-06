const elements = {
  answerOutput: document.querySelector("#answerOutput"),
  answerSource: document.querySelector("#answerSource"),
  askQuestion: document.querySelector("#askQuestion"),
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
  meetingAudioLevel: document.querySelector("#meetingAudioLevel"),
  meetingAudioStatus: document.querySelector("#meetingAudioStatus"),
  speechSupport: document.querySelector("#speechSupport"),
  startMeetingAudio: document.querySelector("#startMeetingAudio"),
  startListening: document.querySelector("#startListening"),
  stopMeetingAudio: document.querySelector("#stopMeetingAudio"),
  stopListening: document.querySelector("#stopListening")
};

const STORAGE_KEYS = {
  history: "orbynecue.history",
  knowledge: "orbynecue.knowledge"
};

const DOCUMENT_MATCH_THRESHOLD = 50;
const MAX_LOCAL_ANSWER_WORDS = 180;
const MEETING_AUDIO_SEGMENT_MS = 20000;
const MEETING_AUTO_ANSWER_COOLDOWN_MS = 30000;
const QUESTION_STARTERS = /^(what|why|how|who|when|where|which|can|could|would|should|do|does|did|tell|explain|describe)\b/i;

let recognition = null;
let lastMeetingAnswerAt = 0;
let lastMeetingAnswerText = "";
let meetingAudioActive = false;
let meetingAudioContext = null;
let meetingAudioLevelTimer = null;
let meetingAudioRecorder = null;
let meetingAudioStream = null;
let meetingAudioUploadActive = false;
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

function setMeetingAudioStatus(text) {
  elements.meetingAudioStatus.textContent = text;
}

function setMeetingAudioLevel(value) {
  const bounded = Math.max(0, Math.min(value, 1));
  elements.meetingAudioLevel.style.transform = `scaleX(${bounded})`;
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

async function callAi(question) {
  const response = await fetch("/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.detail || `Backend request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (!payload.answer) {
    throw new Error("Backend returned an empty answer.");
  }

  return payload;
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

    const result = await callAi(trimmed);
    renderAnswer(result.answer, result.model);
    addHistory(trimmed, result.model);
  } catch (error) {
    elements.answerOutput.textContent = `Error: ${error.message}`;
    elements.answerSource.textContent = "Error";
    addHistory(trimmed, "Error");
  }
}

function looksLikeQuestion(text) {
  const cleanText = text.trim();
  const words = tokenize(cleanText);
  return cleanText.endsWith("?") || (words.length >= 4 && QUESTION_STARTERS.test(cleanText));
}

async function maybeAnswerMeetingTranscript(transcript) {
  const cleanTranscript = transcript.trim();
  if (!looksLikeQuestion(cleanTranscript)) {
    elements.answerSource.textContent = "Transcript only";
    return;
  }

  const now = Date.now();
  const normalized = cleanTranscript.toLowerCase();
  if (normalized === lastMeetingAnswerText) {
    return;
  }
  if (now - lastMeetingAnswerAt < MEETING_AUTO_ANSWER_COOLDOWN_MS) {
    elements.answerSource.textContent = "Waiting for cooldown";
    return;
  }

  lastMeetingAnswerAt = now;
  lastMeetingAnswerText = normalized;
  await answerQuestion(cleanTranscript);
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

function getSupportedAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getAudioFileName(mimeType) {
  if (mimeType.includes("mp4")) {
    return "meeting-audio.mp4";
  }
  return "meeting-audio.webm";
}

async function sendMeetingAudioChunk(blob) {
  if (meetingAudioUploadActive || !blob.size) {
    return;
  }

  meetingAudioUploadActive = true;
  try {
    const formData = new FormData();
    formData.append("file", blob, getAudioFileName(blob.type || ""));
    const response = await fetch("/transcribe-audio", {
      method: "POST",
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.detail || `Audio transcription failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const transcript = (payload.transcript || "").trim();
    if (transcript) {
      elements.interimTranscript.textContent = transcript;
      await maybeAnswerMeetingTranscript(transcript);
    }
  } catch (error) {
    elements.answerOutput.textContent = `Meeting audio error: ${error.message}`;
    elements.answerSource.textContent = "Error";
    if (error.status === 429) {
      stopMeetingAudioCapture();
      setMeetingAudioStatus("Quota exhausted");
    }
  } finally {
    meetingAudioUploadActive = false;
  }
}

function startMeetingAudioMeter(audioStream) {
  stopMeetingAudioMeter();
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  meetingAudioContext = new AudioContextConstructor();
  const source = meetingAudioContext.createMediaStreamSource(audioStream);
  const analyser = meetingAudioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  let silentTicks = 0;

  meetingAudioLevelTimer = window.setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / samples.length);
    const level = Math.min(rms * 8, 1);
    setMeetingAudioLevel(level);

    if (rms > 0.018) {
      silentTicks = 0;
      setMeetingAudioStatus("Audio detected");
    } else {
      silentTicks += 1;
      if (silentTicks >= 8) {
        setMeetingAudioStatus("No audio detected");
      }
    }
  }, 500);
}

function stopMeetingAudioMeter() {
  if (meetingAudioLevelTimer) {
    window.clearInterval(meetingAudioLevelTimer);
    meetingAudioLevelTimer = null;
  }
  if (meetingAudioContext) {
    meetingAudioContext.close();
    meetingAudioContext = null;
  }
  setMeetingAudioLevel(0);
}

function recordNextMeetingAudioSegment(audioStream) {
  if (!meetingAudioActive) {
    return;
  }

  const mimeType = getSupportedAudioMimeType();
  const segmentParts = [];
  meetingAudioRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);

  meetingAudioRecorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) {
      segmentParts.push(event.data);
    }
  });

  meetingAudioRecorder.addEventListener("stop", () => {
    if (segmentParts.length) {
      const blob = new Blob(segmentParts, { type: meetingAudioRecorder.mimeType || mimeType || "audio/webm" });
      sendMeetingAudioChunk(blob);
    }

    if (meetingAudioActive) {
      window.setTimeout(() => recordNextMeetingAudioSegment(audioStream), 250);
    }
  });

  meetingAudioRecorder.start();
  window.setTimeout(() => {
    if (meetingAudioRecorder?.state === "recording") {
      meetingAudioRecorder.stop();
    }
  }, MEETING_AUDIO_SEGMENT_MS);
}

async function startMeetingAudioCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Meeting audio capture needs Chrome or Edge screen/tab sharing.");
  }
  if (!window.MediaRecorder) {
    throw new Error("This browser does not support MediaRecorder audio capture.");
  }

  meetingAudioStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback: false
    },
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include"
  });

  const audioTracks = meetingAudioStream.getAudioTracks();
  if (!audioTracks.length) {
    meetingAudioStream.getTracks().forEach((track) => track.stop());
    meetingAudioStream = null;
    throw new Error("No shared audio found. Choose a tab/screen with audio sharing enabled.");
  }

  const audioOnlyStream = new MediaStream(audioTracks);

  for (const track of meetingAudioStream.getTracks()) {
    track.addEventListener("ended", stopMeetingAudioCapture);
  }

  meetingAudioActive = true;
  startMeetingAudioMeter(audioOnlyStream);
  recordNextMeetingAudioSegment(audioOnlyStream);
  elements.startMeetingAudio.disabled = true;
  elements.stopMeetingAudio.disabled = false;
  setMeetingAudioStatus("Checking audio");
}

function stopMeetingAudioCapture() {
  meetingAudioActive = false;
  if (meetingAudioRecorder && meetingAudioRecorder.state !== "inactive") {
    meetingAudioRecorder.stop();
  }
  if (meetingAudioStream) {
    meetingAudioStream.getTracks().forEach((track) => track.stop());
    meetingAudioStream = null;
  }
  elements.startMeetingAudio.disabled = false;
  elements.stopMeetingAudio.disabled = true;
  stopMeetingAudioMeter();
  setMeetingAudioStatus("Not shared");
}

function loadState() {
  chunks = JSON.parse(localStorage.getItem(STORAGE_KEYS.knowledge) || "[]");
  history = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");

  elements.knowledgeStatus.textContent = chunks.length ? `${chunks.length} chunks` : "No file";
  renderHistory();

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  elements.speechSupport.textContent = SpeechRecognition ? "Supported" : "Manual only";
}

async function checkBackend() {
  try {
    const response = await fetch("/health");
    const payload = await response.json();
    if (payload.provider === "ollama") {
      setConnectionStatus(`Ollama | ${payload.ollamaModel}`, "neutral");
      return;
    }
    setConnectionStatus(payload.geminiConfigured ? "Gemini ready" : "Set GEMINI_API_KEY", payload.geminiConfigured ? "" : "error");
  } catch (error) {
    setConnectionStatus("Backend unavailable", "error");
  }
}

elements.knowledgeFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  elements.knowledgeStatus.textContent = "Processing...";
  elements.answerOutput.textContent = "";
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/knowledge", {
      method: "POST",
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || `File upload failed with ${response.status}`);
    }

    chunks = payload.chunks || [];
    localStorage.setItem(STORAGE_KEYS.knowledge, JSON.stringify(chunks));
    elements.knowledgeStatus.textContent = `${payload.filename} · ${payload.chunkCount} chunks`;
  } catch (error) {
    chunks = [];
    localStorage.removeItem(STORAGE_KEYS.knowledge);
    elements.knowledgeStatus.textContent = "Upload failed";
    elements.answerOutput.textContent = `File processing error: ${error.message}`;
  }
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

elements.startMeetingAudio.addEventListener("click", async () => {
  try {
    await startMeetingAudioCapture();
  } catch (error) {
    elements.answerOutput.textContent = error.message;
    setMeetingAudioStatus("Error");
  }
});

elements.stopMeetingAudio.addEventListener("click", () => {
  stopMeetingAudioCapture();
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
checkBackend();
