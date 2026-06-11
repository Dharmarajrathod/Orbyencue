const elements = {
  askQuestion: document.querySelector("#askQuestion"),
  audioLanguage: document.querySelector("#audioLanguage"),
  audioSharedStatus: document.querySelector("#audioSharedStatus"),
  chatForm: document.querySelector("#chatForm"),
  chatMessages: document.querySelector("#chatMessages"),
  clearHistory: document.querySelector("#clearHistory"),
  composerFile: document.querySelector("#composerFile"),
  connectionStatus: document.querySelector("#connectionStatus"),
  contextIndicator: document.querySelector("#contextIndicator"),
  documentDropzone: document.querySelector("#documentDropzone"),
  documentList: document.querySelector("#documentList"),
  documentsStatus: document.querySelector("#documentsStatus"),
  historyList: document.querySelector("#historyList"),
  knowledgeFile: document.querySelector("#knowledgeFile"),
  knowledgeStatus: document.querySelector("#knowledgeStatus"),
  liveTranscript: document.querySelector("#liveTranscript"),
  manualQuestion: document.querySelector("#manualQuestion"),
  meetingAudioLevel: document.querySelector("#meetingAudioLevel"),
  meetingAudioStatus: document.querySelector("#meetingAudioStatus"),
  newChat: document.querySelector("#newChat"),
  processingStatus: document.querySelector("#processingStatus"),
  recordingPlayback: document.querySelector("#recordingPlayback"),
  settingsButton: document.querySelector("#settingsButton"),
  startListening: document.querySelector("#startListening"),
  startMeetingAudio: document.querySelector("#startMeetingAudio"),
  startRecording: document.querySelector("#startRecording"),
  stopMeetingAudio: document.querySelector("#stopMeetingAudio"),
  stopListening: document.querySelector("#stopListening"),
  stopRecording: document.querySelector("#stopRecording"),
  listeningStatus: document.querySelector("#listeningStatus")
};

const STORAGE_KEYS = {
  apiBaseUrl: "orbynecue.apiBaseUrl",
  documents: "orbynecue.documents",
  history: "orbynecue.history",
  messages: "orbynecue.messages",
  meetingContext: "orbynecue.meetingContext"
};

const DEFAULT_LOCAL_BACKEND_URL = "http://127.0.0.1:8000";
const DOCUMENT_MATCH_THRESHOLD = 40;
const MAX_LOCAL_ANSWER_WORDS = 180;
const MAX_CONTEXT_WORDS = 520;
const AI_REQUEST_TIMEOUT_MS = 45000;
const MEETING_AUDIO_SEGMENT_MS = 7000;
const MEETING_AUTO_ANSWER_COOLDOWN_MS = 6000;
const MEETING_QUESTION_SETTLE_MS = 4500;
const MIN_MEETING_AUTO_ANSWER_WORDS = 5;

let documents = [];
let history = [];
let lastMeetingAnswerAt = 0;
let lastMeetingAnswerText = "";
let pendingMeetingAnswerSegments = [];
let pendingMeetingAnswerText = "";
let pendingMeetingAnswerTimer = null;
let meetingAudioContext = null;
let meetingAudioLevelTimer = null;
let discardMeetingAudioChunks = false;
let meetingAudioRecorder = null;
let meetingAudioShared = false;
let meetingSharedAudioStream = null;
let meetingAudioStream = null;
let meetingMicStream = null;
let micRecorder = null;
let micRecordingParts = [];
let pendingTranscriptions = new Set();
let messages = [];
let processingCount = 0;
let meetingListening = false;
let meetingRecording = false;
let meetingRecorderGeneration = 0;
let meetingTranscript = [];
let displayedMeetingTranscript = [];
let currentRecordingUrl = "";

function getApiBaseUrl() {
  const configured = localStorage.getItem(STORAGE_KEYS.apiBaseUrl) || window.ORBYNE_API_BASE_URL || "";
  if (configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }

  if (window.location.hostname.endsWith("github.io")) {
    return DEFAULT_LOCAL_BACKEND_URL;
  }

  return "";
}

function apiUrl(path) {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
}

function setStatus(element, text, state = "neutral") {
  element.textContent = text;
  element.className = `statusPill ${state}`;
}

function setProcessing(active) {
  processingCount = Math.max(0, processingCount + (active ? 1 : -1));
  setStatus(elements.processingStatus, processingCount ? "Processing" : "Idle", processingCount ? "warning" : "neutral");
}

