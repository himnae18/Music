// js/app-player.js - 노래 추가/삭제 + 유튜브 플레이어 + 랜덤/반복 버튼

async function addSong() {
  const ytUrl = safeLink(document.getElementById("yt")?.value);
  const lyrics = safeText(document.getElementById("lyrics")?.value);
  const mr = safeLink(document.getElementById("mr")?.value);
  const score = safeLink(document.getElementById("score")?.value);
  const original = safeLink(document.getElementById("original")?.value);

  const id = extractID(ytUrl);
  if (!ytUrl || !id) {
    alert("유튜브 링크가 올바르지 않아! watch?v= 또는 youtu.be 링크로 넣어봐.");
    return;
  }

  const meta = await fetchYouTubeMeta(ytUrl);
  const duplicateMatches = window.AppState?.collectDuplicateSongs?.({
    ytUrl,
    id,
    title: meta.title,
    storeKey: window.AppState?.storeKey || ""
  }) || [];
  if (duplicateMatches.length > 0) {
    const canAddDuplicate = typeof window.AppState?.confirmDuplicateAdd === "function"
      ? window.AppState.confirmDuplicateAdd(duplicateMatches)
      : true;
    if (!canAddDuplicate) return;
  }

  songs.push({
    title: meta.title,
    author: meta.author,
    ytUrl,
    id,
    lyrics,
    mr,
    score,
    original,
    memo: "",
    tags: [],
    aspect: meta.aspect || "",
    thumbnailWidth: meta.thumbnailWidth || 0,
    thumbnailHeight: meta.thumbnailHeight || 0
  });

  save();
  showList();

  ["yt", "lyrics", "mr", "score", "original"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  play(songs.length - 1);
}

function deleteSong(index) {
  if (!songs[index]) return;

  if (window.AppState?.isTagPage?.()) {
    const tag = window.AppState.getCurrentTagParam?.() || "";
    if (!tag) return;
    if (!confirm(`이 영상에서 #${tag} 태그만 제거할까?
원래 페이지의 영상은 삭제되지 않아.`)) return;

    const song = songs[index];
    song.tags = normalizeTags(song.tags).filter((item) => item !== tag);
    window.AppState.saveSongToSource?.(song);

    const wasCurrentTag = index === current;
    songs.splice(index, 1);
    if (songs.length === 0) {
      if (ytPlayer) ytPlayer.stopVideo();
      current = 0;
      showList();
      updateLyricsDrawer();
      updateControlLabels();
      if (typeof renderTagTools === "function") renderTagTools();
      return;
    }

    if (index < current) current--;
    if (current >= songs.length) current = songs.length - 1;
    showList();
    updateLyricsDrawer();
    updateControlLabels();
    if (typeof renderTagTools === "function") renderTagTools();
    if (wasCurrentTag) play(current);
    return;
  }

  if (!confirm("이 노래를 삭제할까?")) return;

  const wasCurrent = index === current;
  songs.splice(index, 1);

  if (songs.length === 0) {
    save();
    if (ytPlayer) ytPlayer.stopVideo();
    current = 0;
    showList();
    updateLyricsDrawer();
    updateControlLabels();
    if (typeof renderTagTools === "function") renderTagTools();
    return;
  }

  if (index < current) current--;
  if (current >= songs.length) current = songs.length - 1;

  save();
  showList();
  updateLyricsDrawer();

  if (wasCurrent) play(current);
}

let ytPlayer = null;
let apiLoading = false;
let apiReady = false;
let playerReady = false;
let apiReadyQueue = [];
const YOUTUBE_CAPTION_LANGUAGE = "ko";
const SEEK_STEP_SECONDS = 5;

// 모드: seq | rand_once | rand_n | rand_auto | loop_n | loop_inf
let playMode = "seq";
let remainingRandom = 0;
let remainingLoops = 0;
let totalRandom = 0;
let totalLoops = 0;
let loopInfinite = false;
let lastRandomIndex = -1;

// 재생 위치 되돌아가기/앞으로가기 기록
let playHistoryBack = [];
let playHistoryForward = [];
const MAX_PLAY_HISTORY = 100;

// 전역 영상 단축키 / 배속 조절
const DEFAULT_PLAYBACK_RATE = 1;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2;
const FALLBACK_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let desiredPlaybackRate = DEFAULT_PLAYBACK_RATE;
let shiftOnlySpeedResetCandidate = false;
let shiftShortcutWasUsed = false;
let playbackSpeedToastTimer = null;

function roundPlaybackRate(rate) {
  return Math.round(Number(rate || DEFAULT_PLAYBACK_RATE) * 100) / 100;
}

function clampPlaybackRate(rate) {
  const n = roundPlaybackRate(rate);
  if (!Number.isFinite(n)) return DEFAULT_PLAYBACK_RATE;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, n));
}

