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
  homeButton: document.querySelector("#homeButton"),
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
  listeningStatus: document.querySelector("#listeningStatus"),
  trialTimer: document.querySelector("#trialTimer")
};

const STORAGE_KEYS = {
  apiBaseUrl: "orbynecue.apiBaseUrl",
  demoAuthenticated: "orbynecue.demoAuthenticated",
  documents: "orbynecue.documents",
  history: "orbynecue.history",
  messages: "orbynecue.messages",
  meetingContext: "orbynecue.meetingContext"
};

const DEMO_CREDENTIALS = {
  email: "demo@orbynecue.com",
  password: "Demo@123"
};

const PUBLIC_BACKEND_URL = window.ORBYNE_PUBLIC_BACKEND_URL || "";
const DOCUMENT_MATCH_THRESHOLD = 40;
const BEHAVIORAL_DOCUMENT_MATCH_THRESHOLD = 70;
const MAX_LOCAL_ANSWER_WORDS = 180;
const MEETING_AUDIO_SEGMENT_MS = 2000;
const MEETING_AUDIO_FIRST_CHUNK_MS = 2000;
const MEETING_AUDIO_OVERLAP_MS = 500;
const MEETING_AUDIO_TARGET_SAMPLE_RATE = 16000;
const MEETING_AUDIO_PROCESSOR_SIZE = 2048;
const MEETING_AUDIO_RMS_THRESHOLD = 0.0008;
const MEETING_MIN_SPEECH_SECONDS_PER_CHUNK = 0.005;
const MIN_MEETING_AUTO_ANSWER_WORDS = 3;
const MIN_BEHAVIORAL_PROMPT_WORDS = 10;
const MEETING_QUESTION_BUFFER_MAX_CHARS = 900;
const MEETING_QUESTION_QUEUE_LIMIT = 20;
const MEETING_QUESTION_SIGNAL_WORDS = "what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|was|were|will|shall|have|has|had|am|tell|explain|describe|summarize|compare|show|give|find|list|calculate|analyze|answer|define|name|discuss|walk";
const RECENT_TRANSCRIPT_CACHE_LIMIT = 128;
const TRIAL_DURATION_MS = 60 * 60 * 1000;
const MAX_CONSECUTIVE_SILENT_UPLOADS = 2;
const INSUFFICIENT_DOCUMENT_ANSWER = "No relevant information found in the uploaded documents.";
const PERF_TARGETS_MS = {
  vadMs: 100,
  speechToTextMs: 1500,
  documentRetrievalMs: 200,
  llmGenerationMs: 1500,
  totalSinceQuestionEndMs: 4000
};

let documents = [];
let documentSearchIndex = [];
let documentSearchIndexDirty = true;
let history = [];
let lastMeetingAnswerText = "";
let meetingAudioContext = null;
let meetingAudioLevelTimer = null;
let meetingAudioSourceNode = null;
let meetingAudioProcessorNode = null;
let meetingAudioMutedOutputNode = null;
let meetingAudioChunkBuffers = [];
let meetingAudioChunkSamples = 0;
let meetingAudioChunkNumber = 0;
let meetingAudioSessionId = "";
let meetingAudioChunkProcessing = false;
let meetingAudioSpeechSamplesSinceLastChunk = 0;
let meetingAudioShared = false;
let meetingSharedAudioStream = null;
let meetingAudioActiveRecently = false;
let meetingAudioPeakSinceLastChunk = 0;
let meetingAudioDebugLog = [];
let meetingSilentChunkCount = 0;
let meetingAudioHadSpeechSinceLastFinal = false;
let meetingLastChunkAt = 0;
let meetingProcessorWatchdogTimer = null;
let meetingCurrentInputStream = null;
let meetingCurrentInputMode = "shared";
let meetingAudioStream = null;
let meetingMicStream = null;
let micRecorder = null;
let micRecordingParts = [];
let pendingTranscriptions = new Set();
let transcriptionPausedUntil = 0;
let messages = [];
let processingCount = 0;
let meetingListening = false;
let meetingRecording = false;
let meetingRecorderGeneration = 0;
let meetingTranscript = [];
let displayedMeetingTranscript = [];
let meetingQuestionQueue = [];
let meetingAnswerInProgress = false;
let meetingQuestionQueueTimer = null;
let meetingQuestionTranscriptBuffer = "";
let meetingLivePartialTranscript = "";
let currentRecordingUrl = "";
let recentTranscriptHashes = [];
let recentDisplayedTranscriptHashes = [];

function getApiBaseUrl() {
  const configured = localStorage.getItem(STORAGE_KEYS.apiBaseUrl) || window.ORBYNE_API_BASE_URL || PUBLIC_BACKEND_URL || "";
  if (configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }

  return "";
}

function apiUrl(path) {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
}

function isStaticPublicSite() {
  return window.location.hostname.endsWith("github.io");
}

function hasBackendTarget() {
  return Boolean(getApiBaseUrl() || !isStaticPublicSite());
}

function requireBackendTarget(action) {
  if (hasBackendTarget()) {
    return true;
  }
  throw new Error(`${action} needs a backend URL. Open Settings and enter your deployed backend URL.`);
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
  if (elements.audioLanguage) {
    elements.audioLanguage.disabled = meetingListening;
  }
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
  const segments = displayedMeetingTranscript.slice(-6);
  if (meetingLivePartialTranscript) {
    segments.push(meetingLivePartialTranscript);
  }
  const transcript = segments.join(" ").trim();
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

function cleanTranscript(text) {
  let cleanText = String(text || "");
  cleanText = cleanText.replace(/\[[^\]]+\]|\([^\)]+\)/g, " ");
  cleanText = cleanText.replace(/\b(?:um+|uh+|ah+|erm|hmm|you know|like|okay|right)\b/gi, " ");
  cleanText = cleanText.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
  cleanText = cleanText.replace(/\b(\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");
  cleanText = cleanText.replace(/\b(\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, "$1");
  cleanText = cleanText.replace(/\b(\w+)\s+(?:a|an|the)\s+\1\b/gi, "$1");
  cleanText = cleanText.replace(/\bwhen\s+time\s+when\s+you\b/gi, "when you");
  cleanText = cleanText.replace(/\s+\btell me about it\s*$/i, "");
  cleanText = cleanText.replace(/\s+/g, " ").replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "");
  if (text.trim().endsWith("?") && !cleanText.endsWith("?")) {
    cleanText += "?";
  }
  return cleanText;
}

function transcriptHash(text) {
  let hash = 5381;
  const normalized = normalizedTranscriptKey(text);
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(index);
  }
  return String(hash >>> 0);
}

function hasRecentlyProcessedTranscript(text) {
  const hash = transcriptHash(text);
  if (recentTranscriptHashes.includes(hash)) {
    recentTranscriptHashes = recentTranscriptHashes.filter((item) => item !== hash);
    recentTranscriptHashes.push(hash);
    return true;
  }
  recentTranscriptHashes.push(hash);
  recentTranscriptHashes = recentTranscriptHashes.slice(-RECENT_TRANSCRIPT_CACHE_LIMIT);
  return false;
}

