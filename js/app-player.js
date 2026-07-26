// js/app-player.js - 노래 추가/삭제 + 유튜브 플레이어 + 랜덤/반복 버튼

let playlistImportBusy = false;

function extractPlaylistID(url) {
  if (!url) return "";

  try {
    const u = new URL(String(url).trim());
    if (!/(^|\.)youtube\.com$/i.test(u.hostname) && !/(^|\.)youtu\.be$/i.test(u.hostname)) return "";
    return String(u.searchParams.get("list") || "").trim();
  } catch {
    const match = String(url).match(/[?&]list=([^&#\s]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function ensurePlaylistImportStatusElement() {
  const ytInput = document.getElementById("yt");
  const row = ytInput?.closest(".add-song-row");
  if (!row) return null;

  let el = document.getElementById("playlistImportStatus");
  if (!el) {
    el = document.createElement("p");
    el.id = "playlistImportStatus";
    el.className = "playlist-import-status";
    el.setAttribute("aria-live", "polite");
    row.insertAdjacentElement("afterend", el);
  }
  return el;
}

function setPlaylistImportStatus(message = "", state = "") {
  const el = ensurePlaylistImportStatusElement();
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
  el.hidden = !message;
}

function setPlaylistImportControlsBusy(busy) {
  const ytInput = document.getElementById("yt");
  const addButton = ytInput?.closest(".add-song-row")?.querySelector(".add-song-btn");
  if (ytInput) ytInput.disabled = !!busy;
  if (addButton) {
    addButton.disabled = !!busy;
    if (!addButton.dataset.defaultText) addButton.dataset.defaultText = addButton.textContent || "추가";
    addButton.textContent = busy ? "불러오는 중..." : addButton.dataset.defaultText;
  }
}

const PLAYLIST_API_KEY_STORAGE = "youtubePlaylistDataApiKey";

function readPlaylistApiKey() {
  try { return String(localStorage.getItem(PLAYLIST_API_KEY_STORAGE) || "").trim(); }
  catch { return ""; }
}

function savePlaylistApiKey(value) {
  const key = String(value || "").trim();
  try {
    if (key) localStorage.setItem(PLAYLIST_API_KEY_STORAGE, key);
    else localStorage.removeItem(PLAYLIST_API_KEY_STORAGE);
  } catch {}
  return key;
}

async function fetchPlaylistWithDataApi(playlistId, apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("YouTube Data API 키가 없어.");

  const items = [];
  let pageToken = "";
  let page = 0;

  do {
    page += 1;
    const params = new URLSearchParams({
      part: "snippet",
      maxResults: "50",
      playlistId,
      key
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`);
    let data = null;
    try { data = await res.json(); } catch {}

    if (!res.ok) {
      const apiMessage = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`YouTube Data API 오류: ${apiMessage}`);
    }

    (Array.isArray(data?.items) ? data.items : []).forEach((item) => {
      const snippet = item?.snippet || {};
      const id = String(snippet?.resourceId?.videoId || "").trim();
      if (!id) return;
      items.push({
        id,
        title: String(snippet.title || "제목 없음").trim() || "제목 없음",
        author: String(snippet.videoOwnerChannelTitle || snippet.channelTitle || "").trim(),
        thumbnailWidth: Number(snippet?.thumbnails?.high?.width || snippet?.thumbnails?.medium?.width || 0) || 0,
        thumbnailHeight: Number(snippet?.thumbnails?.high?.height || snippet?.thumbnails?.medium?.height || 0) || 0
      });
    });

    pageToken = String(data?.nextPageToken || "");
    setPlaylistImportStatus(`대형 재생목록 전체 불러오는 중... ${items.length}개`, "loading");

    if (page > 200) throw new Error("재생목록 페이지가 너무 많아서 중단했어.");
  } while (pageToken);

  return items;
}

function askPlaylistApiKey() {
  const current = readPlaylistApiKey();
  const message = [
    "이 재생목록은 200개보다 클 수 있어.",
    "YouTube 플레이어 방식은 큰 재생목록이 200개에서 잘릴 수 있어서, 전부 가져오려면 YouTube Data API 키가 필요해.",
    "",
    "API 키가 있으면 아래에 붙여넣어줘.",
    "없으면 취소를 누르면 현재 읽힌 영상까지만 추가할게."
  ].join("\n");
  const entered = window.prompt(message, current);
  if (entered === null) return "";
  return savePlaylistApiKey(entered);
}

function waitForYouTubeIframeApi(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error("YouTube 플레이어 API를 불러오지 못했어."));
    }, timeoutMs);

    ensurePlayerReady(() => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve();
    });
  });
}

async function fetchPlaylistVideoIds(playlistId) {
  await waitForYouTubeIframeApi();

  return new Promise((resolve, reject) => {
    const wrapper = document.createElement("div");
    wrapper.className = "playlist-import-loader";
    wrapper.setAttribute("aria-hidden", "true");
    const target = document.createElement("div");
    target.id = `playlist-import-player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    wrapper.appendChild(target);
    document.body.appendChild(wrapper);

    let player = null;
    let finished = false;
    let pollTimer = null;
    let timeoutTimer = null;
    let lastLength = -1;
    let stableCount = 0;

    const cleanup = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
      try { player?.destroy?.(); } catch {}
      wrapper.remove();
    };

    const finish = (ids) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(ids);
    };

    const fail = (message) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error(message));
    };

    const checkPlaylist = () => {
      let ids = [];
      try {
        ids = Array.isArray(player?.getPlaylist?.()) ? player.getPlaylist().filter(Boolean) : [];
      } catch {}
      if (!ids.length) return;

      if (ids.length === lastLength) stableCount += 1;
      else {
        lastLength = ids.length;
        stableCount = 0;
      }

      // 큰 재생목록도 한 번에 로딩될 시간을 조금 주고, 길이가 잠시 안정되면 확정한다.
      if (stableCount >= 3) finish(ids);
    };

    try {
      player = new YT.Player(target.id, {
        width: "2",
        height: "2",
        playerVars: {
          autoplay: 0,
          controls: 0,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: (event) => {
            try {
              event.target.cuePlaylist({
                listType: "playlist",
                list: playlistId,
                index: 0,
                startSeconds: 0
              });
              pollTimer = window.setInterval(checkPlaylist, 400);
              window.setTimeout(checkPlaylist, 250);
            } catch {
              fail("재생목록을 불러오지 못했어.");
            }
          },
          onStateChange: (event) => {
            if (window.YT?.PlayerState && event.data === YT.PlayerState.CUED) checkPlaylist();
          }
        }
      });
    } catch {
      fail("재생목록용 플레이어를 만들지 못했어.");
      return;
    }

    timeoutTimer = window.setTimeout(() => {
      let ids = [];
      try {
        ids = Array.isArray(player?.getPlaylist?.()) ? player.getPlaylist().filter(Boolean) : [];
      } catch {}
      if (ids.length) finish(ids);
      else fail("재생목록 영상을 읽지 못했어. 비공개 재생목록이거나 YouTube에서 불러오기를 막았을 수 있어.");
    }, 22000);
  });
}

async function mapWithConcurrency(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  const count = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch {
        results[index] = null;
      }
      completed += 1;
      try { onProgress?.(completed, items.length); } catch {}
    }
  }

  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