function getAvailablePlaybackRates() {
  try {
    const rates = ytPlayer?.getAvailablePlaybackRates?.();
    if (Array.isArray(rates) && rates.length > 0) {
      return [...new Set(rates.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
    }
  } catch {}
  return FALLBACK_PLAYBACK_RATES;
}

function getCurrentPlaybackRate() {
  try {
    const rate = Number(ytPlayer?.getPlaybackRate?.());
    if (Number.isFinite(rate) && rate > 0) return roundPlaybackRate(rate);
  } catch {}
  return desiredPlaybackRate || DEFAULT_PLAYBACK_RATE;
}

function pickSupportedPlaybackRate(target, direction = 0) {
  const rates = getAvailablePlaybackRates();
  const wanted = clampPlaybackRate(target);
  if (!rates.length) return wanted;

  const exact = rates.find((rate) => Math.abs(rate - wanted) < 0.001);
  if (exact !== undefined) return exact;

  if (direction < 0) {
    const lower = rates.filter((rate) => rate <= wanted).at(-1);
    if (lower !== undefined) return lower;
  }

  if (direction > 0) {
    const higher = rates.find((rate) => rate >= wanted);
    if (higher !== undefined) return higher;
  }

  return rates.reduce((best, rate) => Math.abs(rate - wanted) < Math.abs(best - wanted) ? rate : best, rates[0]);
}

function showPlaybackSpeedToast(rate, note = "") {
  let toast = document.getElementById("playbackSpeedToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "playbackSpeedToast";
    toast.setAttribute("aria-live", "polite");
    Object.assign(toast.style, {
      position: "fixed",
      left: "50%",
      bottom: "28px",
      transform: "translateX(-50%)",
      zIndex: "99999",
      padding: "10px 14px",
      borderRadius: "999px",
      background: "rgba(0, 0, 0, 0.78)",
      color: "#fff",
      fontSize: "14px",
      fontWeight: "700",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.15s ease"
    });
    document.body.appendChild(toast);
  }

  toast.textContent = `배속 ${Number(rate).toFixed(2)}x${note}`;
  toast.style.opacity = "1";
  clearTimeout(playbackSpeedToastTimer);
  playbackSpeedToastTimer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 900);
}

function setPlayerPlaybackRate(rate, direction = 0, options = {}) {
  if (!ytPlayer || typeof ytPlayer.setPlaybackRate !== "function") return false;

  const wanted = clampPlaybackRate(rate);
  const next = pickSupportedPlaybackRate(wanted, direction);
  const roundedNext = roundPlaybackRate(next);

  try {
    ytPlayer.setPlaybackRate(roundedNext);
    desiredPlaybackRate = roundedNext;
    if (!options.silent) {
      const roundedWanted = roundPlaybackRate(wanted);
      const note = Math.abs(roundedWanted - roundedNext) > 0.001 ? " (유튜브 가능 배속)" : "";
      showPlaybackSpeedToast(roundedNext, note);
    }
    return true;
  } catch {
    return false;
  }
}

function changePlayerPlaybackRate(amount) {
  const currentRate = getCurrentPlaybackRate();
  return setPlayerPlaybackRate(currentRate + amount, amount);
}

function resetPlayerPlaybackRate() {
  return setPlayerPlaybackRate(DEFAULT_PLAYBACK_RATE, 0);
}

function focusPlayerArea() {
  const playerArea = document.querySelector(".player-wrap") || document.getElementById("player");
  if (!playerArea) return;
  if (!playerArea.hasAttribute("tabindex")) playerArea.setAttribute("tabindex", "-1");
  try { playerArea.focus({ preventScroll: true }); } catch {}
}

function togglePlayerPlayPause() {
  if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") return false;

  try {
    const state = ytPlayer.getPlayerState();
    const YTP = window.YT?.PlayerState || {};
    if (state === YTP.PLAYING || state === YTP.BUFFERING) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
    focusPlayerArea();
    return true;
  } catch {
    return false;
  }
}

function isAnyModalOpen() {
  return Boolean(document.querySelector(".modal-overlay.open"));
}

function isPlainSpaceKey(e) {
  return e.code === "Space" || e.key === " " || e.key === "Spacebar";
}

function seekPlayerRelative(seconds) {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function" || typeof ytPlayer.seekTo !== "function") return false;

  try {
    const now = Number(ytPlayer.getCurrentTime()) || 0;
    const duration = Number(ytPlayer.getDuration?.()) || 0;
    let next = now + Number(seconds || 0);
    if (duration > 0) next = Math.min(duration, next);
    next = Math.max(0, next);
    ytPlayer.seekTo(next, true);
    focusPlayerArea();
    return true;
  } catch {
    return false;
  }
}

function applyKoreanCaptions() {
  if (!ytPlayer) return;

  try { ytPlayer.loadModule?.("captions"); } catch {}
  try { ytPlayer.loadModule?.("cc"); } catch {}

  const apply = () => {
    try {
      ytPlayer.setOption?.("captions", "track", { languageCode: YOUTUBE_CAPTION_LANGUAGE });
    } catch {}
    try {
      ytPlayer.setOption?.("cc", "track", { languageCode: YOUTUBE_CAPTION_LANGUAGE });
    } catch {}
  };

  apply();
  window.setTimeout(apply, 450);
  window.setTimeout(apply, 1200);
}

function getDraggedYoutubeUrl(e) {
  const dt = e.dataTransfer;
  if (!dt) return "";
  const values = [
    dt.getData("text/uri-list"),
    dt.getData("text/plain"),
    dt.getData("text"),
    dt.getData("text/html")
  ].filter(Boolean);
  const joined = values.join("\n");
  const match = joined.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/i);
  return safeLink(match ? match[0] : values[0] || "");
}

