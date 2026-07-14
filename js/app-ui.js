// js/app-ui.js - 목록 표시 + 가사/메모/원곡 패널 + 드래그 정렬 + 링크/태그 패널
(() => {
  const S = window.AppState;
  if (!S) return;

  function getCurrentSong() {
    const songs = S.songs || [];
    return songs[S.current] || null;
  }

  function getPrimaryVideoUrl(song) {
    if (!song) return "";
    return S.safeLink(song.ytUrl);
  }

  function getOriginalUrl(song) {
    const fallback = song?.original || song?.origin || song?.originalUrl || "";
    const shared = typeof S.getSharedTextForSong === "function" ? S.getSharedTextForSong(song, "original", fallback).value : fallback;
    return S.safeLink(shared);
  }

  function getSubPagePrefix() {
    return location.pathname.includes("/japan/") ||
      location.pathname.includes("/china/") ||
      location.pathname.includes("/korea/") ||
      location.pathname.includes("/english/") ||
      location.pathname.includes("/youtube/") ? "../" : "";
  }

  function getCollectionPageHref(collection) {
    const page = collection?.page || "";
    return `${getSubPagePrefix()}${page}`;
  }

  function findSongByUrl(url) {
    const cleanUrl = S.safeLink(url);
    const id = S.extractID(cleanUrl);
    if (!cleanUrl && !id) return null;

    return S.getAllSongs().find((song) => {
      const songUrl = S.safeLink(song.ytUrl);
      const songId = song.id || S.extractID(songUrl);
      return (id && songId === id) || (cleanUrl && songUrl === cleanUrl);
    }) || null;
  }


  function isTagPage() {
    return typeof S.isTagPage === "function" && S.isTagPage();
  }

  function isLyricsPage() {
    return typeof S.isLyricsPage === "function" && S.isLyricsPage();
  }

  function isCombinedLibraryPage() {
    return isTagPage() || isLyricsPage();
  }

  function isYoutubeCollectionPage() {
    return !isTagPage() && String(S.storeKey || "").startsWith("yt");
  }

  function songIdentity(song) {
    const url = S.safeLink(song?.ytUrl);
    return {
      id: String(song?.id || S.extractID(url) || "").trim(),
      url
    };
  }

  function sameSong(a, b) {
    const A = songIdentity(a);
    const B = songIdentity(b);
    return Boolean((A.id && B.id && A.id === B.id) || (A.url && B.url && A.url === B.url));
  }

  function getSongLocations(song) {
    if (!song) return [];
    const seen = new Set();
    return S.getAllSongs().filter((item) => sameSong(item, song)).filter((item) => {
      const key = `${item.storeKey || item.sourceKey}|${item.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function pageSongHref(collection, song) {
    if (!collection?.page) return "#";
    const playKey = song?.id || song?.ytUrl || "";
    return `${getCollectionPageHref(collection)}${playKey ? `?play=${encodeURIComponent(playKey)}` : ""}`;
  }

  function collectionBadgeText(song) {
    const collection = song?.collection || song?.country;
    if (!collection) return "";
    return `${collection.emoji || ""} ${collection.label || ""}`.trim();
  }

  async function copyText(text, successMessage = "복사했어!") {
    if (!text) {
      alert("복사할 링크가 없어.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      alert(successMessage);
    } catch {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
      alert(successMessage);
    }
  }

  let pageSearchQuery = "";

  function pageSearchResults() {
    const songs = S.songs || [];
    return songs
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => S.songMatchesSearch ? S.songMatchesSearch(song, pageSearchQuery) : true);
  }

  function updatePageSearchSummary(matchCount = null, totalCount = null) {
    const summary = document.getElementById("pageSearchSummary");
    if (!summary) return;
    const total = Number.isFinite(totalCount) ? totalCount : (S.songs || []).length;
    const matched = Number.isFinite(matchCount) ? matchCount : pageSearchResults().length;
    if (!String(pageSearchQuery || "").trim()) {
      summary.textContent = isLyricsPage()
        ? `제목태그 / 가사를 검색할 수 있어. 전체 제목태그 파일 ${total}개`
        : `이 페이지 안에서 제목 / 태그 / 가사를 검색할 수 있어. 전체 ${total}개`;
      return;
    }
    summary.textContent = isLyricsPage()
      ? `검색 결과 ${matched}개 파일 / 전체 ${total}개 파일`
      : `검색 결과 ${matched}개 / 전체 ${total}개`;
  }

  function setPageSearchQuery(value) {
    pageSearchQuery = String(value ?? "");
    showList();
  }

  function createPageSearchBox() {
    const panel = document.querySelector(".left-library-panel");
    if (!panel || document.getElementById("pageSearchBox")) return;

    const section = document.createElement("section");
    section.id = "pageSearchBox";
    section.className = "add-song-section search-song-section";
    section.setAttribute("aria-label", "현재 페이지 노래 검색");
    section.innerHTML = `
      <div class="add-song-row search-song-row">
        <input id="pageSongSearchInput" placeholder="${isLyricsPage() ? "제목태그 / 가사 검색" : "제목 / 태그 / 가사 검색"}" aria-label="현재 페이지 노래 검색" />
        <button id="pageSongSearchBtn" class="add-song-btn search-song-btn" type="button">검색</button>
      </div>
      <p id="pageSearchSummary" class="search-song-help"></p>
    `;

    const firstSection = panel.querySelector(".add-song-section, .tag-playlist-head");
    if (firstSection) panel.insertBefore(section, firstSection);
    else panel.insertBefore(section, panel.firstChild);

    const input = section.querySelector("#pageSongSearchInput");
    const run = () => setPageSearchQuery(input?.value || "");
    section.querySelector("#pageSongSearchBtn")?.addEventListener("click", run);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    });
    input?.addEventListener("input", run);
    updatePageSearchSummary();
  }

  function tagChipHTML(tag, count = null, extraClass = "") {
    const safe = S.escapeHTML(tag);
    const countText = count === null ? "" : `<span class="tag-count">${count}</span>`;
    return `<a class="tag-chip ${extraClass}" href="${S.getTagPageUrl(tag)}">#${safe}${countText}</a>`;
  }

  function songTagsHTML(song, mode = "list") {
    const tags = S.normalizeTags(song?.tags);
    if (tags.length === 0) return mode === "list" ? "" : `<p class="tag-empty">태그가 아직 없어.</p>`;
    const counts = new Map(S.getTagCounts("all"));
    return `<div class="song-tags song-tags-${mode}">${tags.map((tag) => tagChipHTML(tag, counts.get(tag) || 1)).join("")}</div>`;
  }

  function getFivePStore() {
    return S.YOUTUBE_STORES?.find((item) => item.key === "yt5pVideos") || null;
  }

  function getSixPStore() {
    return S.YOUTUBE_STORES?.find((item) => item.key === "yt6pVideos") || null;
  }

  function getFivePSongs() {
    return S.cleanSongArray ? S.cleanSongArray(S.readStorage("yt5pVideos")) : [];
  }

  function getSixPSongs() {
    return S.cleanSongArray ? S.cleanSongArray(S.readStorage("yt6pVideos")) : [];
  }

  function makeSongTransferPayload(song, extra = {}) {
    return {
      title: S.safeText(song?.title || "제목 없음"),
      author: S.safeText(song?.author || ""),
      ytUrl: S.safeLink(song?.ytUrl || ""),
      id: S.safeText(song?.id || S.extractID(song?.ytUrl || "")),
      lyrics: String(song?.lyrics || ""),
      lyricsOriginal: String(song?.lyricsOriginal || ""),
      lyricsPronunciation: String(song?.lyricsPronunciation || ""),
      lyricsMeaning: String(song?.lyricsMeaning || ""),
      memo: String(song?.memo || ""),
      original: S.safeLink(song?.original || ""),
      mr: S.safeLink(song?.mr || ""),
      score: S.safeLink(song?.score || ""),
      tags: S.normalizeTags(song?.tags),
      aspect: S.safeText(song?.aspect || ""),
      thumbnailWidth: Number(song?.thumbnailWidth || 0) || 0,
      thumbnailHeight: Number(song?.thumbnailHeight || 0) || 0,
      ...extra
    };
  }

  function serializeFivePSong(song, index = 0) {
    return JSON.stringify(makeSongTransferPayload(song, { fivePIndex: index, sourceStoreKey: "yt5pVideos" }));
  }

  function serializeSixPSong(song, index = 0) {
    return JSON.stringify(makeSongTransferPayload(song, { sixPIndex: index, sourceStoreKey: "yt6pVideos" }));
  }

  function serializeLibrarySong(song, index = 0) {
    return JSON.stringify(makeSongTransferPayload(song, { sourceIndex: index, sourceStoreKey: S.storeKey }));
  }

  function fivePPanelHTML() {
    const items = getFivePSongs();
    if (items.length === 0) {
      return `
        <section class="fivep-panel">
          <p class="fivep-help">5P에 아직 영상이 없어. 현재 페이지 목록의 영상을 이곳에 끌면 5P에 조용히 추가돼.</p>
          <a class="fivep-open-page" href="${getCollectionPageHref(getFivePStore())}">5P 페이지 열기</a>
        </section>
      `;
    }

    return `
      <section class="fivep-panel">
        <p class="fivep-help">5P 영상은 왼쪽 목록/영상 추가 영역으로 끌면 현재 페이지로 이동되고, 현재 페이지 영상을 이곳에 끌면 5P에 조용히 추가돼.</p>
        <a class="fivep-open-page" href="${getCollectionPageHref(getFivePStore())}">5P 페이지 열기</a>
        <div class="fivep-video-list">
          ${items.map((song, index) => {
            const id = song.id || S.extractID(song.ytUrl);
            const thumb = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
            const sub = S.safeText(song.author || "");
            return `
              <article class="fivep-video-card" draggable="true" data-fivep-song="${S.escapeHTML(serializeFivePSong(song, index))}" data-fivep-index="${index}">
                <div class="fivep-thumb">${thumb ? `<img src="${thumb}" alt="thumb">` : ""}</div>
                <div class="fivep-meta">
                  <strong>${S.escapeHTML(song.title || "제목 없음")}</strong>
                  <span>${S.escapeHTML(sub || "5P 보관 영상")}</span>
                </div>
                <button class="fivep-add-btn" type="button" data-fivep-add="${index}">넣기</button>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function sixPPanelHTML() {
    const items = getSixPSongs();
    if (items.length === 0) {
      return `
        <section class="sixp-panel">
          <p class="sixp-help">6P에 아직 영상이 없어. 현재 페이지 목록의 영상을 이곳에 끌면 6P에 조용히 추가돼.</p>
          <a class="sixp-open-page" href="${getCollectionPageHref(getSixPStore())}">6P 페이지 열기</a>
        </section>
      `;
    }

    return `
      <section class="sixp-panel">
        <p class="sixp-help">6P 영상은 왼쪽 목록/영상 추가 영역으로 끌면 현재 페이지로 이동되고, 현재 페이지 영상을 이곳에 끌면 6P에 조용히 추가돼.</p>
        <a class="sixp-open-page" href="${getCollectionPageHref(getSixPStore())}">6P 페이지 열기</a>
        <div class="sixp-video-list">
          ${items.map((song, index) => {
            const id = song.id || S.extractID(song.ytUrl);
            const thumb = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
            const sub = S.safeText(song.author || "");
            return `
              <article class="sixp-video-card" draggable="true" data-sixp-song="${S.escapeHTML(serializeSixPSong(song, index))}" data-sixp-index="${index}">
                <div class="sixp-thumb">${thumb ? `<img src="${thumb}" alt="thumb">` : ""}</div>
                <div class="sixp-meta">
                  <strong>${S.escapeHTML(song.title || "제목 없음")}</strong>
                  <span>${S.escapeHTML(sub || "6P 보관 영상")}</span>
                </div>
                <button class="sixp-add-btn" type="button" data-sixp-add="${index}">넣기</button>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function readFivePTransfer(e) {
    const raw = e?.dataTransfer?.getData("application/x-fivep-song") || "";
    if (!raw) return null;
    try {
      const song = JSON.parse(raw);
      return song && typeof song === "object" ? song : null;
    } catch {
      return null;
    }
  }

  function readSixPTransfer(e) {
    const raw = e?.dataTransfer?.getData("application/x-sixp-song") || "";
    if (!raw) return null;
    try {
      const song = JSON.parse(raw);
      return song && typeof song === "object" ? song : null;
    } catch {
      return null;
    }
  }

  function readLibrarySongTransfer(e) {
    const raw = e?.dataTransfer?.getData("application/x-library-song") || "";
    if (!raw) return null;
    try {
      const song = JSON.parse(raw);
      return song && typeof song === "object" ? song : null;
    } catch {
      return null;
    }
  }

  function sameVideoForMove(a, b) {
    const aUrl = S.safeLink(a?.ytUrl || "");
    const bUrl = S.safeLink(b?.ytUrl || "");
    const aId = S.safeText(a?.id || S.extractID(aUrl));
    const bId = S.safeText(b?.id || S.extractID(bUrl));
    if (aId && bId && aId === bId) return true;
    if (aUrl && bUrl && aUrl === bUrl) return true;
    return false;
  }

  function refreshFivePViewAfterStorageChange() {
    if (S.storeKey === "yt5pVideos") {
      S.songs = getFivePSongs();
      if (S.current >= S.songs.length) S.current = Math.max(0, S.songs.length - 1);
      showList();
      updatePageSearchSummary();
      renderTagTools();
    }
    if (activeTab === "fivep") updateLyricsDrawer();
  }

  function refreshSixPViewAfterStorageChange() {
    if (S.storeKey === "yt6pVideos") {
      S.songs = getSixPSongs();
      if (S.current >= S.songs.length) S.current = Math.max(0, S.songs.length - 1);
      showList();
      updatePageSearchSummary();
      renderTagTools();
    }
    if (activeTab === "sixp") updateLyricsDrawer();
  }

  function removeFivePSong(song) {
    if (!song || typeof song !== "object") return false;
    const arr = getFivePSongs();
    let removeIndex = -1;
    const hinted = Number(song.fivePIndex);
    if (Number.isInteger(hinted) && hinted >= 0 && hinted < arr.length && sameVideoForMove(arr[hinted], song)) {
      removeIndex = hinted;
    }
    if (removeIndex < 0) removeIndex = arr.findIndex((item) => sameVideoForMove(item, song));
    if (removeIndex < 0) return false;
    arr.splice(removeIndex, 1);
    S.writeStorage("yt5pVideos", arr);
    refreshFivePViewAfterStorageChange();
    return true;
  }

  function removeSixPSong(song) {
    if (!song || typeof song !== "object") return false;
    const arr = getSixPSongs();
    let removeIndex = -1;
    const hinted = Number(song.sixPIndex);
    if (Number.isInteger(hinted) && hinted >= 0 && hinted < arr.length && sameVideoForMove(arr[hinted], song)) {
      removeIndex = hinted;
    }
    if (removeIndex < 0) removeIndex = arr.findIndex((item) => sameVideoForMove(item, song));
    if (removeIndex < 0) return false;
    arr.splice(removeIndex, 1);
    S.writeStorage("yt6pVideos", arr);
    refreshSixPViewAfterStorageChange();
    return true;
  }

  function addSongToFiveP(song) {
    if (!song || typeof song !== "object") return false;
    const ytUrl = S.safeLink(song.ytUrl);
    const id = S.safeText(song.id || S.extractID(ytUrl));
    if (!ytUrl || !id) return false;

    const arr = getFivePSongs();
    const already = arr.some((item) => {
      const itemUrl = S.safeLink(item?.ytUrl || "");
      const itemId = S.safeText(item?.id || S.extractID(itemUrl));
      return (id && itemId && id === itemId) || (ytUrl && itemUrl && ytUrl === itemUrl);
    });

    if (!already) {
      const clean = S.cleanSong ? S.cleanSong({
        ...song,
        ytUrl,
        id,
        tags: S.normalizeTags(song.tags),
        title: song.title || "제목 없음"
      }) : song;
      arr.push(clean);
      S.writeStorage("yt5pVideos", arr);
    }

    refreshFivePViewAfterStorageChange();
    return true;
  }

  function addSongToSixP(song) {
    if (!song || typeof song !== "object") return false;
    const ytUrl = S.safeLink(song.ytUrl);
    const id = S.safeText(song.id || S.extractID(ytUrl));
    if (!ytUrl || !id) return false;

    const arr = getSixPSongs();
    const already = arr.some((item) => {
      const itemUrl = S.safeLink(item?.ytUrl || "");
      const itemId = S.safeText(item?.id || S.extractID(itemUrl));
      return (id && itemId && id === itemId) || (ytUrl && itemUrl && ytUrl === itemUrl);
    });

    if (!already) {
      const clean = S.cleanSong ? S.cleanSong({
        ...song,
        ytUrl,
        id,
        tags: S.normalizeTags(song.tags),
        title: song.title || "제목 없음"
      }) : song;
      arr.push(clean);
      S.writeStorage("yt6pVideos", arr);
    }

    refreshSixPViewAfterStorageChange();
    return true;
  }

  function copyFivePSongToCurrentPage(song, options = {}) {
    if (!song || typeof song !== "object") return false;
    const removeAfterAdd = !!options.removeFromFiveP;
    const targetStore = S.ALL_STORES?.find((item) => item.key === S.storeKey);
    if (!targetStore || targetStore.key === "yt5pVideos") return false;

    const ytUrl = S.safeLink(song.ytUrl);
    const id = S.safeText(song.id || S.extractID(ytUrl));
    if (!ytUrl || !id) {
      alert("이 5P 영상 링크가 올바르지 않아.");
      return false;
    }

    const duplicates = S.collectDuplicateSongs ? S.collectDuplicateSongs({
      ytUrl,
      id,
      title: song.title,
      storeKey: S.storeKey
    }) : [];

    if (duplicates.length > 0 && typeof S.confirmDuplicateAdd === "function" && !S.confirmDuplicateAdd(duplicates)) {
      return false;
    }

    const clean = S.cleanSong ? S.cleanSong({
      ...song,
      ytUrl,
      id,
      tags: S.normalizeTags(song.tags),
      title: song.title || "제목 없음"
    }) : song;

    S.songs = [...(S.songs || []), clean];
    S.save();
    if (removeAfterAdd) removeFivePSong(song);
    showList();
    updatePageSearchSummary();
    updateLyricsDrawer();
    renderTagTools();
    return true;
  }

  function copySixPSongToCurrentPage(song, options = {}) {
    if (!song || typeof song !== "object") return false;
    const removeAfterAdd = !!options.removeFromSixP;
    const targetStore = S.ALL_STORES?.find((item) => item.key === S.storeKey);
    if (!targetStore || targetStore.key === "yt6pVideos") return false;

    const ytUrl = S.safeLink(song.ytUrl);
    const id = S.safeText(song.id || S.extractID(ytUrl));
    if (!ytUrl || !id) {
      alert("이 6P 영상 링크가 올바르지 않아.");
      return false;
    }

    const duplicates = S.collectDuplicateSongs ? S.collectDuplicateSongs({
      ytUrl,
      id,
      title: song.title,
      storeKey: S.storeKey
    }) : [];

    if (duplicates.length > 0 && typeof S.confirmDuplicateAdd === "function" && !S.confirmDuplicateAdd(duplicates)) {
      return false;
    }

    const clean = S.cleanSong ? S.cleanSong({
      ...song,
      ytUrl,
      id,
      tags: S.normalizeTags(song.tags),
      title: song.title || "제목 없음"
    }) : song;

    S.songs = [...(S.songs || []), clean];
    S.save();
    if (removeAfterAdd) removeSixPSong(song);
    showList();
    updatePageSearchSummary();
    updateLyricsDrawer();
    renderTagTools();
    return true;
  }


  function bindFivePTabDrop() {
    const tab = document.getElementById("tabFiveP");
    if (!tab || tab.dataset.libraryDropBound === "1") return;
    tab.dataset.libraryDropBound = "1";

    tab.addEventListener("dragover", (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (!types.includes("application/x-library-song")) return;
      e.preventDefault();
      tab.classList.add("fivep-drop-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    tab.addEventListener("dragleave", () => tab.classList.remove("fivep-drop-over"));

    tab.addEventListener("drop", (e) => {
      const song = readLibrarySongTransfer(e);
      if (!song) return;
      e.preventDefault();
      e.stopPropagation();
      tab.classList.remove("fivep-drop-over");
      addSongToFiveP(song);
      setTab("fivep");
    });
  }

  function bindSixPTabDrop() {
    const tab = document.getElementById("tabSixP");
    if (!tab || tab.dataset.libraryDropBound === "1") return;
    tab.dataset.libraryDropBound = "1";

    tab.addEventListener("dragover", (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (!types.includes("application/x-library-song")) return;
      e.preventDefault();
      tab.classList.add("sixp-drop-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    tab.addEventListener("dragleave", () => tab.classList.remove("sixp-drop-over"));

    tab.addEventListener("drop", (e) => {
      const song = readLibrarySongTransfer(e);
      if (!song) return;
      e.preventDefault();
      e.stopPropagation();
      tab.classList.remove("sixp-drop-over");
      addSongToSixP(song);
      setTab("sixp");
    });
  }

  function bindFivePPanel() {
    const panel = document.querySelector(".fivep-panel");
    if (panel && panel.dataset.libraryDropBound !== "1") {
      panel.dataset.libraryDropBound = "1";
      panel.addEventListener("dragover", (e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes("application/x-library-song")) return;
        e.preventDefault();
        panel.classList.add("fivep-drop-over");
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      });
      panel.addEventListener("dragleave", (e) => {
        if (panel.contains(e.relatedTarget)) return;
        panel.classList.remove("fivep-drop-over");
      });
      panel.addEventListener("drop", (e) => {
        const song = readLibrarySongTransfer(e);
        if (!song) return;
        e.preventDefault();
        e.stopPropagation();
        panel.classList.remove("fivep-drop-over");
        addSongToFiveP(song);
      });
    }

    document.querySelectorAll("[data-fivep-song]").forEach((card) => {
      if (card.dataset.fivepDragBound === "1") return;
      card.dataset.fivepDragBound = "1";
      card.addEventListener("dragstart", (e) => {
        const raw = card.getAttribute("data-fivep-song") || "";
        if (!raw) return;
        S.dragIndex = null;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-fivep-song", raw);
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.ytUrl) e.dataTransfer.setData("text/plain", parsed.ytUrl);
        } catch {}
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    });

    document.querySelectorAll("[data-fivep-add]").forEach((btn) => {
      if (btn.dataset.fivepAddBound === "1") return;
      btn.dataset.fivepAddBound = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute("data-fivep-add"));
        const song = getFivePSongs()[idx];
        copyFivePSongToCurrentPage(song, { removeFromFiveP: true });
      });
    });
  }

  function bindSixPPanel() {
    const panel = document.querySelector(".sixp-panel");
    if (panel && panel.dataset.libraryDropBound !== "1") {
      panel.dataset.libraryDropBound = "1";
      panel.addEventListener("dragover", (e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes("application/x-library-song")) return;
        e.preventDefault();
        panel.classList.add("sixp-drop-over");
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      });
      panel.addEventListener("dragleave", (e) => {
        if (panel.contains(e.relatedTarget)) return;
        panel.classList.remove("sixp-drop-over");
      });
      panel.addEventListener("drop", (e) => {
        const song = readLibrarySongTransfer(e);
        if (!song) return;
        e.preventDefault();
        e.stopPropagation();
        panel.classList.remove("sixp-drop-over");
        addSongToSixP(song);
      });
    }

    document.querySelectorAll("[data-sixp-song]").forEach((card) => {
      if (card.dataset.sixpDragBound === "1") return;
      card.dataset.sixpDragBound = "1";
      card.addEventListener("dragstart", (e) => {
        const raw = card.getAttribute("data-sixp-song") || "";
        if (!raw) return;
        S.dragIndex = null;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-sixp-song", raw);
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.ytUrl) e.dataTransfer.setData("text/plain", parsed.ytUrl);
        } catch {}
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    });

    document.querySelectorAll("[data-sixp-add]").forEach((btn) => {
      if (btn.dataset.sixpAddBound === "1") return;
      btn.dataset.sixpAddBound = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute("data-sixp-add"));
        const song = getSixPSongs()[idx];
        copySixPSongToCurrentPage(song, { removeFromSixP: true });
      });
    });
  }

  function bindFivePDropTargets() {
    const panel = document.querySelector(".left-library-panel");
    if (!panel || panel.dataset.fivepDropBound === "1") return;
    panel.dataset.fivepDropBound = "1";

    panel.addEventListener("dragover", (e) => {
      const hasFiveP = Array.from(e.dataTransfer?.types || []).includes("application/x-fivep-song");
      if (!hasFiveP) return;
      e.preventDefault();
      panel.classList.add("fivep-drop-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });

    panel.addEventListener("dragleave", (e) => {
      if (panel.contains(e.relatedTarget)) return;
      panel.classList.remove("fivep-drop-over");
    });

    panel.addEventListener("drop", (e) => {
      const song = readFivePTransfer(e);
      if (!song) return;
      e.preventDefault();
      e.stopPropagation();
      panel.classList.remove("fivep-drop-over");
      copyFivePSongToCurrentPage(song, { removeFromFiveP: true });
    });
  }

  function bindSixPDropTargets() {
    const panel = document.querySelector(".left-library-panel");
    if (!panel || panel.dataset.sixpDropBound === "1") return;
    panel.dataset.sixpDropBound = "1";

    panel.addEventListener("dragover", (e) => {
      const hasSixP = Array.from(e.dataTransfer?.types || []).includes("application/x-sixp-song");
      if (!hasSixP) return;
      e.preventDefault();
      panel.classList.add("sixp-drop-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });

    panel.addEventListener("dragleave", (e) => {
      if (panel.contains(e.relatedTarget)) return;
      panel.classList.remove("sixp-drop-over");
    });

    panel.addEventListener("drop", (e) => {
      const song = readSixPTransfer(e);
      if (!song) return;
      e.preventDefault();
      e.stopPropagation();
      panel.classList.remove("sixp-drop-over");
      copySixPSongToCurrentPage(song, { removeFromSixP: true });
    });
  }

  const LYRICS_BROWSER_COUNTRY_NAMES = {
    jaSongs: "일본곡",
    cnSongs: "중국곡",
    krSongs: "한국곡",
    enSongs: "영어곡",
    bgmSongs: "브금"
  };

  let lyricsBrowserView = "root";

  function normalizeLyricsFileName(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim();
  }

  function compareLyricsFileNames(a, b) {
    return normalizeLyricsFileName(a?.titleTag).localeCompare(
      normalizeLyricsFileName(b?.titleTag),
      "ko",
      { numeric: true, sensitivity: "base" }
    );
  }

  function getLyricsCountryKey(song) {
    return String(song?.collection?.key || song?.country?.key || song?.storeKey || song?.sourceKey || "");
  }

  function getLyricsCountryName(key) {
    return LYRICS_BROWSER_COUNTRY_NAMES[key]
      || S.COUNTRY_STORES?.find((item) => item.key === key)?.label
      || "기타";
  }

  function makeLyricsTitleFiles() {
    const fileMap = new Map();

    (S.songs || []).forEach((song, index) => {
      const titleTag = normalizeLyricsFileName(
        song?.lyricsPageTitleTag
        || (typeof S.getSongTitleTag === "function" ? S.getSongTitleTag(song) : "")
      );
      if (!titleTag) return;

      let file = fileMap.get(titleTag);
      if (!file) {
        file = {
          titleTag,
          hasLyrics: false,
          songIndexes: [],
          countryIndexes: new Map(),
          countryKeys: new Set(),
          songs: []
        };
        fileMap.set(titleTag, file);
      }

      const countryKey = getLyricsCountryKey(song);
      file.songIndexes.push(index);
      file.songs.push(song);
      file.hasLyrics = file.hasLyrics || !!song?.lyricsPageHasLyrics;

      if (countryKey) {
        file.countryKeys.add(countryKey);
        if (!file.countryIndexes.has(countryKey)) file.countryIndexes.set(countryKey, []);
        file.countryIndexes.get(countryKey).push(index);
      }
    });

    return [...fileMap.values()].sort(compareLyricsFileNames);
  }

  function lyricsFileMatchesSearch(file, query) {
    const text = String(query || "").trim();
    if (!text) return true;
    const terms = typeof S.getSearchTerms === "function"
      ? S.getSearchTerms(text)
      : text.toLowerCase().split(/\s+/).filter(Boolean);
    const titleHaystack = typeof S.normalizeSearchText === "function"
      ? S.normalizeSearchText(file.titleTag)
      : file.titleTag.toLowerCase().replace(/\s+/g, "");
    const titleMatch = terms.every((term) => titleHaystack.includes(term));
    if (titleMatch) return true;
    return file.songs.some((song) => typeof S.songMatchesSearch === "function" && S.songMatchesSearch(song, text));
  }

  function lyricsBrowserBackView(view) {
    if (view.startsWith("country:")) return "files";
    if (view.startsWith("status:")) return "classify";
    if (view === "files" || view === "classify") return "root";
    return "root";
  }

  function lyricsBrowserBreadcrumb(view, isSearch = false) {
    const pieces = [{ label: "가사", view: "root" }];
    if (isSearch) {
      pieces.push({ label: "검색 결과", view: "" });
      return pieces;
    }
    if (view === "files" || view.startsWith("country:")) pieces.push({ label: "파일", view: "files" });
    if (view.startsWith("country:")) {
      const key = view.split(":")[1] || "";
      pieces.push({ label: getLyricsCountryName(key), view });
    }
    if (view === "classify" || view.startsWith("status:")) pieces.push({ label: "파일 분류", view: "classify" });
    if (view === "status:done") pieces.push({ label: "가사 되어있는 것", view });
    if (view === "status:todo") pieces.push({ label: "가사 안 되어있는 것", view });
    return pieces;
  }

  function lyricsBrowserToolbarHTML(view, isSearch = false) {
    const backDisabled = isSearch || view === "root";
    const crumbs = lyricsBrowserBreadcrumb(view, isSearch).map((crumb, index, all) => {
      const isLast = index === all.length - 1 || !crumb.view;
      const button = isLast
        ? `<span class="lyrics-browser-crumb-current">${S.escapeHTML(crumb.label)}</span>`
        : `<button type="button" class="lyrics-browser-crumb" data-lyrics-view="${S.escapeHTML(crumb.view)}">${S.escapeHTML(crumb.label)}</button>`;
      return `${button}${index < all.length - 1 ? '<span class="lyrics-browser-separator">›</span>' : ''}`;
    }).join("");

    return `
      <div class="lyrics-browser-toolbar">
        <button type="button" class="lyrics-browser-back" data-lyrics-back="1" ${backDisabled ? "disabled" : ""} title="이전 폴더">←</button>
        <div class="lyrics-browser-path" aria-label="현재 폴더">${crumbs}</div>
      </div>
    `;
  }

  function lyricsFolderRowHTML({ view, name, count, description = "파일 폴더" }) {
    return `
      <button type="button" class="lyrics-browser-row lyrics-browser-folder" data-lyrics-view="${S.escapeHTML(view)}">
        <span class="lyrics-browser-icon" aria-hidden="true">📁</span>
        <span class="lyrics-browser-name-wrap">
          <strong class="lyrics-browser-name">${S.escapeHTML(name)}</strong>
          <span class="lyrics-browser-detail">${S.escapeHTML(description)}</span>
        </span>
        <span class="lyrics-browser-count">${Number(count || 0)}개</span>
      </button>
    `;
  }

  function getLyricsFilePlayIndex(file, countryKey = "") {
    const candidates = countryKey
      ? (file.countryIndexes.get(countryKey) || [])
      : file.songIndexes;
    if (candidates.includes(S.current)) return S.current;
    const lyricsIndex = candidates.find((index) => !!S.songs?.[index]?.lyricsPageHasLyrics);
    return lyricsIndex ?? candidates[0] ?? file.songIndexes[0] ?? 0;
  }

  function lyricsFileRowHTML(file, countryKey = "") {
    const playIndex = getLyricsFilePlayIndex(file, countryKey);
    const active = file.songIndexes.includes(S.current) ? " is-active" : "";
    const stateClass = file.hasLyrics ? " lyrics-file-done" : " lyrics-file-todo";
    const stateText = file.hasLyrics ? "가사 있음" : "가사 없음";
    const countryNames = [...file.countryKeys].map(getLyricsCountryName).join(", ") || "기타";
    const songCount = file.songIndexes.length;
    const fileName = `${file.titleTag}.txt`;

    return `
      <button type="button" class="lyrics-browser-row lyrics-browser-file${stateClass}${active}" data-lyrics-song-index="${playIndex}" title="${S.escapeHTML(file.titleTag)}">
        <span class="lyrics-browser-icon lyrics-text-file-icon" aria-hidden="true"></span>
        <span class="lyrics-browser-name-wrap">
          <strong class="lyrics-browser-name">${S.escapeHTML(fileName)}</strong>
          <span class="lyrics-browser-detail">${S.escapeHTML(countryNames)} · 연결 영상 ${songCount}개</span>
        </span>
        <span class="lyrics-browser-state">${stateText}</span>
      </button>
    `;
  }

  function bindLyricsBrowserEvents(list) {
    if (!list || list.dataset.lyricsBrowserBound === "1") return;
    list.dataset.lyricsBrowserBound = "1";

    list.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-lyrics-view]");
      if (viewButton && list.contains(viewButton)) {
        const nextView = String(viewButton.dataset.lyricsView || "root");
        if (nextView) {
          lyricsBrowserView = nextView;
          showList();
        }
        return;
      }

      const backButton = event.target.closest("[data-lyrics-back]");
      if (backButton && !backButton.disabled) {
        lyricsBrowserView = lyricsBrowserBackView(lyricsBrowserView);
        showList();
        return;
      }

      const fileButton = event.target.closest("[data-lyrics-song-index]");
      if (fileButton) {
        const index = Number(fileButton.dataset.lyricsSongIndex);
        if (Number.isInteger(index) && typeof window.play === "function") window.play(index);
      }
    });
  }

  function showLyricsFileBrowser(list) {
    bindLyricsBrowserEvents(list);

    const allFiles = makeLyricsTitleFiles();
    const query = String(pageSearchQuery || "").trim();
    const isSearch = !!query;
    const matchingFiles = allFiles.filter((file) => lyricsFileMatchesSearch(file, query));
    updatePageSearchSummary(matchingFiles.length, allFiles.length);

    const countryOrder = (S.COUNTRY_STORES || []).map((country) => country.key);
    let bodyHTML = "";
    let titleText = "";
    let visibleFiles = [];
    let countryKey = "";
    let headingCountText = "";

    if (isSearch) {
      titleText = "검색 결과";
      visibleFiles = matchingFiles;
      headingCountText = `${matchingFiles.length}개 파일`;
    } else if (lyricsBrowserView === "root") {
      titleText = "가사 파일";
      const doneCount = allFiles.filter((file) => file.hasLyrics).length;
      const todoCount = allFiles.length - doneCount;
      bodyHTML = [
        lyricsFolderRowHTML({ view: "files", name: "파일", count: allFiles.length, description: "일본곡·중국곡 등 나라별 폴더" }),
        lyricsFolderRowHTML({ view: "classify", name: "파일 분류", count: 2, description: `가사 있음 ${doneCount}개 · 가사 없음 ${todoCount}개` })
      ].join("");
      headingCountText = "2개 폴더";
    } else if (lyricsBrowserView === "files") {
      titleText = "파일";
      const rows = countryOrder.map((key) => {
        const count = allFiles.filter((file) => file.countryKeys.has(key)).length;
        return lyricsFolderRowHTML({
          view: `country:${key}`,
          name: getLyricsCountryName(key),
          count,
          description: "제목태그 메모장"
        });
      });
      bodyHTML = rows.join("");
      headingCountText = `${rows.length}개 폴더`;
    } else if (lyricsBrowserView.startsWith("country:")) {
      countryKey = lyricsBrowserView.split(":")[1] || "";
      titleText = getLyricsCountryName(countryKey);
      visibleFiles = allFiles.filter((file) => file.countryKeys.has(countryKey));
    } else if (lyricsBrowserView === "classify") {
      titleText = "파일 분류";
      const doneCount = allFiles.filter((file) => file.hasLyrics).length;
      const todoCount = allFiles.length - doneCount;
      bodyHTML = [
        lyricsFolderRowHTML({ view: "status:done", name: "가사 되어있는 것", count: doneCount, description: "빨간색 제목태그 파일만 모음" }),
        lyricsFolderRowHTML({ view: "status:todo", name: "가사 안 되어있는 것", count: todoCount, description: "회색 제목태그 파일만 모음" })
      ].join("");
      headingCountText = "2개 폴더";
    } else if (lyricsBrowserView === "status:done") {
      titleText = "가사 되어있는 것";
      visibleFiles = allFiles.filter((file) => file.hasLyrics);
    } else if (lyricsBrowserView === "status:todo") {
      titleText = "가사 안 되어있는 것";
      visibleFiles = allFiles.filter((file) => !file.hasLyrics);
    } else {
      lyricsBrowserView = "root";
      showLyricsFileBrowser(list);
      return;
    }

    if (visibleFiles.length) {
      bodyHTML = visibleFiles.map((file) => lyricsFileRowHTML(file, countryKey)).join("");
      headingCountText = `${visibleFiles.length}개 파일`;
    } else if (!bodyHTML) {
      bodyHTML = `<p class="lyrics-browser-empty">${isSearch ? "검색되는 제목태그 파일이 없어." : "이 폴더에는 제목태그 파일이 없어."}</p>`;
    }

    list.innerHTML = `
      <div class="lyrics-file-browser">
        ${lyricsBrowserToolbarHTML(lyricsBrowserView, isSearch)}
        <div class="lyrics-browser-heading">
          <strong>${S.escapeHTML(titleText)}</strong>
          <span>${S.escapeHTML(headingCountText)}</span>
        </div>
        <div class="lyrics-browser-list">${bodyHTML}</div>
      </div>
    `;
  }

  function showList() {
    const list = document.getElementById("list");
    if (!list) return;

    if (isLyricsPage()) {
      showLyricsFileBrowser(list);
      return;
    }

    const previousPlaylist = list.querySelector(".playlist");
    const previousScrollTop = previousPlaylist ? previousPlaylist.scrollTop : 0;

    const songs = S.songs || [];
    if (songs.length === 0) {
      list.innerHTML = `<p class="empty-center">아직 추가된 노래가 없어!</p>`;
      updatePageSearchSummary(0, 0);
      return;
    }

    const filtered = pageSearchResults();
    updatePageSearchSummary(filtered.length, songs.length);

    if (filtered.length === 0) {
      list.innerHTML = `<p class="empty-center">검색 결과가 없어!</p>`;
      return;
    }

    let html = `<div class="playlist">`;

    filtered.forEach(({ song: s, index: i }, order) => {
      const thumb = s.id ? `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg` : "";
      const active = i === S.current ? " active" : "";
      const lyricsStatusClass = isLyricsPage()
        ? (s.lyricsPageHasLyrics ? " lyrics-has-text" : " lyrics-no-text")
        : "";
      const hasMr = !!S.safeLink(s.mr);
      const isCurrent = i === S.current;
      const statusClass = isCurrent
        ? (hasMr ? "status-current-has-mr" : "status-current-no-mr")
        : (hasMr ? "status-has-mr" : "status-no-mr");
      const statusLabel = hasMr ? "MR" : "없음";
      const sourceBadge = isCombinedLibraryPage() ? collectionBadgeText(s) : "";
      const actionButtonHTML = isYoutubeCollectionPage()
        ? `<button class="pl-mr-status pl-add-status" type="button" title="현재 목록에서 숨기고 태그 설명에 기록" onclick="event.stopPropagation(); archivePlaylistSong(${i});">추가</button>`
        : `<button class="pl-mr-status ${statusClass}" type="button"
            title="${hasMr ? "MR 링크 있음 - 누르면 큰 유튜브 창에서 MR 재생" : "MR 링크 없음"}"
            onclick="event.stopPropagation(); playMr(${i});">
            ${statusLabel}
          </button>`;
      const subText = [S.safeText(s.author || ""), sourceBadge].filter(Boolean).join(" · ");

      const dragAttributes = isLyricsPage()
        ? `draggable="false"`
        : `draggable="true" ondragstart="onDragStart(event, ${i})" ondragover="onDragOver(event)" ondrop="onDrop(event, ${i})"`;
      const handleHTML = isLyricsPage()
        ? ""
        : `<div class="pl-handle" title="드래그해서 순서 변경" onclick="event.stopPropagation();"><span></span><span></span></div>`;

      html += `
        <div class="pl-item${active}${lyricsStatusClass}"
          ${dragAttributes}
          onclick="play(${i})">

          <div class="pl-left">
            <div class="pl-index">${order + 1}</div>
            ${handleHTML}
            <div class="pl-playing">${i === S.current ? "▶" : ""}</div>
          </div>

          <div class="pl-thumb">
            ${thumb ? `<img src="${thumb}" alt="thumb">` : ""}
          </div>

          <div class="pl-meta">
            <div class="pl-title">${S.escapeHTML(s.title || "제목 없음")}</div>
            <div class="pl-sub">${S.escapeHTML(subText)}</div>
          </div>

${actionButtonHTML}
        </div>
      `;
    });

    html += `</div>`;
    list.innerHTML = html;

    const nextPlaylist = list.querySelector(".playlist");
    if (nextPlaylist) nextPlaylist.scrollTop = previousScrollTop;
  }

  let activeTab = "lyrics";
  let activeTagDescriptionTag = "";
  let editorLocked = localStorage.getItem("lyricsMemoEditorLocked") !== "unlocked";

  const LYRICS_SUB_TABS = [
    { key: "lyrics", field: "lyrics", label: "가사", placeholder: "여기에 전체 가사를 적어줘." },
    { key: "original", field: "lyricsOriginal", label: "원어", placeholder: "여기에 원어 가사를 적어줘." },
    { key: "pronunciation", field: "lyricsPronunciation", label: "발음", placeholder: "여기에 발음/독음/로마자를 적어줘." },
    { key: "meaning", field: "lyricsMeaning", label: "뜻", placeholder: "여기에 뜻/해석을 적어줘." }
  ];
  const LYRICS_PART_FIELDS = LYRICS_SUB_TABS.filter((item) => item.field !== "lyrics");
  const LYRICS_PART_FIELD_NAMES = LYRICS_SUB_TABS.map((item) => item.field);
  let activeLyricsSubTab = "lyrics";
  const LEGACY_LYRICS_FIELDS = ["lyricsJa", "lyricsCn", "lyricsKr", "lyricsEn"];

  function isVideoPageSong(song) {
    const key = song?.storeKey || song?.sourceKey || song?.collection?.key || S.storeKey || "";
    return String(key).startsWith("yt");
  }

  function shouldUseLyricsParts(song) {
    return !isVideoPageSong(song);
  }

  function normalizeDrawerTab(tab) {
    return ["lyrics", "tagdesc", "mr", "videomemo", "original", "fivep", "sixp"].includes(tab) ? tab : "lyrics";
  }

  function normalizeLyricsSubTab(tab) {
    return LYRICS_SUB_TABS.some((item) => item.key === tab) ? tab : "lyrics";
  }

  function getActiveLyricsSubTabItem() {
    const key = normalizeLyricsSubTab(activeLyricsSubTab);
    return LYRICS_SUB_TABS.find((item) => item.key === key) || LYRICS_SUB_TABS[0];
  }

  function resetLyricsSubTab() {
    activeLyricsSubTab = "lyrics";
  }

  function setLyricsSubTab(tab) {
    activeLyricsSubTab = normalizeLyricsSubTab(tab);
    updateLyricsDrawer();
  }

  function setTabClass(el, className = "tab-link") {
    if (el) el.className = className;
  }

  function legacyLyricsText(song) {
    if (!song) return "";
    return song.lyrics || song.lyricsJa || song.lyricsCn || song.lyricsKr || song.lyricsEn || "";
  }

  function getEditorText(song, field) {
    if (!song) return "";

    let fallback = "";
    if (field === "lyricsOriginal") fallback = song.lyricsOriginal ?? legacyLyricsText(song);
    else if (field === "lyrics") fallback = song.lyrics ?? song.lyricsOriginal ?? "";
    else fallback = song[field] ?? "";

    if (typeof S.getSharedTextForSong === "function") {
      return S.getSharedTextForSong(song, field, fallback).value;
    }
    return fallback;
  }

  function sharedTitleBadgeHTML(song, field) {
    if (typeof S.getSharedTextForSong !== "function") return "";
    const info = S.getSharedTextForSong(song, field, "");
    if (!info.shared || !info.titleTag) return "";
    return `<span class="lyrics-shared-badge" title="같은 제목태그를 가진 노래/영상은 이 칸을 같이 써.">제목태그 #${S.escapeHTML(info.titleTag)} 공유</span>`;
  }

  function getLyricsLockButton() {
    let btn = document.getElementById("lyricsLockBtn");
    if (btn) return btn;

    const head = document.querySelector(".lyrics-head");
    const closeBtn = document.getElementById("lyricsCloseBtn");
    if (!head) return null;

    btn = document.createElement("button");
    btn.id = "lyricsLockBtn";
    btn.className = "lyrics-lock-btn";
    btn.type = "button";
    btn.addEventListener("click", () => setEditorLocked(!editorLocked, true));

    if (closeBtn) head.insertBefore(btn, closeBtn);
    else head.appendChild(btn);
    return btn;
  }

  function updateLockUI() {
    const btn = getLyricsLockButton();
    if (btn) {
      btn.textContent = editorLocked ? "🔒 잠금" : "🔓 수정 가능";
      btn.title = editorLocked ? "잠금 상태라 내용을 수정할 수 없어." : "잠금 해제 상태라 내용을 수정할 수 있어.";
      btn.setAttribute("aria-pressed", editorLocked ? "true" : "false");
      btn.classList.toggle("locked", editorLocked);
      btn.classList.toggle("unlocked", !editorLocked);
    }

    document.querySelectorAll(".lyrics-edit-textarea, .memo-textarea").forEach((textarea) => {
      textarea.readOnly = editorLocked;
      textarea.classList.toggle("is-locked", editorLocked);
      textarea.classList.toggle("is-unlocked", !editorLocked);
    });

    document.querySelectorAll(".editor-lock-help").forEach((help) => {
      help.textContent = editorLocked
        ? "잠금 상태야. 위의 잠금 버튼을 풀면 수정할 수 있어."
        : "수정 가능 상태야. 입력하면 바로 자동 저장돼.";
    });
  }

  function setEditorLocked(locked, shouldFocus = false) {
    editorLocked = !!locked;
    localStorage.setItem("lyricsMemoEditorLocked", editorLocked ? "locked" : "unlocked");
    updateLockUI();

    if (!editorLocked && shouldFocus) {
      const editor = document.querySelector(".lyrics-edit-textarea, .memo-textarea");
      editor?.focus();
    }
  }

  function setTab(tab) {
    activeTab = normalizeDrawerTab(tab);
    if (activeTab === "lyrics") resetLyricsSubTab();
    updateLyricsDrawer();
  }

  function editorPanelHTML(song, field, placeholder, labelOverride = "") {
    const value = S.escapeHTML(getEditorText(song, field));
    const label = labelOverride || (field === "memo" ? "메모" : "가사");
    const downloadLabel = field === "memo" ? "메모" : "가사";
    return `
      <section class="lyrics-edit-panel" aria-label="${label} 메모장">
        <div class="lyrics-editor-toolbar">
          <strong>${S.escapeHTML(label)}</strong>
          ${sharedTitleBadgeHTML(song, field)}
          <button class="lyrics-text-download-btn" type="button" data-download-field="${S.escapeHTML(field)}" data-download-kind="${downloadLabel}">${downloadLabel} txt 다운로드</button>
        </div>
        <textarea class="lyrics-edit-textarea ${editorLocked ? "is-locked" : "is-unlocked"}" data-field="${S.escapeHTML(field)}" placeholder="${S.escapeHTML(placeholder)}" spellcheck="false" ${editorLocked ? "readonly" : ""}>${value}</textarea>
        <p class="memo-save-help editor-lock-help">${editorLocked ? "잠금 상태야. 위의 잠금 버튼을 풀면 수정할 수 있어. txt 파일/메모장 글은 여기에 끌어다 놓으면 바로 저장돼." : "수정 가능 상태야. 입력하거나 txt 파일/메모장 글을 끌어다 놓으면 바로 자동 저장돼."}</p>
      </section>
    `;
  }

  function hasLyricsSubTabContent(song, item) {
    return Boolean(getEditorText(song, item.field).trim());
  }

  function lyricsSubTabsHTML(song) {
    return `
      <div class="lyrics-sub-tabs" aria-label="가사 세부 탭">
        ${LYRICS_SUB_TABS.map((item) => {
          const activeClass = normalizeLyricsSubTab(activeLyricsSubTab) === item.key ? "is-active" : "";
          const filledClass = hasLyricsSubTabContent(song, item) ? "has-content" : "";
          return `
            <button class="lyrics-sub-tab ${activeClass} ${filledClass}" type="button" data-lyrics-subtab="${S.escapeHTML(item.key)}">${S.escapeHTML(item.label)}</button>
          `;
        }).join("")}
      </div>
    `;
  }

  function lyricsSinglePartPanelHTML(song, item) {
    const value = S.escapeHTML(getEditorText(song, item.field));
    return `
      <section class="lyrics-edit-panel lyrics-part-panel lyrics-single-part-panel" aria-label="가사 ${item.label}">
        <div class="lyrics-single-panel-head">
          <strong>${S.escapeHTML(item.label)}</strong>
          ${sharedTitleBadgeHTML(song, item.field)}
          <button class="lyrics-text-download-btn lyrics-floating-download-btn" type="button" data-download-field="${S.escapeHTML(item.field)}" data-download-kind="${S.escapeHTML(item.label)}">${S.escapeHTML(item.label)} txt 다운로드</button>
        </div>
        <textarea class="lyrics-edit-textarea lyrics-part-textarea ${editorLocked ? "is-locked" : "is-unlocked"}" data-field="${S.escapeHTML(item.field)}" placeholder="${S.escapeHTML(item.placeholder)}" spellcheck="false" ${editorLocked ? "readonly" : ""}>${value}</textarea>
      </section>
    `;
  }

  function lyricsTriplePanelHTML(song) {
    const item = getActiveLyricsSubTabItem();
    return `
      <section class="lyrics-triple-panel" aria-label="가사 원어 발음 뜻">
        ${lyricsSubTabsHTML(song)}
        ${lyricsSinglePartPanelHTML(song, item)}
        <p class="memo-save-help editor-lock-help">${editorLocked ? "잠금 상태야. 위의 잠금 버튼을 풀면 수정할 수 있어. txt 파일/메모장 글은 현재 탭 칸에 끌어다 놓으면 바로 저장돼." : "수정 가능 상태야. 현재 탭에 입력하거나 txt 파일을 끌어다 놓으면 바로 자동 저장돼."}</p>
      </section>
    `;
  }

  function getTextEditorField(editor) {
    const rawField = editor?.dataset?.field || "lyrics";
    const allowedFields = ["memo", "lyrics", ...LYRICS_PART_FIELD_NAMES, ...LEGACY_LYRICS_FIELDS];
    return allowedFields.includes(rawField) ? rawField : "lyrics";
  }

  function saveTextEditorValue(editor, options = {}) {
    if (!editor) return false;
    const songs = S.songs || [];
    const s = songs[S.current];
    const field = getTextEditorField(editor);
    if (!s) return false;
    s[field] = editor.value;
    if (typeof S.setSharedTextForSong === "function") S.setSharedTextForSong(s, field, editor.value);
    S.save();
    refreshLyricsSubTabState();
    if (options.refreshTags && typeof renderTagTools === "function") renderTagTools();
    return true;
  }

  function saveAllTextEditors() {
    let saved = false;
    document.querySelectorAll(".lyrics-edit-textarea[data-field]").forEach((editor) => {
      saved = saveTextEditorValue(editor) || saved;
    });
    return saved;
  }

  function insertTextAtCursor(editor, text) {
    if (!editor || !text) return;
    editor.focus();

    const start = Number.isFinite(editor.selectionStart) ? editor.selectionStart : editor.value.length;
    const end = Number.isFinite(editor.selectionEnd) ? editor.selectionEnd : start;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    editor.value = `${before}${text}${after}`;

    const nextCursor = start + text.length;
    try { editor.setSelectionRange(nextCursor, nextCursor); } catch {}
    saveTextEditorValue(editor);
  }

  function readDroppedTextFile(file, onText) {
    if (!file) return;
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    const looksText = name.endsWith(".txt") || type.startsWith("text/") || !type;

    if (!looksText) {
      alert("txt 파일이나 텍스트 파일만 넣을 수 있어.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result || ""));
    reader.onerror = () => alert("파일을 읽지 못했어. txt 파일인지 확인해줘.");
    reader.readAsText(file, "utf-8");
  }

  function sanitizeFilenamePart(text) {
    const cleaned = String(text || "제목 없음")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (cleaned || "제목 없음").slice(0, 100);
  }

  function makeTextDownload(filename, text) {
    const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function getDownloadKindByField(field) {
    if (field === "memo") return "메모";
    if (field === "lyricsOriginal") return "원어";
    if (field === "lyricsPronunciation") return "발음";
    if (field === "lyricsMeaning") return "뜻";
    return "가사";
  }

  function downloadCurrentEditorText(editor, kindOverride = "") {
    if (!editor) return;
    const s = getCurrentSong();
    if (!s) {
      alert("먼저 노래를 하나 선택해줘.");
      return;
    }

    saveTextEditorValue(editor);
    const field = getTextEditorField(editor);
    const kind = kindOverride || getDownloadKindByField(field);
    const title = sanitizeFilenamePart(s.title || "제목 없음");
    makeTextDownload(`${title}+${kind}.txt`, editor.value);
  }

  function downloadCurrentLyricsBundle() {
    const s = getCurrentSong();
    if (!s) {
      alert("먼저 노래를 하나 선택해줘.");
      return;
    }

    saveAllTextEditors();
    const title = sanitizeFilenamePart(s.title || "제목 없음");
    const parts = LYRICS_PART_FIELDS.map((item) => {
      const editor = Array.from(document.querySelectorAll(".lyrics-edit-textarea[data-field]")).find((el) => getTextEditorField(el) === item.field);
      const value = editor ? editor.value : getEditorText(s, item.field);
      return `[${item.label}]\n${value}`;
    }).join("\n\n");
    makeTextDownload(`${title}+가사.txt`, parts);
  }

  function refreshLyricsSubTabState() {
    const song = getCurrentSong();
    document.querySelectorAll("[data-lyrics-subtab]").forEach((btn) => {
      const key = normalizeLyricsSubTab(btn.getAttribute("data-lyrics-subtab") || "lyrics");
      const item = LYRICS_SUB_TABS.find((entry) => entry.key === key);
      const hasContent = item ? hasLyricsSubTabContent(song, item) : false;
      btn.classList.toggle("is-active", normalizeLyricsSubTab(activeLyricsSubTab) === key);
      btn.classList.toggle("has-content", hasContent);
    });
  }

  function bindLyricsSubTabs() {
    document.querySelectorAll("[data-lyrics-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setLyricsSubTab(btn.getAttribute("data-lyrics-subtab") || "lyrics");
        refreshLyricsSubTabState();
      });
    });
  }

  function bindTextEditorAutosave() {
    bindLyricsSubTabs();
    const editors = Array.from(document.querySelectorAll(".lyrics-edit-textarea[data-field]"));
    if (editors.length === 0) return;

    editors.forEach((editor) => {
      editor.readOnly = editorLocked;
      editor.addEventListener("input", () => {
        if (editorLocked) return;
        saveTextEditorValue(editor);
      });

      editor.addEventListener("dragover", (e) => {
        const dt = e.dataTransfer;
        const hasFile = Array.from(dt?.types || []).includes("Files");
        const hasText = Array.from(dt?.types || []).includes("text/plain");
        if (!hasFile && !hasText) return;
        e.preventDefault();
        editor.classList.add("is-dragover");
        if (dt) dt.dropEffect = "copy";
      });

      editor.addEventListener("dragleave", () => {
        editor.classList.remove("is-dragover");
      });

      editor.addEventListener("drop", (e) => {
        e.preventDefault();
        editor.classList.remove("is-dragover");

        const file = e.dataTransfer?.files?.[0];
        if (file) {
          readDroppedTextFile(file, (text) => insertTextAtCursor(editor, text));
          return;
        }

        const text = e.dataTransfer?.getData("text/plain") || "";
        if (text) insertTextAtCursor(editor, text);
      });
    });

    document.querySelectorAll(".lyrics-text-download-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.getAttribute("data-download-mode") === "lyrics-bundle") {
          downloadCurrentLyricsBundle();
          return;
        }
        const field = btn.getAttribute("data-download-field") || "lyrics";
        const kind = btn.getAttribute("data-download-kind") || getDownloadKindByField(field);
        const editor = editors.find((el) => getTextEditorField(el) === field) || editors[0];
        downloadCurrentEditorText(editor, kind);
      });
    });
  }

  function getDrawerSelectedTag(song = null) {
    if (isTagPage()) return S.getCurrentTagParam?.() || "";
    const tags = S.normalizeTags(song?.tags);
    if (activeTagDescriptionTag && tags.includes(activeTagDescriptionTag)) return activeTagDescriptionTag;
    return tags[0] || "";
  }

  function tagDescriptionTagPickerHTML(tags, selectedTag) {
    if (!tags.length) return `<p class="tag-description-empty">붙어 있는 태그가 아직 없어.</p>`;
    return `
      <div class="tag-description-tag-list">
        ${tags.map((tag) => `
          <button type="button" class="tag-description-tag-btn ${selectedTag === tag ? "is-active" : ""}" data-tag-description-pick="${S.escapeHTML(tag)}">#${S.escapeHTML(tag)}</button>
        `).join("")}
      </div>
    `;
  }

  function tagArchiveCardsHTML(tag) {
    const clean = S.normalizeTag(tag);
    if (!clean) return `<p class="tag-description-empty">먼저 태그를 선택해줘.</p>`;
    const records = (typeof S.readRemovedVideoArchive === "function" ? S.readRemovedVideoArchive() : [])
      .filter((item) => S.normalizeTag(item.primaryTag) === clean || S.normalizeTags(item.tags).includes(clean));
    if (!records.length) return `<p class="tag-description-empty">여기에 자동으로 쌓인 정리 기록이 아직 없어.</p>`;
    return `
      <div class="tag-archive-list">
        ${records.map((record) => {
          const dateText = typeof S.formatArchiveDateText === "function" ? S.formatArchiveDateText(record.removedAt || new Date()) : "";
          const desc = S.escapeHTML(String(record.lyrics || "")).replace(/\n/g, "<br>");
          const href = pageSongHref({ page: (S.ALL_STORES || []).find((item) => item.key === record.sourceStoreKey)?.page || "" }, record);
          return `
            <article class="tag-archive-card">
              <div class="tag-archive-sep">============</div>
              <div class="tag-archive-line">${S.escapeHTML(dateText)} /</div>
              <div class="tag-archive-line">
                <span>${S.escapeHTML(record.title || "제목 없음")} / </span>
                <a class="tag-archive-link" href="${href}" title="사이트에서 바로 재생">${S.escapeHTML(record.ytUrl || "")}</a>
              </div>
              <div class="tag-archive-desc">${desc || `<span class="tag-description-empty">설명이 비어 있어.</span>`}</div>
              <div class="tag-archive-sep">============</div>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function tagDescriptionPanelHTML(song = null) {
    const explicitTag = isTagPage() ? (S.getCurrentTagParam?.() || "") : "";
    const tags = explicitTag ? [explicitTag] : S.normalizeTags(song?.tags);
    const selectedTag = explicitTag || getDrawerSelectedTag(song);
    const description = selectedTag && typeof S.getTagSharedDescription === "function" ? S.getTagSharedDescription(selectedTag) : "";
    return `
      <section class="tag-description-panel" aria-label="태그 설명">
        <div class="tag-description-head">
          <strong>태그 설명</strong>
          <span>${selectedTag ? `현재 태그: #${S.escapeHTML(selectedTag)}` : "영상의 태그 설명을 적을 수 있어."}</span>
        </div>
        ${tagDescriptionTagPickerHTML(tags, selectedTag)}
        <textarea class="tag-description-textarea ${editorLocked ? "is-locked" : "is-unlocked"}" data-tag-description-editor="${S.escapeHTML(selectedTag)}" placeholder="여기에 태그 자체 설명을 적어줘. 쓰는 즉시 자동 저장돼." spellcheck="false" ${editorLocked ? "readonly" : ""}>${S.escapeHTML(description)}</textarea>
        <p class="memo-save-help editor-lock-help">${editorLocked ? "잠금 상태야. 위의 잠금 버튼을 풀면 수정할 수 있어." : "수정 가능 상태야. 입력하면 바로 자동 저장돼."}</p>
        <div class="tag-description-archive">
          <h3>정리 기록</h3>
          ${tagArchiveCardsHTML(selectedTag)}
        </div>
      </section>
    `;
  }

  function bindTagDescriptionPanel(song = null) {
    document.querySelectorAll('[data-tag-description-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTagDescriptionTag = S.normalizeTag(btn.getAttribute('data-tag-description-pick') || "");
        updateLyricsDrawer();
      });
    });

    const editor = document.querySelector('[data-tag-description-editor]');
    if (!editor) return;
    editor.readOnly = editorLocked;
    editor.addEventListener('input', () => {
      if (editorLocked) return;
      const tag = S.normalizeTag(editor.getAttribute('data-tag-description-editor') || "");
      if (!tag || typeof S.setTagSharedDescription !== 'function') return;
      S.setTagSharedDescription(tag, editor.value);
    });
  }

  function tagVideoMemoPanelHTML() {
    const tag = S.getCurrentTagParam?.() || getDrawerSelectedTag(getCurrentSong());
    if (!tag) {
      return `
        <section class="tag-video-memo-panel"><p class="tag-description-empty">먼저 태그를 하나 골라줘.</p></section>
      `;
    }
    const items = (typeof S.getAllSongs === 'function' ? S.getAllSongs() : []).filter((song) => S.normalizeTags(song.tags).includes(tag));
    return `
      <section class="tag-video-memo-panel">
        <div class="tag-description-head">
          <strong>영상메모</strong>
          <span>#${S.escapeHTML(tag)} 태그가 있는 영상 메모 모음</span>
        </div>
        <div class="tag-video-memo-list">
          ${items.length ? items.map((item) => {
            const label = collectionBadgeText(item) || (item.collection?.label || '재생목록');
            const href = pageSongHref(item.collection || item.country || {}, item);
            return `
              <article class="tag-video-memo-item">
                <div class="tag-video-memo-sep">==</div>
                <div class="tag-video-memo-head">
                  <div class="tag-video-memo-title">(${Number(item.index) + 1}) ${S.escapeHTML(item.title || '제목 없음')}</div>
                  <a class="tag-video-memo-jump" href="${href}" title="재생목록에서 바로가기">&lt;</a>
                </div>
                <div class="tag-video-memo-sub">${S.escapeHTML(label)}</div>
                <pre class="tag-video-memo-body">${S.escapeHTML(String(item.memo || ''))}</pre>
                <div class="tag-video-memo-sep">==</div>
              </article>
            `;
          }).join('') : `<p class="tag-description-empty">이 태그를 가진 영상이 아직 없어.</p>`}
        </div>
      </section>
    `;
  }

  function archivePlaylistSong(index) {
    if (!isYoutubeCollectionPage()) return;
    const target = songs[index];
    if (!target) return;
    if (typeof S.archiveRemovedVideo === 'function') S.archiveRemovedVideo(target, { sourceStoreKey: S.storeKey, sourceIndex: index });

    const wasCurrent = index === current;
    songs.splice(index, 1);

    if (songs.length === 0) {
      save();
      if (typeof ytPlayer !== 'undefined' && ytPlayer) ytPlayer.stopVideo();
      current = 0;
      showList();
      updateLyricsDrawer();
      updateControlLabels();
      if (typeof renderTagTools === 'function') renderTagTools();
      return;
    }

    if (index < current) current--;
    if (current >= songs.length) current = songs.length - 1;
    save();
    showList();
    updateLyricsDrawer();
    updateControlLabels();
    if (typeof renderTagTools === 'function') renderTagTools();
    if (wasCurrent && typeof play === 'function') play(current);
  }

  function extraPanelHTML(song) {
    const url = getOriginalUrl(song);
    const found = url ? findSongByUrl(url) : null;
    const locations = getSongLocations(song);
    const tags = S.normalizeTags(song?.tags);
    const foundText = found
      ? `웹사이트 안에 같은 원곡이 있어. 버튼을 누르면 ${S.escapeHTML(found.collection?.label || "해당 페이지")}로 이동해.`
      : (url ? "웹사이트 안에 같은 영상이 없으면 유튜브 링크로 열려." : "수정창에서 원곡 링크를 넣으면 여기에서 이동할 수 있어.");
    const showPathInOriginalTab = !isTagPage();
    return `
      <section class="original-panel extra-panel" aria-label="기타 정보">
        ${showPathInOriginalTab ? `
        <div class="extra-section">
          <h3>저장 위치 / 경로</h3>
          <p class="original-help">이 영상이 들어있는 원래 페이지로 바로 이동할 수 있어.</p>
          <div class="song-path-list">
            ${locations.length ? locations.map((item) => `
              <a class="song-path-chip" href="${pageSongHref(item.collection, item)}">
                <span>${S.escapeHTML(collectionBadgeText(item) || "저장 위치")}</span>
                <b>${Number(item.index) + 1}번</b>
              </a>
            `).join("") : `<span class="original-empty">저장 위치를 찾지 못했어.</span>`}
          </div>
        </div>
        ` : ""}

        <div class="extra-section">
          <h3>태그</h3>
          <div class="song-tags song-tags-extra">
            ${tags.length ? tags.map((tag) => tagChipHTML(tag, new Map(S.getTagCounts("all")).get(tag) || 1)).join("") : `<p class="tag-empty">태그가 아직 없어.</p>`}
          </div>
        </div>

        <div class="extra-section">
          <h3>원곡</h3>
          <button id="openOriginalBtn" class="original-open-btn" type="button" ${url ? "" : "disabled"}>원곡 열기</button>
          <p class="original-help">${foundText}</p>
          ${url ? `<div class="original-url-box">${S.escapeHTML(url)}</div>` : `<div class="original-empty">원곡 링크가 아직 없어.</div>`}
        </div>
      </section>
    `;
  }

  function renderTagPlayerSummary() {
    const holder = document.getElementById("tagPlayerMeta");
    if (!holder || !isTagPage()) return;

    const s = getCurrentSong();
    if (!s) {
      holder.innerHTML = `
        <div class="tag-summary-block">
          <h3>저장 위치 / 경로</h3>
          <p class="tag-page-help">영상을 선택하면 원래 페이지로 이동하는 경로가 여기 보여.</p>
        </div>
        <div class="tag-summary-block">
          <h3>태그</h3>
          <p class="tag-page-help">영상을 선택하면 태그도 여기서 바로 볼 수 있어.</p>
        </div>
      `;
      return;
    }

    const locations = getSongLocations(s);
    const tags = S.normalizeTags(s?.tags);
    const tagCounts = new Map(S.getTagCounts("all"));

    holder.innerHTML = `
      <div class="tag-summary-block">
        <h3>저장 위치 / 경로</h3>
        <div class="song-path-list tag-summary-paths">
          ${locations.length ? locations.map((item) => `
            <a class="song-path-chip" href="${pageSongHref(item.collection, item)}">
              <span>${S.escapeHTML(collectionBadgeText(item) || "저장 위치")}</span>
              <b>${Number(item.index) + 1}번</b>
            </a>
          `).join("") : `<span class="original-empty">저장 위치를 찾지 못했어.</span>`}
        </div>
      </div>
      <div class="tag-summary-block">
        <h3>태그</h3>
        <div class="song-tags song-tags-extra tag-summary-tags">
          ${tags.length ? tags.map((tag) => tagChipHTML(tag, tagCounts.get(tag) || 1)).join("") : `<p class="tag-empty">태그가 아직 없어.</p>`}
        </div>
      </div>
    `;
  }

  function bindOriginalPanel() {
    document.getElementById("openOriginalBtn")?.addEventListener("click", openOriginalSong);
  }

  function openOriginalSong() {
    const s = getCurrentSong();
    const url = getOriginalUrl(s);

    if (!url) {
      alert("원곡 링크가 아직 없어. 수정창에서 원곡 링크를 넣어줘.");
      return;
    }

    const found = findSongByUrl(url);
    if (found) {
      if (found.storeKey === S.storeKey && !isTagPage()) {
        if (typeof play === "function") play(found.index);
        return;
      }

      const playKey = found.id || found.ytUrl || url;
      location.href = `${getCollectionPageHref(found.collection)}?play=${encodeURIComponent(playKey)}`;
      return;
    }

    window.open(url, "_blank", "noopener");
  }

  function updateLyricsDrawer() {
    const titleEl = document.getElementById("lyricsNowTitle");
    const textEl = document.getElementById("lyricsNowText");
    const mediaEl = document.getElementById("lyricsNowMedia");
    const tagEl = document.getElementById("lyricsNowTags");
    const tabLyrics = document.getElementById("tabLyrics");
    const tabTagDesc = document.getElementById("tabTagDesc");
    const tabMr = document.getElementById("tabMr");
    const tabOriginal = document.getElementById("tabOriginal");
    const tabFiveP = document.getElementById("tabFiveP");
    const tabSixP = document.getElementById("tabSixP");
    const headTitle = document.querySelector(".lyrics-head-title");

    getLyricsLockButton();
    updateLockUI();
    renderTagPlayerSummary();

    if (!titleEl || !textEl || !mediaEl || !tabLyrics || !tabMr || !tabOriginal) return;

    const songs = S.songs || [];
    const s = songs[S.current];

    activeTab = normalizeDrawerTab(activeTab);
    if (isTagPage() && activeTab === "lyrics") activeTab = "tagdesc";
    if (isTagPage() && activeTab === "mr") activeTab = "videomemo";

    setTabClass(tabLyrics);
    if (tabTagDesc) setTabClass(tabTagDesc);
    setTabClass(tabMr);
    setTabClass(tabOriginal);
    if (tabFiveP) setTabClass(tabFiveP);
    if (tabSixP) setTabClass(tabSixP);

    if (tabTagDesc) tabTagDesc.hidden = false;
    if (isTagPage()) {
      tabLyrics.hidden = true;
      tabOriginal.hidden = true;
      tabMr.textContent = "영상메모";
    } else {
      tabLyrics.hidden = false;
      tabOriginal.hidden = false;
      tabMr.textContent = "메모";
    }
    bindFivePTabDrop();
    bindSixPTabDrop();

    if (activeTab === "fivep" && tabFiveP) {
      if (headTitle) headTitle.textContent = "5P";
      titleEl.textContent = "5P 영상 보관함";
      if (tagEl) tagEl.innerHTML = "";
      textEl.style.display = "none";
      mediaEl.style.display = "block";
      tabFiveP.classList.add("tab-active");
      mediaEl.innerHTML = fivePPanelHTML();
      bindFivePPanel();
      return;
    }

    if (activeTab === "sixp" && tabSixP) {
      if (headTitle) headTitle.textContent = "6P";
      titleEl.textContent = "6P 영상 보관함";
      if (tagEl) tagEl.innerHTML = "";
      textEl.style.display = "none";
      mediaEl.style.display = "block";
      tabSixP.classList.add("tab-active");
      mediaEl.innerHTML = sixPPanelHTML();
      bindSixPPanel();
      return;
    }

    if (!s) {
      const selectedTag = S.getCurrentTagParam?.() || "";
      if (activeTab === "tagdesc" && tabTagDesc) {
        if (headTitle) headTitle.textContent = "태그설명";
        titleEl.textContent = selectedTag ? `#${selectedTag}` : "태그설명";
        if (tagEl) tagEl.innerHTML = selectedTag ? `<div class="song-tags song-tags-drawer"><a class="song-tag-chip drawer-tag-chip is-active" href="#">#${S.escapeHTML(selectedTag)}</a></div>` : "";
        textEl.style.display = "none";
        mediaEl.style.display = "block";
        tabTagDesc.classList.add("tab-active");
        mediaEl.innerHTML = tagDescriptionPanelHTML();
        bindTagDescriptionPanel();
        updateLockUI();
        return;
      }

      if (activeTab === "videomemo" && isTagPage()) {
        if (headTitle) headTitle.textContent = "영상메모";
        titleEl.textContent = selectedTag ? `#${selectedTag}` : "영상메모";
        if (tagEl) tagEl.innerHTML = selectedTag ? `<div class="song-tags song-tags-drawer"><a class="song-tag-chip drawer-tag-chip is-active" href="#">#${S.escapeHTML(selectedTag)}</a></div>` : "";
        textEl.style.display = "none";
        mediaEl.style.display = "block";
        tabMr.classList.add("tab-active");
        mediaEl.innerHTML = tagVideoMemoPanelHTML();
        updateLockUI();
        return;
      }

      if (headTitle) headTitle.textContent = isTagPage() ? "태그설명 / 영상메모 / 5P / 6P" : "설명 / 메모 / 기타 / 5P / 6P";
      const videoLikePage = isTagPage() || document.body?.dataset?.store?.startsWith("yt");
      titleEl.textContent = videoLikePage ? "재생중인 영상이 없어" : "재생중인 곡이 없어";
      if (tagEl) tagEl.innerHTML = "";
      textEl.textContent = videoLikePage
        ? "영상을 재생하면 여기서 설명/태그설명/메모/기타 정보를 볼 수 있어."
        : "노래를 재생하면 여기서 원어/발음/뜻 가사를 나눠 적을 수 있어.";
      textEl.style.display = "block";
      mediaEl.style.display = "none";
      mediaEl.innerHTML = "";

      if (isTagPage()) {
        if (tabTagDesc) tabTagDesc.classList.add("tab-active");
        tabMr.classList.add("tab-disabled-soft");
      } else {
        tabLyrics.classList.add("tab-active");
        if (tabTagDesc) tabTagDesc.classList.add("tab-ready");
        tabMr.classList.add("tab-disabled-soft");
        tabOriginal.classList.add("tab-disabled-soft");
      }
      if (tabFiveP) tabFiveP.classList.add("tab-ready");
      if (tabSixP) tabSixP.classList.add("tab-ready");
      return;
    }

    const author = S.safeText(s.author);
    titleEl.textContent = author ? `${S.safeText(s.title || "제목 없음")} - ${author}` : S.safeText(s.title || "제목 없음");
    if (tagEl) tagEl.innerHTML = songTagsHTML(s, "drawer");

    if (!isTagPage()) tabLyrics.classList.add("tab-ready");
    if (tabTagDesc) tabTagDesc.classList.add("tab-ready");
    tabMr.classList.add("tab-ready");
    if (!isTagPage()) tabOriginal.classList.add("tab-ready");
    if (tabFiveP) tabFiveP.classList.add("tab-ready");
    if (tabSixP) tabSixP.classList.add("tab-ready");

    textEl.style.display = "none";
    mediaEl.style.display = "block";

    activeTab = normalizeDrawerTab(activeTab);

    if (activeTab === "fivep" && tabFiveP) {
      if (headTitle) headTitle.textContent = "5P";
      tabFiveP.classList.add("tab-active");
      mediaEl.innerHTML = fivePPanelHTML();
      bindFivePPanel();
      updateLockUI();
      return;
    }

    if (activeTab === "sixp" && tabSixP) {
      if (headTitle) headTitle.textContent = "6P";
      tabSixP.classList.add("tab-active");
      mediaEl.innerHTML = sixPPanelHTML();
      bindSixPPanel();
      updateLockUI();
      return;
    }

    if (activeTab === "tagdesc" && tabTagDesc) {
      if (headTitle) headTitle.textContent = "태그설명";
      tabTagDesc.classList.add("tab-active");
      mediaEl.innerHTML = tagDescriptionPanelHTML(s);
      bindTagDescriptionPanel(s);
      updateLockUI();
      return;
    }

    if (activeTab === "videomemo" && isTagPage()) {
      if (headTitle) headTitle.textContent = "영상메모";
      tabMr.classList.add("tab-active");
      mediaEl.innerHTML = tagVideoMemoPanelHTML();
      updateLockUI();
      return;
    }

    if (activeTab === "mr") {
      if (headTitle) headTitle.textContent = "메모";
      tabMr.classList.add("tab-active");
      mediaEl.innerHTML = editorPanelHTML(s, "memo", "여기에 메모를 적어줘. 쓰는 즉시 자동 저장돼.", "메모");
      bindTextEditorAutosave();
      updateLockUI();
      return;
    }

    if (activeTab === "original") {
      if (headTitle) headTitle.textContent = "기타";
      tabOriginal.classList.add("tab-active");
      mediaEl.innerHTML = extraPanelHTML(s);
      bindOriginalPanel();
      updateLockUI();
      return;
    }

    activeTab = isTagPage() ? "tagdesc" : "lyrics";
    if (isTagPage()) {
      if (tabTagDesc) tabTagDesc.classList.add("tab-active");
      if (headTitle) headTitle.textContent = "태그설명";
      mediaEl.innerHTML = tagDescriptionPanelHTML(s);
      bindTagDescriptionPanel(s);
      updateLockUI();
      return;
    }

    tabLyrics.classList.add("tab-active");

    if (shouldUseLyricsParts(s)) {
      if (headTitle) headTitle.textContent = "가사";
      mediaEl.innerHTML = lyricsTriplePanelHTML(s);
    } else {
      if (headTitle) headTitle.textContent = "설명";
      mediaEl.innerHTML = `
        <div class="video-description-combined">
          ${editorPanelHTML(
            s,
            "lyrics",
            "여기에 설명을 적어줘. 쓰는 즉시 자동 저장돼.",
            "설명"
          )}
          ${tagDescriptionPanelHTML(s)}
        </div>
      `;
      bindTextEditorAutosave();
      bindTagDescriptionPanel(s);
      updateLockUI();
      return;
    }
    bindTextEditorAutosave();
    updateLockUI();
  }

  function renderTagTools() {
    const holder = document.getElementById("tagTools");
    if (!holder) return;
    if (!document.body?.dataset?.store && !isTagPage()) return;

    const s = getCurrentSong();
    const countScope = isTagPage() ? "all" : S.storeKey;
    const countryCounts = new Map(S.getTagCounts(countScope));
    const currentTags = S.normalizeTags(s?.tags);
    const locations = getSongLocations(s);
    const showPathBox = isTagPage();

    holder.innerHTML = `
      <div class="tag-tools-head">
        <strong># 태그</strong>
        <span>${s ? "현재 재생/선택한 영상에 태그를 넣는 곳" : "영상을 선택하면 태그를 넣을 수 있어"}</span>
      </div>
      <div class="tag-tools-main ${showPathBox ? "has-path-box" : ""}">
        <div class="tag-tools-main-left">
          <div class="tag-input-row">
            <input id="tagInput" placeholder="예: 노래, 노래방, 추천곡" ${s ? "" : "disabled"} />
            <button id="addTagBtn" type="button" ${s ? "" : "disabled"}>태그 추가</button>
          </div>
          <p class="tag-help">쉼표, 띄어쓰기, #으로 여러 개를 한 번에 넣을 수 있어.</p>
          <div id="currentSongTags" class="tag-cloud small">
            ${currentTags.length ? currentTags.map((tag) => `
              <span class="tag-edit-chip">
                <a href="${S.getTagPageUrl(tag)}">#${S.escapeHTML(tag)}</a>
                <button type="button" data-remove-tag="${S.escapeHTML(tag)}" title="태그 삭제">×</button>
              </span>
            `).join("") : `<span class="tag-empty">현재 곡 태그 없음</span>`}
          </div>
        </div>
        ${showPathBox ? `
        <div class="tag-tools-path-box">
          <div class="tag-tools-path-head">경로</div>
          <div class="song-path-list tag-tools-path-list">
            ${s ? (locations.length ? locations.map((item) => `
              <a class="song-path-chip" href="${pageSongHref(item.collection, item)}">
                <span>${S.escapeHTML(collectionBadgeText(item) || "저장 위치")}</span>
                <b>${Number(item.index) + 1}번</b>
              </a>
            `).join("") : `<span class="original-empty">저장 위치를 찾지 못했어.</span>`) : `<span class="tag-empty">영상을 선택하면 경로가 보여.</span>`}
          </div>
        </div>
        ` : ""}
      </div>
    `;

    const input = document.getElementById("tagInput");
    const addBtn = document.getElementById("addTagBtn");

    function addFromInput() {
      const tags = S.normalizeTags(input?.value || "");
      if (!s || tags.length === 0) return;
      s.tags = S.applyTitleFixedTagsToTags ? S.applyTitleFixedTagsToTags(S.addTags(s.tags, tags)) : S.addTags(s.tags, tags);
      if (input) input.value = "";
      S.save();
      showList();
      updateLyricsDrawer();
      renderTagTools();
    }

    addBtn?.addEventListener("click", addFromInput);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addFromInput();
    });

    holder.querySelectorAll("[data-remove-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = btn.getAttribute("data-remove-tag");
        if (!s || !tag) return;
        s.tags = S.normalizeTags(s.tags).filter((item) => item !== tag);
        S.save();
        showList();
        updateLyricsDrawer();
        renderTagTools();
      });
    });
  }

  function onDragStart(e, index) {
    S.dragIndex = index;
    e.dataTransfer.effectAllowed = "copyMove";
    const song = Array.isArray(S.songs) ? S.songs[index] : null;
    if (song) {
      const raw = serializeLibrarySong(song, index);
      e.dataTransfer.setData("application/x-library-song", raw);
      const url = S.safeLink(song.ytUrl || "");
      if (url) e.dataTransfer.setData("text/plain", url);
    }
  }

  function onDragOver(e) {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes("application/x-music-tag")) e.dataTransfer.dropEffect = "copy";
    else e.dataTransfer.dropEffect = "move";
  }

  function addDraggedTagToSong(tag, dropIndex) {
    const cleanTag = S.normalizeTag ? S.normalizeTag(tag) : String(tag || "").trim();
    const song = Array.isArray(S.songs) ? S.songs[dropIndex] : null;
    if (!cleanTag || !song) return;
    S.dragIndex = null;

    song.tags = S.applyTitleFixedTagsToTags
      ? S.applyTitleFixedTagsToTags(S.addTags(song.tags, cleanTag))
      : S.addTags(song.tags, cleanTag);

    S.save();
    showList();
    updateLyricsDrawer();
    renderTagTools();
  }

  function onDrop(e, dropIndex) {
    e.preventDefault();

    // 5P 보관함의 영상을 재생목록 항목 위에 놓았을 때는
    // 일반 목록 순서 변경보다 먼저 "현재 페이지로 이동"으로 처리한다.
    // 추가가 성공한 뒤 removeFromFiveP 옵션으로 5P 원본도 함께 제거한다.
    const fivePSong = readFivePTransfer(e);
    if (fivePSong) {
      e.stopPropagation();
      S.dragIndex = null;
      copyFivePSongToCurrentPage(fivePSong, { removeFromFiveP: true });
      return;
    }

    const sixPSong = readSixPTransfer(e);
    if (sixPSong) {
      e.stopPropagation();
      S.dragIndex = null;
      copySixPSongToCurrentPage(sixPSong, { removeFromSixP: true });
      return;
    }

    const tag = S.normalizeTag ? S.normalizeTag(e.dataTransfer?.getData("application/x-music-tag") || "") : "";
    if (tag) {
      addDraggedTagToSong(tag, dropIndex);
      return;
    }

    const dragIndex = S.dragIndex;
    if (dragIndex === null || dragIndex === dropIndex) return;

    const songs = S.songs;
    const moved = songs.splice(dragIndex, 1)[0];
    songs.splice(dropIndex, 0, moved);

    if (S.current === dragIndex) S.current = dropIndex;
    else if (dragIndex < S.current && dropIndex >= S.current) S.current--;
    else if (dragIndex > S.current && dropIndex <= S.current) S.current++;

    S.dragIndex = null;
    S.save();
    showList();
    updateLyricsDrawer();
    renderTagTools();
  }

  function openLyricsDrawer(tab = "lyrics") {
    document.body.classList.add("lyrics-open");
    activeTab = normalizeDrawerTab(tab);
    if (activeTab === "lyrics") resetLyricsSubTab();
    updateLyricsDrawer();
  }

  function closeLyricsDrawer() {
    document.body.classList.remove("lyrics-open");
  }

  function toggleLyricsDrawer() {
    const willOpen = !document.body.classList.contains("lyrics-open");
    document.body.classList.toggle("lyrics-open");
    if (willOpen) {
      activeTab = normalizeDrawerTab("lyrics");
      resetLyricsSubTab();
      updateLyricsDrawer();
    }
  }

  function copyCurrentVideoUrl() {
    const s = getCurrentSong();
    copyText(getPrimaryVideoUrl(s), "현재 곡 링크를 복사했어!");
  }

  function openCurrentVideoUrl(useMr = false) {
    const s = getCurrentSong();
    const url = useMr ? S.safeLink(s?.mr) : getPrimaryVideoUrl(s);
    if (!url) {
      alert(useMr ? "MR 링크가 없어." : "열 수 있는 링크가 없어.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function openVideoLinkPanel() {
    const s = getCurrentSong();
    const url = getPrimaryVideoUrl(s);

    if (!s || !url) {
      alert("먼저 노래를 하나 선택해줘.");
      return;
    }

    let modal = document.getElementById("videoLinkModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "videoLinkModal";
      modal.className = "modal-overlay video-link-modal";
      modal.innerHTML = `
        <div class="modal-box video-link-box" onclick="event.stopPropagation();">
          <h2>영상 링크</h2>
          <p class="video-link-help">현재 선택된 곡의 유튜브 링크를 열거나 복사할 수 있어.</p>
          <div class="video-link-actions">
            <button id="videoOpenBtn" class="download-link-btn" type="button">유튜브로 열기</button>
            <button id="videoCopyBtn" class="download-link-btn" type="button">유튜브 링크 복사</button>
            <button id="videoCloseBtn" class="download-link-btn video-close-btn" type="button">닫기</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener("click", closeVideoLinkPanel);
      document.getElementById("videoCloseBtn")?.addEventListener("click", closeVideoLinkPanel);
      document.getElementById("videoOpenBtn")?.addEventListener("click", () => openCurrentVideoUrl(false));
      document.getElementById("videoCopyBtn")?.addEventListener("click", copyCurrentVideoUrl);
    }

    modal.classList.add("open");
  }

  function closeVideoLinkPanel() {
    document.getElementById("videoLinkModal")?.classList.remove("open");
  }

  function requestYouTubeDownload() {
    openVideoLinkPanel();
  }

  function isTypingTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return target?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("tabLyrics")?.addEventListener("click", () => setTab("lyrics"));
    document.getElementById("tabTagDesc")?.addEventListener("click", () => setTab("tagdesc"));
    document.getElementById("tabMr")?.addEventListener("click", () => setTab(isTagPage() ? "videomemo" : "mr"));
    document.getElementById("tabOriginal")?.addEventListener("click", () => setTab("original"));
    document.getElementById("tabFiveP")?.addEventListener("click", () => setTab("fivep"));
    document.getElementById("tabSixP")?.addEventListener("click", () => setTab("sixp"));
    document.getElementById("btnDownload")?.addEventListener("click", copyCurrentVideoUrl);

    document.addEventListener("keydown", (e) => {
      if (isTypingTarget(e.target)) return;
      const isBackquote = e.code === "Backquote" || e.key === "`" || e.key === "₩";
      if (!isBackquote) return;
      const drawer = document.getElementById("lyricsDrawer");
      if (!drawer) return;
      e.preventDefault();
      toggleLyricsDrawer();
    });

    updateLyricsDrawer();
    renderTagTools();
    createPageSearchBox();
    bindFivePDropTargets();
    bindSixPDropTargets();
    updatePageSearchSummary();
  });

  window.showList = showList;
  window.updateLyricsDrawer = updateLyricsDrawer;
  window.archivePlaylistSong = archivePlaylistSong;
  window.renderTagTools = renderTagTools;
  window.renderTagPlayerSummary = renderTagPlayerSummary;
  window.onDragStart = onDragStart;
  window.onDragOver = onDragOver;
  window.onDrop = onDrop;
  window.openLyricsDrawer = openLyricsDrawer;
  window.closeLyricsDrawer = closeLyricsDrawer;
  window.toggleLyricsDrawer = toggleLyricsDrawer;
  window.openCurrentVideoUrl = openCurrentVideoUrl;
  window.openOriginalSong = openOriginalSong;
  window.copyCurrentVideoUrl = copyCurrentVideoUrl;
  window.requestYouTubeDownload = requestYouTubeDownload;
  window.openVideoLinkPanel = openVideoLinkPanel;
  window.closeVideoLinkPanel = closeVideoLinkPanel;
  window.copyFivePSongToCurrentPage = copyFivePSongToCurrentPage;
  window.copySixPSongToCurrentPage = copySixPSongToCurrentPage;
})();
