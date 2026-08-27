// js/app-player.js - 노래 추가/삭제 + 유튜브 플레이어 + 랜덤/반복 버튼

async function addSong() {
  const ytUrl = safeLink(document.getElementById("yt")?.value);
  const lyrics = safeText(document.getElementById("lyrics")?.value);
  const mr = safeLink(document.getElementById("mr")?.value);
  const score = safeLink(document.getElementById("score")?.value);
  const original = safeLink(document.getElementById("original")?.value);

  const id = extractID(ytUrl);
  if (!ytUrl || !id) {
    alert("유튜브 영상 링크가 올바르지 않아!");
    return;
  }

  const meta = await fetchYouTubeMeta(ytUrl);
  const archivedRecord = typeof window.AppState?.findRemovedVideoRecord === "function"
    ? window.AppState.findRemovedVideoRecord({ ytUrl, id, title: meta.title, storeKey: window.AppState?.storeKey || "" })
    : null;
  if (archivedRecord) {
    const allowArchived = typeof window.AppState?.openArchivedDuplicateDialog === "function"
      ? await window.AppState.openArchivedDuplicateDialog(archivedRecord)
      : true;
    if (!allowArchived) return;
  }

  const exactDuplicateMatches = window.AppState?.collectExactVideoDuplicates?.({ ytUrl, id }) || [];
  if (exactDuplicateMatches.length > 0) {
    const canAddExactDuplicate = typeof window.AppState?.confirmExactVideoDuplicateAdd === "function"
      ? window.AppState.confirmExactVideoDuplicateAdd(exactDuplicateMatches)
      : true;
    if (!canAddExactDuplicate) return;
  }

  // 기존의 같은-제목 확인은 그대로 유지하되, 같은 영상으로 이미 한 번 물은 경우 두 번 묻지 않는다.
  const duplicateMatches = exactDuplicateMatches.length > 0 ? [] : (window.AppState?.collectDuplicateSongs?.({
    ytUrl,
    id,
    title: meta.title,
    storeKey: window.AppState?.storeKey || ""
  }) || []);
  if (duplicateMatches.length > 0) {
    const canAddDuplicate = typeof window.AppState?.confirmDuplicateAdd === "function"
      ? window.AppState.confirmDuplicateAdd(duplicateMatches)
      : true;
    if (!canAddDuplicate) return;
  }

  songs.push({
    title: archivedRecord?.title || meta.title,
    author: archivedRecord?.author || meta.author,
    ytUrl,
    id,
    lyrics: archivedRecord ? String(archivedRecord.lyrics || "") : lyrics,
    mr: archivedRecord ? safeLink(archivedRecord.mr || "") : mr,
    score,
    original: archivedRecord ? safeLink(archivedRecord.original || "") : original,
    memo: archivedRecord ? String(archivedRecord.memo || "") : "",
    tags: archivedRecord?.tags || [],
    aspect: meta.aspect || archivedRecord?.aspect || "",
    thumbnailWidth: meta.thumbnailWidth || archivedRecord?.thumbnailWidth || 0,
    thumbnailHeight: meta.thumbnailHeight || archivedRecord?.thumbnailHeight || 0
  });

  // 같은 영상 묶기에서 위치가 바뀌어도 방금 추가한 항목을 현재 곡으로 유지한다.
  current = songs.length - 1;
  save();
  showList();

  ["yt", "lyrics", "mr", "score", "original"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  play(current);
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

// YouTube의 공개 watch-page "Most Replayed"(가장 많이 다시 본 장면) 데이터를
// 브라우저에서 사용할 수 있도록 공개 운영 API 미러를 통해 읽는다.
// YouTube Data API / IFrame API 자체에는 이 heatmap 필드가 노출되지 않는다.
const YOUTUBE_MOST_REPLAYED_ENDPOINTS = [
  "https://yt.mtdv.me/videos?part=mostReplayed&id=",
  "https://ytapp.thecurrent.pk/videos?part=mostReplayed&id="
];
const modernHeatmapCache = new Map();
const modernStoryboardCache = new Map();
let modernHeatmapRequestSerial = 0;

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

// 유튜브 iframe이 키보드 포커스를 가져가면 사이트 단축키 이벤트를 받을 수 없다.
// 다만 클릭 직후 강제로 포커스를 뺏으면 유튜브의 볼륨 슬라이더/설정창이 즉시 닫힌다.
// 그래서 마우스가 플레이어 안에 있는 동안에는 유튜브의 포커스를 유지하고,
// 플레이어 밖으로 나왔을 때만 사이트 쪽으로 포커스를 되돌린다.
function keepFiveSecondSeekShortcuts() {
  if (window.__fiveSecondSeekFocusBound) return;
  window.__fiveSecondSeekFocusBound = true;

  const wrap = document.querySelector(".player-wrap");
  if (!wrap) return;
  let pointerInsideYoutube = false;

  wrap.addEventListener("mouseenter", () => {
    pointerInsideYoutube = true;
  });

  wrap.addEventListener("mouseleave", () => {
    pointerInsideYoutube = false;
    // 커스텀 재생바도 플레이어 안에 포함된다. 영상 밖으로 마우스를 빼면
    // 즉시 사이트 쪽으로 포커스를 되돌리고 컨트롤은 CSS에서 바로 숨긴다.
    window.setTimeout(() => {
      const iframe = ytPlayer?.getIframe?.();
      const fullscreenEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenEl === wrap || fullscreenEl === iframe) return;
      try { iframe?.blur?.(); } catch {}
      focusPlayerArea();
    }, 0);
  });

  window.addEventListener("blur", () => {
    window.setTimeout(() => {
      const iframe = ytPlayer?.getIframe?.();
      if (iframe && document.activeElement === iframe && !pointerInsideYoutube) {
        focusPlayerArea();
      }
    }, 0);
  });
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

let modernCaptionsEnabled = true;

function applyKoreanCaptions() {
  if (!ytPlayer) return;
  if (!modernCaptionsEnabled) {
    try { ytPlayer.unloadModule?.("captions"); } catch {}
    try { ytPlayer.unloadModule?.("cc"); } catch {}
    return;
  }

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
  const url = safeLink(song?.ytUrl || song?.url || "");
  const stored = getStoredVideoAspect(song);

  // 명시적으로 세로 저장된 값은 가장 먼저 사용한다.
  if (stored === "portrait") return "portrait";

  // 예전에 oEmbed 썸네일 때문에 landscape로 잘못 저장된 Shorts도 다시 세로로 보정한다.
  if (/youtube\.com\/shorts\//i.test(url) || /\/shorts\//i.test(url)) return "portrait";

  const hintText = [
    song?.title || "",
    song?.author || "",
    ...(Array.isArray(song?.tags) ? song.tags : [])
  ].join(" ").toLowerCase();
  if (/(^|[#\s])(shorts?|쇼츠)($|[#\s])|세로|vertical|9:16|1080x1920/i.test(hintText)) return "portrait";

  const id = String(song?.id || extractID(url) || "").trim();
  if (id && videoAspectCache.has(id)) return videoAspectCache.get(id);
  if (stored === "landscape") return "landscape";

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
    img.crossOrigin = "anonymous";
    img.onload = () => finish({
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
      image: img
    });
    img.onerror = () => finish(null);
    img.src = src;
  });
}

function thumbnailHasPortraitPillarbox(image) {
  if (!image) return false;

  try {
    const canvas = document.createElement("canvas");
    const width = 160;
    const height = 90;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0, width, height);

    const pixels = ctx.getImageData(0, 0, width, height).data;
    const yStart = 5;
    const yEnd = height - 5;

    const columnStats = (x) => {
      let sum = 0;
      let sumSq = 0;
      let dark = 0;
      let count = 0;
      for (let y = yStart; y < yEnd; y++) {
        const i = (y * width + x) * 4;
        const lum = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
        sum += lum;
        sumSq += lum * lum;
        if (lum < 24) dark++;
        count++;
      }
      const mean = count ? sum / count : 0;
      const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
      return {
        mean,
        deviation: Math.sqrt(variance),
        darkRatio: count ? dark / count : 0
      };
    };

    const columns = Array.from({ length: width }, (_, x) => columnStats(x));
    const isBlackBarColumn = (stat) => stat.mean < 22 && stat.darkRatio > 0.9 && stat.deviation < 18;

    let leftBar = 0;
    while (leftBar < width / 2 && isBlackBarColumn(columns[leftBar])) leftBar++;

    let rightBar = 0;
    while (rightBar < width / 2 && isBlackBarColumn(columns[width - 1 - rightBar])) rightBar++;

    const minBar = Math.floor(width * 0.18);
    const maxBar = Math.ceil(width * 0.39);
    if (leftBar < minBar || rightBar < minBar || leftBar > maxBar || rightBar > maxBar) return false;
    if (Math.abs(leftBar - rightBar) > Math.ceil(width * 0.05)) return false;

    const contentStart = leftBar;
    const contentEnd = width - rightBar;
    const contentWidth = contentEnd - contentStart;
    const contentRatio = contentWidth / height;
    if (contentRatio < 0.4 || contentRatio > 0.92) return false;

    const regionStats = (x0, x1) => {
      let sum = 0;
      let active = 0;
      let count = 0;
      for (let y = yStart; y < yEnd; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          const lum = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
          sum += lum;
          if (lum > 38) active++;
          count++;
        }
      }
      return {
        mean: count ? sum / count : 0,
        activeRatio: count ? active / count : 0
      };
    };

    const center = regionStats(contentStart, contentEnd);
    const leftEdgeMean = columns.slice(0, leftBar).reduce((sum, stat) => sum + stat.mean, 0) / Math.max(1, leftBar);
    const rightEdgeMean = columns.slice(width - rightBar).reduce((sum, stat) => sum + stat.mean, 0) / Math.max(1, rightBar);
    const edgeMean = (leftEdgeMean + rightEdgeMean) / 2;

    const leftBoundary = columns[Math.min(width - 1, contentStart + 2)]?.mean || 0;
    const rightBoundary = columns[Math.max(0, contentEnd - 3)]?.mean || 0;

    // 실제 9:16/4:5 영상처럼 양옆에 넓고 균일한 검은 기둥이 있을 때만 세로로 판정한다.
    // 단순히 화면 가장자리가 어두운 가로 영상은 이 조건을 통과하지 못한다.
    return center.mean > edgeMean + 30
      && center.activeRatio > 0.28
      && leftBoundary > edgeMean + 18
      && rightBoundary > edgeMean + 18;
  } catch {
    // CORS 등으로 픽셀 판독이 막히면 기존 판정으로 안전하게 돌아간다.
    return false;
  }
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

    if (size.height > size.width * 1.15 || thumbnailHasPortraitPillarbox(size.image)) {
      videoAspectCache.set(id, "portrait");
      return "portrait";
    }

    // 썸네일은 실제 세로 영상도 가로 캔버스로 제공될 수 있어,
    // 단순히 width > height라는 이유만으로 즉시 가로 확정하지 않는다.
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

  // 세로는 즉시 적용한다. 저장된 landscape 값은 과거 oEmbed 오판일 수 있으므로
  // 썸네일 검사를 한 번 더 진행해 일반 링크의 세로 영상도 잡아낸다.
  if (firstAspect === "portrait") return;

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


function modernPlayerIcon(name) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12 8 5.2Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.5v14H6V5Zm3.7 7L19 5.8v12.4L9.7 12Z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5H18v14h-2.5V5ZM5 5.8 14.3 12 5 18.2V5.8Z"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm11.5-.7v2c1 .5 1.7 1.5 1.7 2.7s-.7 2.2-1.7 2.7v2c2.1-.6 3.7-2.5 3.7-4.7s-1.6-4.1-3.7-4.7Z"/></svg>',
    muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm11.1 1.3 1.4 1.4 1.4-1.4 1.1 1.1-1.4 1.4 1.4 1.4-1.1 1.1-1.4-1.4-1.4 1.4-1.1-1.1 1.4-1.4-1.4-1.4 1.1-1.1Z"/></svg>',
    cc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm4.7 5.2c-.3-.4-.8-.7-1.4-.7-1.1 0-1.8.9-1.8 2.5s.7 2.5 1.8 2.5c.7 0 1.2-.3 1.5-.8l1.2.8c-.6.9-1.5 1.4-2.8 1.4-2.1 0-3.5-1.5-3.5-3.9s1.4-3.9 3.5-3.9c1.2 0 2.2.5 2.8 1.4l-1.3.7Zm7 0c-.3-.4-.8-.7-1.4-.7-1.1 0-1.8.9-1.8 2.5s.7 2.5 1.8 2.5c.7 0 1.2-.3 1.5-.8l1.2.8c-.6.9-1.5 1.4-2.8 1.4-2.1 0-3.5-1.5-3.5-3.9s1.4-3.9 3.5-3.9c1.2 0 2.2.5 2.8 1.4l-1.3.7Z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L15 3.5h-4L10.7 6a8 8 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0-.1 1 7.8 7.8 0 0 0 .1 1l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.3 2.5h4l.3-2.5a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2.1-1.4ZM13 15.3A3.3 3.3 0 1 1 13 8.7a3.3 3.3 0 0 1 0 6.6Z"/></svg>',
    mini: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3V5Zm2 2v10h14V7H5Zm7 5h6v4h-6v-4Z"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3H4Zm11-5h5v5h-2V6h-3V4ZM4 15h2v3h3v2H4v-5Zm14 0h2v5h-5v-2h3v-3Z"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.2A8 8 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.5 5.2L19 9l-5.5 1.8L12 16l-1.5-5.2L5 9l5.5-1.8L12 2Zm7 12 .8 2.7L22 17.5l-2.2.8L19 21l-.8-2.7-2.2-.8 2.2-.8L19 14Z"/></svg>'
  };
  return icons[name] || '';
}

function formatModernPlayerTime(value) {
  const sec = Math.max(0, Math.floor(Number(value) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

let modernPlayerTimer = null;
let modernPlayerSeeking = false;
let modernSleepMinutes = 0;
let modernSleepTimer = null;
let modernAmbientEnabled = false;

function setModernRangeFill(input, percent) {
  if (!input) return;
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  input.style.setProperty('--range-pct', `${pct}%`);
}

function updateModernPlayerControls() {
  const wrap = document.querySelector('.player-wrap');
  const controls = wrap?.querySelector('.yt-modern-controls');
  if (!wrap || !controls || !ytPlayer) return;

  let currentTime = 0;
  let duration = 0;
  let state = -1;
  let volume = 100;
  let muted = false;
  try { currentTime = Number(ytPlayer.getCurrentTime?.()) || 0; } catch {}
  try { duration = Number(ytPlayer.getDuration?.()) || 0; } catch {}
  try { state = Number(ytPlayer.getPlayerState?.()); } catch {}
  try { volume = Number(ytPlayer.getVolume?.()) || 0; } catch {}
  try { muted = !!ytPlayer.isMuted?.(); } catch {}

  const seek = controls.querySelector('.yt-modern-seek');
  if (seek && !modernPlayerSeeking) {
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    seek.value = String(Math.max(0, Math.min(1000, Math.round(pct * 10))));
    setModernRangeFill(seek, pct);
    const progressWrap = controls.querySelector('.yt-modern-progress-wrap');
    progressWrap?.style.setProperty('--seek-pct', `${Math.max(0, Math.min(100, pct))}%`);
  }

  const time = controls.querySelector('.yt-modern-time');
  if (time) time.textContent = `${formatModernPlayerTime(currentTime)} / ${formatModernPlayerTime(duration)}`;

  const playButton = controls.querySelector('.yt-modern-play');
  const playing = state === window.YT?.PlayerState?.PLAYING || state === window.YT?.PlayerState?.BUFFERING;
  if (playButton) {
    playButton.innerHTML = modernPlayerIcon(playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', playing ? '일시정지' : '재생');
    playButton.title = playing ? '일시정지' : '재생';
  }

  const volumeButton = controls.querySelector('.yt-modern-volume-btn');
  if (volumeButton) volumeButton.innerHTML = modernPlayerIcon(muted || volume === 0 ? 'muted' : 'volume');
  const volumeInput = controls.querySelector('.yt-modern-volume-range');
  if (volumeInput && document.activeElement !== volumeInput) {
    volumeInput.value = String(volume);
    setModernRangeFill(volumeInput, volume);
  }

  controls.querySelector('.yt-modern-cc')?.classList.toggle('is-active', modernCaptionsEnabled);
  const captionValue = controls.querySelector('[data-modern-setting="captions"] .yt-modern-setting-value');
  if (captionValue) captionValue.textContent = modernCaptionsEnabled ? '한국어' : '사용 안함';

  const speedValue = controls.querySelector('[data-modern-setting="speed"] .yt-modern-setting-value');
  if (speedValue) speedValue.textContent = getCurrentPlaybackRate() === 1 ? '보통' : `${getCurrentPlaybackRate()}x`;

  const qualityValue = controls.querySelector('[data-modern-setting="quality"] .yt-modern-setting-value');
  if (qualityValue) {
    let quality = '';
    try { quality = String(ytPlayer.getPlaybackQuality?.() || ''); } catch {}
    const labels = { highres:'최고 화질', hd2160:'2160p', hd1440:'1440p', hd1080:'1080p', hd720:'720p', large:'480p', medium:'360p', small:'240p', tiny:'144p', auto:'자동' };
    qualityValue.textContent = labels[quality] || '자동';
  }

  const sleepValue = controls.querySelector('[data-modern-setting="sleep"] .yt-modern-setting-value');
  if (sleepValue) sleepValue.textContent = modernSleepMinutes ? `${modernSleepMinutes}분` : '사용 안함';
  controls.querySelector('.yt-modern-ambient-switch')?.classList.toggle('is-on', modernAmbientEnabled);
}

function toggleModernCaptions() {
  modernCaptionsEnabled = !modernCaptionsEnabled;
  if (modernCaptionsEnabled) {
    applyKoreanCaptions();
  } else {
    try { ytPlayer?.unloadModule?.('captions'); } catch {}
    try { ytPlayer?.unloadModule?.('cc'); } catch {}
  }
  updateModernPlayerControls();
}

function cycleModernSleepTimer() {
  const options = [0, 15, 30, 60];
  const at = options.indexOf(modernSleepMinutes);
  modernSleepMinutes = options[(at + 1) % options.length];
  clearTimeout(modernSleepTimer);
  modernSleepTimer = null;
  if (modernSleepMinutes > 0) {
    modernSleepTimer = setTimeout(() => {
      try { ytPlayer?.pauseVideo?.(); } catch {}
      modernSleepMinutes = 0;
      updateModernPlayerControls();
    }, modernSleepMinutes * 60 * 1000);
  }
  updateModernPlayerControls();
}

function cycleModernPlaybackSpeed() {
  const rates = getAvailablePlaybackRates();
  if (!rates.length) return;
  const currentRate = getCurrentPlaybackRate();
  let idx = rates.findIndex(rate => Math.abs(rate - currentRate) < 0.001);
  if (idx < 0) idx = rates.findIndex(rate => rate > currentRate) - 1;
  const next = rates[(idx + 1 + rates.length) % rates.length];
  setPlayerPlaybackRate(next, 1, { silent: true });
  updateModernPlayerControls();
}

function cycleModernQuality() {
  if (!ytPlayer?.setPlaybackQuality) return;
  let levels = [];
  try { levels = ytPlayer.getAvailableQualityLevels?.() || []; } catch {}
  if (!Array.isArray(levels) || !levels.length) return;
  let currentQuality = '';
  try { currentQuality = ytPlayer.getPlaybackQuality?.() || ''; } catch {}
  let idx = levels.indexOf(currentQuality);
  const next = levels[(idx + 1 + levels.length) % levels.length];
  try { ytPlayer.setPlaybackQuality(next); } catch {}
  setTimeout(updateModernPlayerControls, 300);
}

function toggleModernMiniPlayer() {
  const wrap = document.querySelector('.player-wrap');
  if (!wrap) return;
  const entering = !wrap.classList.contains('is-modern-mini');
  if (entering) {
    const rect = wrap.getBoundingClientRect();
    wrap.dataset.modernOriginWidth = wrap.style.width || '';
    wrap.dataset.modernOriginTransform = wrap.style.transform || '';
    wrap.dataset.modernOriginMarginLeft = wrap.style.marginLeft || '';
    wrap.style.setProperty('--modern-mini-ratio', String(rect.width / Math.max(1, rect.height)));
  }
  wrap.classList.toggle('is-modern-mini', entering);
  const btn = wrap.querySelector('.yt-modern-mini');
  btn?.classList.toggle('is-active', entering);
}

function toggleModernFullscreen() {
  const wrap = document.querySelector('.player-wrap');
  if (!wrap) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    return;
  }
  try {
    const promise = wrap.requestFullscreen?.() || wrap.webkitRequestFullscreen?.();
    promise?.catch?.(() => {});
  } catch {}
}

function clampModernHeatmapNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseModernMostReplayedPayload(payload) {
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  const raw = item?.mostReplayed;
  if (!raw || !Array.isArray(raw.markers) || raw.markers.length < 2) return null;

  const markers = raw.markers
    .map((marker) => ({
      startMillis: Number(marker?.startMillis),
      intensityScoreNormalized: Number(marker?.intensityScoreNormalized)
    }))
    .filter((marker) => Number.isFinite(marker.startMillis) && Number.isFinite(marker.intensityScoreNormalized))
    .sort((a, b) => a.startMillis - b.startMillis)
    .map((marker) => ({
      startMillis: Math.max(0, marker.startMillis),
      intensityScoreNormalized: clampModernHeatmapNumber(marker.intensityScoreNormalized, 0, 1)
    }));

  if (markers.length < 2) return null;

  const gaps = [];
  for (let i = 1; i < markers.length; i++) {
    const gap = markers[i].startMillis - markers[i - 1].startMillis;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1000;
  const estimatedDurationMillis = Math.max(1, markers.at(-1).startMillis + typicalGap);

  let peakMarker = markers.reduce((best, marker) =>
    marker.intensityScoreNormalized > best.intensityScoreNormalized ? marker : best,
  markers[0]);

  let peakStartMillis = peakMarker.startMillis;
  let peakEndMillis = peakMarker.startMillis + typicalGap;
  const timed = Array.isArray(raw.timedMarkerDecorations) ? raw.timedMarkerDecorations : [];
  if (timed.length) {
    const decoration = timed.find((d) => {
      const start = Number(d?.visibleTimeRangeStartMillis);
      const end = Number(d?.visibleTimeRangeEndMillis);
      return Number.isFinite(start) && Number.isFinite(end) && peakMarker.startMillis >= start && peakMarker.startMillis <= end;
    }) || timed[0];
    const start = Number(decoration?.visibleTimeRangeStartMillis);
    const end = Number(decoration?.visibleTimeRangeEndMillis);
    if (Number.isFinite(start)) peakStartMillis = Math.max(0, start);
    if (Number.isFinite(end) && end > peakStartMillis) peakEndMillis = end;
    peakMarker = markers.reduce((best, marker) => {
      if (marker.startMillis < peakStartMillis || marker.startMillis > peakEndMillis) return best;
      return !best || marker.intensityScoreNormalized > best.intensityScoreNormalized ? marker : best;
    }, null) || peakMarker;
  }

  const peakMillis = timed.length
    ? Math.max(0, (peakStartMillis + peakEndMillis) / 2)
    : peakMarker.startMillis;

  return {
    markers,
    estimatedDurationMillis,
    peakMillis,
    peakStartMillis,
    peakEndMillis
  };
}

async function fetchModernMostReplayed(videoId) {
  const id = String(videoId || '').trim();
  if (!id) return null;
  if (modernHeatmapCache.has(id)) return modernHeatmapCache.get(id);

  for (const endpoint of YOUTUBE_MOST_REPLAYED_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${endpoint}${encodeURIComponent(id)}`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache',
        signal: controller.signal
      });
      if (!response.ok) continue;
      const parsed = parseModernMostReplayedPayload(await response.json());
      if (parsed) {
        modernHeatmapCache.set(id, parsed);
        return parsed;
      }
    } catch (error) {
      // 다음 미러로 자동 폴백한다.
    } finally {
      clearTimeout(timer);
    }
  }

  // 영상 자체에 heatmap이 없는 경우도 있으므로 실패 결과도 짧게 캐시한다.
  modernHeatmapCache.set(id, null);
  return null;
}

function makeModernHeatmapCurve(markers, durationMillis) {
  if (!Array.isArray(markers) || markers.length < 2) return '';
  const width = 1000;
  const top = 5;
  const bottom = 88;
  const duration = Math.max(1, Number(durationMillis) || 1);

  const points = markers.map((marker) => {
    const x = clampModernHeatmapNumber((marker.startMillis / duration) * width, 0, width);
    // YouTube처럼 낮은 값도 완전히 평평해지지 않게 약간 들어 올린다.
    const strength = Math.pow(clampModernHeatmapNumber(marker.intensityScoreNormalized, 0, 1), 0.72);
    const y = bottom - strength * (bottom - top);
    return { x, y };
  });

  // 끝점은 재생바 양 끝에 맞춘다.
  points[0].x = 0;
  points[points.length - 1].x = width;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = points.at(-1);
  d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}

function getModernStoryboardSpec(videoId) {
  const id = String(videoId || '').trim();
  if (!id) return null;
  if (modernStoryboardCache.has(id)) return modernStoryboardCache.get(id);

  // IFrame Player의 내부 메타데이터 위치가 브라우저/YouTube 버전에 따라 달라질 수 있다.
  // 가능한 storyboard spec 위치를 순서대로 확인한다.
  let raw = '';
  const candidates = [];
  try { candidates.push(ytPlayer?.playerInfo?.storyboardFormat); } catch {}
  try { candidates.push(ytPlayer?.playerInfo?.storyboards?.playerStoryboardSpecRenderer?.spec); } catch {}
  try { candidates.push(ytPlayer?.playerInfo?.storyboards?.playerLiveStoryboardSpecRenderer?.spec); } catch {}
  try { candidates.push(ytPlayer?.getVideoData?.()?.storyboardFormat); } catch {}
  raw = String(candidates.find(Boolean) || '');
  if (!raw) return null;

  try { raw = decodeURIComponent(raw); } catch {}
  const parts = raw.split('|');
  const base = parts.shift();
  if (!base || !parts.length) return null;

  const levels = parts.map((part, index) => {
    const args = part.split('#');
    if (args.length < 8) return null;
    const [width, height, count, columns, rows, interval, name, sigh] = args;
    const spec = {
      level: index,
      width: Number(width),
      height: Number(height),
      count: Number(count),
      columns: Number(columns),
      rows: Number(rows),
      interval: Number(interval),
      name: String(name || ''),
      sigh: String(sigh || '')
    };
    if (![spec.width, spec.height, spec.count, spec.columns, spec.rows].every((v) => Number.isFinite(v) && v > 0)) return null;
    return spec;
  }).filter(Boolean);

  if (!levels.length) return null;
  const level = levels.at(-1); // 가장 큰 썸네일 레벨
  if (!Number.isFinite(level.interval) || level.interval <= 0) {
    let duration = 0;
    try { duration = Number(ytPlayer?.getDuration?.()) || 0; } catch {}
    level.interval = duration > 0 ? (duration * 1000) / level.count : 10000;
  }

  let urlTemplate = base.replace('$L', String(level.level)).replace('$N', level.name);
  if (level.sigh) urlTemplate += `${urlTemplate.includes('?') ? '&' : '?'}sigh=${encodeURIComponent(level.sigh)}`;

  const parsed = { ...level, urlTemplate };
  modernStoryboardCache.set(id, parsed);
  return parsed;
}

function getModernStoryboardFrame(videoId, timeMillis) {
  const spec = getModernStoryboardSpec(videoId);
  if (!spec) return null;

  const frameIndex = Math.max(0, Math.min(spec.count - 1, Math.floor(Math.max(0, Number(timeMillis) || 0) / Math.max(1, spec.interval))));
  const perImage = spec.columns * spec.rows;
  const imageIndex = Math.floor(frameIndex / perImage);
  const inside = frameIndex % perImage;
  const col = inside % spec.columns;
  const row = Math.floor(inside / spec.columns);
  const url = spec.urlTemplate.replace('$M', String(imageIndex));

  return {
    url,
    col,
    row,
    columns: spec.columns,
    rows: spec.rows
  };
}

function getModernFallbackPreview(videoId, pct) {
  const id = String(videoId || '').trim();
  if (!id) return null;

  // YouTube가 모든 iframe에서 storyboardFormat을 노출하는 것은 아니므로,
  // 그 경우에도 실제 YouTube 자동 생성 썸네일을 시간대별 대체 미리보기로 사용한다.
  const normalized = clampModernHeatmapNumber(Number(pct) || 0, 0, 100);
  let index = 1;
  if (normalized >= 66.666) index = 3;
  else if (normalized >= 33.333) index = 2;

  return {
    url: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mq${index}.jpg`,
    fallback: true
  };
}

function updateModernSeekPreview(event) {
  const wrap = document.querySelector('.player-wrap');
  const controls = wrap?.querySelector('.yt-modern-controls');
  const progressWrap = controls?.querySelector('.yt-modern-progress-wrap');
  const preview = progressWrap?.querySelector('.yt-modern-seek-preview');
  if (!wrap || !progressWrap || !preview) return;

  const rect = progressWrap.getBoundingClientRect();
  if (!rect.width) return;
  const x = clampModernHeatmapNumber(Number(event?.clientX) - rect.left, 0, rect.width);
  const pct = (x / rect.width) * 100;
  progressWrap.style.setProperty('--seek-preview-pct', `${pct}%`);
  preview.classList.toggle('is-left-edge', pct < 12);
  preview.classList.toggle('is-right-edge', pct > 88);

  let duration = 0;
  try { duration = Number(ytPlayer?.getDuration?.()) || 0; } catch {}
  if (duration <= 0) return;
  const timeSeconds = duration * (pct / 100);
  const timeMillis = timeSeconds * 1000;

  const timeEl = preview.querySelector('.yt-modern-seek-preview-time');
  if (timeEl) timeEl.textContent = formatModernPlayerTime(timeSeconds);

  const id = String(wrap.dataset.videoId || '');
  const heatmap = modernHeatmapCache.get(id);
  const replayEl = preview.querySelector('.yt-modern-seek-preview-replayed');
  if (replayEl) {
    const inPeak = !!heatmap && timeMillis >= Number(heatmap.peakStartMillis || heatmap.peakMillis || -1)
      && timeMillis <= Number(heatmap.peakEndMillis || heatmap.peakMillis || -1);
    replayEl.hidden = !inPeak;
  }

  const picture = preview.querySelector('.yt-modern-seek-preview-picture');
  if (picture) {
    const frame = getModernStoryboardFrame(id, timeMillis);
    const fallback = frame?.url ? null : getModernFallbackPreview(id, pct);
    const source = frame || fallback;

    if (source?.url) {
      picture.classList.add('has-storyboard');
      picture.classList.toggle('is-fallback', !!source.fallback);
      picture.style.backgroundImage = `url("${String(source.url).replace(/"/g, '%22')}")`;

      if (frame?.url) {
        picture.style.backgroundSize = `${frame.columns * 100}% ${frame.rows * 100}%`;
        const posX = frame.columns > 1 ? (frame.col / (frame.columns - 1)) * 100 : 0;
        const posY = frame.rows > 1 ? (frame.row / (frame.rows - 1)) * 100 : 0;
        picture.style.backgroundPosition = `${posX}% ${posY}%`;
      } else {
        picture.style.backgroundSize = 'cover';
        picture.style.backgroundPosition = 'center';
      }
    } else {
      picture.classList.remove('has-storyboard', 'is-fallback');
      picture.style.backgroundImage = '';
      picture.style.backgroundSize = '';
      picture.style.backgroundPosition = '';
    }
  }
}

function clearModernYouTubeHeatmap() {
  const wrap = document.querySelector('.player-wrap');
  const controls = wrap?.querySelector('.yt-modern-controls');
  const progressWrap = controls?.querySelector('.yt-modern-progress-wrap');
  if (!progressWrap) return;

  progressWrap.classList.remove('has-heatmap', 'heatmap-loading');
  progressWrap.style.removeProperty('--most-replayed-pct');
  const line = progressWrap.querySelector('.yt-modern-heatmap-line');
  const fill = progressWrap.querySelector('.yt-modern-heatmap-fill');
  if (line) line.setAttribute('d', '');
  if (fill) fill.setAttribute('d', '');
  const label = progressWrap.querySelector('.yt-modern-most-replayed-label');
  if (label) label.hidden = true;
}

function renderModernYouTubeHeatmap(videoId, heatmap) {
  const wrap = document.querySelector('.player-wrap');
  const controls = wrap?.querySelector('.yt-modern-controls');
  const progressWrap = controls?.querySelector('.yt-modern-progress-wrap');
  if (!wrap || !progressWrap || String(wrap.dataset.videoId || '') !== String(videoId || '')) return;

  if (!heatmap?.markers?.length) {
    clearModernYouTubeHeatmap();
    return;
  }

  let durationMillis = heatmap.estimatedDurationMillis;
  try {
    const playerDuration = Number(ytPlayer?.getDuration?.()) || 0;
    if (playerDuration > 0) durationMillis = playerDuration * 1000;
  } catch {}

  const curve = makeModernHeatmapCurve(heatmap.markers, durationMillis);
  if (!curve) {
    clearModernYouTubeHeatmap();
    return;
  }

  const line = progressWrap.querySelector('.yt-modern-heatmap-line');
  const fill = progressWrap.querySelector('.yt-modern-heatmap-fill');
  if (line) line.setAttribute('d', curve);
  if (fill) fill.setAttribute('d', `${curve} L 1000 96 L 0 96 Z`);

  const peakPct = clampModernHeatmapNumber((heatmap.peakMillis / Math.max(1, durationMillis)) * 100, 0, 100);
  progressWrap.style.setProperty('--most-replayed-pct', `${peakPct}%`);
  progressWrap.classList.add('has-heatmap');
  progressWrap.classList.remove('heatmap-loading');

  const label = progressWrap.querySelector('.yt-modern-most-replayed-label');
  const time = progressWrap.querySelector('.yt-modern-most-replayed-time');
  if (label) {
    label.hidden = false;
    label.classList.toggle('is-left-edge', peakPct < 18);
    label.classList.toggle('is-right-edge', peakPct > 82);
  }
  if (time) time.textContent = formatModernPlayerTime(heatmap.peakMillis / 1000);
}

async function loadModernYouTubeHeatmap(videoId) {
  const id = String(videoId || '').trim();
  const wrap = document.querySelector('.player-wrap');
  const progressWrap = wrap?.querySelector('.yt-modern-progress-wrap');
  if (!id || !wrap || !progressWrap) return;

  const requestSerial = ++modernHeatmapRequestSerial;
  clearModernYouTubeHeatmap();
  progressWrap.classList.add('heatmap-loading');

  const heatmap = await fetchModernMostReplayed(id);
  if (requestSerial !== modernHeatmapRequestSerial) return;
  if (String(wrap.dataset.videoId || '') !== id) return;
  renderModernYouTubeHeatmap(id, heatmap);
}

function ensureModernYouTubeControls() {
  const wrap = document.querySelector('.player-wrap');
  if (!wrap || wrap.querySelector('.yt-modern-controls')) return;

  const controls = document.createElement('div');
  controls.className = 'yt-modern-controls';
  controls.innerHTML = `
    <div class="yt-modern-bottom">
      <div class="yt-modern-progress-wrap">
        <div class="yt-modern-seek-track" aria-hidden="true"><i></i></div>
        <div class="yt-modern-heatmap" aria-hidden="true">
          <svg class="yt-modern-heatmap-svg" viewBox="0 0 1000 100" preserveAspectRatio="none">
            <path class="yt-modern-heatmap-fill" d=""></path>
            <path class="yt-modern-heatmap-line" d=""></path>
          </svg>
          <span class="yt-modern-most-replayed-pin"></span>
        </div>
        <div class="yt-modern-most-replayed-label" hidden>
          <strong class="yt-modern-most-replayed-time">0:00</strong>
          <span>가장 많이 다시 본 장면</span>
        </div>
        <div class="yt-modern-seek-preview" aria-hidden="true">
          <div class="yt-modern-seek-preview-picture"></div>
          <div class="yt-modern-seek-preview-caption">
            <strong class="yt-modern-seek-preview-time">0:00</strong>
            <span class="yt-modern-seek-preview-replayed" hidden>가장 많이 다시 본 장면</span>
          </div>
        </div>
        <input class="yt-modern-seek yt-modern-range" type="range" min="0" max="1000" value="0" step="1" aria-label="재생 위치" />
      </div>
      <div class="yt-modern-control-row">
        <div class="yt-modern-left-controls">
          <button class="yt-modern-btn yt-modern-round yt-modern-play" type="button" aria-label="재생" title="재생">${modernPlayerIcon('play')}</button>
          <div class="yt-modern-pill yt-modern-skip-pill">
            <button class="yt-modern-btn yt-modern-prev" type="button" aria-label="이전 곡" title="이전 곡">${modernPlayerIcon('prev')}</button>
            <button class="yt-modern-btn yt-modern-next" type="button" aria-label="다음 곡" title="다음 곡">${modernPlayerIcon('next')}</button>
          </div>
          <div class="yt-modern-volume-wrap">
            <button class="yt-modern-btn yt-modern-round yt-modern-volume-btn" type="button" aria-label="볼륨" title="볼륨">${modernPlayerIcon('volume')}</button>
            <div class="yt-modern-volume-popover">
              <input class="yt-modern-volume-range yt-modern-range" type="range" min="0" max="100" step="1" value="100" aria-label="볼륨 조절" />
            </div>
          </div>
          <div class="yt-modern-time-pill"><span class="yt-modern-time">0:00 / 0:00</span></div>
        </div>
        <div class="yt-modern-right-wrap">
          <div class="yt-modern-settings-panel" aria-hidden="true">
            <button class="yt-modern-setting-row" type="button" data-modern-setting="ambient">
              <span class="yt-modern-setting-icon">${modernPlayerIcon('spark')}</span>
              <span class="yt-modern-setting-label">특수효과</span>
              <span class="yt-modern-ambient-switch"><i></i></span>
            </button>
            <button class="yt-modern-setting-row" type="button" data-modern-setting="captions">
              <span class="yt-modern-setting-icon">${modernPlayerIcon('cc')}</span>
              <span class="yt-modern-setting-label">자막</span>
              <span class="yt-modern-setting-value">한국어</span><span class="yt-modern-chevron">›</span>
            </button>
            <button class="yt-modern-setting-row" type="button" data-modern-setting="sleep">
              <span class="yt-modern-setting-icon">${modernPlayerIcon('moon')}</span>
              <span class="yt-modern-setting-label">취침 타이머</span>
              <span class="yt-modern-setting-value">사용 안함</span><span class="yt-modern-chevron">›</span>
            </button>
            <button class="yt-modern-setting-row" type="button" data-modern-setting="speed">
              <span class="yt-modern-setting-icon">⟳</span>
              <span class="yt-modern-setting-label">재생 속도</span>
              <span class="yt-modern-setting-value">보통</span><span class="yt-modern-chevron">›</span>
            </button>
            <button class="yt-modern-setting-row" type="button" data-modern-setting="quality">
              <span class="yt-modern-setting-icon">☷</span>
              <span class="yt-modern-setting-label">화질</span>
              <span class="yt-modern-setting-value">자동</span><span class="yt-modern-chevron">›</span>
            </button>
          </div>
          <div class="yt-modern-pill yt-modern-right-controls">
            <button class="yt-modern-btn yt-modern-cc is-active" type="button" aria-label="자막" title="자막">${modernPlayerIcon('cc')}</button>
            <button class="yt-modern-btn yt-modern-settings" type="button" aria-label="설정" title="설정">${modernPlayerIcon('gear')}</button>
            <button class="yt-modern-btn yt-modern-mini" type="button" aria-label="미니 플레이어" title="미니 플레이어">${modernPlayerIcon('mini')}</button>
            <button class="yt-modern-btn yt-modern-fullscreen" type="button" aria-label="전체 화면" title="전체 화면">${modernPlayerIcon('fullscreen')}</button>
          </div>
        </div>
      </div>
    </div>`;
  wrap.appendChild(controls);

  // YouTube iframe 자체가 마우스를 받으면 임베드 전용 제목/공유/하단 UI가
  // iframe 안에서 자체적으로 떠서 부모 페이지가 즉시 숨길 수 없다.
  // 그래서 마우스 입력은 사이트 레이어가 받고, 영상 조작은 IFrame API로 처리한다.
  // 이 방식이면 포인터가 플레이어를 벗어나는 순간 사이트 컨트롤을 바로 숨길 수 있다.
  let interactionLayer = wrap.querySelector('.player-interaction-layer');
  if (!interactionLayer) {
    interactionLayer = document.createElement('div');
    interactionLayer.className = 'player-interaction-layer';
    interactionLayer.setAttribute('aria-label', '영상 재생/일시정지');
    interactionLayer.setAttribute('role', 'button');
    interactionLayer.setAttribute('tabindex', '0');
    wrap.insertBefore(interactionLayer, controls);
  }

  const seek = controls.querySelector('.yt-modern-seek');
  const progressWrap = controls.querySelector('.yt-modern-progress-wrap');
  let modernSeekPointerActive = false;

  const getModernSeekPercentFromPointer = (event) => {
    const rect = progressWrap?.getBoundingClientRect();
    if (!rect?.width) return 0;
    const x = clampModernHeatmapNumber(Number(event?.clientX) - rect.left, 0, rect.width);
    return (x / rect.width) * 100;
  };

  const applyModernSeekFromPointer = (event, seekVideo = true) => {
    if (!progressWrap || !seek) return;
    const pct = getModernSeekPercentFromPointer(event);
    seek.value = String(Math.max(0, Math.min(1000, Math.round(pct * 10))));
    setModernRangeFill(seek, pct);
    progressWrap.style.setProperty('--seek-pct', `${Math.max(0, Math.min(100, pct))}%`);
    updateModernSeekPreview(event);

    let duration = 0;
    try { duration = Number(ytPlayer?.getDuration?.()) || 0; } catch {}
    if (duration > 0) {
      const target = duration * pct / 100;
      const timeLabel = controls.querySelector('.yt-modern-time');
      if (timeLabel) timeLabel.textContent = `${formatModernPlayerTime(target)} / ${formatModernPlayerTime(duration)}`;
      if (seekVideo) {
        // 첫 클릭(pointerdown)에서 바로 이동시킨다. 두 번째 클릭이 필요하지 않다.
        try { ytPlayer?.seekTo?.(target, true); } catch {}
      }
    }
  };

  progressWrap?.addEventListener('pointerenter', updateModernSeekPreview, { passive: true });
  progressWrap?.addEventListener('pointermove', (event) => {
    updateModernSeekPreview(event);
    if (modernSeekPointerActive) applyModernSeekFromPointer(event, true);
  }, { passive: true });

  progressWrap?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    event.preventDefault();
    modernSeekPointerActive = true;
    modernPlayerSeeking = true;
    try { progressWrap.setPointerCapture?.(event.pointerId); } catch {}
    applyModernSeekFromPointer(event, true);
  }, { passive: false });

  const finishModernPointerSeek = (event) => {
    if (!modernSeekPointerActive) return;
    applyModernSeekFromPointer(event, true);
    modernSeekPointerActive = false;
    modernPlayerSeeking = false;
    try { progressWrap?.releasePointerCapture?.(event.pointerId); } catch {}
    scheduleModernControlsHide(700);
    updateModernPlayerControls();
  };
  progressWrap?.addEventListener('pointerup', finishModernPointerSeek, { passive: true });
  progressWrap?.addEventListener('pointercancel', () => {
    modernSeekPointerActive = false;
    modernPlayerSeeking = false;
    updateModernPlayerControls();
  }, { passive: true });

  // 숨겨진 range는 진행 상태 보관용으로만 사용한다. 키보드로 값이 바뀌는 경우도 지원.
  seek?.addEventListener('input', () => {
    const pct = Number(seek.value) / 10;
    setModernRangeFill(seek, pct);
    progressWrap?.style.setProperty('--seek-pct', `${Math.max(0, Math.min(100, pct))}%`);
  });
  seek?.addEventListener('change', () => {
    const pct = Number(seek.value || 0) / 10;
    let duration = 0;
    try { duration = Number(ytPlayer?.getDuration?.()) || 0; } catch {}
    if (duration > 0) {
      try { ytPlayer?.seekTo?.(duration * pct / 100, true); } catch {}
    }
    modernPlayerSeeking = false;
    updateModernPlayerControls();
  });

  controls.querySelector('.yt-modern-play')?.addEventListener('click', (e) => { e.stopPropagation(); togglePlayerPlayPause(); updateModernPlayerControls(); });
  controls.querySelector('.yt-modern-prev')?.addEventListener('click', (e) => { e.stopPropagation(); previousSong(); });
  controls.querySelector('.yt-modern-next')?.addEventListener('click', (e) => { e.stopPropagation(); nextSong(); });

  const volumeWrap = controls.querySelector('.yt-modern-volume-wrap');
  const volumeButton = controls.querySelector('.yt-modern-volume-btn');
  const volumeInput = controls.querySelector('.yt-modern-volume-range');
  volumeButton?.addEventListener('click', (e) => {
    e.stopPropagation();
    showModernControls();
    volumeWrap?.classList.toggle('is-open');
    if (!volumeWrap?.classList.contains('is-open')) {
      try {
        if (ytPlayer?.isMuted?.()) ytPlayer.unMute?.(); else ytPlayer?.mute?.();
      } catch {}
      scheduleModernControlsHide(700);
    }
    updateModernPlayerControls();
  });
  volumeInput?.addEventListener('input', (e) => {
    e.stopPropagation();
    showModernControls();
    const value = Number(volumeInput.value || 0);
    try {
      ytPlayer?.unMute?.();
      ytPlayer?.setVolume?.(value);
    } catch {}
    setModernRangeFill(volumeInput, value);
    updateModernPlayerControls();
  });

  volumeInput?.addEventListener('change', () => {
    scheduleModernControlsHide(700);
  });

  controls.querySelector('.yt-modern-cc')?.addEventListener('click', (e) => { e.stopPropagation(); toggleModernCaptions(); });
  const settingsPanel = controls.querySelector('.yt-modern-settings-panel');
  const settingsButton = controls.querySelector('.yt-modern-settings');

  // 유튜브 iframe은 브라우저에 따라 :hover 해제가 늦을 수 있어서
  // 실제 포인터 위치 + 유휴 시간 기준으로 커스텀 컨트롤 표시 상태를 직접 관리한다.
  let modernControlsHideTimer = null;
  const MODERN_CONTROLS_IDLE_MS = 1200;

  const clearModernControlsHideTimer = () => {
    if (modernControlsHideTimer) {
      clearTimeout(modernControlsHideTimer);
      modernControlsHideTimer = null;
    }
  };

  const closeModernAuxUi = () => {
    settingsPanel?.classList.remove('is-open');
    settingsPanel?.setAttribute('aria-hidden', 'true');
    settingsButton?.classList.remove('is-active');
    volumeWrap?.classList.remove('is-open');
  };

  const hideModernControls = (force = false) => {
    clearModernControlsHideTimer();

    // 드래그 중이거나 설정/볼륨 조작 중에는 자동 숨김을 막는다.
    if (!force) {
      const interactingWithAuxUi = !!settingsPanel?.classList.contains('is-open') || !!volumeWrap?.classList.contains('is-open');
      if (modernPlayerSeeking || modernSeekPointerActive || interactingWithAuxUi) return;
    }

    wrap.classList.remove('modern-controls-visible');
    closeModernAuxUi();
  };

  const scheduleModernControlsHide = (delay = MODERN_CONTROLS_IDLE_MS) => {
    clearModernControlsHideTimer();
    modernControlsHideTimer = setTimeout(() => hideModernControls(false), delay);
  };

  const showModernControls = () => {
    wrap.classList.add('modern-controls-visible');
    scheduleModernControlsHide();
  };

  wrap.classList.remove('modern-controls-visible');

  // iframe 대신 이 레이어에서 클릭을 받아 재생/일시정지를 수행한다.
  interactionLayer?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlayerPlayPause();
    updateModernPlayerControls();
  });
  interactionLayer?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    togglePlayerPlayPause();
    updateModernPlayerControls();
  });

  wrap.addEventListener('pointerenter', showModernControls, { passive: true });
  wrap.addEventListener('pointermove', showModernControls, { passive: true });
  wrap.addEventListener('pointerleave', () => hideModernControls(true), { passive: true });
  wrap.addEventListener('mouseleave', () => hideModernControls(true), { passive: true });

  // 플레이어 영역에서 손을 떼고 가만히 두면 유튜브처럼 자동으로 숨긴다.
  wrap.addEventListener('pointerup', () => scheduleModernControlsHide(700), { passive: true });
  wrap.addEventListener('mouseup', () => scheduleModernControlsHide(700), { passive: true });
  wrap.addEventListener('touchend', () => scheduleModernControlsHide(900), { passive: true });

  // iframe에서 바로 사이트 바깥 영역으로 나갈 때 parent의 leave 이벤트가
  // 누락되는 브라우저까지 대비해서 문서의 실제 좌표로 한 번 더 확인한다.
  document.addEventListener('pointermove', (event) => {
    const rect = wrap.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!inside) {
      hideModernControls(true);
    }
  }, { passive: true });

  window.addEventListener('blur', () => hideModernControls(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideModernControls(true);
  });

  settingsButton?.addEventListener('click', (e) => {
    e.stopPropagation();
    showModernControls();
    const open = !settingsPanel?.classList.contains('is-open');
    settingsPanel?.classList.toggle('is-open', open);
    settingsPanel?.setAttribute('aria-hidden', open ? 'false' : 'true');
    settingsButton.classList.toggle('is-active', open);
    if (!open) scheduleModernControlsHide(700);
    updateModernPlayerControls();
  });

  controls.querySelector('[data-modern-setting="ambient"]')?.addEventListener('click', () => {
    modernAmbientEnabled = !modernAmbientEnabled;
    wrap.classList.toggle('modern-ambient-on', modernAmbientEnabled);
    updateModernPlayerControls();
  });
  controls.querySelector('[data-modern-setting="captions"]')?.addEventListener('click', toggleModernCaptions);
  controls.querySelector('[data-modern-setting="sleep"]')?.addEventListener('click', cycleModernSleepTimer);
  controls.querySelector('[data-modern-setting="speed"]')?.addEventListener('click', cycleModernPlaybackSpeed);
  controls.querySelector('[data-modern-setting="quality"]')?.addEventListener('click', cycleModernQuality);
  controls.querySelector('.yt-modern-mini')?.addEventListener('click', (e) => { e.stopPropagation(); toggleModernMiniPlayer(); });
  controls.querySelector('.yt-modern-fullscreen')?.addEventListener('click', (e) => { e.stopPropagation(); toggleModernFullscreen(); });

  wrap.addEventListener('click', (e) => {
    if (e.target.closest?.('.yt-modern-settings-panel, .yt-modern-settings, .yt-modern-volume-wrap')) return;
    closeModernAuxUi();
    scheduleModernControlsHide(700);
  });

  document.addEventListener('fullscreenchange', () => {
    controls.querySelector('.yt-modern-fullscreen')?.classList.toggle('is-active', !!document.fullscreenElement);
  });

  setModernRangeFill(seek, 0);
  setModernRangeFill(volumeInput, 100);
  clearInterval(modernPlayerTimer);
  modernPlayerTimer = setInterval(updateModernPlayerControls, 250);
  updateModernPlayerControls();
  clearModernYouTubeHeatmap();
}