function bindAddSongDropTargets() {
  const ytInput = document.getElementById("yt");
  if (!ytInput) return;

  const addButton = ytInput.closest(".add-song-row")?.querySelector(".add-song-btn");
  const addSection = ytInput.closest(".add-song-section");
  const targets = [...new Set([addSection, ytInput, addButton].filter(Boolean))];

  targets.forEach((target) => {
    if (target.dataset.youtubeAddDropBound === "1") return;
    target.dataset.youtubeAddDropBound = "1";

    target.addEventListener("dragover", (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes("application/x-fivep-song") || types.includes("application/x-library-song")) return;
      const maybeUrl = types.includes("text/uri-list") || types.includes("text/plain") || types.includes("text/html") || types.includes("text");
      if (!maybeUrl) return;
      e.preventDefault();
      target.classList.add("is-url-dragover");
      if (addSection) addSection.classList.add("is-url-dragover");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    target.addEventListener("dragleave", (e) => {
      if (target.contains(e.relatedTarget)) return;
      target.classList.remove("is-url-dragover");
      if (addSection && !addSection.contains(e.relatedTarget)) addSection.classList.remove("is-url-dragover");
    });

    target.addEventListener("drop", (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes("application/x-fivep-song") || types.includes("application/x-library-song")) return;
      const url = getDraggedYoutubeUrl(e);
      if (!url || !extractID(url)) return;
      e.preventDefault();
      e.stopPropagation();
      targets.forEach((el) => el.classList.remove("is-url-dragover"));
      if (addSection) addSection.classList.remove("is-url-dragover");
      ytInput.value = url;
      addSong();
    });
  });
}

