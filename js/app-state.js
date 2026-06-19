// js/app-state.js - 저장소/공통 유틸 + 통합 노래함/태그
(() => {
  const storeKey = document.body?.dataset?.store || "main";

  const COUNTRY_STORES = [
    { key: "jaSongs", label: "일본 노래", emoji: "🇯🇵", page: "japan/jaindex.html", old: ["jaBright", "jaMid", "jaDark", "jpBright", "jpMid", "jpDark"], mood: { jaBright: "밝은곡", jpBright: "밝은곡", jaMid: "중간곡", jpMid: "중간곡", jaDark: "어두운곡", jpDark: "어두운곡" } },
    { key: "cnSongs", label: "중국 노래", emoji: "🇨🇳", page: "china/cnindex.html", old: ["cnBright", "cnMid", "cnDark"], mood: { cnBright: "밝은곡", cnMid: "중간곡", cnDark: "어두운곡" } },
    { key: "krSongs", label: "한국 노래", emoji: "🇰🇷", page: "korea/krindex.html", old: ["krBright", "krMid", "krDark"], mood: { krBright: "밝은곡", krMid: "중간곡", krDark: "어두운곡" } }
  ];

  const YOUTUBE_STORES = [
    { key: "yt1pVideos", label: "유튜브 영상 1P", emoji: "📺", page: "youtube/1p.html" },
    { key: "yt2pVideos", label: "유튜브 영상 2P", emoji: "📺", page: "youtube/2p.html" },
    { key: "yt3pVideos", label: "유튜브 영상 3P", emoji: "📺", page: "youtube/3p.html" },
    { key: "yt4pVideos", label: "유튜브 영상 4P", emoji: "📺", page: "youtube/4p.html" }
  ];

  const ALL_STORES = [...COUNTRY_STORES, ...YOUTUBE_STORES];

  function readStorage(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key)) || [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  }

  function safeText(v) {
    if (v === undefined || v === null) return "";
    return String(v).trim();
  }

  function safeLink(url) {
    if (!url) return "";
    return String(url).trim();
  }

  function escapeHTML(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function extractID(url) {
    if (!url) return "";

    try {
      const u = new URL(url);
      const v = u.searchParams.get("v");
      if (v) return v;

      if (u.hostname.includes("youtu.be")) {
        return u.pathname.split("/").filter(Boolean)[0] || "";
      }

      const parts = u.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      const embedIndex = parts.indexOf("embed");
      if (shortsIndex !== -1 && parts[shortsIndex + 1]) return parts[shortsIndex + 1];
      if (embedIndex !== -1 && parts[embedIndex + 1]) return parts[embedIndex + 1];
    } catch {
      const text = String(url);
      const match =
        text.match(/[?&]v=([^&]+)/) ||
        text.match(/youtu\.be\/([^?&]+)/) ||
        text.match(/youtube\.com\/shorts\/([^?&]+)/) ||
        text.match(/youtube\.com\/embed\/([^?&]+)/);
      return match ? match[1] : "";
    }

    return "";
  }

  function normalizeTag(tag) {
    return safeText(tag).replace(/^#+/, "").replace(/\s+/g, "");
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) {
      return [...new Set(value.map(normalizeTag).filter(Boolean))];
    }
    return [...new Set(String(value || "")
      .split(/[#,，、\n\t ]+/)
      .map(normalizeTag)
      .filter(Boolean))];
  }

  function normalizeVideoAspect(value) {
    const text = String(value || "").trim().toLowerCase();
    if (["portrait", "vertical", "세로", "9:16", "1080x1920"].includes(text)) return "portrait";
    if (["landscape", "horizontal", "가로", "16:9", "1920x1080"].includes(text)) return "landscape";
    return "";
  }

  function addTags(existing, extra) {
    return normalizeTags([...(Array.isArray(existing) ? existing : normalizeTags(existing)), ...normalizeTags(extra)]);
  }

  function cleanSong(song, extraTag = "") {
    if (!song || typeof song !== "object") return null;
    const ytUrl = String(song.ytUrl || song.url || "").trim();
    const id = String(song.id || extractID(ytUrl) || "").trim();
    const title = String(song.title || "제목 없음").trim() || "제목 없음";
    const thumbnailWidth = Number(song.thumbnailWidth || song.thumbnail_width || song.thumbWidth || 0) || 0;
    const thumbnailHeight = Number(song.thumbnailHeight || song.thumbnail_height || song.thumbHeight || 0) || 0;
    let aspect = normalizeVideoAspect(song.aspect || song.videoAspect || song.orientation || song.videoOrientation);
    if (!aspect && thumbnailWidth > 0 && thumbnailHeight > 0) {
      if (thumbnailHeight > thumbnailWidth * 1.15) aspect = "portrait";
      else if (thumbnailWidth > thumbnailHeight * 1.15) aspect = "landscape";
    }
    return {
      title,
      author: String(song.author || "").trim(),
      ytUrl,
      id,
      lyrics: String(song.lyrics || "").trim(),
      mr: String(song.mr || "").trim(),
      score: String(song.score || "").trim(),
      original: String(song.original || song.origin || song.originalUrl || "").trim(),
      memo: String(song.memo || ""),
      tags: addTags(song.tags, extraTag),
      aspect,
      thumbnailWidth,
      thumbnailHeight
    };
  }

  function cleanSongArray(value, extraTag = "") {
    if (!Array.isArray(value)) return [];
    return value.map((song) => cleanSong(song, extraTag)).filter(Boolean);
  }

  function mergeSongArrays(arrays) {
    const merged = [];
    const seen = new Set();
    arrays.flat().forEach((song) => {
      const s = cleanSong(song);
      if (!s) return;
      const key = s.id || s.ytUrl || `${s.title}|${s.author}`;
      if (seen.has(key)) {
        const old = merged.find((item) => (item.id || item.ytUrl || `${item.title}|${item.author}`) === key);
        if (old) old.tags = addTags(old.tags, s.tags);
        return;
      }
      seen.add(key);
      merged.push(s);
    });
    return merged;
  }

  function migrateUnifiedStores() {
    COUNTRY_STORES.forEach((country) => {
      const currentData = cleanSongArray(readStorage(country.key));
      const oldData = [];
      country.old.forEach((oldKey) => {
        const moodTag = country.mood?.[oldKey] || "";
        oldData.push(...cleanSongArray(readStorage(oldKey), moodTag));
      });
      if (oldData.length > 0) {
        const merged = mergeSongArrays([currentData, oldData]);
        writeStorage(country.key, merged);
      } else if (currentData.length > 0) {
        writeStorage(country.key, currentData);
      }
    });
  }

  migrateUnifiedStores();

  let songs = cleanSongArray(readStorage(storeKey));
  let current = 0;
  let dragIndex = null;

  function isTagPage() {
    return document.body?.dataset?.page === "tag";
  }

  function getCurrentTagParam() {
    return normalizeTag(new URLSearchParams(location.search).get("tag") || "");
  }

  function setSongsRaw(value) {
    songs = Array.isArray(value) ? value : [];
  }

  function findSongIndexInStore(sourceKey, song) {
    const arr = cleanSongArray(readStorage(sourceKey));
    const wantedId = String(song?.sourceId || song?.id || extractID(song?.ytUrl) || "").trim();
    const wantedUrl = safeLink(song?.sourceUrl || song?.ytUrl);
    const wantedIndex = Number(song?.sourceIndex ?? song?.index);

    if (Number.isInteger(wantedIndex) && arr[wantedIndex]) {
      const candidate = arr[wantedIndex];
      const candidateId = candidate.id || extractID(candidate.ytUrl);
      if ((wantedId && candidateId === wantedId) || (wantedUrl && safeLink(candidate.ytUrl) === wantedUrl)) {
        return wantedIndex;
      }
    }

    return arr.findIndex((item) => {
      const itemId = item.id || extractID(item.ytUrl);
      const itemUrl = safeLink(item.ytUrl);
      return (wantedId && itemId === wantedId) || (wantedUrl && itemUrl === wantedUrl);
    });
  }

  function saveSongToSource(song) {
    const sourceKey = song?.sourceKey || song?.storeKey;
    if (!sourceKey || !ALL_STORES.some((item) => item.key === sourceKey)) return false;

    const arr = cleanSongArray(readStorage(sourceKey));
    const idx = findSongIndexInStore(sourceKey, song);
    if (idx < 0 || !arr[idx]) return false;

    arr[idx] = cleanSong(song);
    writeStorage(sourceKey, arr);
    song.sourceIndex = idx;
    song.index = idx;
    song.sourceId = song.id || extractID(song.ytUrl);
    song.sourceUrl = song.ytUrl;
    return true;
  }

  function save() {
    if (isTagPage()) {
      songs.forEach((song) => saveSongToSource(song));
    } else if (storeKey !== "main") {
      writeStorage(storeKey, songs);
    }
    if (typeof updateDrawerCounts === "function") updateDrawerCounts();
    if (typeof renderTagTools === "function") renderTagTools();
  }

  async function fetchYouTubeMeta(ytUrl) {
    try {
      const api = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(ytUrl);
      const res = await fetch(api);
      if (!res.ok) throw new Error("oEmbed 실패");
      const data = await res.json();
      const thumbnailWidth = Number(data.thumbnail_width || 0) || 0;
      const thumbnailHeight = Number(data.thumbnail_height || 0) || 0;
      let aspect = "";
      if (thumbnailWidth > 0 && thumbnailHeight > 0) {
        if (thumbnailHeight > thumbnailWidth * 1.15) aspect = "portrait";
        else if (thumbnailWidth > thumbnailHeight * 1.15) aspect = "landscape";
      }
      return {
        title: data.title || "제목 없음",
        author: data.author_name || "",
        aspect,
        thumbnailWidth,
        thumbnailHeight
      };
    } catch {
      return { title: "제목 없음", author: "", aspect: "", thumbnailWidth: 0, thumbnailHeight: 0 };
    }
  }

  function getAllSongs() {
    return ALL_STORES.flatMap((collection) =>
      cleanSongArray(readStorage(collection.key)).map((song, index) => ({
        ...song,
        storeKey: collection.key,
        sourceKey: collection.key,
        sourceIndex: index,
        sourceId: song.id || extractID(song.ytUrl),
        sourceUrl: song.ytUrl,
        country: collection,
        collection,
        index
      }))
    );
  }

  function getTagCounts(scopeKey = "all") {
    const source = scopeKey && scopeKey !== "all" ? cleanSongArray(readStorage(scopeKey)) : getAllSongs();
    const map = new Map();
    source.forEach((song) => {
      normalizeTags(song.tags).forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1));
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }

  function getTagPageUrl(tag, basePrefix = "") {
    const prefix = basePrefix || (location.pathname.includes("/japan/") || location.pathname.includes("/china/") || location.pathname.includes("/korea/") || location.pathname.includes("/youtube/") ? "../" : "");
    return `${prefix}tag.html?tag=${encodeURIComponent(tag)}`;
  }

  window.AppState = {
    get storeKey() { return storeKey; },
    get songs() { return songs; },
    set songs(v) { songs = cleanSongArray(v); },
    get current() { return current; },
    set current(v) { current = Number.isFinite(Number(v)) ? Number(v) : 0; },
    get dragIndex() { return dragIndex; },
    set dragIndex(v) { dragIndex = v; },
    COUNTRY_STORES,
    YOUTUBE_STORES,
    ALL_STORES,
    readStorage,
    writeStorage,
    save,
    safeText,
    safeLink,
    escapeHTML,
    extractID,
    fetchYouTubeMeta,
    normalizeTag,
    normalizeTags,
    normalizeVideoAspect,
    addTags,
    cleanSong,
    cleanSongArray,
    getAllSongs,
    getTagCounts,
    getTagPageUrl,
    isTagPage,
    getCurrentTagParam,
    setSongsRaw,
    saveSongToSource,
    findSongIndexInStore
  };
})();

// 기존 전역 함수 방식도 계속 동작하게 연결
(() => {
  const S = window.AppState;
  if (!S) return;

  ["songs", "current", "dragIndex"].forEach((key) => {
    Object.defineProperty(window, key, {
      get: () => S[key],
      set: (v) => (S[key] = v),
      configurable: true
    });
  });

  ["save", "safeText", "safeLink", "escapeHTML", "extractID", "fetchYouTubeMeta", "normalizeTags", "getTagCounts"]
    .forEach((fn) => (window[fn] = S[fn]));
})();

// =========================
// 전체 저장 / 불러오기 기능
// =========================
(() => {
  const S = window.AppState;
  if (!S) return;

  const BACKUP_KEYS = (S.ALL_STORES || S.COUNTRY_STORES).map((item) => ({ key: item.key, label: item.label }));
  const OLD_TO_NEW = {
    jaBright: "jaSongs", jaMid: "jaSongs", jaDark: "jaSongs", jpBright: "jaSongs", jpMid: "jaSongs", jpDark: "jaSongs",
    cnBright: "cnSongs", cnMid: "cnSongs", cnDark: "cnSongs",
    krBright: "krSongs", krMid: "krSongs", krDark: "krSongs"
  };
  const OLD_MOOD = {
    jaBright: "밝은곡", jpBright: "밝은곡", cnBright: "밝은곡", krBright: "밝은곡",
    jaMid: "중간곡", jpMid: "중간곡", cnMid: "중간곡", krMid: "중간곡",
    jaDark: "어두운곡", jpDark: "어두운곡", cnDark: "어두운곡", krDark: "어두운곡"
  };

  function makeBackupData() {
    const stores = {};
    BACKUP_KEYS.forEach(({ key }) => {
      stores[key] = S.cleanSongArray(S.readStorage(key));
    });

    return {
      app: "my-music-library",
      version: 3,
      exportedAt: new Date().toISOString(),
      stores
    };
  }

  function downloadBackup() {
    const data = makeBackupData();
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const filename = `music-library-backup-${yyyy}${mm}${dd}-${hh}${mi}.json`;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeImportData(data) {
    const result = {};
    BACKUP_KEYS.forEach(({ key }) => (result[key] = []));

    const put = (key, value) => {
      const finalKey = OLD_TO_NEW[key] || key;
      if (!BACKUP_KEYS.some((item) => item.key === finalKey)) return;
      result[finalKey].push(...S.cleanSongArray(value, OLD_MOOD[key] || ""));
    };

    if (data && typeof data === "object" && data.stores && typeof data.stores === "object") {
      Object.entries(data.stores).forEach(([key, value]) => put(key, value));
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      Object.entries(data).forEach(([key, value]) => put(key, value));
    } else if (Array.isArray(data)) {
      const pageKey = document.body?.dataset?.store;
      if (pageKey && BACKUP_KEYS.some((item) => item.key === pageKey)) result[pageKey].push(...S.cleanSongArray(data));
    }

    Object.keys(result).forEach((key) => {
      result[key] = S.cleanSongArray(result[key]);
      if (result[key].length === 0) delete result[key];
    });
    return result;
  }

  function countImportSongs(stores) {
    return Object.values(stores).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  }

  function applyImportedStores(stores) {
    Object.entries(stores).forEach(([key, arr]) => {
      S.writeStorage(key, S.cleanSongArray(arr));
    });

    const pageKey = document.body?.dataset?.store;
    if (pageKey && stores[pageKey]) {
      S.songs = S.cleanSongArray(stores[pageKey]);
      S.current = 0;
      if (typeof showList === "function") showList();
      if (typeof updateLyricsDrawer === "function") updateLyricsDrawer();
      if (typeof updateControlLabels === "function") updateControlLabels();
    }

    if (typeof updateDrawerCounts === "function") updateDrawerCounts();
    if (typeof renderTagTools === "function") renderTagTools();
  }

  function openImportFilePicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || ""));
          const stores = normalizeImportData(data);
          const total = countImportSongs(stores);

          if (Object.keys(stores).length === 0) {
            alert("불러올 수 있는 노래 백업 파일이 아니야.");
            return;
          }

          const names = Object.keys(stores).map((key) => {
            const found = BACKUP_KEYS.find((item) => item.key === key);
            return `${found ? found.label : key} ${stores[key].length}곡`;
          }).join("\n");

          const ok = confirm(`이 백업 파일을 불러올까?\n\n총 ${total}곡\n${names}\n\n현재 저장된 목록은 백업 내용으로 바뀌어.`);
          if (!ok) return;

          applyImportedStores(stores);
          alert("불러오기 완료! 목록이 복원됐어.");
        } catch {
          alert("파일을 읽을 수 없어. 저장 버튼으로 받은 JSON 파일인지 확인해줘.");
        }
      };
      reader.readAsText(file, "utf-8");
    });

    input.click();
  }

  function createBackupButtons() {
    if (document.getElementById("backupTools")) return;
    if (document.body?.dataset?.store || document.body?.dataset?.page === "tag") return; // 노래 재생 페이지/태그 재생 페이지에는 저장/불러오기 박스를 띄우지 않음

    const box = document.createElement("div");
    box.id = "backupTools";
    box.className = "backup-tools";
    box.innerHTML = `
      <button id="exportBackupBtn" class="backup-btn" type="button">💾 저장</button>
      <button id="importBackupBtn" class="backup-btn" type="button">📂 불러오기</button>
      <button id="openTagIndexBtn" class="backup-btn tag-index-open" type="button"># 태그</button>
      <p class="backup-help">저장은 JSON 파일로 다운로드되고, 불러오기는 그 파일을 다시 넣는 방식이야. 노래 페이지와 유튜브 1P~4P도 같이 저장돼.</p>
    `;

    const mainContent = document.getElementById("mainContent");
    const h1 = mainContent?.querySelector("h1") || document.querySelector("h1");
    if (h1) h1.insertAdjacentElement("afterend", box);
    else document.body.insertAdjacentElement("afterbegin", box);

    document.getElementById("exportBackupBtn")?.addEventListener("click", downloadBackup);
    document.getElementById("importBackupBtn")?.addEventListener("click", openImportFilePicker);
    document.getElementById("openTagIndexBtn")?.addEventListener("click", () => {
      window.location.href = "tag.html";
    });
  }

  document.addEventListener("DOMContentLoaded", createBackupButtons);

  window.downloadMusicLibraryBackup = downloadBackup;
  window.openMusicLibraryBackup = openImportFilePicker;
})();
