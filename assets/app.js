const elements = {
  askQuestion: document.querySelector("#askQuestion"),
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
  manualQuestion: document.querySelector("#manualQuestion"),
  meetingAudioLevel: document.querySelector("#meetingAudioLevel"),
  meetingAudioStatus: document.querySelector("#meetingAudioStatus"),
  newChat: document.querySelector("#newChat"),
  processingStatus: document.querySelector("#processingStatus"),
  settingsButton: document.querySelector("#settingsButton"),
  startListening: document.querySelector("#startListening"),
  startMeetingAudio: document.querySelector("#startMeetingAudio"),
  stopMeetingAudio: document.querySelector("#stopMeetingAudio"),
  stopListening: document.querySelector("#stopListening"),
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
const MEETING_AUDIO_SEGMENT_MS = 20000;
const MEETING_AUTO_ANSWER_COOLDOWN_MS = 30000;
const MIN_MEETING_AUTO_ANSWER_WORDS = 4;

let audioOnlyStream = null;
let documents = [];
let history = [];
let lastMeetingAnswerAt = 0;
let lastMeetingAnswerText = "";
let meetingAudioContext = null;
let meetingAudioLevelTimer = null;
let meetingAudioRecorder = null;
let meetingAudioShared = false;
let meetingAudioStream = null;
let meetingAudioUploadActive = false;
let messages = [];
let processingCount = 0;
let meetingListening = false;
let meetingTranscript = [];

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

function updateAudioStatus() {
  setStatus(elements.audioSharedStatus, meetingAudioShared ? "Audio Shared" : "Audio Not Shared", meetingAudioShared ? "" : "neutral");
  setStatus(elements.listeningStatus, meetingListening ? "Listening" : "Idle", meetingListening ? "" : "neutral");
  elements.startMeetingAudio.disabled = meetingAudioShared;
  elements.stopMeetingAudio.disabled = !meetingAudioShared;
  elements.startListening.disabled = !meetingAudioShared || meetingListening;
  elements.stopListening.disabled = !meetingListening;
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
  const bestMatch = scoredChunks[0];
  if (!bestMatch) {
    return "";
  }

  const section = extractAnswerSection(question, bestMatch.chunk);
  const source = bestMatch.filename ? `${bestMatch.filename}: ` : "";
  return `1. **Document Match**: ${source}${section}`;
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

function saveMessages() {
  localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages.slice(-50)));
}

function saveDocuments() {
  localStorage.setItem(STORAGE_KEYS.documents, JSON.stringify(documents));
}