function setupGlobalPlayerShortcuts() {
  focusPlayerArea();

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (isAnyModalOpen()) return;
    if (isShortcutTypingTarget(e.target)) return;

    const code = e.code || "";
    const plainShiftCombo = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

    if ((code === "ShiftLeft" || code === "ShiftRight" || e.key === "Shift") && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      shiftOnlySpeedResetCandidate = true;
      shiftShortcutWasUsed = false;
      return;
    }

    if (plainShiftCombo) {
      const speedShortcuts = {
        Comma: -0.25,      // Shift + ,
        Period: 0.25,      // Shift + .
        Semicolon: -0.10,  // Shift + ;
        Quote: -0.50       // Shift + '
      };

      if (Object.prototype.hasOwnProperty.call(speedShortcuts, code)) {
        e.preventDefault();
        e.stopPropagation();
        shiftShortcutWasUsed = true;
        changePlayerPlaybackRate(speedShortcuts[code]);
        focusPlayerArea();
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const key = String(e.key || "").toLowerCase();
      if (e.key === "ArrowLeft" || key === "j") {
        if (seekPlayerRelative(-SEEK_STEP_SECONDS)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (e.key === "ArrowRight" || key === "l") {
        if (seekPlayerRelative(SEEK_STEP_SECONDS)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && isPlainSpaceKey(e)) {
      if (togglePlayerPlayPause()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  document.addEventListener("keyup", (e) => {
    const isShiftUp = e.code === "ShiftLeft" || e.code === "ShiftRight" || e.key === "Shift";
    if (!isShiftUp || !shiftOnlySpeedResetCandidate) return;

    if (!shiftShortcutWasUsed && !isAnyModalOpen() && !isShortcutTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      resetPlayerPlaybackRate();
      focusPlayerArea();
    }

    shiftOnlySpeedResetCandidate = false;
    shiftShortcutWasUsed = false;
  }, true);
}

function trimPlayHistory() {
  if (playHistoryBack.length > MAX_PLAY_HISTORY) playHistoryBack = playHistoryBack.slice(-MAX_PLAY_HISTORY);
  if (playHistoryForward.length > MAX_PLAY_HISTORY) playHistoryForward = playHistoryForward.slice(-MAX_PLAY_HISTORY);
}

function updateHistoryButtons() {
  const backBtn = document.getElementById("btnHistoryBack");
  const forwardBtn = document.getElementById("btnHistoryForward");
  if (backBtn) {
    backBtn.disabled = playHistoryBack.length === 0;
    backBtn.title = playHistoryBack.length === 0 ? "되돌아갈 노래가 없어." : "이전에 들었던 노래로 이동 (Ctrl+Z)";
  }
  if (forwardBtn) {
    forwardBtn.disabled = playHistoryForward.length === 0;
    forwardBtn.title = playHistoryForward.length === 0 ? "앞으로 갈 노래가 없어." : "되돌아간 노래에서 다시 앞으로 이동 (Ctrl+X)";
  }
}

function prunePlayHistory() {
  playHistoryBack = playHistoryBack.filter((idx) => songs[idx]);
  playHistoryForward = playHistoryForward.filter((idx) => songs[idx]);
  updateHistoryButtons();
}

const videoAspectCache = new Map();

function getStoredVideoAspect(song) {
  const raw = String(song?.aspect || song?.videoAspect || song?.orientation || song?.videoOrientation || "").trim().toLowerCase();
  if (["portrait", "vertical", "세로", "9:16", "1080x1920"].includes(raw)) return "portrait";
  if (["landscape", "horizontal", "가로", "16:9", "1920x1080"].includes(raw)) return "landscape";

  const w = Number(song?.thumbnailWidth || song?.thumbnail_width || song?.thumbWidth || 0) || 0;
  const h = Number(song?.thumbnailHeight || song?.thumbnail_height || song?.thumbHeight || 0) || 0;
  if (w > 0 && h > 0) {
    if (h > w * 1.15) return "portrait";
    if (w > h * 1.15) return "landscape";
  }

  return "";
}

function getLikelyVideoAspect(song) {
  const stored = getStoredVideoAspect(song);
  if (stored) return stored;

  const url = safeLink(song?.ytUrl || song?.url || "");
  if (/youtube\.com\/shorts\//i.test(url) || /\/shorts\//i.test(url)) return "portrait";

  const hintText = [
    song?.title || "",
    song?.author || "",
    ...(Array.isArray(song?.tags) ? song.tags : [])
  ].join(" ").toLowerCase();
  if (/(^|[#\s])(shorts?|쇼츠)($|[#\s])|세로|vertical|9:16|1080x1920/i.test(hintText)) return "portrait";

  const id = String(song?.id || extractID(url) || "").trim();
  if (id && videoAspectCache.has(id)) return videoAspectCache.get(id);

  return "landscape";
}

function setPlayerAspectClass(aspect) {
  const wrap = document.querySelector(".player-wrap");
  if (!wrap) return;

  wrap.classList.remove("player-portrait", "player-landscape");
  wrap.classList.add(aspect === "portrait" ? "player-portrait" : "player-landscape");
}

function loadImageSize(src, timeout = 2200) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeout);
    img.onload = () => finish({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => finish(null);
    img.src = src;
  });
}

async function detectThumbnailAspect(song) {
  const url = safeLink(song?.ytUrl || song?.url || "");
  const id = String(song?.id || extractID(url) || "").trim();
  if (!id) return "";
  if (videoAspectCache.has(id)) return videoAspectCache.get(id);

  const candidates = [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  ];

  for (const src of candidates) {
    const size = await loadImageSize(src);
    if (!size || size.width < 240 || size.height < 240) continue;

    if (size.height > size.width * 1.15) {
      videoAspectCache.set(id, "portrait");
      return "portrait";
    }

    if (size.width > size.height * 1.15) {
      videoAspectCache.set(id, "landscape");
      return "landscape";
    }
  }

  videoAspectCache.set(id, "landscape");
  return "landscape";
}

function applyPlayerFrame(song) {
  const wrap = document.querySelector(".player-wrap");
  if (!wrap) return;

  const url = safeLink(song?.ytUrl || song?.url || "");
  const id = String(song?.id || extractID(url) || "").trim();
  wrap.dataset.videoId = id;

  const firstAspect = getLikelyVideoAspect(song);
  setPlayerAspectClass(firstAspect);

  if (firstAspect === "portrait" || getStoredVideoAspect(song)) return;

  detectThumbnailAspect(song).then((detectedAspect) => {
    if (!detectedAspect) return;
    const currentId = String(wrap.dataset.videoId || "");
    if (id && currentId !== id) return;
    setPlayerAspectClass(detectedAspect);
  }).catch(() => {});
}

function flushPlayerReadyQueue() {
  const q = [...apiReadyQueue];
  apiReadyQueue = [];
  q.forEach((fn) => {
    try { fn(); } catch {}
  });
}

function createYouTubePlayerOnce() {
  if (ytPlayer || !window.YT || typeof window.YT.Player !== "function") return;

  ytPlayer = new YT.Player("player", {
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1,
      rel: 0,
      playsinline: 1,
      hl: "ko",
      cc_lang_pref: YOUTUBE_CAPTION_LANGUAGE,
      cc_load_policy: 1
    },
    events: {
      onReady: () => {
        apiReady = true;
        playerReady = true;
        apiLoading = false;
        applyKoreanCaptions();
        flushPlayerReadyQueue();
      },
      onStateChange: onPlayerStateChange
    }
  });
}

function ensurePlayerReady(cb) {
  if (ytPlayer && apiReady && playerReady) {
    cb();
    return;
  }

  apiReadyQueue.push(cb);

  if (window.YT && typeof window.YT.Player === "function") {
    createYouTubePlayerOnce();
    return;
  }

  if (apiLoading) return;
  apiLoading = true;

  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    try {
      if (typeof prev === "function") prev();
    } catch {}
    createYouTubePlayerOnce();
  };

  if (!document.getElementById("yt-iframe-api")) {
    const tag = document.createElement("script");
    tag.id = "yt-iframe-api";
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      apiLoading = false;
    };
    document.head.appendChild(tag);
  }
}

function ensureTopTrackNavButtons() {
  const titleBar = document.querySelector(".page-title-bar");
  if (!titleBar || document.getElementById("btnPrevTrack")) return;

  const nav = document.createElement("div");
  nav.className = "title-track-nav";
  nav.innerHTML = `
    <button id="btnPrevTrack" class="title-track-btn" type="button" aria-label="이전 노래">&lt;</button>
    <button id="btnNextTrack" class="title-track-btn" type="button" aria-label="다음 노래">&gt;</button>
  `;
  titleBar.appendChild(nav);
}

function play(i, options = {}) {
  const nextIndex = Number(i);
  if (!Number.isFinite(nextIndex) || !songs[nextIndex] || !songs[nextIndex].id) return;

  if (!options.fromHistory && songs[current] && nextIndex !== current) {
    playHistoryBack.push(current);
    playHistoryForward = [];
    trimPlayHistory();
  }

  current = nextIndex;
  applyPlayerFrame(songs[nextIndex]);

  ensurePlayerReady(() => {
    ytPlayer.loadVideoById(songs[nextIndex].id);
    applyKoreanCaptions();
    setTimeout(() => setPlayerPlaybackRate(desiredPlaybackRate, 0, { silent: true }), 350);
  });

  showList();
  updateLyricsDrawer();
  updateControlLabels();
  if (typeof renderTagTools === "function") renderTagTools();
}

function goBackSong() {
  prunePlayHistory();
  const prev = playHistoryBack.pop();
  if (prev === undefined || !songs[prev]) {
    updateHistoryButtons();
    return;
  }
  if (songs[current]) playHistoryForward.push(current);
  trimPlayHistory();
  play(prev, { fromHistory: true });
}

function goForwardSong() {
  prunePlayHistory();
  const next = playHistoryForward.pop();
  if (next === undefined || !songs[next]) {
    updateHistoryButtons();
    return;
  }
  if (songs[current]) playHistoryBack.push(current);
  trimPlayHistory();
  play(next, { fromHistory: true });
}

function playMr(i) {
  const song = songs[i];
  if (!song) return;

  const mrUrl = safeLink(song.mr);
  if (!mrUrl) {
    alert("이 곡은 MR 링크가 없어.");
    return;
  }

  const mrId = extractID(mrUrl);
  if (!mrId) {
    window.open(mrUrl, "_blank", "noopener");
    return;
  }

  current = i;
  applyPlayerFrame({ ytUrl: mrUrl, id: mrId });
  ensurePlayerReady(() => {
    ytPlayer.loadVideoById(mrId);
    applyKoreanCaptions();
    setTimeout(() => setPlayerPlaybackRate(desiredPlaybackRate, 0, { silent: true }), 350);
  });

  showList();
  updateLyricsDrawer();
  updateControlLabels();
}

function onPlayerStateChange(e) {
  if (e.data !== 0) return; // 0 = ended

  if (loopInfinite) {
    ytPlayer.playVideo();
    return;
  }

  if (playMode === "loop_n") {
    if (remainingLoops > 1) {
      remainingLoops--;
      updateControlLabels();
      ytPlayer.playVideo();
      return;
    }
    playMode = "seq";
    remainingLoops = 0;
    totalLoops = 0;
    updateControlLabels();
  }

  if (playMode === "rand_n") {
    if (remainingRandom > 1) {
      remainingRandom--;
      updateControlLabels();
      playRandomPickAndPlay(true);
      return;
    }
    playMode = "seq";
    remainingRandom = 0;
    totalRandom = 0;
    updateControlLabels();
    return;
  }

  if (playMode === "rand_auto") {
    playRandomPickAndPlay(true);
    return;
  }

  if (playMode === "rand_once") {
    playMode = "seq";
    updateControlLabels();
    return;
  }

  playNextSequential();
}

function playNextSequential() {
  if (songs.length === 0) return;
  const next = (current + 1) % songs.length;
  play(next);
}

function pickRandomIndex(excludeConsecutive = true) {
  const n = songs.length;
  if (n === 0) return -1;
  if (n === 1) return 0;

  let tries = 0;
  let idx = Math.floor(Math.random() * n);

  while (excludeConsecutive && tries < 30 && (idx === current || idx === lastRandomIndex)) {
    idx = Math.floor(Math.random() * n);
    tries++;
  }

  return idx;
}

function playRandomPickAndPlay(excludeConsecutive = true) {
  const idx = pickRandomIndex(excludeConsecutive);
  if (idx === -1) return;
  lastRandomIndex = idx;
  play(idx);
}

function setActiveControl(activeId) {
  const ids = ["btnSeq", "btnRandOne", "btnRand10", "btnRandAuto", "btnLoop5", "btnLoop10", "btnLoopInf"];
  ids.forEach((id) => document.getElementById(id)?.classList.remove("active-control"));
  document.getElementById(activeId)?.classList.add("active-control");
  updateControlLabels();
}

function resetPlayCounters() {
  loopInfinite = false;
  remainingLoops = 0;
  totalLoops = 0;
  remainingRandom = 0;
  totalRandom = 0;
}

function updateControlLabels() {
  const base = {
    btnSeq: "순서대로",
    btnRandOne: "랜덤곡",
    btnRand10: "랜덤곡 10회",
    btnRandAuto: "랜덤자동재생",
    btnLoop5: "5회반복",
    btnLoop10: "10회반복",
    btnLoopInf: "무한반복"
  };

  Object.entries(base).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });

  updateHistoryButtons();

  if (playMode === "rand_n" && totalRandom > 0) {
    const el = document.getElementById("btnRand10");
    if (el) el.textContent = `랜덤곡 10회 (${remainingRandom}/${totalRandom})`;
  }

  if (playMode === "loop_n" && totalLoops > 0) {
    const id = totalLoops === 5 ? "btnLoop5" : "btnLoop10";
    const el = document.getElementById(id);
    if (el) el.textContent = `${totalLoops}회반복 (${remainingLoops}/${totalLoops})`;
  }

  if (playMode === "rand_auto") {
    const el = document.getElementById("btnRandAuto");
    if (el) el.textContent = "랜덤자동재생 (ON)";
  }

  if (playMode === "loop_inf") {
    const el = document.getElementById("btnLoopInf");
    if (el) el.textContent = "무한반복 (ON)";
  }
}

function isShortcutTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return target?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

document.addEventListener("DOMContentLoaded", () => {
  ensureTopTrackNavButtons();
  const ytInput = document.getElementById("yt");

  ytInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    addSong();
  });

  bindAddSongDropTargets();
  setupGlobalPlayerShortcuts();

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (document.querySelector(".modal-overlay.open")) return;

    if (!isShortcutTypingTarget(e.target)) {
      const key = String(e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "z") {
        e.preventDefault();
        goBackSong();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "x") {
        e.preventDefault();
        goForwardSong();
        return;
      }
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isShortcutTypingTarget(e.target)) return;

    const key = String(e.key || "").toLowerCase();
    const inputId = key === "q" ? "yt" : key === "w" ? "tagInput" : "";
    if (!inputId) return;

    const input = document.getElementById(inputId);
    if (!input || input.disabled) return;
    e.preventDefault();
    input.focus();
    input.select?.();
  });

  document.getElementById("lyricsBtn")?.addEventListener("click", toggleLyricsDrawer);
  document.getElementById("lyricsCloseBtn")?.addEventListener("click", closeLyricsDrawer);
  document.getElementById("lyricsOverlay")?.addEventListener("click", closeLyricsDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLyricsDrawer();
  });

  const qs = (id) => document.getElementById(id);

  qs("btnSeq")?.addEventListener("click", () => {
    playMode = "seq";
    resetPlayCounters();
    setActiveControl("btnSeq");
  });

  qs("btnRandOne")?.addEventListener("click", () => {
    playMode = "rand_once";
    resetPlayCounters();
    setActiveControl("btnRandOne");
    playRandomPickAndPlay(true);
  });

  qs("btnRand10")?.addEventListener("click", () => {
    playMode = "rand_n";
    resetPlayCounters();
    totalRandom = 10;
    remainingRandom = 10;
    setActiveControl("btnRand10");
    playRandomPickAndPlay(true);
  });

  qs("btnRandAuto")?.addEventListener("click", () => {
    playMode = "rand_auto";
    resetPlayCounters();
    setActiveControl("btnRandAuto");
    if (!songs[current]) playRandomPickAndPlay(true);
  });

  qs("btnLoop5")?.addEventListener("click", () => {
    if (!songs[current]) return alert("먼저 노래를 하나 재생해줘!");
    playMode = "loop_n";
    resetPlayCounters();
    totalLoops = 5;
    remainingLoops = 5;
    setActiveControl("btnLoop5");
  });

  qs("btnLoop10")?.addEventListener("click", () => {
    if (!songs[current]) return alert("먼저 노래를 하나 재생해줘!");
    playMode = "loop_n";
    resetPlayCounters();
    totalLoops = 10;
    remainingLoops = 10;
    setActiveControl("btnLoop10");
  });

  qs("btnLoopInf")?.addEventListener("click", () => {
    if (!songs[current]) return alert("먼저 노래를 하나 재생해줘!");
    playMode = "loop_inf";
    resetPlayCounters();
    loopInfinite = true;
    setActiveControl("btnLoopInf");
  });

  qs("btnHistoryBack")?.addEventListener("click", goBackSong);
  qs("btnHistoryForward")?.addEventListener("click", goForwardSong);
  qs("btnPrevTrack")?.addEventListener("click", previousSong);
  qs("btnNextTrack")?.addEventListener("click", nextSong);

  qs("btnEdit")?.addEventListener("click", () => openEditModal());

  qs("btnDelete")?.addEventListener("click", () => {
    if (!songs[current]) return alert("먼저 노래를 하나 재생해줘!");
    deleteSong(current);
    prunePlayHistory();
  });

  showList();
  updateLyricsDrawer();
  updateControlLabels();
  if (typeof renderTagTools === "function") renderTagTools();
  updateHistoryButtons();

  const params = new URLSearchParams(location.search);
  const playId = params.get("play");
  if (playId) {
    const foundIndex = songs.findIndex((song) => song.id === playId || song.ytUrl === playId);
    if (foundIndex >= 0) play(foundIndex);
  }
});

function previousSong() {
  if (!songs.length) return;
  const prev = (current - 1 + songs.length) % songs.length;
  play(prev);
}

function nextSong() {
  playNextSequential();
}

function randomSong() {
  playRandomPickAndPlay(true);
}

window.goBackSong = goBackSong;
window.previousSong = previousSong;
window.goForwardSong = goForwardSong;
window.changePlayerPlaybackRate = changePlayerPlaybackRate;
window.resetPlayerPlaybackRate = resetPlayerPlaybackRate;
window.togglePlayerPlayPause = togglePlayerPlayPause;