function hasRecentlyDisplayedTranscript(text) {
  const hash = transcriptHash(text);
  if (recentDisplayedTranscriptHashes.includes(hash)) {
    recentDisplayedTranscriptHashes = recentDisplayedTranscriptHashes.filter((item) => item !== hash);
    recentDisplayedTranscriptHashes.push(hash);
    return true;
  }
  recentDisplayedTranscriptHashes.push(hash);
  recentDisplayedTranscriptHashes = recentDisplayedTranscriptHashes.slice(-RECENT_TRANSCRIPT_CACHE_LIMIT);
  return false;
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

function scoreIndexedChunk(questionWords, chunkWords) {
  let hits = 0;
  for (const word of questionWords) {
    if (chunkWords.has(word)) {
      hits += 1;
    }
  }
  return hits / Math.max(questionWords.length, 1);
}

function normalizeChunkEntry(chunk, doc) {
  if (typeof chunk === "string") {
    return { chunk, filename: doc.name, page: null };
  }
  return {
    chunk: chunk.text || "",
    filename: chunk.filename || doc.name,
    page: chunk.page ?? null
  };
}

function getAllChunks() {
  if (!documentSearchIndexDirty) {
    return documentSearchIndex;
  }
  documentSearchIndex = documents
    .filter((doc) => doc.status === "Loaded")
    .flatMap((doc) => (doc.chunks || []).map((chunk) => {
      const entry = normalizeChunkEntry(chunk, doc);
      return {
        ...entry,
        tokenSet: new Set(tokenize(entry.chunk))
      };
    }));
  documentSearchIndexDirty = false;
  return documentSearchIndex;
}

function getBestChunks(question, count = 4) {
  const questionWords = tokenize(question);
  return getAllChunks()
    .map((entry) => ({ ...entry, score: scoreIndexedChunk(questionWords, entry.tokenSet) }))
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
  return section ? `1. **Complete Answer**:\n${section}` : INSUFFICIENT_DOCUMENT_ANSWER;
}

function hasDocumentAnswer(matches) {
  return matches.length && documents.some((doc) => doc.status === "Loaded" && (doc.chunks || []).length);
}

function documentMatchThresholdForQuestion(question) {
  return isBehavioralPrompt(question) ? BEHAVIORAL_DOCUMENT_MATCH_THRESHOLD : DOCUMENT_MATCH_THRESHOLD;
}

async function answerFromAi(question) {
  const response = await fetch(apiUrl("/answer"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `AI answer failed with ${response.status}`);
  }
  return {
    answer: payload.answer || "",
    model: payload.model || "AI"
  };
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
  documentSearchIndexDirty = true;
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

function appendMeetingQuestion(question, meta = contextLabel()) {
  addMessage("user", question, meta);
  const assistantMessageId = addMessage("assistant", "Generating answer...", "Processing");
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

async function answerQuestion(question, options = {}) {
  const answerStartedAt = performance.now();
  const pipelineTimings = options.pipelineTimings || {};
  const trimmed = cleanTranscript(question);
  if (!trimmed) {
    return;
  }
  if (options.fromMeetingAudio && !options.skipDuplicateCheck && hasRecentlyProcessedTranscript(trimmed)) {
    return;
  }
  if (options.fromMeetingAudio && !options.validatedMeetingQuestion && !shouldAnswerMeetingTranscript(trimmed)) {
    return;
  }

  const assistantMessageId = options.silentUserMessage
    ? startCurrentAnswer("Thinking...", options.meta || "Processing")
    : options.fromMeetingAudio
      ? appendMeetingQuestion(trimmed, contextLabel()).assistantMessageId
      : startCurrentQuestion(trimmed, contextLabel()).assistantMessageId;
  setProcessing(true);

  const retrievalStartedAt = performance.now();
  if (options.fromMeetingAudio) {
    setMeetingAudioStatus("Searching documents...");
  }
  const matches = getBestChunks(trimmed);
  const retrievalMs = performance.now() - retrievalStartedAt;
  const confidence = matches.length ? Math.round(matches[0].score * 10000) / 100 : 0;
  const documentMatchThreshold = documentMatchThresholdForQuestion(trimmed);
  if (options.fromMeetingAudio) {
    logAudioStage({
      stage: "retrieval",
      chunkNumber: options.chunkNumber || 0,
      transcript: trimmed,
      retrievalScore: confidence,
      retrievalThreshold: documentMatchThreshold,
      questionDetected: true,
      retrievalMs: Math.round(retrievalMs),
      topK: matches.length
    });
  }

  try {
    if (matches.length && confidence >= documentMatchThreshold) {
      const answer = localAnswer(trimmed, matches);
      if (answer !== INSUFFICIENT_DOCUMENT_ANSWER) {
        const bestMatch = matches[0];
        const pageLabel = bestMatch.page ? ` | Page: ${bestMatch.page}` : "";
        const transcriptConfidenceLabel = options.transcriptConfidence != null ? ` | Confidence: ${options.transcriptConfidence}%` : "";
        updateMessage(assistantMessageId, answer, options.meta || `Source: Document | Similarity: ${confidence}%${transcriptConfidenceLabel} | ${bestMatch.filename}${pageLabel}`);
        if (options.fromMeetingAudio) {
          setMeetingAudioStatus(`Document match: ${confidence}%`);
          logPerformance("audio-to-answer", {
            chunk: options.chunkNumber || 0,
            audioCaptureMs: pipelineTimings.captureMs,
            vadMs: pipelineTimings.vadMs,
            languageDetectionMs: pipelineTimings.languageDetectionMs,
            speechToTextMs: pipelineTimings.speechToTextMs || pipelineTimings.transcriptionLatencyMs,
            documentRetrievalMs: retrievalMs,
            llmGenerationMs: 0,
            totalSinceQuestionEndMs: performance.now() - (pipelineTimings.questionEndedAt || answerStartedAt)
          });
          logAudioStage({
            stage: "answer",
            chunkNumber: options.chunkNumber || 0,
            retrievalScore: confidence,
            answerSource: "Document",
            document: bestMatch.filename,
            page: bestMatch.page || null,
            retrievalMs: Math.round(retrievalMs),
            totalMs: Math.round(performance.now() - (pipelineTimings.questionEndedAt || answerStartedAt))
          });
        }
        if (!options.silentUserMessage) {
          addHistory(trimmed, `Document ${confidence}%`);
        }
        return;
      }
    }

    const aiStartedAt = performance.now();
    if (options.fromMeetingAudio) {
      setMeetingAudioStatus("No document match. Asking AI...");
    }
    try {
      const aiResult = await answerFromAi(trimmed);
      updateMessage(assistantMessageId, aiResult.answer, options.meta || `Source: AI | Document similarity: ${confidence}% | Model: ${aiResult.model}`);
      if (options.fromMeetingAudio) {
        setMeetingAudioStatus("AI answer ready");
      }
      addHistory(options.historyQuestion || trimmed, "AI");
      if (options.fromMeetingAudio) {
        const llmMs = performance.now() - aiStartedAt;
        logPerformance("audio-to-answer", {
          chunk: options.chunkNumber || 0,
          audioCaptureMs: pipelineTimings.captureMs,
          vadMs: pipelineTimings.vadMs,
          languageDetectionMs: pipelineTimings.languageDetectionMs,
          speechToTextMs: pipelineTimings.speechToTextMs || pipelineTimings.transcriptionLatencyMs,
          documentRetrievalMs: retrievalMs,
          llmGenerationMs: llmMs,
          totalSinceQuestionEndMs: performance.now() - (pipelineTimings.questionEndedAt || answerStartedAt)
        });
        logAudioStage({
          stage: "answer",
          chunkNumber: options.chunkNumber || 0,
          retrievalScore: confidence,
          answerSource: "AI",
          reason: "no_relevant_document_match",
          retrievalMs: Math.round(retrievalMs),
          llmMs: Math.round(llmMs),
          totalMs: Math.round(performance.now() - (pipelineTimings.questionEndedAt || answerStartedAt))
        });
      }
      return;
    } catch (aiError) {
      updateMessage(assistantMessageId, `${INSUFFICIENT_DOCUMENT_ANSWER}\n\nAI fallback error: ${aiError.message}`, "AI unavailable");
      if (options.fromMeetingAudio) {
        setMeetingAudioStatus("AI fallback unavailable");
      }
      addHistory(options.historyQuestion || trimmed, "AI unavailable");
      return;
    }

    if (options.fromMeetingAudio) {
      logPerformance("audio-to-answer", {
        chunk: options.chunkNumber || 0,
        audioCaptureMs: pipelineTimings.captureMs,
        vadMs: pipelineTimings.vadMs,
        languageDetectionMs: pipelineTimings.languageDetectionMs,
        speechToTextMs: pipelineTimings.speechToTextMs || pipelineTimings.transcriptionLatencyMs,
        documentRetrievalMs: retrievalMs,
        llmGenerationMs: 0,
        totalSinceQuestionEndMs: performance.now() - (pipelineTimings.questionEndedAt || answerStartedAt)
      });
      logAudioStage({
        stage: "answer",
        chunkNumber: options.chunkNumber || 0,
        retrievalScore: confidence,
        answerSource: "Documents",
        reason: "no_relevant_document_match",
        retrievalMs: Math.round(retrievalMs),
        llmMs: 0,
        totalMs: Math.round(performance.now() - (pipelineTimings.questionEndedAt || answerStartedAt))
      });
      addHistory(options.historyQuestion || trimmed, "Documents");
      return;
    }

    updateMessage(assistantMessageId, INSUFFICIENT_DOCUMENT_ANSWER, options.meta || `Source: Documents | Similarity: ${confidence}%`);
    addHistory(options.historyQuestion || trimmed, "Documents");
  } catch (error) {
    if (matches.length && confidence >= documentMatchThreshold && hasDocumentAnswer(matches)) {
      const answer = localAnswer(trimmed, matches);
      if (answer !== INSUFFICIENT_DOCUMENT_ANSWER) {
        const bestMatch = matches[0];
        const pageLabel = bestMatch.page ? ` | Page: ${bestMatch.page}` : "";
        updateMessage(assistantMessageId, answer, options.meta || `Source: Document | Similarity: ${confidence}% | ${bestMatch.filename}${pageLabel}`);
        addHistory(options.historyQuestion || trimmed, `Document ${confidence}%`);
        return;
      }
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
    requireBackendTarget("Document upload");
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
  if (mimeType.includes("wav")) {
    return "meeting-audio.wav";
  }
  return mimeType.includes("mp4") ? "meeting-audio.mp4" : "meeting-audio.webm";
}

function getSelectedAudioLanguage() {
  return "en";
}

function createMeetingAudioSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `meeting-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function logAudioStage(entry) {
  const enriched = {
    at: new Date().toISOString(),
    ...entry
  };
  meetingAudioDebugLog.push(enriched);
  meetingAudioDebugLog = meetingAudioDebugLog.slice(-300);
  window.ORBYNE_AUDIO_DEBUG = meetingAudioDebugLog;
  console.info("[ORBYNECUE audio]", enriched);
}

function logPerformance(label, timings = {}) {
  const cleaned = Object.fromEntries(
    Object.entries(timings)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, typeof value === "number" ? Math.round(value) : value])
  );
  console.info(`[ORBYNECUE perf] ${label}`, cleaned);
  for (const [key, target] of Object.entries(PERF_TARGETS_MS)) {
    if (typeof cleaned[key] === "number" && cleaned[key] > target) {
      console.warn(`[ORBYNECUE perf bottleneck] ${key} exceeded ${target}ms`, cleaned);
    }
  }
}

function mergeFloat32Buffers(buffers, totalSamples) {
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
}

function mixInputBufferToMono(inputBuffer) {
  const channels = inputBuffer.numberOfChannels || 1;
  const length = inputBuffer.length;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = inputBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += data[index] / channels;
    }
  }
  return mono;
}

function calculateRms(samples) {
  if (!samples.length) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

function resampleLinear(samples, fromSampleRate, toSampleRate) {
  if (fromSampleRate === toSampleRate) {
    return samples;
  }
  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.max(1, Math.round(samples.length / ratio));
  const result = new Float32Array(newLength);
  for (let index = 0; index < newLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, samples.length - 1);
    const weight = sourceIndex - before;
    result[index] = samples[before] * (1 - weight) + samples[after] * weight;
  }
  return result;
}

function encodeWavPcm16(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeAudioBlobToMono(blob) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextConstructor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return {
      samples: mixInputBufferToMono(audioBuffer),
      sampleRate: audioBuffer.sampleRate
    };
  } finally {
    audioContext.close();
  }
}

function compactTranscriptForAnalysis(text, maxCharacters = 14000) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (cleanText.length <= maxCharacters) {
    return cleanText;
  }
  return cleanText.slice(-maxCharacters).replace(/^\S+\s*/, "").trim();
}

function appendMeetingQuestionTranscript(text) {
  const cleanText = cleanTranscript(text);
  if (!cleanText) {
    return meetingQuestionTranscriptBuffer;
  }
  meetingQuestionTranscriptBuffer = compactTranscriptForAnalysis(
    `${meetingQuestionTranscriptBuffer} ${cleanText}`,
    MEETING_QUESTION_BUFFER_MAX_CHARS
  );
  return meetingQuestionTranscriptBuffer;
}

function isBehavioralPrompt(text) {
  return /^(tell me about a time|describe a time|give me an example|talk about a time|tell me about an experience)\b/i.test(cleanTranscript(text));
}

function isCompleteBehavioralPrompt(text) {
  const cleanText = cleanTranscript(text);
  if (!isBehavioralPrompt(cleanText)) {
    return false;
  }
  const words = tokenize(cleanText);
  const incompleteEnding = /\b(time|example|experience|when|where|who|that|with|for|about|you|your|a|an|the|or|difficult|challenging)$/i.test(cleanText);
  return words.length >= MIN_BEHAVIORAL_PROMPT_WORDS && !incompleteEnding;
}

function shouldAnswerMeetingTranscript(text) {
  const cleanText = cleanTranscript(text);
  if (isBehavioralPrompt(cleanText) && !isCompleteBehavioralPrompt(cleanText)) {
    return false;
  }
  const words = tokenize(cleanText);
  const questionLike = new RegExp(`\\b(${MEETING_QUESTION_SIGNAL_WORDS})\\b`, "i").test(cleanText);
  const requestLike = /\b(tell|explain|describe|summarize|compare|show|give|find|list|calculate|analyze|answer|define|name|discuss|walk)\b/i.test(cleanText);
  const fillerOnly = /^(hi|hello|hey|thanks|thank you|yeah|yes|no|ok|okay|sure|great|fine|cool|nice to meet you)\.?$/i.test(cleanText)
    || /^(my name is|i am|i'm|this is)\b/i.test(cleanText);
  const trailingFragment = /\b(and|or|but|so|because|with|for|to|of|the|a|an|in|on|at|from|by|about|like|that|this|these|those|we|i|you|they|he|she|it|what|why|how|when|where|who|which|is|are|was|were|do|does|did|can|could|would|should|will|shall)$/i.test(cleanText);
  const hasSentenceEnd = /[?.!]$/.test(cleanText);
  const completeThought = hasSentenceEnd || ((questionLike || requestLike) && words.length >= MIN_MEETING_AUTO_ANSWER_WORDS && !trailingFragment);
  return !fillerOnly && completeThought && (cleanText.endsWith("?") || questionLike || requestLike);
}

function cleanMeetingQuestionCandidate(text) {
  return cleanTranscript(text)
    .replace(/^(?:question|q)(?:\s+(?:number\s+)?[a-z0-9]+)?[:\s-]+/i, "")
    .replace(new RegExp(`^(?:i\\s+)+(?=(${MEETING_QUESTION_SIGNAL_WORDS})\\b)`, "i"), "")
    .replace(new RegExp(`\\s+\\b(${MEETING_QUESTION_SIGNAL_WORDS})\\s*$`, "i"), "")
    .trim();
}

function startsWithQuestionSignal(text) {
  return new RegExp(`^(?:(?:question|q)(?:\\s+(?:number\\s+)?[a-z0-9]+)?[:\\s-]+)?(${MEETING_QUESTION_SIGNAL_WORDS})\\b`, "i").test(cleanTranscript(text));
}

function splitMeetingTranscriptQuestions(text) {
  const cleanText = cleanTranscript(text);
  if (!cleanText) {
    return [];
  }

  if (isBehavioralPrompt(cleanText)) {
    return isCompleteBehavioralPrompt(cleanText) && shouldAnswerMeetingTranscript(cleanText) ? [cleanText] : [];
  }

  const marked = cleanText.replace(new RegExp(`\\s+\\b(${MEETING_QUESTION_SIGNAL_WORDS})\\b`, "gi"), "\n$1");
  const candidates = marked
    .split(/\n+|(?<=[?!.])\s+/)
    .map((segment) => cleanMeetingQuestionCandidate(segment))
    .filter(Boolean);

  const questions = [];
  for (const candidate of candidates) {
    const words = tokenize(candidate);
    if (words.length < 3) {
      continue;
    }
    if (!startsWithQuestionSignal(candidate)) {
      continue;
    }
    if (!shouldAnswerMeetingTranscript(candidate)) {
      continue;
    }
    if (!questions.some((question) => normalizedTranscriptKey(question) === normalizedTranscriptKey(candidate))) {
      questions.push(candidate);
    }
  }

  if (questions.length) {
    return questions;
  }
  return shouldAnswerMeetingTranscript(cleanText) && startsWithQuestionSignal(cleanText) ? [cleanText] : [];
}

function enqueueMeetingQuestions(questions) {
  let addedCount = 0;
  for (const question of questions) {
    const key = normalizedTranscriptKey(question);
    if (!key || key === normalizedTranscriptKey(lastMeetingAnswerText)) {
      continue;
    }
    if (meetingQuestionQueue.some((queuedQuestion) => normalizedTranscriptKey(queuedQuestion) === key)) {
      continue;
    }
    meetingQuestionQueue.push(question);
    addedCount += 1;
  }
  meetingQuestionQueue = meetingQuestionQueue.slice(-MEETING_QUESTION_QUEUE_LIMIT);
  return addedCount;
}

function clearMeetingQuestionQueue() {
  meetingQuestionQueue = [];
  meetingAnswerInProgress = false;
  meetingQuestionTranscriptBuffer = "";
  if (meetingQuestionQueueTimer) {
    window.clearTimeout(meetingQuestionQueueTimer);
    meetingQuestionQueueTimer = null;
  }
}

function scheduleMeetingQuestionQueue(options = {}, delayMs = 0) {
  if (meetingQuestionQueueTimer) {
    return;
  }
  meetingQuestionQueueTimer = window.setTimeout(async () => {
    meetingQuestionQueueTimer = null;
    await processMeetingQuestionQueue(options);
  }, delayMs);
}

async function processMeetingQuestionQueue(options = {}) {
  if (!meetingQuestionQueue.length) {
    return;
  }
  if (meetingAnswerInProgress || meetingRecording) {
    scheduleMeetingQuestionQueue(options, 500);
    return;
  }

  const meetingQuestion = meetingQuestionQueue.shift();
  meetingAnswerInProgress = true;
  lastMeetingAnswerText = meetingQuestion.toLowerCase();
  logAudioStage({
    stage: "queued-question",
    question: meetingQuestion,
    queued: meetingQuestionQueue.length
  });
  try {
    await answerQuestion(meetingQuestion, {
      fromMeetingAudio: true,
      validatedMeetingQuestion: true,
      skipDuplicateCheck: true,
      transcriptConfidence: options.transcriptConfidence,
      chunkNumber: options.chunkNumber || 0,
      pipelineTimings: options.pipelineTimings || {}
    });
    removeAnsweredMeetingSegments([meetingQuestion]);
    renderLiveTranscript();
  } finally {
    meetingAnswerInProgress = false;
  }

  if (meetingQuestionQueue.length) {
    setMeetingAudioStatus("Next question ready...");
    scheduleMeetingQuestionQueue(options, 300);
  }
}

async function sendMeetingAudioChunk(blob, meta = {}) {
  if (!blob.size) {
    return;
  }

  const uploadStartedAt = performance.now();
  logAudioStage({
    stage: "upload",
    chunkNumber: meta.chunkNumber || 0,
    audioReceived: true,
    chunkSize: blob.size,
    duration: meta.duration || 0,
    sampleRate: meta.sampleRate || 0,
    audioEnergy: meta.audioEnergy || 0,
    voiceActivity: meta.voiceActivity !== false,
    flow: "Shared Audio -> Speech-to-Text -> Document Search -> Answer"
  });

  setProcessing(true);
  try {
    requireBackendTarget("Meeting transcription");
    const formData = new FormData();
    formData.append("file", blob, getAudioFileName(blob.type || ""));
    formData.append("language", getSelectedAudioLanguage());
    formData.append("chunk_number", String(meta.chunkNumber || 0));
    formData.append("session_id", meta.sessionId || meetingAudioSessionId || "");
    formData.append("final_chunk", String(meta.finalChunk === true));
    formData.append("duration", String(meta.duration || 0));
    formData.append("sample_rate", String(meta.sampleRate || 0));
    formData.append("audio_energy", String(meta.audioEnergy || 0));
    formData.append("voice_activity", String(meta.voiceActivity !== false));
    setMeetingAudioStatus("Speech detected. Converting to text...");
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
    const isFinalTranscript = payload.isFinal !== false;
    const backendTimings = payload.stageTimings || {};
    logAudioStage({
      stage: "backend-result",
      chunkNumber: payload.chunkNumber || meta.chunkNumber || 0,
      audioReceived: true,
      chunkSize: payload.chunkSize || blob.size,
      duration: payload.duration || meta.duration || 0,
      sampleRate: payload.sampleRate || meta.sampleRate || 0,
      audioEnergy: payload.audioEnergy ?? meta.audioEnergy ?? 0,
      voiceActivity: payload.voiceActivity ?? meta.voiceActivity ?? false,
      detectedLanguage: payload.language || "unknown",
      languageConfidence: payload.languageConfidence || 0,
      transcript,
      isFinal: isFinalTranscript,
      transcriptConfidence: payload.transcriptionConfidence || 0,
      answerSource: "",
      latency: payload.latencyMs || 0,
      stageTimings: backendTimings,
      discarded: payload.discarded || false,
      reason: payload.reason || ""
    });
    logPerformance("audio-to-transcript", {
      chunk: payload.chunkNumber || meta.chunkNumber || 0,
      captureMs: meta.captureMs || Math.round((meta.duration || 0) * 1000),
      vadMs: meta.vadMs || 0,
      uploadRoundTripMs: performance.now() - uploadStartedAt,
      languageDetectionMs: backendTimings.languageDetectionMs,
      speechToTextMs: backendTimings.speechToTextMs,
      totalBackendMs: payload.latencyMs || 0
    });

    if ((isFinalTranscript || meta.finalChunk) && !transcript && meetingLivePartialTranscript) {
      meetingLivePartialTranscript = "";
      renderLiveTranscript();
    }

    if (payload.discarded) {
      if (payload.reason === "low_transcription_confidence") {
        setMeetingAudioStatus(`STT ignored unclear speech (${Math.round((payload.transcriptionConfidence || 0) * 100)}%)`);
      } else if (payload.reason === "no_clear_speech") {
        setMeetingAudioStatus("STT heard audio but found no clear words");
      } else if (payload.reason === "implausible_transcript") {
        setMeetingAudioStatus("STT rejected an uncertain transcript");
      } else if (payload.reason === "stt_unavailable") {
        setMeetingAudioStatus(meetingListening ? "Listening..." : "Audio shared");
      } else {
        setMeetingAudioStatus(`STT skipped audio: ${payload.reason || "unknown reason"}`);
      }
      return;
    }

    if (transcript) {
      if (!isFinalTranscript) {
        meetingLivePartialTranscript = transcript;
        renderLiveTranscript();
        setMeetingAudioStatus("Listening... converting speech to text");
        return;
      }

      meetingLivePartialTranscript = "";
      setMeetingAudioStatus(meta.suppressAnswer ? "Text ready" : "Text ready. Searching documents...");
      const duplicateDisplay = hasRecentlyDisplayedTranscript(transcript);
      const detectionTranscript = duplicateDisplay ? meetingQuestionTranscriptBuffer : appendMeetingQuestionTranscript(transcript);
      if (!duplicateDisplay) {
        displayedMeetingTranscript.push(transcript);
        displayedMeetingTranscript = displayedMeetingTranscript.slice(-20);
        meetingTranscript.push(transcript);
        meetingTranscript = meetingTranscript.slice(-20);
        saveMeetingContext();
        renderLiveTranscript();
      }
      const meetingQuestions = splitMeetingTranscriptQuestions(detectionTranscript);
      const readyForAnswer = meetingQuestions.length > 0;
      if (!readyForAnswer && !meta.suppressAnswer && !meetingRecording) {
        setMeetingAudioStatus("Text ready. Waiting for complete question...");
      }
      if (!meta.suppressAnswer && !meetingRecording && readyForAnswer) {
        const queueOptions = {
          transcriptConfidence: Math.round((payload.transcriptionConfidence || 0) * 100),
          chunkNumber: payload.chunkNumber || meta.chunkNumber || 0,
          pipelineTimings: {
            questionEndedAt: meta.questionEndedAt || uploadStartedAt,
            transcriptionLatencyMs: performance.now() - uploadStartedAt,
            speechToTextMs: backendTimings.speechToTextMs,
            languageDetectionMs: 0
          }
        };
        const queuedCount = enqueueMeetingQuestions(meetingQuestions);
        if (queuedCount > 0) {
          meetingQuestionTranscriptBuffer = "";
          scheduleMeetingQuestionQueue(queueOptions);
        }
      }
    }
  } catch (error) {
    if (error.status === 429) {
      transcriptionPausedUntil = Date.now() + 30000;
      setMeetingAudioStatus(meetingListening ? "Listening... transcription paused" : "Audio shared");
    } else {
      setMeetingAudioStatus(`STT error: ${error.message}`);
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

    meetingAudioPeakSinceLastChunk = Math.max(meetingAudioPeakSinceLastChunk, rms);

    if (rms > MEETING_AUDIO_RMS_THRESHOLD) {
      silentTicks = 0;
      meetingAudioActiveRecently = true;
      setMeetingAudioStatus(meetingListening ? "Listening..." : "Audio shared");
    } else {
      silentTicks += 1;
      if (silentTicks >= 8) {
        meetingAudioActiveRecently = false;
        setMeetingAudioStatus(meetingListening ? "Listening... checking shared audio" : "Audio shared, waiting for speech");
      }
    }
  }, 500);
}

function stopMeetingAudioMeter() {
  if (meetingAudioLevelTimer) {
    window.clearInterval(meetingAudioLevelTimer);
    meetingAudioLevelTimer = null;
  }
  if (meetingAudioProcessorNode) {
    meetingAudioProcessorNode.disconnect();
    meetingAudioProcessorNode = null;
  }
  if (meetingAudioMutedOutputNode) {
    meetingAudioMutedOutputNode.disconnect();
    meetingAudioMutedOutputNode = null;
  }
  if (meetingAudioSourceNode) {
    meetingAudioSourceNode.disconnect();
    meetingAudioSourceNode = null;
  }
  if (meetingAudioContext) {
    meetingAudioContext.close();
    meetingAudioContext = null;
  }
  setMeetingAudioLevel(0);
  meetingAudioActiveRecently = false;
  meetingAudioSpeechSamplesSinceLastChunk = 0;
  meetingAudioPeakSinceLastChunk = 0;
  meetingSilentChunkCount = 0;
}

async function processSharedAudioChunk() {
  if (meetingAudioChunkProcessing || !meetingListening || !meetingAudioChunkSamples) {
    return;
  }
  meetingAudioChunkProcessing = true;
  try {
    meetingLastChunkAt = Date.now();
    const vadStartedAt = performance.now();

    const sourceSampleRate = meetingAudioContext?.sampleRate || 0;
    const samples = mergeFloat32Buffers(meetingAudioChunkBuffers, meetingAudioChunkSamples);
    const overlapSamples = sourceSampleRate ? Math.min(samples.length, Math.round(sourceSampleRate * (MEETING_AUDIO_OVERLAP_MS / 1000))) : 0;
    const overlapBuffer = overlapSamples ? samples.slice(samples.length - overlapSamples) : null;
    meetingAudioChunkBuffers = overlapBuffer ? [overlapBuffer] : [];
    meetingAudioChunkSamples = overlapBuffer ? overlapBuffer.length : 0;
    meetingAudioChunkNumber += 1;

    const duration = sourceSampleRate ? samples.length / sourceSampleRate : 0;
    const rms = calculateRms(samples);
    const speechSeconds = sourceSampleRate ? meetingAudioSpeechSamplesSinceLastChunk / sourceSampleRate : 0;
    const peak = meetingAudioPeakSinceLastChunk;
    meetingAudioSpeechSamplesSinceLastChunk = 0;
    meetingAudioPeakSinceLastChunk = 0;

    const probableVoiceActivity = peak >= MEETING_AUDIO_RMS_THRESHOLD
      && speechSeconds >= MEETING_MIN_SPEECH_SECONDS_PER_CHUNK
      && rms >= MEETING_AUDIO_RMS_THRESHOLD / 3;
    const finalChunk = !probableVoiceActivity && meetingAudioHadSpeechSinceLastFinal;
    if (probableVoiceActivity) {
      meetingAudioHadSpeechSinceLastFinal = true;
    } else if (finalChunk) {
      meetingAudioHadSpeechSinceLastFinal = false;
    }
    const vadMs = performance.now() - vadStartedAt;
    const baseLog = {
      stage: "vad",
      chunkNumber: meetingAudioChunkNumber,
      audioReceived: true,
      chunkSize: samples.length,
      duration: Number(duration.toFixed(3)),
      sampleRate: sourceSampleRate,
      targetSampleRate: MEETING_AUDIO_TARGET_SAMPLE_RATE,
      audioEnergy: Number(rms.toFixed(6)),
      peak: Number(peak.toFixed(6)),
      speechSeconds: Number(speechSeconds.toFixed(3)),
      voiceActivity: probableVoiceActivity,
      vadMs: Math.round(vadMs)
    };
    logAudioStage(baseLog);

    if (!probableVoiceActivity) {
      meetingSilentChunkCount += 1;
      setMeetingAudioStatus(meetingSilentChunkCount >= 10 ? "Listening... checking shared audio" : "Listening... waiting for speech");
      if (meetingSilentChunkCount > MAX_CONSECUTIVE_SILENT_UPLOADS) {
        return;
      }
    } else {
      meetingSilentChunkCount = 0;
      setMeetingAudioStatus("Speech detected...");
    }
    if (Date.now() < transcriptionPausedUntil) {
      setMeetingAudioStatus("Listening... transcription cooling down");
      logAudioStage({
        ...baseLog,
        stage: "transcription-paused",
        reason: "quota_cooldown"
      });
      return;
    }

    const resampled = resampleLinear(samples, sourceSampleRate, MEETING_AUDIO_TARGET_SAMPLE_RATE);
    const wavBlob = encodeWavPcm16(resampled, MEETING_AUDIO_TARGET_SAMPLE_RATE);
    const upload = sendMeetingAudioChunk(wavBlob, {
      chunkNumber: meetingAudioChunkNumber,
      sessionId: meetingAudioSessionId,
      duration,
      sampleRate: MEETING_AUDIO_TARGET_SAMPLE_RATE,
      audioEnergy: rms,
      voiceActivity: probableVoiceActivity,
      finalChunk,
      captureMs: Math.round(duration * 1000),
      vadMs,
      questionEndedAt: performance.now()
    });
    pendingTranscriptions.add(upload);
    upload.finally(() => pendingTranscriptions.delete(upload));
  } finally {
    meetingAudioChunkProcessing = false;
  }
}

function startProcessorWatchdog() {
  stopProcessorWatchdog();
  meetingLastChunkAt = Date.now();
  meetingProcessorWatchdogTimer = window.setInterval(async () => {
    if (!meetingListening || !meetingCurrentInputStream) {
      return;
    }
    if (Date.now() - meetingLastChunkAt < 5000) {
      return;
    }
    logAudioStage({
      stage: "processor-watchdog-restart",
      mode: meetingCurrentInputMode,
      reason: "no_chunks_processed"
    });
    try {
      await startSharedAudioProcessor(meetingCurrentInputStream, meetingCurrentInputMode);
    } catch (error) {
      setMeetingAudioStatus(`Audio processor restart failed: ${error.message}`);
    }
  }, 2500);
}

function stopProcessorWatchdog() {
  if (meetingProcessorWatchdogTimer) {
    window.clearInterval(meetingProcessorWatchdogTimer);
    meetingProcessorWatchdogTimer = null;
  }
}

async function startSharedAudioProcessor(stream = meetingSharedAudioStream, mode = "shared") {
  stopMeetingAudioMeter();
  meetingCurrentInputStream = stream;
  meetingCurrentInputMode = mode;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  meetingAudioContext = new AudioContextConstructor();
  if (meetingAudioContext.state === "suspended") {
    await meetingAudioContext.resume();
  }
  meetingAudioSourceNode = meetingAudioContext.createMediaStreamSource(stream);
  meetingAudioProcessorNode = meetingAudioContext.createScriptProcessor(MEETING_AUDIO_PROCESSOR_SIZE, 2, 1);
  meetingAudioMutedOutputNode = meetingAudioContext.createGain();
  meetingAudioMutedOutputNode.gain.value = 0;

  meetingAudioChunkBuffers = [];
  meetingAudioChunkSamples = 0;
  meetingAudioSpeechSamplesSinceLastChunk = 0;
  meetingAudioPeakSinceLastChunk = 0;
  meetingAudioChunkNumber = 0;
  meetingSilentChunkCount = 0;
  meetingAudioHadSpeechSinceLastFinal = false;
  meetingAudioChunkProcessing = false;
  meetingLivePartialTranscript = "";
  renderLiveTranscript();

  const targetSamplesPerChunk = Math.round(meetingAudioContext.sampleRate * (MEETING_AUDIO_SEGMENT_MS / 1000));
  const firstSpeechTargetSamples = Math.round(meetingAudioContext.sampleRate * (MEETING_AUDIO_FIRST_CHUNK_MS / 1000));
  meetingAudioProcessorNode.onaudioprocess = (event) => {
    if (!meetingListening) {
      return;
    }
    const copy = mixInputBufferToMono(event.inputBuffer);
    meetingAudioChunkBuffers.push(copy);
    meetingAudioChunkSamples += copy.length;

    const rms = calculateRms(copy);
    meetingAudioPeakSinceLastChunk = Math.max(meetingAudioPeakSinceLastChunk, rms);
    if (rms >= MEETING_AUDIO_RMS_THRESHOLD) {
      meetingAudioSpeechSamplesSinceLastChunk += copy.length;
      meetingAudioActiveRecently = true;
      setMeetingAudioStatus("Listening...");
    }
    setMeetingAudioLevel(Math.min(rms * 8, 1));

    const targetSamples = meetingAudioChunkNumber === 0 && meetingAudioSpeechSamplesSinceLastChunk
      ? firstSpeechTargetSamples
      : targetSamplesPerChunk;
    if (meetingAudioChunkSamples >= targetSamples) {
      processSharedAudioChunk();
    }
  };

  meetingAudioSourceNode.connect(meetingAudioProcessorNode);
  meetingAudioProcessorNode.connect(meetingAudioMutedOutputNode);
  meetingAudioMutedOutputNode.connect(meetingAudioContext.destination);
  setMeetingAudioStatus("Listening...");
  logAudioStage({
    stage: "capture-started",
    mode,
    sampleRate: meetingAudioContext.sampleRate,
    targetSampleRate: MEETING_AUDIO_TARGET_SAMPLE_RATE,
    chunkMs: MEETING_AUDIO_SEGMENT_MS,
    audioTracks: stream.getAudioTracks().length,
    audioContextState: meetingAudioContext.state
  });
  startProcessorWatchdog();
}

function stopSharedAudioProcessor() {
  stopProcessorWatchdog();
  if (meetingAudioChunkSamples) {
    processSharedAudioChunk();
  }
  stopMeetingAudioMeter();
  meetingCurrentInputStream = null;
}

function endSharedAudioSession(statusText = "Audio sharing ended") {
  meetingListening = false;
  meetingLivePartialTranscript = "";
  renderLiveTranscript();
  meetingRecorderGeneration += 1;
  stopSharedAudioProcessor();
  meetingAudioShared = false;
  meetingSharedAudioStream = null;
  meetingAudioSessionId = "";
  if (meetingAudioStream) {
    meetingAudioStream.getTracks().forEach((track) => track.stop());
    meetingAudioStream = null;
  }
  stopMeetingAudioMeter();
  setMeetingAudioStatus(statusText);
  updateAudioStatus();
  updateContextIndicator();
}

async function shareMeetingAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Meeting audio sharing needs Chrome or Edge screen/tab sharing.");
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
  for (const track of audioTracks) {
    track.addEventListener("ended", () => {
      endSharedAudioSession("Audio sharing ended");
    });
  }

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

async function startListeningSession() {
  if (!hasSharedAudioSession()) {
    setMeetingAudioStatus("Share meeting audio first");
    updateAudioStatus();
    return;
  }
  if (!hasActiveSharedAudio()) {
    setMeetingAudioStatus("Audio shared, waiting for audio");
  }
  transcriptionPausedUntil = 0;
  meetingListening = true;
  clearMeetingQuestionQueue();
  meetingLivePartialTranscript = "";
  renderLiveTranscript();
  meetingAudioSessionId = createMeetingAudioSessionId();
  meetingRecorderGeneration += 1;
  if (hasActiveSharedAudio()) {
    setMeetingAudioStatus("Listening...");
  }
  updateAudioStatus();
  updateContextIndicator();
  try {
    setMeetingAudioStatus("Listening...");
    await startSharedAudioProcessor();
  } catch (error) {
    meetingListening = false;
    setMeetingAudioStatus(`Unable to listen: ${error.message}`);
    updateAudioStatus();
  }
}

function stopListeningSession({ keepStatus = false, discardFinalChunk = false } = {}) {
  meetingListening = false;
  meetingLivePartialTranscript = "";
  renderLiveTranscript();
  stopSharedAudioProcessor();
  meetingAudioSessionId = "";
  meetingRecorderGeneration += 1;
  if (!keepStatus) {
    setMeetingAudioStatus(hasSharedAudioSession() ? "Audio shared" : "Not shared");
  }
  updateAudioStatus();
  updateContextIndicator();
  return Promise.resolve();
}

async function generateMeetingAnalysis() {
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
  let recordingBlob = null;
  if (micRecordingParts.length) {
    const mimeType = micRecordingParts[0]?.type || getSupportedAudioMimeType() || "audio/webm";
    recordingBlob = new Blob(micRecordingParts, { type: mimeType });
    renderRecordingPlayback(recordingBlob);
  }
  micRecordingParts = [];

  if (meetingMicStream) {
    meetingMicStream.getTracks().forEach((track) => track.stop());
    meetingMicStream = null;
  }

  setMeetingAudioStatus(meetingListening ? "Listening..." : meetingAudioShared ? "Audio shared" : "Not shared");
  updateAudioStatus();
  updateContextIndicator();

  if (recordingBlob) {
    await transcribeRecordingBlob(recordingBlob);
  }
}

async function transcribeRecordingBlob(recordingBlob) {
  if (!recordingBlob?.size) {
    return;
  }

  setMeetingAudioStatus("Transcribing recording...");
  const transcriptCountBefore = meetingTranscript.length;
  const { samples, sampleRate } = await decodeAudioBlobToMono(recordingBlob);
  if (!samples.length || !sampleRate) {
    setMeetingAudioStatus("Recording had no audio to transcribe");
    return;
  }

  const sessionId = createMeetingAudioSessionId();
  const sourceSamplesPerChunk = Math.round(sampleRate * (MEETING_AUDIO_SEGMENT_MS / 1000));
  const totalChunks = Math.ceil(samples.length / sourceSamplesPerChunk);
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * sourceSamplesPerChunk;
    const end = Math.min(samples.length, start + sourceSamplesPerChunk);
    const chunk = samples.slice(start, end);
    const rms = calculateRms(chunk);
    const resampled = resampleLinear(chunk, sampleRate, MEETING_AUDIO_TARGET_SAMPLE_RATE);
    const wavBlob = encodeWavPcm16(resampled, MEETING_AUDIO_TARGET_SAMPLE_RATE);
    await sendMeetingAudioChunk(wavBlob, {
      chunkNumber: index + 1,
      sessionId,
      duration: chunk.length / sampleRate,
      sampleRate: MEETING_AUDIO_TARGET_SAMPLE_RATE,
      audioEnergy: rms,
      voiceActivity: rms >= MEETING_AUDIO_RMS_THRESHOLD / 3,
      finalChunk: index === totalChunks - 1,
      suppressAnswer: true,
      captureMs: Math.round((chunk.length / sampleRate) * 1000),
      questionEndedAt: performance.now()
    });
  }

  setMeetingAudioStatus(meetingTranscript.length > transcriptCountBefore ? "Recording transcribed" : "No clear speech found in recording");
}

async function stopMeetingAudioSession() {
  const recorderStopped = stopListeningSession({ keepStatus: true, discardFinalChunk: true });
  await recorderStopped;
  meetingAudioShared = false;
  meetingAudioSessionId = "";

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
  if (!hasBackendTarget()) {
    setStatus(elements.connectionStatus, "Backend not configured", "error");
    return;
  }

  try {
    const response = await fetch(apiUrl("/health"));
    if (!response.ok) {
      throw new Error(`Backend health check failed with ${response.status}`);
    }
    const payload = await response.json();
    setStatus(elements.connectionStatus, payload.externalAiEnabled === false ? "Documents only" : "Backend ready", "neutral");
  } catch (error) {
    setStatus(elements.connectionStatus, "Backend unavailable", "error");
  }
}

function configureBackendUrl() {
  const currentUrl = getApiBaseUrl();
  const nextUrl = window.prompt("Backend URL", currentUrl);
  if (nextUrl === null) {
    return;
  }

  const normalized = nextUrl.trim().replace(/\/+$/, "");
  if (normalized) {
    localStorage.setItem(STORAGE_KEYS.apiBaseUrl, normalized);
    startCurrentAnswer(`Backend URL saved: ${normalized}`, "Settings");
  } else {
    localStorage.removeItem(STORAGE_KEYS.apiBaseUrl);
    startCurrentAnswer("Backend URL cleared. Public GitHub Pages needs a deployed backend for uploads and transcription.", "Settings");
  }
  checkBackend();
}

function clearChat({ clearDocuments = false } = {}) {
  messages = [];
  history = [];
  meetingTranscript = [];
  displayedMeetingTranscript = [];
  clearMeetingQuestionQueue();
  recentDisplayedTranscriptHashes = [];
  recentTranscriptHashes = [];
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
  clearStoredSessionData();
  documents = [];
  history = [];
  messages = [];
  meetingTranscript = [];
  displayedMeetingTranscript = [];
  clearMeetingQuestionQueue();
  recentDisplayedTranscriptHashes = [];
  recentTranscriptHashes = [];

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

elements.startListening.addEventListener("click", async () => {
  await startListeningSession();
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
  configureBackendUrl();
});

elements.homeButton.addEventListener("click", () => {
  endTrialSession();
});

elements.historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".historyItem");
  if (item) {
    elements.manualQuestion.value = item.dataset.question;
    elements.manualQuestion.focus();
  }
});

let dashboardInitialized = false;
let trialExpiresAt = 0;
let trialTimerId = null;
let trialLogoutInProgress = false;

function formatTrialTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function clearTrialTimer() {
  if (trialTimerId) {
    window.clearInterval(trialTimerId);
    trialTimerId = null;
  }
}

async function endTrialSession({ expired = false } = {}) {
  if (trialLogoutInProgress) {
    return;
  }

  trialLogoutInProgress = true;
  clearTrialTimer();

  try {
    if (meetingRecording) {
      await stopRecordingSession();
    }
    if (meetingListening || meetingAudioShared) {
      await stopMeetingAudioSession();
    }
  } finally {
    localStorage.removeItem(STORAGE_KEYS.demoAuthenticated);
    trialExpiresAt = 0;
    elements.trialTimer.textContent = expired ? "Trial ended" : "Trial 01:00:00";
    revealLanding();
    window.history.replaceState(null, "", `${window.location.pathname}#home`);
    trialLogoutInProgress = false;
  }
}

function expireTrialSession() {
  return endTrialSession({ expired: true });
}

function updateTrialTimer() {
  const remaining = trialExpiresAt - Date.now();
  elements.trialTimer.textContent = `Trial ${formatTrialTime(remaining)}`;
  if (remaining <= 0) {
    expireTrialSession();
  }
}

function startTrialTimer() {
  clearTrialTimer();
  trialExpiresAt = Date.now() + TRIAL_DURATION_MS;
  updateTrialTimer();
  trialTimerId = window.setInterval(updateTrialTimer, 1000);
}

function revealDashboard() {
  const publicSite = document.querySelector("#publicSite");
  const loginView = document.querySelector("#loginView");
  const appShell = document.querySelector(".appShell");

  document.body.classList.remove("publicMode", "loginMode");
  publicSite.hidden = true;
  loginView.hidden = true;
  appShell.hidden = false;

  if (!dashboardInitialized) {
    dashboardInitialized = true;
    loadState();
    checkBackend();
  }
  window.scrollTo(0, 0);
}

function revealLanding() {
  const publicSite = document.querySelector("#publicSite");
  const loginView = document.querySelector("#loginView");
  const appShell = document.querySelector(".appShell");

  document.body.classList.add("publicMode");
  document.body.classList.remove("loginMode");
  publicSite.hidden = false;
  loginView.hidden = true;
  appShell.hidden = true;
}

function revealLogin() {
  const publicSite = document.querySelector("#publicSite");
  const loginView = document.querySelector("#loginView");
  const appShell = document.querySelector(".appShell");
  const loginEmail = document.querySelector("#loginEmail");

  document.body.classList.add("loginMode");
  document.body.classList.remove("publicMode");
  publicSite.hidden = true;
  loginView.hidden = false;
  appShell.hidden = true;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => loginEmail?.focus());
}

function setupPublicMotion() {
  const motionItems = document.querySelectorAll(".motionItem");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("isVisible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16 });

  motionItems.forEach((item) => observer.observe(item));

  const framer = window.framerMotion || window.Motion;
  if (framer?.animate) {
    document.querySelectorAll(".glassCard, .glassPanel, .primaryCta, .secondaryCta").forEach((node) => {
      node.addEventListener("pointerenter", () => framer.animate(node, { scale: 1.01 }, { duration: 0.18 }));
      node.addEventListener("pointerleave", () => framer.animate(node, { scale: 1 }, { duration: 0.18 }));
    });
  }
}

function setupDemoLogin() {
  const loginForm = document.querySelector("#loginForm");
  const loginError = document.querySelector("#loginError");

  document.querySelectorAll("[data-auth-open]").forEach((button) => {
    button.addEventListener("click", revealLogin);
  });

  document.querySelector("[data-login-back]")?.addEventListener("click", (event) => {
    event.preventDefault();
    revealLanding();
  });

  loginForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.querySelector("#loginEmail").value.trim().toLowerCase();
    const password = document.querySelector("#loginPassword").value;

    if (email === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) {
      localStorage.setItem(STORAGE_KEYS.demoAuthenticated, "true");
      loginError.textContent = "";
      startTrialTimer();
      revealDashboard();
      return;
    }

    loginError.textContent = "Use demo@orbynecue.com and Demo@123 to continue.";
  });
}

function initPublicExperience() {
  setupPublicMotion();
  setupDemoLogin();
  revealLanding();
}

initPublicExperience();
