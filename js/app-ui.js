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
    return S.safeLink(song?.original || song?.origin || song?.originalUrl || "");
  }

  function getSubPagePrefix() {
    return location.pathname.includes("/japan/") ||
      location.pathname.includes("/china/") ||
      location.pathname.includes("/korea/") ||
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

  function showList() {
    const list = document.getElementById("list");
    if (!list) return;

    const songs = S.songs || [];
    if (songs.length === 0) {
      list.innerHTML = `<p class="empty-center">아직 추가된 노래가 없어!</p>`;
      return;
    }

    let html = `<div class="playlist">`;

    songs.forEach((s, i) => {
      const thumb = s.id ? `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg` : "";
      const active = i === S.current ? " active" : "";
      const hasMr = !!S.safeLink(s.mr);
      const isCurrent = i === S.current;
      const statusClass = isCurrent
        ? (hasMr ? "status-current-has-mr" : "status-current-no-mr")
        : (hasMr ? "status-has-mr" : "status-no-mr");
      const statusLabel = hasMr ? "MR" : "없음";
      const sourceBadge = isTagPage() ? collectionBadgeText(s) : "";
      const subText = [S.safeText(s.author || ""), sourceBadge].filter(Boolean).join(" · ");

      html += `
        <div class="pl-item${active}"
          draggable="true"
          ondragstart="onDragStart(event, ${i})"
          ondragover="onDragOver(event)"
          ondrop="onDrop(event, ${i})"
          onclick="play(${i})">

          <div class="pl-left">
            <div class="pl-index">${i + 1}</div>
            <div class="pl-handle" title="드래그해서 순서 변경" onclick="event.stopPropagation();">
              <span></span><span></span>
            </div>
            <div class="pl-playing">${i === S.current ? "▶" : ""}</div>
          </div>

          <div class="pl-thumb">
            ${thumb ? `<img src="${thumb}" alt="thumb">` : ""}
          </div>

          <div class="pl-meta">
            <div class="pl-title">${S.escapeHTML(s.title || "제목 없음")}</div>
            <div class="pl-sub">${S.escapeHTML(subText)}</div>
          </div>

          <button class="pl-mr-status ${statusClass}" type="button"
            title="${hasMr ? "MR 링크 있음 - 누르면 큰 유튜브 창에서 MR 재생" : "MR 링크 없음"}"
            onclick="event.stopPropagation(); playMr(${i});">
            ${statusLabel}
          </button>
        </div>
      `;
    });

    html += `</div>`;
    list.innerHTML = html;
  }

  let activeTab = "lyrics";
  let editorLocked = localStorage.getItem("lyricsMemoEditorLocked") !== "unlocked";

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
    activeTab = tab;
    updateLyricsDrawer();
  }

  function editorPanelHTML(song, field, placeholder) {
    const value = S.escapeHTML(song?.[field] || "");
    const label = field === "memo" ? "메모" : "가사";
    return `
      <section class="lyrics-edit-panel" aria-label="${label} 메모장">
        <textarea id="songTextEditor" class="lyrics-edit-textarea ${editorLocked ? "is-locked" : "is-unlocked"}" data-field="${field}" placeholder="${placeholder}" spellcheck="false" ${editorLocked ? "readonly" : ""}>${value}</textarea>
        <p class="memo-save-help editor-lock-help">${editorLocked ? "잠금 상태야. 위의 잠금 버튼을 풀면 수정할 수 있어." : "수정 가능 상태야. 입력하면 바로 자동 저장돼."}</p>
      </section>
    `;
  }

  function bindTextEditorAutosave() {
    const editor = document.getElementById("songTextEditor");
    if (!editor) return;

    editor.readOnly = editorLocked;
    editor.addEventListener("input", () => {
      if (editorLocked) return;
      const songs = S.songs || [];
      const s = songs[S.current];
      const field = editor.dataset.field === "memo" ? "memo" : "lyrics";
      if (!s) return;
      s[field] = editor.value;
      S.save();
    });
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
    const tabMr = document.getElementById("tabMr");
    const tabOriginal = document.getElementById("tabOriginal");
    const headTitle = document.querySelector(".lyrics-head-title");

    getLyricsLockButton();
    updateLockUI();
    renderTagPlayerSummary();

    if (!titleEl || !textEl || !mediaEl || !tabLyrics || !tabMr || !tabOriginal) return;

    const songs = S.songs || [];
    const s = songs[S.current];

    tabLyrics.className = "tab-link";
    tabMr.className = "tab-link";
    tabOriginal.className = "tab-link";

    if (!s) {
      if (headTitle) headTitle.textContent = "가사 / 메모 / 기타";
      const videoLikePage = isTagPage() || document.body?.dataset?.store?.startsWith("yt");
      titleEl.textContent = videoLikePage ? "재생중인 영상이 없어" : "재생중인 곡이 없어";
      if (tagEl) tagEl.innerHTML = "";
      textEl.textContent = videoLikePage
        ? "영상을 재생하면 여기서 설명/메모/기타 정보를 볼 수 있어."
        : "노래를 재생하면 여기서 가사/메모/기타 정보를 볼 수 있어.";
      textEl.style.display = "block";
      mediaEl.style.display = "none";
      mediaEl.innerHTML = "";
      tabLyrics.classList.add("tab-active");
      tabMr.classList.add("tab-disabled-soft");
      tabOriginal.classList.add("tab-disabled-soft");
      return;
    }

    const author = S.safeText(s.author);
    titleEl.textContent = author ? `${S.safeText(s.title || "제목 없음")} - ${author}` : S.safeText(s.title || "제목 없음");
    if (tagEl) tagEl.innerHTML = songTagsHTML(s, "drawer");

    tabMr.classList.add("tab-ready");
    tabOriginal.classList.add("tab-ready");

    textEl.style.display = "none";
    mediaEl.style.display = "block";

    if (activeTab === "mr") {
      if (headTitle) headTitle.textContent = "메모";
      tabMr.classList.add("tab-active");
      mediaEl.innerHTML = editorPanelHTML(s, "memo", "여기에 메모를 적어줘. 쓰는 즉시 자동 저장돼.");
      bindTextEditorAutosave();
      updateLockUI();
    } else if (activeTab === "original") {
      if (headTitle) headTitle.textContent = "기타";
      tabOriginal.classList.add("tab-active");
      mediaEl.innerHTML = extraPanelHTML(s);
      bindOriginalPanel();
      updateLockUI();
    } else {
      activeTab = "lyrics";
      if (headTitle) headTitle.textContent = (isTagPage() || document.body?.dataset?.store?.startsWith("yt")) ? "설명" : "가사";
      tabLyrics.classList.add("tab-active");
      mediaEl.innerHTML = editorPanelHTML(
        s,
        "lyrics",
        (isTagPage() || document.body?.dataset?.store?.startsWith("yt"))
          ? "여기에 설명을 적어줘. 쓰는 즉시 자동 저장돼."
          : "여기에 가사를 적어줘. 쓰는 즉시 자동 저장돼."
      );
      bindTextEditorAutosave();
      updateLockUI();
    }
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
                <a href="${S.getTagPageUrl(tag)}">#${S.escapeHTML(tag)} <b>${countryCounts.get(tag) || 1}</b></a>
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
      s.tags = S.addTags(s.tags, tags);
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
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e, dropIndex) {
    e.preventDefault();

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
    activeTab = tab;
    updateLyricsDrawer();
  }

  function closeLyricsDrawer() {
    document.body.classList.remove("lyrics-open");
  }

  function toggleLyricsDrawer() {
    const willOpen = !document.body.classList.contains("lyrics-open");
    document.body.classList.toggle("lyrics-open");
    if (willOpen) {
      activeTab = "lyrics";
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
    document.getElementById("tabMr")?.addEventListener("click", () => setTab("mr"));
    document.getElementById("tabOriginal")?.addEventListener("click", () => setTab("original"));
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
  });

  window.showList = showList;
  window.updateLyricsDrawer = updateLyricsDrawer;
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
})();
