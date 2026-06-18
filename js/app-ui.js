// js/app-ui.js - 목록 표시 + 가사/메모/악보 패널 + 드래그 정렬 + 링크/태그 패널
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
            <div class="pl-sub">${S.escapeHTML(s.author || "")}</div>
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

  function setTab(tab) {
    activeTab = tab;
    updateLyricsDrawer();
  }

  function memoPanelHTML(song) {
    const memo = S.escapeHTML(song?.memo || "");
    return `
      <section class="memo-panel" aria-label="메모장">
        <textarea id="songMemo" class="memo-textarea" placeholder="여기에 메모를 적어줘. 쓰는 즉시 자동 저장돼." spellcheck="false">${memo}</textarea>
        <p class="memo-save-help">입력하면 바로 자동 저장돼.</p>
      </section>
    `;
  }

  function bindMemoAutosave() {
    const memoEl = document.getElementById("songMemo");
    if (!memoEl) return;

    memoEl.addEventListener("input", () => {
      const songs = S.songs || [];
      const s = songs[S.current];
      if (!s) return;
      s.memo = memoEl.value;
      S.save();
    });
  }

  function updateLyricsDrawer() {
    const titleEl = document.getElementById("lyricsNowTitle");
    const textEl = document.getElementById("lyricsNowText");
    const mediaEl = document.getElementById("lyricsNowMedia");
    const tagEl = document.getElementById("lyricsNowTags");
    const tabLyrics = document.getElementById("tabLyrics");
    const tabMr = document.getElementById("tabMr");
    const tabScore = document.getElementById("tabScore");

    if (!titleEl || !textEl || !mediaEl || !tabLyrics || !tabMr || !tabScore) return;

    const songs = S.songs || [];
    const s = songs[S.current];

    tabLyrics.className = "tab-link";
    tabMr.className = "tab-link";
    tabScore.className = "tab-link";

    if (!s) {
      titleEl.textContent = "재생중인 곡이 없어";
      if (tagEl) tagEl.innerHTML = "";
      textEl.textContent = "노래를 재생하면 여기서 가사를 볼 수 있어.";
      textEl.style.display = "block";
      mediaEl.style.display = "none";
      mediaEl.innerHTML = "";
      tabLyrics.classList.add("tab-active");
      tabMr.classList.add("tab-disabled-soft");
      tabScore.classList.add("tab-disabled");
      tabScore.href = "#";
      return;
    }

    const author = S.safeText(s.author);
    titleEl.textContent = author ? `${S.safeText(s.title || "제목 없음")} - ${author}` : S.safeText(s.title || "제목 없음");
    if (tagEl) tagEl.innerHTML = songTagsHTML(s, "drawer");

    const scoreUrl = S.safeLink(s.score);
    const hasScore = !!scoreUrl;

    if (hasScore) {
      tabScore.classList.add("tab-ready");
      tabScore.href = scoreUrl;
    } else {
      tabScore.classList.add("tab-disabled");
      tabScore.href = "#";
    }

    tabMr.classList.add("tab-ready");

    if (activeTab === "mr") {
      tabMr.classList.add("tab-active");
      textEl.style.display = "none";
      mediaEl.style.display = "block";
      mediaEl.innerHTML = memoPanelHTML(s);
      bindMemoAutosave();
    } else {
      activeTab = "lyrics";
      tabLyrics.classList.add("tab-active");
      textEl.textContent = S.safeText(s.lyrics) || "가사가 아직 없어.";
      textEl.style.display = "block";
      mediaEl.style.display = "none";
      mediaEl.innerHTML = "";
    }
  }

  function renderTagTools() {
    const holder = document.getElementById("tagTools");
    if (!holder || !document.body?.dataset?.store) return;

    const s = getCurrentSong();
    const countryCounts = new Map(S.getTagCounts(S.storeKey));
    const currentTags = S.normalizeTags(s?.tags);

    holder.innerHTML = `
      <div class="tag-tools-head">
        <strong># 태그</strong>
        <span>${s ? "현재 재생/선택한 곡에 태그를 넣는 곳" : "곡을 선택하면 태그를 넣을 수 있어"}</span>
      </div>
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
  window.onDragStart = onDragStart;
  window.onDragOver = onDragOver;
  window.onDrop = onDrop;
  window.openLyricsDrawer = openLyricsDrawer;
  window.closeLyricsDrawer = closeLyricsDrawer;
  window.toggleLyricsDrawer = toggleLyricsDrawer;
  window.openCurrentVideoUrl = openCurrentVideoUrl;
  window.copyCurrentVideoUrl = copyCurrentVideoUrl;
  window.requestYouTubeDownload = requestYouTubeDownload;
  window.openVideoLinkPanel = openVideoLinkPanel;
  window.closeVideoLinkPanel = closeVideoLinkPanel;
})();