function saveMeetingContext() {
  localStorage.setItem(STORAGE_KEYS.meetingContext, JSON.stringify(meetingTranscript.slice(-20)));
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
  const response = await fetch(apiUrl("/answer"), {
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

  return `${contextParts.join("\n\n")}\n\nUser question:\n${question}\n\nAnswer using the meeting audio context, uploaded document context, or both when relevant.`;
}

async function answerQuestion(question, options = {}) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  if (!options.silentUserMessage) {
    addMessage("user", trimmed, contextLabel());
  }

  const assistantMessageId = addMessage("assistant", "Thinking...", "Processing");
  setProcessing(true);

  const matches = getBestChunks(trimmed);
  const confidence = matches.length ? Math.round(matches[0].score * 10000) / 100 : 0;

  try {
    if (matches.length && confidence > DOCUMENT_MATCH_THRESHOLD && !meetingTranscript.length) {
      const answer = localAnswer(trimmed, matches);
      updateMessage(assistantMessageId, answer, `Documents | Match: ${confidence}%`);
      addHistory(trimmed, `Document match ${confidence}%`);
      return;
    }

    const result = await callAi(buildContextualQuestion(trimmed, matches));
    updateMessage(assistantMessageId, result.answer, contextLabel());
    addHistory(trimmed, result.model);
  } catch (error) {
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

function shouldAnswerMeetingTranscript(text) {
  const cleanText = text.trim();
  const words = tokenize(cleanText);
  return cleanText.endsWith("?") || words.length >= MIN_MEETING_AUTO_ANSWER_WORDS;
}

async function maybeAnswerMeetingTranscript(transcript) {
  const cleanTranscript = transcript.trim();
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
}

async function sendMeetingAudioChunk(blob) {
  if (meetingAudioUploadActive || !blob.size) {
    return;
  }

  meetingAudioUploadActive = true;
  setProcessing(true);
  try {
    const formData = new FormData();
    formData.append("file", blob, getAudioFileName(blob.type || ""));
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
      meetingTranscript.push(transcript);
      meetingTranscript = meetingTranscript.slice(-20);
      saveMeetingContext();
      await maybeAnswerMeetingTranscript(transcript);
    }
  } catch (error) {
    addMessage("assistant", `Meeting audio error: ${error.message}`, "Error");
    if (error.status === 429) {
      stopMeetingAudioSession();
      setMeetingAudioStatus("Quota exhausted");
    }
  } finally {
    meetingAudioUploadActive = false;
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
  if (!meetingListening || !audioOnlyStream) {
    return;
  }

  const mimeType = getSupportedAudioMimeType();
  const segmentParts = [];
  meetingAudioRecorder = new MediaRecorder(audioOnlyStream, mimeType ? { mimeType } : undefined);

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

    if (meetingListening) {
      window.setTimeout(recordNextMeetingAudioSegment, 250);
    }
  });

  meetingAudioRecorder.start();
  window.setTimeout(() => {
    if (meetingAudioRecorder?.state === "recording") {
      meetingAudioRecorder.stop();
    }
  }, MEETING_AUDIO_SEGMENT_MS);
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

  audioOnlyStream = new MediaStream(audioTracks);
  for (const track of meetingAudioStream.getTracks()) {
    track.addEventListener("ended", stopMeetingAudioSession);
  }

  meetingAudioShared = true;
  startMeetingAudioMeter(audioOnlyStream);
  setMeetingAudioStatus("Audio shared");
  updateAudioStatus();
  updateContextIndicator();
}

function startListeningSession() {
  if (!audioOnlyStream) {
    setMeetingAudioStatus("Share meeting audio first");
    return;
  }
  meetingListening = true;
  setMeetingAudioStatus("Listening...");
  updateAudioStatus();
  updateContextIndicator();
  recordNextMeetingAudioSegment();
}

function stopListeningSession() {
  meetingListening = false;

  if (meetingAudioRecorder && meetingAudioRecorder.state !== "inactive") {
    meetingAudioRecorder.stop();
  }
  setMeetingAudioStatus(meetingAudioShared ? "Audio shared" : "Not shared");
  updateAudioStatus();
  updateContextIndicator();
}

function stopMeetingAudioSession() {
  stopListeningSession();
  meetingAudioShared = false;

  if (meetingAudioStream) {
    meetingAudioStream.getTracks().forEach((track) => track.stop());
    meetingAudioStream = null;
  }
  audioOnlyStream = null;
  stopMeetingAudioMeter();
  setMeetingAudioStatus("Not shared");
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

function clearChat() {
  messages = [];
  history = [];
  meetingTranscript = [];
  localStorage.removeItem(STORAGE_KEYS.messages);
  localStorage.removeItem(STORAGE_KEYS.history);
  localStorage.removeItem(STORAGE_KEYS.meetingContext);
  renderMessages();
  renderHistory();
  updateContextIndicator();
}

function loadState() {
  documents = JSON.parse(localStorage.getItem(STORAGE_KEYS.documents) || "[]");
  history = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");
  messages = JSON.parse(localStorage.getItem(STORAGE_KEYS.messages) || "[]");
  meetingTranscript = JSON.parse(localStorage.getItem(STORAGE_KEYS.meetingContext) || "[]");

  const legacyKnowledge = JSON.parse(localStorage.getItem("orbynecue.knowledge") || "[]");
  if (!documents.length && Array.isArray(legacyKnowledge) && legacyKnowledge.length) {
    documents = [{
      id: "legacy-knowledge",
      name: "Uploaded Knowledge",
      status: "Loaded",
      chunkCount: legacyKnowledge.length,
      chunks: legacyKnowledge
    }];
    saveDocuments();
  }

  renderDocuments();
  renderHistory();
  renderMessages();
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
    addMessage("assistant", error.message, "Audio sharing");
    setMeetingAudioStatus("Error");
  } finally {
    setProcessing(false);
  }
});

elements.startListening.addEventListener("click", () => {
  startListeningSession();
});

elements.stopListening.addEventListener("click", () => {
  stopListeningSession();
});

elements.stopMeetingAudio.addEventListener("click", () => {
  stopMeetingAudioSession();
});

elements.clearHistory.addEventListener("click", () => {
  clearChat();
});

elements.newChat.addEventListener("click", () => {
  clearChat();
});

elements.settingsButton.addEventListener("click", () => {
  addMessage("assistant", "Settings are managed through backend environment variables for this build.", "Settings");
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