async function addYouTubePlaylist(ytUrl, playlistId) {
  if (playlistImportBusy) return;
  playlistImportBusy = true;
  setPlaylistImportControlsBusy(true);
  setPlaylistImportStatus("재생목록을 읽는 중...", "loading");

  try {
    let playlistEntries = [];
    let usedDataApi = false;
    let possiblyTruncated = false;
    const savedApiKey = readPlaylistApiKey();

    if (savedApiKey) {
      try {
        playlistEntries = await fetchPlaylistWithDataApi(playlistId, savedApiKey);
        usedDataApi = true;
      } catch (apiError) {
        console.warn("Saved YouTube Data API key failed; falling back to iframe playlist loader.", apiError);
        savePlaylistApiKey("");
        setPlaylistImportStatus("저장된 API 키로 못 불러와서 기본 방식으로 다시 시도 중...", "loading");
      }
    }

    if (!playlistEntries.length) {
      const rawIds = await fetchPlaylistVideoIds(playlistId);
      playlistEntries = rawIds.map((id) => ({ id: String(id || "").trim() })).filter((item) => item.id);

      if (playlistEntries.length >= 200) {
        possiblyTruncated = true;
        const apiKey = askPlaylistApiKey();
        if (apiKey) {
          try {
            playlistEntries = await fetchPlaylistWithDataApi(playlistId, apiKey);
            usedDataApi = true;
            possiblyTruncated = false;
          } catch (apiError) {
            console.error(apiError);
            savePlaylistApiKey("");
            alert(`${apiError?.message || "API 키로 전체 재생목록을 불러오지 못했어."}\n\n기본 방식으로 읽힌 ${playlistEntries.length}개는 계속 추가할게.`);
          }
        }
      }
    }

    const seenIds = new Set();
    const importEntries = [];
    let duplicateCount = 0;
    let duplicateAddedCount = 0;

    playlistEntries.forEach((entry) => {
      const id = String(entry?.id || "").trim();
      if (!id) return;
      const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

      let duplicateMatches = window.AppState?.collectExactVideoDuplicates?.({ ytUrl: videoUrl, id }) || [];
      if (seenIds.has(id)) {
        duplicateMatches = duplicateMatches.length ? duplicateMatches : [{
          song: { title: entry?.title || "같은 재생목록 안의 영상" },
          store: { label: "지금 추가 중인 재생목록" }
        }];
      }

      if (duplicateMatches.length > 0) {
        duplicateCount += 1;
        const allowDuplicate = typeof window.AppState?.confirmExactVideoDuplicateAdd === "function"
          ? window.AppState.confirmExactVideoDuplicateAdd(duplicateMatches)
          : window.confirm("이미 추가된 똑같은 영상이 있어. 그래도 추가할까?");
        if (!allowDuplicate) return;
        duplicateAddedCount += 1;
      }

      seenIds.add(id);
      importEntries.push({ ...entry, id });
    });

    if (!importEntries.length) {
      setPlaylistImportStatus(`추가할 영상이 없어. 중복 영상은 추가하지 않기로 했어.`, "done");
      alert(`추가할 영상이 없어!\n중복 영상은 추가하지 않기로 했어.`);
      return;
    }

    setPlaylistImportStatus(`영상 정보 불러오는 중... 0 / ${importEntries.length}`, "loading");

    const metadata = await mapWithConcurrency(
      importEntries,
      usedDataApi ? 12 : 8,
      async (entry) => {
        const id = entry.id;
        const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
        const hasApiMeta = !!(entry.title || entry.author);
        const meta = hasApiMeta
          ? {
              title: entry.title || "제목 없음",
              author: entry.author || "",
              aspect: "",
              thumbnailWidth: Number(entry.thumbnailWidth || 0) || 0,
              thumbnailHeight: Number(entry.thumbnailHeight || 0) || 0
            }
          : await fetchYouTubeMeta(videoUrl);
        const archivedRecord = typeof window.AppState?.findRemovedVideoRecord === "function"
          ? window.AppState.findRemovedVideoRecord({
              ytUrl: videoUrl,
              id,
              title: meta.title,
              storeKey: window.AppState?.storeKey || ""
            })
          : null;
        return { id, videoUrl, meta, archivedRecord };
      },
      (completed, total) => {
        setPlaylistImportStatus(
          `영상 정보 불러오는 중... ${completed} / ${total}${duplicateCount ? ` · 중복 확인 ${duplicateCount}개` : ""}`,
          "loading"
        );
      }
    );

    let addedCount = 0;
    let metadataFailCount = 0;

    metadata.forEach((item) => {
      if (!item) return;
      const { id, videoUrl, meta, archivedRecord } = item;
      if (!meta?.title || meta.title === "제목 없음") metadataFailCount += 1;

      songs.push({
        title: archivedRecord?.title || meta?.title || "제목 없음",
        author: archivedRecord?.author || meta?.author || "",
        ytUrl: videoUrl,
        id,
        lyrics: archivedRecord ? String(archivedRecord.lyrics || "") : "",
        mr: archivedRecord ? safeLink(archivedRecord.mr || "") : "",
        score: "",
        original: archivedRecord ? safeLink(archivedRecord.original || "") : "",
        memo: archivedRecord ? String(archivedRecord.memo || "") : "",
        tags: archivedRecord?.tags || [],
        aspect: meta?.aspect || archivedRecord?.aspect || "",
        thumbnailWidth: meta?.thumbnailWidth || archivedRecord?.thumbnailWidth || 0,
        thumbnailHeight: meta?.thumbnailHeight || archivedRecord?.thumbnailHeight || 0
      });
      addedCount += 1;
    });

    save();
    showList();

    const ytInput = document.getElementById("yt");
    if (ytInput) ytInput.value = "";

    const details = [
      `${addedCount}개 추가 완료`,
      duplicateCount ? `중복 확인 ${duplicateCount}개${duplicateAddedCount ? ` · 그중 ${duplicateAddedCount}개 추가` : ""}` : "",
      metadataFailCount ? `제목 정보 ${metadataFailCount}개는 나중에 확인 필요` : "",
      possiblyTruncated ? `⚠ 큰 재생목록은 200개까지만 들어갔을 수 있음` : ""
    ].filter(Boolean);
    setPlaylistImportStatus(details.join(" · "), possiblyTruncated ? "warning" : "done");

    alert(`재생목록 추가 완료!\n${details.join("\n")}`);
  } catch (error) {
    console.error(error);
    const message = error?.message || "재생목록을 불러오지 못했어.";
    setPlaylistImportStatus(message, "error");
    alert(`${message}\n\n공개/일부 공개 재생목록 링크인지 확인해줘.`);
  } finally {
    playlistImportBusy = false;
    setPlaylistImportControlsBusy(false);
  }
}