function hasActiveSharedAudio() {
  return Boolean(meetingSharedAudioStream?.getAudioTracks().some((track) => track.readyState === "live"));
}

function hasSharedAudioSession() {
  return Boolean(meetingAudioShared && meetingSharedAudioStream);
}

function updateAudioStatus() {
  const sharedAudioSession = hasSharedAudioSession();
  setStatus(elements.audioSharedStatus, sharedAudioSession ? "Audio Shared" : "Audio Not Shared", sharedAudioSession ? "" : "neutral");
  setStatus(elements.listeningStatus, meetingRecording ? "Recording" : meetingListening ? "Listening" : "Idle", meetingListening || meetingRecording ? "" : "neutral");
  elements.startMeetingAudio.disabled = sharedAudioSession;
  elements.stopMeetingAudio.disabled = !sharedAudioSession;
  elements.startListening.disabled = !sharedAudioSession || meetingListening;
  elements.stopListening.disabled = !meetingListening;
  elements.startRecording.disabled = meetingRecording;
  elements.stopRecording.disabled = !meetingRecording;
  elements.audioLanguage.disabled = meetingListening;
}

function updateDocumentStatus() {
  const loaded = documents.filter((doc) => doc.status === "Loaded");
  const label = loaded.length === 1 ? "1 Document Loaded" : `${loaded.length} Documents Loaded`;
  elements.knowledgeStatus.textContent = loaded.length ? `${loaded.length} loaded` : "0 loaded";
  setStatus(elements.documentsStatus, label, loaded.length ? "" : "neutral");
  updateContextIndicator();
}

function updateContextIndicator() {
  const loadedCount = documents.filter((doc) => doc.status === "Loaded").length;
  if (meetingListening && loadedCount) {
    elements.contextIndicator.textContent = `Meeting + Documents | ${loadedCount} document${loadedCount === 1 ? "" : "s"} loaded`;
  } else if (meetingListening) {
    elements.contextIndicator.textContent = "Meeting Audio Active";
  } else if (loadedCount) {
    elements.contextIndicator.textContent = `${loadedCount} Document${loadedCount === 1 ? "" : "s"} Loaded`;
  } else {
    elements.contextIndicator.textContent = "Idle";
  }
}

function setMeetingAudioStatus(text) {
  elements.meetingAudioStatus.textContent = text;
}

function setMeetingAudioLevel(value) {
  const bounded = Math.max(0, Math.min(value, 1));
  elements.meetingAudioLevel.style.transform = `scaleX(${bounded})`;
}

function showLiveTranscript(text) {
  if (!elements.liveTranscript) {
    return;
  }
  elements.liveTranscript.textContent = text;
}

function renderLiveTranscript() {
  const transcript = displayedMeetingTranscript.slice(-6).join(" ").trim();
  showLiveTranscript(transcript ? `Shared audio: ${transcript}` : "");
}

function clearRecordingPlayback() {
  if (currentRecordingUrl) {
    URL.revokeObjectURL(currentRecordingUrl);
    currentRecordingUrl = "";
  }
  if (elements.recordingPlayback) {
    elements.recordingPlayback.innerHTML = "";
  }
}

function renderRecordingPlayback(blob) {
  if (!elements.recordingPlayback || !blob?.size) {
    return;
  }

  clearRecordingPlayback();
  currentRecordingUrl = URL.createObjectURL(blob);
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  elements.recordingPlayback.innerHTML = `
    <div class="recordingPlaybackHeader">Recorded audio</div>
    <audio controls src="${currentRecordingUrl}"></audio>
    <a href="${currentRecordingUrl}" download="orbynecue-recording.${extension}">Download audio</a>
  `;
}

