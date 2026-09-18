(() => {
  const S = window.AppState;
  if (!S) return;

  const els = {};
  let query = "";
  let sortMode = "oldest";
  let selectedKey = "";

  const STORE_LABELS = {
    yt1pVideos: "1P",
    yt2pVideos: "2P",
    yt3pVideos: "3P",
    yt4pVideos: "4P",
    yt5pVideos: "5P",
    yt6pVideos: "6P"
  };

  function esc(value) {
    return S.escapeHTML ? S.escapeHTML(value) : String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function safeUrl(value) {
    return S.safeLink ? S.safeLink(value) : String(value || "").trim();
  }

  function getId(item) {
    return String(item?.id || S.extractID?.(item?.ytUrl || "") || "").trim();
  }

  function itemKey(item) {
    return `${getId(item)}|${String(item?.removedAt || "")}`;
  }

  function timestamp(item) {
    const n = Date.parse(item?.removedAt || "");
    return Number.isFinite(n) ? n : 0;
  }

  function formatDate(value) {
    const d = new Date(value || "");
    if (Number.isNaN(d.getTime())) return "날짜 없음";
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yy}.${mm}.${dd} ${hh}:${mi}`;
  }

  function normalizeSearch(value) {
    return String(value || "").toLocaleLowerCase("ko").replace(/^#/, "").trim();
  }

  function searchText(item) {
    return [
      item?.title,
      item?.author,
      ...(Array.isArray(item?.tags) ? item.tags : []),
      item?.primaryTag,
      item?.memo,
      item?.lyrics,
      STORE_LABELS[item?.sourceStoreKey] || item?.sourceStoreKey
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko");
  }

  function getVisibleItems() {
    const list = typeof S.readRemovedVideoArchive === "function" ? S.readRemovedVideoArchive() : [];
    const q = normalizeSearch(query);
    const filtered = q ? list.filter((item) => searchText(item).includes(q)) : list;
    return [...filtered].sort((a, b) => sortMode === "newest"
      ? timestamp(b) - timestamp(a)
      : timestamp(a) - timestamp(b));
  }

  function sourceLabel(item) {
    return STORE_LABELS[item?.sourceStoreKey] || "유튜브";
  }

  function render() {
    const all = typeof S.readRemovedVideoArchive === "function" ? S.readRemovedVideoArchive() : [];
    const items = getVisibleItems();
    els.count.textContent = query.trim() ? `${items.length}개 / 전체 ${all.length}개` : `${items.length}개`;

    if (!items.length) {
      els.list.innerHTML = `<div class="added-empty-state">${query.trim() ? "검색 결과가 없어." : "아직 추가된 영상이 없어."}</div>`;
      return;
    }

    els.list.innerHTML = items.map((item, index) => {
      const id = getId(item);
      const key = itemKey(item);
      const thumb = id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : "";
      const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [];
      const tagsHtml = tags.slice(0, 5).map((tag) => `<span>#${esc(tag)}</span>`).join("");
      const active = key === selectedKey ? " is-selected" : "";
      return `
        <button class="added-video-row${active}" type="button" data-added-key="${esc(key)}">
          <span class="added-video-order">${index + 1}</span>
          <span class="added-video-thumb">${thumb ? `<img src="${esc(thumb)}" alt="">` : "<span>▶</span>"}</span>
          <span class="added-video-meta">
            <strong>${esc(item?.title || "제목 없음")}</strong>
            <span class="added-video-sub">${esc(item?.author || "채널 정보 없음")} · ${esc(sourceLabel(item))} · ${esc(formatDate(item?.removedAt))}</span>
            ${tagsHtml ? `<span class="added-video-tags">${tagsHtml}</span>` : ""}
          </span>
          <span class="added-video-play">▶</span>
        </button>
      `;
    }).join("");
  }

  function findByKey(key) {
    const list = typeof S.readRemovedVideoArchive === "function" ? S.readRemovedVideoArchive() : [];
    return list.find((item) => itemKey(item) === key) || null;
  }

  function selectItem(item, { autoplay = true } = {}) {
    if (!item) return;
    const id = getId(item);
    selectedKey = itemKey(item);
    render();

    els.playerEmpty.hidden = true;
    els.playerBox.hidden = false;
    els.playerTitle.textContent = item?.title || "제목 없음";
    els.playerSub.textContent = [item?.author || "", sourceLabel(item), formatDate(item?.removedAt)].filter(Boolean).join(" · ");
    const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [];
    els.playerTags.innerHTML = tags.map((tag) => `<span>#${esc(tag)}</span>`).join("");
    els.openYoutube.href = safeUrl(item?.ytUrl) || (id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : "#");
    if (els.restoreTarget && STORE_LABELS[item?.sourceStoreKey]) els.restoreTarget.value = item.sourceStoreKey;

    if (id) {
      els.frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=${autoplay ? 1 : 0}&rel=0`;
    } else {
      els.frame.removeAttribute("src");
    }
  }

  function clearSelectedPlayer() {
    selectedKey = "";
    els.playerBox.hidden = true;
    els.playerEmpty.hidden = false;
    els.frame.removeAttribute("src");
    render();
  }

  function restoreSelected(targetStoreKey = "") {
    const item = findByKey(selectedKey);
    if (!item) return;
    const originalLabel = sourceLabel(item);
    const result = S.restoreRemovedVideoRecord?.(item, {
      targetStoreKey: targetStoreKey || item.sourceStoreKey || "yt1pVideos",
      keepOriginalPosition: !targetStoreKey
    });
    if (!result?.ok) {
      alert(result?.error || "복원하지 못했어.");
      return;
    }
    const label = STORE_LABELS[result.storeKey] || originalLabel || "목록";
    clearSelectedPlayer();
    alert(result.duplicate
      ? `${label}에 이미 같은 영상이 있어서 보관함에서만 정리했어.`
      : `${label}로 복원했어.`);
  }

  function bind() {
    els.search.addEventListener("input", () => {
      query = els.search.value || "";
      render();
    });

    els.clear.addEventListener("click", () => {
      els.search.value = "";
      query = "";
      els.search.focus();
      render();
    });

    els.sort.addEventListener("change", () => {
      sortMode = els.sort.value === "newest" ? "newest" : "oldest";
      localStorage.setItem("addedVideosSortMode", sortMode);
      render();
    });

    els.list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-added-key]");
      if (!row) return;
      const item = findByKey(row.getAttribute("data-added-key") || "");
      selectItem(item);
    });

    els.restoreOriginal?.addEventListener("click", () => restoreSelected(""));
    els.restoreChosen?.addEventListener("click", () => restoreSelected(els.restoreTarget?.value || "yt1pVideos"));

    window.addEventListener("storage", (event) => {
      if (!event.key || event.key === "musicRemovedVideoArchive") render();
    });
    window.addEventListener("focus", render);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) render();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    Object.assign(els, {
      search: document.getElementById("addedVideoSearch"),
      clear: document.getElementById("addedSearchClear"),
      sort: document.getElementById("addedSort"),
      count: document.getElementById("addedVideoCount"),
      list: document.getElementById("addedVideoList"),
      playerEmpty: document.getElementById("addedPlayerEmpty"),
      playerBox: document.getElementById("addedPlayerBox"),
      frame: document.getElementById("addedPlayerFrame"),
      playerTitle: document.getElementById("addedPlayerTitle"),
      playerSub: document.getElementById("addedPlayerSub"),
      playerTags: document.getElementById("addedPlayerTags"),
      restoreOriginal: document.getElementById("addedRestoreOriginal"),
      restoreTarget: document.getElementById("addedRestoreTarget"),
      restoreChosen: document.getElementById("addedRestoreChosen"),
      openYoutube: document.getElementById("addedOpenYoutube")
    });

    sortMode = localStorage.getItem("addedVideosSortMode") === "newest" ? "newest" : "oldest";
    els.sort.value = sortMode;
    bind();
    render();
  });
})();