async function addSong() {
  const ytUrl = safeLink(document.getElementById("yt")?.value);
  const lyrics = safeText(document.getElementById("lyrics")?.value);
  const mr = safeLink(document.getElementById("mr")?.value);
  const score = safeLink(document.getElementById("score")?.value);
  const original = safeLink(document.getElementById("original")?.value);

  const playlistId = extractPlaylistID(ytUrl);
  if (ytUrl && playlistId) {
    await addYouTubePlaylist(ytUrl, playlistId);
    return;
  }

  const id = extractID(ytUrl);
  if (!ytUrl || !id) {
    alert("유튜브 영상 또는 재생목록 링크가 올바르지 않아!");
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
      if (!url || (!extractID(url) && !extractPlaylistID(url))) return;
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
  if (ytInput) {
    ytInput.placeholder = "유튜브 영상 / 재생목록 링크";
    ensurePlaylistImportStatusElement();
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

window.extractPlaylistID = extractPlaylistID;
window.addYouTubePlaylist = addYouTubePlaylist;
window.goBackSong = goBackSong;
window.previousSong = previousSong;
window.goForwardSong = goForwardSong;
window.changePlayerPlaybackRate = changePlayerPlaybackRate;
window.resetPlayerPlaybackRate = resetPlayerPlaybackRate;
window.togglePlayerPlayPause = togglePlayerPlayPause;