function escapeHtml(value) {
  return String(value)
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

function compactText(text, maxWords = MAX_LOCAL_ANSWER_WORDS) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:\s]+$/, "")}...`;
}

function isDocumentPoint(line) {
  return new RegExp("^\\s*(?:[-*\\u2022]|\\d+[.)]|[a-zA-Z][.)])\\s+").test(line);
}

function formatDocumentPoints(lines) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (isDocumentPoint(line) ? line : `- ${line}`))
    .join("\n");
}

function isQuestionLine(line) {
  const cleanLine = line.trim();
  return /^q(uestion)?\s*\d*[:.)-]?\s+/i.test(cleanLine)
    || (cleanLine.endsWith("?") && tokenize(cleanLine).length <= 24);
}

function stripAnswerLabel(line) {
  return line.replace(/^(a(nswer)?|response)\s*\d*[:.)-]?\s*/i, "").trim();
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

function getAllChunks() {
  return documents.flatMap((doc) => (doc.chunks || []).map((chunk) => ({ chunk, filename: doc.name })));
}

function getBestChunks(question, count = 4) {
  const questionWords = tokenize(question);
  return getAllChunks()
    .map((entry) => ({ ...entry, score: scoreChunk(questionWords, entry.chunk) }))
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

  const startIndex = isQuestionLine(lines[bestIndex]) ? bestIndex + 1 : bestIndex;
  const collected = [];

  for (const rawLine of lines.slice(startIndex)) {
    if (collected.length && isQuestionLine(rawLine)) {
      break;
    }

    const line = stripAnswerLabel(rawLine);
    if (!line) {
      continue;
    }

    collected.push(line);
    if (collected.join(" ").split(/\s+/).length >= MAX_LOCAL_ANSWER_WORDS) {
      break;
    }
  }

  return compactText(formatDocumentPoints(collected.length ? collected : [lines[bestIndex]]));
}

function localAnswer(question, scoredChunks) {
  const bestMatch = scoredChunks[0];
  if (!bestMatch) {
    return "";
  }

  const section = extractAnswerSection(question, bestMatch.chunk);
  return `1. **Complete Answer**:\n${section}`;
}

function hasDocumentAnswer(matches) {
  return matches.length && documents.some((doc) => doc.status === "Loaded" && (doc.chunks || []).length);
}

function formatAnswer(answer) {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  const firstNumberedIndex = lines.findIndex((line) => /^\d+\.\s+/.test(line));
  if (firstNumberedIndex === -1) {
    return `<p>${escapeHtml(answer)}</p>`;
  }

  const items = [lines
    .slice(firstNumberedIndex)
    .map((line, index) => (index === 0 ? line.replace(/^\d+\.\s+/, "") : line))];

  return `<ol>${items
    .map((itemLines) => `<li>${itemLines
      .map((line) => escapeHtml(line).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"))
      .join("<br>")}</li>`)
    .join("")}</ol>`;
}

function saveMessages() {
  localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages.slice(-50)));
}

function saveDocuments() {
  localStorage.setItem(STORAGE_KEYS.documents, JSON.stringify(documents));
}

function saveMeetingContext() {
  localStorage.setItem(STORAGE_KEYS.meetingContext, JSON.stringify(meetingTranscript.slice(-20)));
}

function normalizedTranscriptKey(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function removeAnsweredMeetingSegments(segments) {
  const segmentCounts = new Map();
  for (const segment of segments) {
    const key = normalizedTranscriptKey(segment);
    if (key) {
      segmentCounts.set(key, (segmentCounts.get(key) || 0) + 1);
    }
  }

  if (!segmentCounts.size) {
    return;
  }

  meetingTranscript = meetingTranscript.filter((segment) => {
    const key = normalizedTranscriptKey(segment);
    const remaining = segmentCounts.get(key) || 0;
    if (!remaining) {
      return true;
    }
    if (remaining === 1) {
      segmentCounts.delete(key);
    } else {
      segmentCounts.set(key, remaining - 1);
    }
    return false;
  });
  saveMeetingContext();
}

function clearStoredSessionData() {
  localStorage.removeItem(STORAGE_KEYS.messages);
  localStorage.removeItem(STORAGE_KEYS.history);
  localStorage.removeItem(STORAGE_KEYS.meetingContext);
  localStorage.removeItem(STORAGE_KEYS.documents);
  localStorage.removeItem("orbynecue.knowledge");
}

function addHistory(question, source) {
  history = [{ question, source, at: new Date().toLocaleTimeString() }, ...history].slice(0, 20);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
  renderHistory();
}

function contextLabel() {
  const loadedCount = documents.filter((doc) => doc.status === "Loaded").length;
  if (meetingListening && loadedCount) {
    return `Meeting + Documents | ${loadedCount} doc${loadedCount === 1 ? "" : "s"}`;
  }
  if (meetingListening) {
    return "Meeting Audio Active";
  }
  if (loadedCount) {
    return `${loadedCount} Document${loadedCount === 1 ? "" : "s"} Loaded`;
  }
  return "No context loaded";
}

function addMessage(role, content, meta = contextLabel()) {
  const message = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    meta
  };
  messages.push(message);
  saveMessages();
  renderMessages();
  return message.id;
}

function startCurrentQuestion(question, meta = contextLabel()) {
  messages = [];
  saveMessages();
  addMessage("user", question, meta);
  const assistantMessageId = addMessage("assistant", "Thinking...", "Processing");
  return { assistantMessageId };
}

function startCurrentAnswer(content, meta = contextLabel()) {
  messages = [];
  saveMessages();
  return addMessage("assistant", content, meta);
}

function updateMessage(id, content, meta) {
  messages = messages.map((message) => (message.id === id ? { ...message, content, meta: meta || message.meta } : message));
  saveMessages();
  renderMessages();
}

function renderMessages() {
  if (!messages.length) {
    elements.chatMessages.innerHTML = "";
    return;
  }

  elements.chatMessages.innerHTML = messages
    .map((message) => `<article class="message ${message.role}">
      <div class="messageMeta">${escapeHtml(message.meta || "")}</div>
      <div class="bubble">${message.role === "assistant" ? formatAnswer(message.content) : escapeHtml(message.content)}</div>
    </article>`)
    .join("");
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function renderHistory() {
  if (!history.length) {
    elements.historyList.textContent = "No conversations yet.";
    return;
  }

  elements.historyList.innerHTML = history
    .map((item) => `<button type="button" class="historyItem" data-question="${escapeHtml(item.question)}">
      <strong>${escapeHtml(item.question)}</strong>
      <span>${escapeHtml(item.source)} | ${escapeHtml(item.at)}</span>
    </button>`)
    .join("");
}

function renderDocuments() {
  if (!documents.length) {
    elements.documentList.textContent = "No documents uploaded.";
    updateDocumentStatus();
    return;
  }

  elements.documentList.innerHTML = documents
    .map((doc) => `<div class="documentItem" data-id="${escapeHtml(doc.id)}">
      <div>
        <div class="documentName">File: ${escapeHtml(doc.name)}</div>
        <div class="documentMeta">${escapeHtml(doc.status)}${doc.chunkCount ? ` | ${doc.chunkCount} chunks` : ""}</div>
      </div>
      <button type="button" class="removeDocument" aria-label="Remove ${escapeHtml(doc.name)}">Remove</button>
    </div>`)
    .join("");
  updateDocumentStatus();
}

async function callAi(question) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(apiUrl("/answer"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Answer request timed out. Check that Ollama is running or configure Gemini.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

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

function buildContextualQuestion(question, matches) {
  const contextParts = [];
  const recentMeeting = meetingTranscript.slice(-6).join(" ");
  if (recentMeeting) {
    contextParts.push(`Meeting audio context:\n${compactText(recentMeeting, MAX_CONTEXT_WORDS)}`);
  }

  if (matches.length) {
    const documentContext = matches
      .map((match) => `${match.filename}: ${compactText(match.chunk, 120)}`)
      .join("\n\n");
    contextParts.push(`Uploaded document context:\n${documentContext}`);
  }

  if (!contextParts.length) {
    return question;
  }

  return `${contextParts.join("\n\n")}\n\nUser question:\n${question}\n\nWhen uploaded document context is relevant, return only one answer from the best matching document section and keep it point-wise as written in the document. Otherwise answer using the meeting audio context.`;
}

async function answerQuestion(question, options = {}) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  const assistantMessageId = options.silentUserMessage
    ? startCurrentAnswer("Thinking...", options.meta || "Processing")
    : startCurrentQuestion(trimmed, contextLabel()).assistantMessageId;
  setProcessing(true);

  const matches = getBestChunks(trimmed);
  const confidence = matches.length ? Math.round(matches[0].score * 10000) / 100 : 0;

  try {
    if (matches.length && confidence > DOCUMENT_MATCH_THRESHOLD) {
      const answer = localAnswer(trimmed, matches);
      updateMessage(assistantMessageId, answer, options.meta || `Documents | Match: ${confidence}%`);
      if (!options.silentUserMessage) {
        addHistory(trimmed, `Document match ${confidence}%`);
      }
      return;
    }

    const result = await callAi(buildContextualQuestion(trimmed, matches));
    updateMessage(assistantMessageId, result.answer, options.meta || contextLabel());
    addHistory(options.historyQuestion || trimmed, result.model);
  } catch (error) {
    if (hasDocumentAnswer(matches)) {
      const answer = localAnswer(trimmed, matches);
      updateMessage(assistantMessageId, answer, options.meta || `Documents | Match: ${confidence}%`);
      addHistory(options.historyQuestion || trimmed, `Document fallback ${confidence}%`);
      return;
    }

    updateMessage(assistantMessageId, `Error: ${error.message}`, "Error");
    addHistory(trimmed, "Error");
  } finally {
    setProcessing(false);
  }
}

async function uploadDocument(file) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pendingDocument = { id, name: file.name, status: "Uploading", chunkCount: 0, chunks: [] };
  documents = [pendingDocument, ...documents];
  saveDocuments();
  renderDocuments();
  setProcessing(true);

  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(apiUrl("/knowledge"), {
      method: "POST",
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || `File upload failed with ${response.status}`);
    }

    documents = documents.map((doc) => doc.id === id
      ? {
          ...doc,
          name: payload.filename || file.name,
          status: "Loaded",
          chunkCount: payload.chunkCount || 0,
          chunks: payload.chunks || []
        }
      : doc);
  } catch (error) {
    documents = documents.map((doc) => doc.id === id
      ? { ...doc, status: `Failed: ${error.message}`, chunkCount: 0, chunks: [] }
      : doc);
  } finally {
    saveDocuments();
    renderDocuments();
    setProcessing(false);
  }
}

async function uploadDocuments(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    await uploadDocument(file);
  }
  elements.knowledgeFile.value = "";
  elements.composerFile.value = "";
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
  return mimeType.includes("mp4") ? "meeting-audio.mp4" : "meeting-audio.webm";
}

function getSelectedAudioLanguage() {
  return elements.audioLanguage?.value || "auto";
}

function compactTranscriptForAnalysis(text, maxCharacters = 14000) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (cleanText.length <= maxCharacters) {
    return cleanText;
  }
  return cleanText.slice(-maxCharacters).replace(/^\S+\s*/, "").trim();
}

function shouldAnswerMeetingTranscript(text) {
  const cleanText = text.trim();
  const words = tokenize(cleanText);
  const questionLike = /\b(what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|was|were|will|shall|tell|explain)\b/i.test(cleanText);
  return cleanText.endsWith("?") || questionLike || words.length >= MIN_MEETING_AUTO_ANSWER_WORDS;
}

function cancelScheduledMeetingAnswer() {
  if (pendingMeetingAnswerTimer) {
    window.clearTimeout(pendingMeetingAnswerTimer);
    pendingMeetingAnswerTimer = null;
  }
}

async function answerPendingMeetingTranscript() {
  pendingMeetingAnswerTimer = null;
  const answeredSegments = pendingMeetingAnswerSegments;
  const cleanTranscript = pendingMeetingAnswerText.replace(/\s+/g, " ").trim();
  pendingMeetingAnswerSegments = [];
  pendingMeetingAnswerText = "";

  if (!shouldAnswerMeetingTranscript(cleanTranscript)) {
    return;
  }

  const now = Date.now();
  const normalized = cleanTranscript.toLowerCase();
  if (normalized === lastMeetingAnswerText) {
    return;
  }
  if (now - lastMeetingAnswerAt < MEETING_AUTO_ANSWER_COOLDOWN_MS) {
    return;
  }

  lastMeetingAnswerAt = now;
  lastMeetingAnswerText = normalized;
  await answerQuestion(cleanTranscript);
  removeAnsweredMeetingSegments(answeredSegments);
  renderLiveTranscript();
}

function scheduleMeetingTranscriptAnswer(transcript) {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) {
    return;
  }

  pendingMeetingAnswerText = `${pendingMeetingAnswerText} ${cleanTranscript}`.trim();
  pendingMeetingAnswerSegments.push(cleanTranscript);
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerTimer = window.setTimeout(() => {
    answerPendingMeetingTranscript();
  }, MEETING_QUESTION_SETTLE_MS);
}

async function sendMeetingAudioChunk(blob) {
  if (!blob.size) {
    return;
  }

  setProcessing(true);
  try {
    const formData = new FormData();
    formData.append("file", blob, getAudioFileName(blob.type || ""));
    formData.append("language", getSelectedAudioLanguage());
    const response = await fetch(apiUrl("/transcribe-audio"), {
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
      if (!meetingRecording) {
        displayedMeetingTranscript.push(transcript);
        displayedMeetingTranscript = displayedMeetingTranscript.slice(-20);
        renderLiveTranscript();
      }
      meetingTranscript.push(transcript);
      meetingTranscript = meetingTranscript.slice(-20);
      saveMeetingContext();
      if (!meetingRecording) {
        scheduleMeetingTranscriptAnswer(transcript);
      }
    }
  } catch (error) {
    if (error.status === 429) {
      setMeetingAudioStatus(meetingListening ? "Listening... transcription paused" : "Audio shared");
    } else {
      startCurrentAnswer(`Meeting audio error: ${error.message}`, "Error");
    }
  } finally {
    setProcessing(false);
  }
}

function startMeetingAudioMeter(stream) {
  stopMeetingAudioMeter();
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  meetingAudioContext = new AudioContextConstructor();
  const source = meetingAudioContext.createMediaStreamSource(stream);
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
      setMeetingAudioStatus(meetingListening ? "Listening..." : "Audio shared");
    } else {
      silentTicks += 1;
      if (silentTicks >= 8) {
        setMeetingAudioStatus(meetingListening ? "Listening... no audio detected" : "Shared, no audio detected");
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

function recordNextMeetingAudioSegment() {
  if (!meetingListening || !hasSharedAudioSession()) {
    return;
  }

  const recorderGeneration = meetingRecorderGeneration;
  if (!hasActiveSharedAudio()) {
    setMeetingAudioStatus("Audio shared, waiting for audio");
    window.setTimeout(() => {
      if (meetingListening && recorderGeneration === meetingRecorderGeneration) {
        recordNextMeetingAudioSegment();
      }
    }, 1000);
    return;
  }

  const mimeType = getSupportedAudioMimeType();
  let recorder;

  try {
    recorder = new MediaRecorder(meetingSharedAudioStream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    setMeetingAudioStatus("Audio shared, recorder paused");
    window.setTimeout(() => {
      if (meetingListening && recorderGeneration === meetingRecorderGeneration) {
        recordNextMeetingAudioSegment();
      }
    }, 1000);
    return;
  }

  meetingAudioRecorder = recorder;
  discardMeetingAudioChunks = false;

  recorder.addEventListener("dataavailable", (event) => {
    if (discardMeetingAudioChunks || !event.data?.size) {
      return;
    }

    const upload = sendMeetingAudioChunk(event.data);
    pendingTranscriptions.add(upload);
    upload.finally(() => pendingTranscriptions.delete(upload));
  });

  recorder.addEventListener("stop", () => {
    if (meetingAudioRecorder === recorder) {
      meetingAudioRecorder = null;
    }

    if (meetingListening && recorderGeneration === meetingRecorderGeneration) {
      setMeetingAudioStatus("Audio recorder restarted");
      window.setTimeout(recordNextMeetingAudioSegment, 1000);
    }
  });

  recorder.start(MEETING_AUDIO_SEGMENT_MS);
}

async function shareMeetingAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Meeting audio sharing needs Chrome or Edge screen/tab sharing.");
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
    throw new Error("No shared audio found. Choose a tab or screen with audio sharing enabled.");
  }

  meetingSharedAudioStream = new MediaStream(audioTracks);

  meetingAudioShared = true;
  startMeetingAudioMeter(meetingSharedAudioStream);
  setMeetingAudioStatus("Audio shared");
  updateAudioStatus();
  updateContextIndicator();
}

async function startRecordingSession() {
  if (!window.MediaRecorder) {
    throw new Error("This browser does not support MediaRecorder audio capture.");
  }
  if (meetingRecording) {
    return;
  }
  meetingMicStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true
    }
  });

  const mimeType = getSupportedAudioMimeType();
  micRecordingParts = [];
  micRecorder = new MediaRecorder(meetingMicStream, mimeType ? { mimeType } : undefined);
  micRecorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) {
      micRecordingParts.push(event.data);
    }
  });
  micRecorder.start();
  meetingRecording = true;
  clearRecordingPlayback();
  setMeetingAudioStatus(meetingListening ? "Listening... microphone recording" : "Microphone recording");
  updateAudioStatus();
  updateContextIndicator();
}

function startListeningSession() {
  if (!hasSharedAudioSession()) {
    setMeetingAudioStatus("Share meeting audio first");
    updateAudioStatus();
    return;
  }
  if (!hasActiveSharedAudio()) {
    setMeetingAudioStatus("Audio shared, waiting for audio");
  }
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerSegments = [];
  pendingMeetingAnswerText = "";
  meetingListening = true;
  meetingRecorderGeneration += 1;
  if (hasActiveSharedAudio()) {
    setMeetingAudioStatus("Listening...");
  }
  updateAudioStatus();
  updateContextIndicator();
  recordNextMeetingAudioSegment();
}

function stopListeningSession({ keepStatus = false, discardFinalChunk = false } = {}) {
  meetingListening = false;
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerSegments = [];
  pendingMeetingAnswerText = "";
  meetingRecorderGeneration += 1;
  const recorder = meetingAudioRecorder;
  let recorderStopped = Promise.resolve();

  if (recorder && recorder.state !== "inactive") {
    recorderStopped = new Promise((resolve) => {
      recorder.addEventListener("stop", resolve, { once: true });
    });
    discardMeetingAudioChunks = discardFinalChunk;
    recorder.stop();
  }
  if (!keepStatus) {
    setMeetingAudioStatus(hasSharedAudioSession() ? "Audio shared" : "Not shared");
  }
  updateAudioStatus();
  updateContextIndicator();
  return recorderStopped;
}

async function generateMeetingAnalysis() {
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerText = "";

  if (pendingTranscriptions.size) {
    setMeetingAudioStatus("Finishing transcription...");
    await Promise.allSettled(Array.from(pendingTranscriptions));
  }

  const transcript = compactTranscriptForAnalysis(meetingTranscript.join(" "));
  if (!transcript) {
    startCurrentAnswer("I could not detect enough clear speech to analyze this recording.", "Meeting analysis");
    return;
  }

  const prompt = `Analyze this meeting transcript and write a detailed, useful meeting report.

