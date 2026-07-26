// js/app-ai-video.js - API 키 없이 브라우저에서 영상/음성 자막 추출 + 요약
(() => {
  const state = {
    file: null,
    busy: false,
    transcript: "",
    chunks: [],
    summary: "",
    keyPoints: [],
    timeline: [],
    status: "영상/음성/자막 파일을 넣어줘.",
    progress: 0,
    transcriber: null,
  };

  const LANG_MAP = {
    auto: null,
    ko: "korean",
    ja: "japanese",
    en: "english",
    zh: "chinese",
  };

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function currentKey(song) {
    const id = String(song?.id || "").trim();
    const url = String(song?.ytUrl || "").trim();
    return id || url || "standalone";
  }

  function readSaved(song) {
    try {
      const key = `localVideoAI:${currentKey(song)}`;
      const data = JSON.parse(localStorage.getItem(key) || "null");
      if (!data || typeof data !== "object") return null;
      return data;
    } catch { return null; }
  }

  function saveResult(song) {
    if (!state.transcript) return;
    try {
      const key = `localVideoAI:${currentKey(song)}`;
      localStorage.setItem(key, JSON.stringify({
        transcript: state.transcript,
        chunks: state.chunks,
        summary: state.summary,
        keyPoints: state.keyPoints,
        timeline: state.timeline,
        fileName: state.file?.name || "",
        savedAt: Date.now(),
      }));
      setStatus("현재 영상에 AI 결과를 저장했어.", 100);
      renderResult();
    } catch (e) {
      alert("저장하지 못했어. 브라우저 저장공간이 부족할 수 있어.");
    }
  }

  function loadSaved(song) {
    const saved = readSaved(song);
    if (!saved) return false;
    state.transcript = String(saved.transcript || "");
    state.chunks = Array.isArray(saved.chunks) ? saved.chunks : [];
    state.summary = String(saved.summary || "");
    state.keyPoints = Array.isArray(saved.keyPoints) ? saved.keyPoints : [];
    state.timeline = Array.isArray(saved.timeline) ? saved.timeline : [];
    state.status = saved.fileName ? `저장된 결과: ${saved.fileName}` : "저장된 AI 결과를 불러왔어.";
    state.progress = 100;
    return true;
  }

  function clearSaved(song) {
    try { localStorage.removeItem(`localVideoAI:${currentKey(song)}`); } catch {}
    state.transcript = "";
    state.chunks = [];
    state.summary = "";
    state.keyPoints = [];
    state.timeline = [];
    setStatus("저장된 결과를 지웠어.", 0);
    renderResult();
  }

  function panelHTML(song) {
    const saved = readSaved(song);
    return `
      <section class="local-ai-panel">
        <div class="local-ai-intro">
          <strong>🤖 API 없는 영상 읽기</strong>
          <p>MP4 / WEBM / MP3 / WAV / M4A 또는 SRT / VTT / TXT를 넣으면 이 컴퓨터에서 자막을 만들고 요약해.</p>
          <p class="local-ai-small">처음 한 번은 Whisper AI 모델을 내려받아서 인터넷이 필요해. API 키/사용료는 없어. 일반적인 MP4(AAC)·오디오 파일은 브라우저가 직접 음성을 읽어.</p>
        </div>

        <label id="localAiDrop" class="local-ai-drop" tabindex="0">
          <input id="localAiFile" type="file" accept="video/*,audio/*,.srt,.vtt,.txt,text/plain" hidden>
          <span class="local-ai-drop-icon">📁</span>
          <b id="localAiFileName">${state.file ? esc(state.file.name) : "영상 파일을 여기에 놓거나 클릭"}</b>
          <small>긴 영상은 컴퓨터 성능에 따라 꽤 오래 걸릴 수 있어.</small>
        </label>

        <div class="local-ai-controls">
          <label>언어
            <select id="localAiLanguage">
              <option value="auto">자동 감지</option>
              <option value="ko">한국어</option>
              <option value="ja">일본어</option>
              <option value="en">영어</option>
              <option value="zh">중국어</option>
            </select>
          </label>
          <button id="localAiAnalyze" type="button" ${state.file ? "" : "disabled"}>${state.busy ? "분석 중..." : "분석 시작"}</button>
        </div>

        <div class="local-ai-status-wrap">
          <div class="local-ai-progress"><span id="localAiProgressBar" style="width:${Math.max(0, Math.min(100, state.progress))}%"></span></div>
          <p id="localAiStatus">${esc(state.status)}</p>
        </div>

        ${saved ? `<div class="local-ai-saved-note">현재 선택한 영상에 저장된 AI 결과가 있어. <button id="localAiLoadSaved" type="button">불러오기</button></div>` : ""}

        <div id="localAiResult"></div>
      </section>
    `;
  }

  function bindPanel({ song } = {}) {
    const drop = document.getElementById("localAiDrop");
    const input = document.getElementById("localAiFile");
    const analyze = document.getElementById("localAiAnalyze");

    const pick = (file) => {
      if (!file) return;
      state.file = file;
      state.transcript = "";
      state.chunks = [];
      state.summary = "";
      state.keyPoints = [];
      state.timeline = [];
      state.progress = 0;
      state.status = `${file.name} 준비됨`;
      document.getElementById("localAiFileName").textContent = file.name;
      if (analyze) analyze.disabled = false;
      setStatus(state.status, 0);
      renderResult(song);
    };

    input?.addEventListener("change", () => pick(input.files?.[0]));
    drop?.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-drag"); });
    drop?.addEventListener("dragleave", () => drop.classList.remove("is-drag"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-drag");
      pick(e.dataTransfer?.files?.[0]);
    });
    drop?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input?.click(); }
    });

    analyze?.addEventListener("click", () => analyzeFile(song));
    document.getElementById("localAiLoadSaved")?.addEventListener("click", () => {
      if (loadSaved(song)) renderResult(song);
    });

    renderResult(song);
  }

  function setStatus(text, progress = state.progress) {
    state.status = String(text || "");
    state.progress = Number(progress) || 0;
    const status = document.getElementById("localAiStatus");
    const bar = document.getElementById("localAiProgressBar");
    if (status) status.textContent = state.status;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, state.progress))}%`;
  }

  async function loadTransformers() {
    if (state.transcriber) return state.transcriber;
    setStatus("음성인식 AI 모델 준비 중... 처음 한 번은 다운로드가 있어.", 15);
    const mod = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
    const device = navigator.gpu ? "webgpu" : "wasm";
    state.transcriber = await mod.pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny",
      {
        device,
        progress_callback: (p) => {
          if (p?.progress != null) {
            const pct = Math.round(Number(p.progress) || 0);
            setStatus(`음성인식 AI 모델 준비 중... ${pct}%`, 15 + pct * 0.25);
          }
        }
      }
    );
    return state.transcriber;
  }

  async function decodeMediaToMono16k(file) {
    setStatus("영상/음성에서 소리를 읽는 중...", 28);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("이 브라우저는 오디오 분석 기능을 지원하지 않아.");

    const ctx = new Ctx();
    let decoded;
    try {
      const data = await file.arrayBuffer();
      decoded = await ctx.decodeAudioData(data.slice(0));
    } catch (e) {
      throw new Error("이 영상의 음성 코덱을 브라우저가 바로 읽지 못했어. 일반 MP4(AAC), MP3, WAV로 바꿔서 다시 넣어줘.");
    } finally {
      try { await ctx.close(); } catch {}
    }

    if (!decoded || !decoded.length) throw new Error("파일에서 음성을 찾지 못했어.");
    setStatus("음성을 AI용으로 변환하는 중...", 38);

    const targetRate = 16000;
    const targetLength = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, targetLength, targetRate);
    const source = offline.createBufferSource();

    // 여러 채널이면 먼저 모노로 합친 버퍼를 만든다.
    const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const out = mono.getChannelData(0);
    const channels = Math.max(1, decoded.numberOfChannels);
    for (let ch = 0; ch < channels; ch += 1) {
      const input = decoded.getChannelData(ch);
      for (let i = 0; i < input.length; i += 1) out[i] += input[i] / channels;
    }

    source.buffer = mono;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  }

  function isTextFile(file) {
    const n = String(file?.name || "").toLowerCase();
    return /\.(srt|vtt|txt)$/.test(n) || String(file?.type || "").startsWith("text/");
  }

  function cleanSubtitleText(raw) {
    return String(raw || "")
      .replace(/^WEBVTT[^\n]*\n+/i, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+.*$/gm, "")
      .replace(/^\s*\d{1,2}:\d{2}[,.]\d{3}\s+-->\s+.*$/gm, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function transcribeFile(file, langCode) {
    if (isTextFile(file)) {
      setStatus("자막 파일 읽는 중...", 45);
      const text = cleanSubtitleText(await file.text());
      return { text, chunks: [] };
    }

    const audioSamples = await decodeMediaToMono16k(file);
    const transcriber = await loadTransformers();
    setStatus("AI가 음성을 자막으로 바꾸는 중...", 52);
    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: "transcribe",
    };
    const language = LANG_MAP[langCode] || null;
    if (language) opts.language = language;
    const out = await transcriber(audioSamples, opts);
    return {
      text: String(out?.text || "").trim(),
      chunks: Array.isArray(out?.chunks) ? out.chunks.map((c) => ({
        text: String(c?.text || "").trim(),
        timestamp: Array.isArray(c?.timestamp) ? c.timestamp : [0, 0]
      })) : []
    };
  }

  function detectTextLanguage(text) {
    const t = String(text || "");
    const ko = (t.match(/[가-힣]/g) || []).length;
    const ja = (t.match(/[ぁ-ゖァ-ヺ]/g) || []).length;
    const cjk = (t.match(/[一-龯]/g) || []).length;
    if (ko > 8) return "ko";
    if (ja > 5) return "ja";
    if (cjk > 10) return "zh";
    return "en";
  }

  function sentenceSplit(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?。！？])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12);
  }

  const STOP = new Set((`그 그리고 그래서 하지만 또는 대한 대해 하는 있는 있다 없다 입니다 합니다 했다 한다 저는 제가 이것 저것 영상 오늘 이제 정말 조금 그냥 너무 여기 저기 경우 부분 방법 내용 설명 생각 사실 먼저 다음 정도 이런 그런 어떤 가장 다시 한번 thing this that with from have has were are was and the for you your about into then just very really video today there here what when where which will would can could should 일본 動画 これ それ そして から まで です ます いる ある する 的 了 是 在 和 有 我 你 他 这 那 一个 进行`).split(/\s+/));

  function tokenize(text) {
    return (String(text || "").toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}|[ぁ-ゖァ-ヺ一-龯]{2,}/g) || [])
      .filter((w) => !STOP.has(w));
  }

  function heuristicSummary(text, maxPoints = 5) {
    const sentences = sentenceSplit(text);
    if (!sentences.length) return { summary: text.slice(0, 240), points: text ? [text.slice(0, 300)] : [] };
    const freq = new Map();
    tokenize(text).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
    const scored = sentences.map((s, i) => {
      const words = tokenize(s);
      let score = words.reduce((a, w) => a + (freq.get(w) || 0), 0) / Math.max(4, words.length);
      if (i < Math.ceil(sentences.length * 0.12)) score *= 1.15;
      if (s.length > 220) score *= 0.8;
      return { s, i, score };
    });
    const picked = [...scored].sort((a,b) => b.score-a.score).slice(0, Math.min(maxPoints, scored.length)).sort((a,b) => a.i-b.i);
    const one = [...scored].sort((a,b) => b.score-a.score)[0]?.s || sentences[0];
    return { summary: one.slice(0, 260), points: picked.map((x) => x.s) };
  }

  async function browserSummary(text) {
    const lang = detectTextLanguage(text);
    if (!("Summarizer" in self) || !["en", "ja"].includes(lang)) return null;
    try {
      const availability = await Summarizer.availability();
      if (availability === "unavailable") return null;
      setStatus("Chrome 내장 AI가 자막을 요약하는 중...", 86);
      const summarizer = await Summarizer.create({
        type: "key-points",
        format: "plain-text",
        length: "medium",
        sharedContext: "This is a transcript from a video. Keep only the important information and remove greetings, filler, repetition, and sponsor-like chatter.",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            const p = Math.round((e.loaded || 0) * 100);
            setStatus(`Chrome 내장 요약 AI 준비 중... ${p}%`, 75 + p * 0.1);
          });
        }
      });
      const out = await summarizer.summarize(text.slice(0, 120000));
      summarizer.destroy?.();
      if (!out) return null;
      const points = String(out).split(/\n+/).map((x) => x.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
      return points;
    } catch (e) {
      console.warn("Chrome Summarizer fallback", e);
      return null;
    }
  }

  function makeTimeline(chunks, text) {
    if (Array.isArray(chunks) && chunks.length) {
      const groups = [];
      let bucket = [];
      let start = 0;
      for (const c of chunks) {
        const s = Number(c?.timestamp?.[0] || 0);
        if (!bucket.length) start = s;
        bucket.push(c);
        if (bucket.length >= 5 || (s - start) >= 75) {
          const joined = bucket.map(x => x.text).join(" ").trim();
          const pick = heuristicSummary(joined, 1).summary || joined;
          groups.push({ time: start, text: pick });
          bucket = [];
        }
      }
      if (bucket.length) {
        const joined = bucket.map(x => x.text).join(" ").trim();
        groups.push({ time: start, text: heuristicSummary(joined, 1).summary || joined });
      }
      return groups.slice(0, 20);
    }
    const sentences = sentenceSplit(text);
    return sentences.slice(0, 8).map((s, i) => ({ time: i * 60, text: s }));
  }

  async function analyzeFile(song) {
    if (!state.file || state.busy) return;
    state.busy = true;
    const btn = document.getElementById("localAiAnalyze");
    if (btn) { btn.disabled = true; btn.textContent = "분석 중..."; }
    try {
      const langCode = document.getElementById("localAiLanguage")?.value || "auto";
      const result = await transcribeFile(state.file, langCode);
      if (!result.text) throw new Error("자막을 만들지 못했어. 음성이 거의 없거나 지원되지 않는 파일일 수 있어.");
      state.transcript = result.text;
      state.chunks = result.chunks;
      setStatus("자막 완성. 핵심 내용 정리 중...", 78);

      const heuristic = heuristicSummary(state.transcript, 6);
      const aiPoints = await browserSummary(state.transcript);
      state.keyPoints = aiPoints?.length ? aiPoints.slice(0, 8) : heuristic.points;
      state.summary = state.keyPoints[0] || heuristic.summary;
      state.timeline = makeTimeline(state.chunks, state.transcript);
      setStatus("분석 완료!", 100);
      renderResult(song);
    } catch (e) {
      console.error(e);
      const msg = String(e?.message || e || "알 수 없는 오류");
      setStatus(`분석 실패: ${msg}`, 0);
      alert(`AI 영상 분석에 실패했어.\n\n${msg}\n\nChrome 최신 버전에서 다시 시도해줘.`);
    } finally {
      state.busy = false;
      if (btn) { btn.disabled = !state.file; btn.textContent = "분석 시작"; }
    }
  }

  function downloadText(name, text) {
    const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(String(text || "")); }
    catch {
      const t = document.createElement("textarea");
      t.value = String(text || "");
      document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
  }

  function renderResult(song) {
    const holder = document.getElementById("localAiResult");
    if (!holder) return;
    if (!state.transcript) { holder.innerHTML = ""; return; }
    const transcriptWithTime = state.chunks?.length
      ? state.chunks.map((c) => `[${fmtTime(c.timestamp?.[0])}] ${c.text}`).join("\n")
      : state.transcript;
    holder.innerHTML = `
      <section class="local-ai-result">
        <div class="local-ai-result-head"><h3>✨ 한줄 요약</h3></div>
        <p class="local-ai-summary">${esc(state.summary || "요약 없음")}</p>

        <h3>⭐ 핵심 내용</h3>
        <ul class="local-ai-points">${state.keyPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>

        <h3>⏱ 구간별 정리</h3>
        <div class="local-ai-timeline">${state.timeline.map((x) => `<div><b>${fmtTime(x.time)}</b><span>${esc(x.text)}</span></div>`).join("") || "<p>타임스탬프 정보가 없어.</p>"}</div>

        <details class="local-ai-transcript" open>
          <summary>💬 전체 자막</summary>
          <pre>${esc(transcriptWithTime)}</pre>
        </details>

        <div class="local-ai-result-actions">
          <button id="localAiCopySummary" type="button">요약 복사</button>
          <button id="localAiCopyTranscript" type="button">자막 복사</button>
          <button id="localAiDownloadTranscript" type="button">자막 txt</button>
          ${song ? `<button id="localAiSave" type="button">현재 영상에 저장</button><button id="localAiClear" type="button" class="danger">저장 결과 삭제</button>` : ""}
        </div>
      </section>
    `;
    const summaryText = [state.summary, "", ...state.keyPoints.map((p) => `- ${p}`)].join("\n");
    document.getElementById("localAiCopySummary")?.addEventListener("click", () => copy(summaryText));
    document.getElementById("localAiCopyTranscript")?.addEventListener("click", () => copy(transcriptWithTime));
    document.getElementById("localAiDownloadTranscript")?.addEventListener("click", () => downloadText(`${(state.file?.name || "video").replace(/\.[^.]+$/, "")}_자막.txt`, transcriptWithTime));
    document.getElementById("localAiSave")?.addEventListener("click", () => saveResult(song));
    document.getElementById("localAiClear")?.addEventListener("click", () => clearSaved(song));
  }

  window.LocalVideoAI = { panelHTML, bindPanel, loadSaved };
})();