function createYouTubePlayerOnce() {
  if (ytPlayer || !window.YT || typeof window.YT.Player !== "function") return;

  ytPlayer = new YT.Player("player", {
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1,
      rel: 0,
      // YouTube 기본 재생바/하단 컨트롤까지 전부 숨긴다.
      controls: 0,
      fs: 1,
      playsinline: 1,
      hl: "ko",
      cc_lang_pref: YOUTUBE_CAPTION_LANGUAGE,
      cc_load_policy: 1,
      disablekb: 0
    },
    events: {
      onReady: () => {
        apiReady = true;
        playerReady = true;
        apiLoading = false;
        applyKoreanCaptions();
        // 임베드 기본 UI 대신 사이트가 직접 그리는 컨트롤을 사용한다.
        // 마우스가 영상 밖으로 나가면 즉시 사라지도록 부모 페이지에서 제어한다.
        ensureModernYouTubeControls();
        keepFiveSecondSeekShortcuts();
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
    loadModernYouTubeHeatmap(songs[nextIndex].id);
    applyKoreanCaptions();
    setTimeout(() => {
      setPlayerPlaybackRate(desiredPlaybackRate, 0, { silent: true });
      const cachedHeatmap = modernHeatmapCache.get(String(songs[nextIndex].id || ''));
      if (cachedHeatmap) renderModernYouTubeHeatmap(songs[nextIndex].id, cachedHeatmap);
    }, 350);
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
    loadModernYouTubeHeatmap(mrId);
    applyKoreanCaptions();
    setTimeout(() => {
      setPlayerPlaybackRate(desiredPlaybackRate, 0, { silent: true });
      const cachedHeatmap = modernHeatmapCache.get(String(mrId || ''));
      if (cachedHeatmap) renderModernYouTubeHeatmap(mrId, cachedHeatmap);
    }, 350);
  });

  showList();
  updateLyricsDrawer();
  updateControlLabels();
}

function onPlayerStateChange(e) {
  updateModernPlayerControls();
  const currentVideoId = String(document.querySelector('.player-wrap')?.dataset.videoId || '');
  const cachedHeatmap = modernHeatmapCache.get(currentVideoId);
  if (cachedHeatmap) renderModernYouTubeHeatmap(currentVideoId, cachedHeatmap);
  getModernStoryboardSpec(currentVideoId);
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
  if (ytInput) {
    ytInput.placeholder = "유튜브 영상 링크";
  }

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