Include these sections:
1. What the meeting was about
2. Key decisions and discussion points
3. What went good
4. What went wrong or needs improvement
5. Action items with owners if they are mentioned
6. Follow-up questions or risks

Be specific, practical, and write a long, polished response. If the transcript contains multiple languages, understand them together and answer in clear English.

Transcript:
${transcript}`;

  await answerQuestion(prompt, {
    silentUserMessage: true,
    meta: "Meeting analysis",
    historyQuestion: "Meeting recording analysis"
  });
}

async function stopRecordingSession() {
  if (!meetingRecording) {
    return;
  }

  meetingRecording = false;
  setMeetingAudioStatus("Stopping microphone...");

  if (micRecorder && micRecorder.state !== "inactive") {
    await new Promise((resolve) => {
      micRecorder.addEventListener("stop", resolve, { once: true });
      micRecorder.stop();
    });
  }
  micRecorder = null;
  if (micRecordingParts.length) {
    const mimeType = micRecordingParts[0]?.type || getSupportedAudioMimeType() || "audio/webm";
    renderRecordingPlayback(new Blob(micRecordingParts, { type: mimeType }));
  }
  micRecordingParts = [];

  if (meetingMicStream) {
    meetingMicStream.getTracks().forEach((track) => track.stop());
    meetingMicStream = null;
  }

  setMeetingAudioStatus(meetingListening ? "Listening..." : meetingAudioShared ? "Audio shared" : "Not shared");
  updateAudioStatus();
  updateContextIndicator();
}

async function stopMeetingAudioSession() {
  const recorderStopped = stopListeningSession({ keepStatus: true, discardFinalChunk: true });
  await recorderStopped;
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerText = "";
  meetingAudioShared = false;

  if (meetingAudioStream) {
    meetingAudioStream.getTracks().forEach((track) => track.stop());
    meetingAudioStream = null;
  }
  meetingSharedAudioStream = null;
  stopMeetingAudioMeter();
  setMeetingAudioStatus(meetingRecording ? "Microphone recording" : "Not shared");
  updateAudioStatus();
  updateContextIndicator();
}

async function checkBackend() {
  try {
    const response = await fetch(apiUrl("/health"));
    const payload = await response.json();
    if (payload.provider === "ollama") {
      setStatus(elements.connectionStatus, `Ollama | ${payload.ollamaModel}`, "neutral");
      return;
    }
    setStatus(elements.connectionStatus, payload.geminiConfigured ? "Gemini ready" : "Set GEMINI_API_KEY", payload.geminiConfigured ? "" : "error");
  } catch (error) {
    setStatus(elements.connectionStatus, window.location.hostname.endsWith("github.io") ? "Start local backend" : "Backend unavailable", "error");
  }
}

function clearChat({ clearDocuments = false } = {}) {
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerText = "";
  messages = [];
  history = [];
  meetingTranscript = [];
  displayedMeetingTranscript = [];
  localStorage.removeItem(STORAGE_KEYS.messages);
  localStorage.removeItem(STORAGE_KEYS.history);
  localStorage.removeItem(STORAGE_KEYS.meetingContext);

  if (clearDocuments) {
    documents = [];
    localStorage.removeItem(STORAGE_KEYS.documents);
    localStorage.removeItem("orbynecue.knowledge");
    elements.knowledgeFile.value = "";
    elements.composerFile.value = "";
    renderDocuments();
  }

  renderMessages();
  renderLiveTranscript();
  clearRecordingPlayback();
  renderHistory();
  updateContextIndicator();
}

function loadState() {
  cancelScheduledMeetingAnswer();
  pendingMeetingAnswerText = "";
  clearStoredSessionData();
  documents = [];
  history = [];
  messages = [];
  meetingTranscript = [];
  displayedMeetingTranscript = [];

  renderDocuments();
  renderHistory();
  renderMessages();
  renderLiveTranscript();
  clearRecordingPlayback();
  updateAudioStatus();
  updateContextIndicator();
}

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = elements.manualQuestion.value;
  elements.manualQuestion.value = "";
  elements.manualQuestion.style.height = "auto";
  answerQuestion(question);
});

elements.manualQuestion.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.chatForm.requestSubmit();
  }
});

elements.manualQuestion.addEventListener("input", () => {
  elements.manualQuestion.style.height = "auto";
  elements.manualQuestion.style.height = `${Math.min(elements.manualQuestion.scrollHeight, 180)}px`;
});

elements.knowledgeFile.addEventListener("change", (event) => {
  uploadDocuments(event.target.files);
});

elements.composerFile.addEventListener("change", (event) => {
  uploadDocuments(event.target.files);
});

elements.documentDropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.documentDropzone.classList.add("dragActive");
});

elements.documentDropzone.addEventListener("dragleave", () => {
  elements.documentDropzone.classList.remove("dragActive");
});

elements.documentDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.documentDropzone.classList.remove("dragActive");
  uploadDocuments(event.dataTransfer.files);
});

elements.documentList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".removeDocument");
  if (!removeButton) {
    return;
  }
  const item = removeButton.closest(".documentItem");
  documents = documents.filter((doc) => doc.id !== item.dataset.id);
  saveDocuments();
  renderDocuments();
});

elements.startMeetingAudio.addEventListener("click", async () => {
  try {
    setProcessing(true);
    await shareMeetingAudio();
  } catch (error) {
    startCurrentAnswer(error.message, "Audio sharing");
    setMeetingAudioStatus("Error");
  } finally {
    setProcessing(false);
  }
});

elements.startListening.addEventListener("click", () => {
  startListeningSession();
});

elements.stopListening.addEventListener("click", () => {
  stopListeningSession({ discardFinalChunk: true });
});

elements.stopMeetingAudio.addEventListener("click", () => {
  stopMeetingAudioSession();
});

elements.startRecording.addEventListener("click", async () => {
  try {
    setProcessing(true);
    await startRecordingSession();
  } catch (error) {
    meetingRecording = false;
    startCurrentAnswer(error.message, "Recording");
    setMeetingAudioStatus("Error");
    updateAudioStatus();
  } finally {
    setProcessing(false);
  }
});

elements.stopRecording.addEventListener("click", async () => {
  try {
    setProcessing(true);
    await stopRecordingSession();
  } finally {
    setProcessing(false);
  }
});

elements.clearHistory.addEventListener("click", () => {
  clearChat();
});

elements.newChat.addEventListener("click", () => {
  clearChat({ clearDocuments: true });
});

elements.settingsButton.addEventListener("click", () => {
  startCurrentAnswer("Settings are managed through backend environment variables for this build.", "Settings");
});

elements.historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".historyItem");
  if (item) {
    elements.manualQuestion.value = item.dataset.question;
    elements.manualQuestion.focus();
  }
});

loadState();
checkBackend();
window.scrollTo(0, 0);
