// js/app-tags.js - 메인 태그 목록 / 태그별 플레이어 페이지
(() => {
  const S = window.AppState;
  if (!S) return;

  const TITLE_TAGS_KEY = "musicTitleTags";
  const TAG_INDEX_FILTER_KEY = "musicTagIndexFilter";
  const TAG_FILTERS = [
    { key: "all", label: "모두" },
    { key: "title", label: "제목태그" },
    { key: "playlist", label: "재생목록" },
    { key: "song", label: "노래전용" },
    { key: "lecture", label: "강의전용" },
    { key: "general", label: "일반(유머)" },
    { key: "pretty", label: "이쁜거(뮤비/일러)" },
    { key: "other", label: "기타" }
  ];

  function getTagIndexFilter() {
    const value = localStorage.getItem(TAG_INDEX_FILTER_KEY) || "all";
    return TAG_FILTERS.some((item) => item.key === value) ? value : "all";
  }

  function setTagIndexFilter(value) {
    const clean = TAG_FILTERS.some((item) => item.key === value) ? value : "all";
    localStorage.setItem(TAG_INDEX_FILTER_KEY, clean);
  }

  function tagParam() {
    return S.normalizeTag(new URLSearchParams(location.search).get("tag") || "");
  }

  function isTagPlayerPage() {
    return document.body?.dataset?.page === "tag";
  }

  function tagPageUrl(tag) {
    return `tag.html?tag=${encodeURIComponent(tag)}`;
  }

  function readTitleTags() {
    if (typeof S.readTitleTags === "function") return S.readTitleTags();
    try {
      const data = JSON.parse(localStorage.getItem(TITLE_TAGS_KEY) || "[]");
      return S.normalizeTags(Array.isArray(data) ? data : []);
    } catch {
      return [];
    }
  }

  function writeTitleTags(tags) {
    if (typeof S.writeTitleTags === "function") {
      S.writeTitleTags(tags);
      return;
    }
    localStorage.setItem(TITLE_TAGS_KEY, JSON.stringify(S.normalizeTags(tags)));
  }

  function isTitleTag(tag) {
    return readTitleTags().includes(S.normalizeTag(tag));
  }

  function registerTitleTag(tag) {
    const clean = S.normalizeTag(tag);
    if (!clean) return false;
    if (typeof S.registerTitleTag === "function") return S.registerTitleTag(clean);
    const tags = S.addTags(readTitleTags(), [clean]);
    writeTitleTags(tags);
    return true;
  }

  function unregisterTitleTag(tag) {
    const clean = S.normalizeTag(tag);
    if (!clean) return false;
    if (typeof S.unregisterTitleTag === "function") return S.unregisterTitleTag(clean);
    writeTitleTags(readTitleTags().filter((item) => item !== clean));
    return true;
  }

  function storeOptionsHTML(selectedKey = "") {
    const stores = S.ALL_STORES || [];
    const selected = stores.some((item) => item.key === selectedKey) ? selectedKey : (stores[0]?.key || "");
    return stores.map((item) => `
      <option value="${S.escapeHTML(item.key)}" ${item.key === selected ? "selected" : ""}>
        ${S.escapeHTML(`${item.emoji || ""} ${item.label || item.key}`.trim())}
      </option>
    `).join("");
  }

  function defaultStoreForTag(tag) {
    const clean = S.normalizeTag(tag);
    const stores = S.ALL_STORES || [];
    if (!clean) return stores[0]?.key || "";

    const counts = new Map();
    S.getAllSongs().forEach((song) => {
      if (!S.normalizeTags(song.tags).includes(clean)) return;
      const key = song.storeKey || song.sourceKey || song.collection?.key;
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return best || stores[0]?.key || "";
  }

  function closeDynamicModal(id) {
    document.getElementById(id)?.classList.remove("open");
  }

  function getDroppedYoutubeUrl(e) {
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
    return S.safeLink(match ? match[0] : values[0] || "");
  }

  function bindYoutubeDropToAddArea(area, urlInput, runAdd) {
    if (!area || !urlInput) return;
    area._youtubeDropRunAdd = runAdd;
    area._youtubeDropUrlInput = urlInput;
    if (area.dataset.youtubeDropBound === "1") return;
    area.dataset.youtubeDropBound = "1";

    area.addEventListener("dragover", (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      const maybeUrl = types.includes("text/uri-list") || types.includes("text/plain") || types.includes("text/html");
      if (!maybeUrl) return;
      e.preventDefault();
      area.classList.add("is-url-dragover");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    area.addEventListener("dragleave", (e) => {
      if (area.contains(e.relatedTarget)) return;
      area.classList.remove("is-url-dragover");
    });

    area.addEventListener("drop", (e) => {
      const url = getDroppedYoutubeUrl(e);
      if (!url) return;
      e.preventDefault();
      area.classList.remove("is-url-dragover");
      const targetInput = area._youtubeDropUrlInput || urlInput;
      targetInput.value = url;
      const run = area._youtubeDropRunAdd || runAdd;
      if (typeof run === "function") run();
    });
  }

  function attachAutocomplete(input) {
    S.attachTagAutocomplete?.(input);
  }

  function ensureVideoAddModal() {
    let modal = document.getElementById("tagVideoAddModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "tagVideoAddModal";
    modal.className = "modal-overlay tag-video-add-modal";
    modal.innerHTML = `
      <div class="modal-box tag-video-add-box" onclick="event.stopPropagation();">
        <h2 id="tagVideoAddTitle">영상 추가</h2>
        <p id="tagVideoAddHelp" class="tag-modal-help">태그에 바로 영상을 추가할 수 있어.</p>
        <input id="tagVideoAddUrl" placeholder="유튜브 링크" />
        <select id="tagVideoAddStore" class="tag-modal-select"></select>
        <input id="tagVideoAddTags" placeholder="추가 태그 예: 일본어, 밝은곡" />
        <p id="tagVideoAddFixedInfo" class="tag-modal-small"></p>
        <div class="modal-actions">
          <button id="tagVideoAddSave" type="button">저장</button>
          <button id="tagVideoAddCancel" type="button">취소</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", () => closeDynamicModal("tagVideoAddModal"));
    document.getElementById("tagVideoAddCancel")?.addEventListener("click", () => closeDynamicModal("tagVideoAddModal"));
    return modal;
  }

  function refreshTagPageAfterChange(focusResult = null) {
    renderTagIndex();

    const selected = tagParam();
    if (selected && typeof window.showList === "function") {
      if (focusResult?.ok) {
        const targetId = focusResult.song?.id || S.extractID(focusResult.song?.ytUrl || "");
        const targetUrl = S.safeLink(focusResult.song?.ytUrl);
        const targetStore = focusResult.storeKey;
        const idx = (S.songs || []).findIndex((song) => {
          const songId = song.id || S.extractID(song.ytUrl);
          return (targetStore && song.storeKey === targetStore && Number(song.index) === Number(focusResult.index)) ||
            (targetId && songId === targetId) ||
            (targetUrl && S.safeLink(song.ytUrl) === targetUrl);
        });
        if (idx >= 0) S.current = idx;
      }
      window.showList();
      window.updateLyricsDrawer?.();
      window.renderTagTools?.();
      window.updateControlLabels?.();
    }

    window.updateDrawerCounts?.();
  }

  async function addVideoWithTags({ ytUrl, storeKey, tags, button = null, closeModalId = "" }) {
    const cleanTags = S.applyTitleFixedTagsToTags ? S.applyTitleFixedTagsToTags(tags) : S.normalizeTags(tags);
    if (cleanTags.length === 0) {
      alert("태그를 하나 이상 넣어줘.");
      return null;
    }

    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "추가중...";
    }

    try {
      const result = await S.addVideoToStoreWithTags({ ytUrl, storeKey, tags: cleanTags });
      if (!result?.ok) {
        if (!result?.cancelled) alert(result?.error || "영상을 추가하지 못했어.");
        return result;
      }

      if (closeModalId) closeDynamicModal(closeModalId);
      refreshTagPageAfterChange(result);
      return result;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText || "저장";
      }
    }
  }

  function openTagVideoModal(tag = "") {
    const clean = S.normalizeTag(tag);
    const modal = ensureVideoAddModal();
    const title = document.getElementById("tagVideoAddTitle");
    const help = document.getElementById("tagVideoAddHelp");
    const urlInput = document.getElementById("tagVideoAddUrl");
    const storeSelect = document.getElementById("tagVideoAddStore");
    const tagsInput = document.getElementById("tagVideoAddTags");
    const fixedInfo = document.getElementById("tagVideoAddFixedInfo");
    const saveBtn = document.getElementById("tagVideoAddSave");

    if (title) title.textContent = clean ? `#${clean} 영상 추가` : "영상 추가";
    if (help) help.textContent = clean ? `추가하는 영상에는 #${clean} 태그가 자동으로 들어가.` : "영상에 넣을 태그를 같이 적어줘.";
    if (urlInput) urlInput.value = "";
    if (storeSelect) storeSelect.innerHTML = storeOptionsHTML(defaultStoreForTag(clean));
    if (tagsInput) {
      tagsInput.value = clean ? "" : "";
      tagsInput.placeholder = clean ? "추가 태그 예: 일본어, 밝은곡" : "태그 예: 일본어, 밝은곡, 노래제목";
    }

    const fixed = clean && isTitleTag(clean) && S.getTitleFixedTags ? S.getTitleFixedTags(clean) : [];
    if (fixedInfo) {
      fixedInfo.textContent = fixed.length ? `고정태그 자동 추가: ${fixed.map((item) => `#${item}`).join(" ")}` : "";
    }

    const saveHandler = async () => {
      const ytUrl = S.safeLink(urlInput?.value);
      const extra = S.normalizeTags(tagsInput?.value || "");
      const baseTags = clean ? [clean] : [];
      await addVideoWithTags({
        ytUrl,
        storeKey: storeSelect?.value || defaultStoreForTag(clean),
        tags: S.addTags(baseTags, extra),
        button: document.getElementById("tagVideoAddSave"),
        closeModalId: "tagVideoAddModal"
      });
    };

    saveBtn?.replaceWith(saveBtn.cloneNode(true));
    const newSaveBtn = document.getElementById("tagVideoAddSave");
    newSaveBtn?.addEventListener("click", saveHandler);
    if (urlInput) {
      urlInput.onkeydown = (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        saveHandler();
      };
    }
    attachAutocomplete(tagsInput);
    bindYoutubeDropToAddArea(modal.querySelector(".tag-video-add-box"), urlInput, saveHandler);

    modal.classList.add("open");
    setTimeout(() => urlInput?.focus(), 0);
  }

  function ensureFixedTagModal() {
    let modal = document.getElementById("titleFixedTagModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "titleFixedTagModal";
    modal.className = "modal-overlay title-fixed-tag-modal";
    modal.innerHTML = `
      <div class="modal-box title-fixed-tag-box" onclick="event.stopPropagation();">
        <h2 id="titleFixedTagTitle">고정태그 추가</h2>
        <p id="titleFixedTagHelp" class="tag-modal-help"></p>
        <div class="fixed-tag-input-row">
          <input id="fixedTagInput" placeholder="#" />
          <button id="fixedTagAddBtn" type="button">추가</button>
        </div>
        <div class="fixed-tag-area">
          <h3>고정된 태그</h3>
          <div id="fixedTagCurrent" class="tag-cloud small"></div>
        </div>
        <div class="fixed-tag-area">
          <h3>있는 태그 목록</h3>
          <div id="fixedTagSuggestions" class="tag-cloud small fixed-tag-suggestions"></div>
        </div>
        <div class="modal-actions">
          <button id="fixedTagSaveBtn" type="button">저장</button>
          <button id="fixedTagVideoBtn" type="button">이 제목으로 영상 추가</button>
          <button id="fixedTagCancelBtn" type="button">취소</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", () => closeDynamicModal("titleFixedTagModal"));
    document.getElementById("fixedTagCancelBtn")?.addEventListener("click", () => closeDynamicModal("titleFixedTagModal"));
    return modal;
  }

  function openTitleFixedTagModal(titleTag) {
    const clean = S.normalizeTag(titleTag);
    if (!clean) return;
    registerTitleTag(clean);

    const modal = ensureFixedTagModal();
    const title = document.getElementById("titleFixedTagTitle");
    const help = document.getElementById("titleFixedTagHelp");
    const input = document.getElementById("fixedTagInput");
    const addBtn = document.getElementById("fixedTagAddBtn");
    const saveBtn = document.getElementById("fixedTagSaveBtn");
    const videoBtn = document.getElementById("fixedTagVideoBtn");
    const currentBox = document.getElementById("fixedTagCurrent");
    const suggestionsBox = document.getElementById("fixedTagSuggestions");
    let tempTags = S.normalizeTags(S.getTitleFixedTags ? S.getTitleFixedTags(clean) : []);

    if (title) title.textContent = `#${clean} 고정태그 추가`;
    if (help) help.textContent = `#${clean} 제목태그가 붙은 영상에는 저장한 고정태그가 자동으로 같이 붙어.`;
    if (input) input.value = "";

    const titleSet = new Set(readTitleTags());
    const allCounts = S.getTagCounts("all")
      .filter(([tag]) => S.normalizeTag(tag) !== clean)
      .filter(([tag]) => !titleSet.has(S.normalizeTag(tag)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));

    function renderTemp() {
      if (currentBox) {
        currentBox.innerHTML = tempTags.length ? tempTags.map((tag) => `
          <span class="tag-edit-chip fixed-current-chip">
            <a href="${tagPageUrl(tag)}">#${S.escapeHTML(tag)}</a>
            <button type="button" data-fixed-remove="${S.escapeHTML(tag)}" title="고정태그 빼기">×</button>
          </span>
        `).join("") : `<span class="tag-empty">아직 고정태그가 없어.</span>`;

        currentBox.querySelectorAll("[data-fixed-remove]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const tag = S.normalizeTag(btn.getAttribute("data-fixed-remove") || "");
            tempTags = tempTags.filter((item) => item !== tag);
            renderTemp();
          });
        });
      }

      if (suggestionsBox) {
        const visible = allCounts.filter(([tag]) => !tempTags.includes(S.normalizeTag(tag))).slice(0, 80);
        suggestionsBox.innerHTML = visible.length ? visible.map(([tag, count]) => `
          <button class="fixed-suggest-chip" type="button" data-fixed-suggest="${S.escapeHTML(tag)}">
            #${S.escapeHTML(tag)} <span>${count}</span>
          </button>
        `).join("") : `<span class="tag-empty">추가할 수 있는 기존 태그가 없어.</span>`;

        suggestionsBox.querySelectorAll("[data-fixed-suggest]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const tag = S.normalizeTag(btn.getAttribute("data-fixed-suggest") || "");
            if (tag && tag !== clean) tempTags = S.addTags(tempTags, [tag]);
            renderTemp();
          });
        });
      }
    }

    function addInputTag() {
      const tags = S.normalizeTags(input?.value || "").filter((tag) => tag !== clean);
      if (tags.length === 0) return;
      tempTags = S.addTags(tempTags, tags);
      if (input) input.value = "";
      renderTemp();
    }

    addBtn?.replaceWith(addBtn.cloneNode(true));
    saveBtn?.replaceWith(saveBtn.cloneNode(true));
    videoBtn?.replaceWith(videoBtn.cloneNode(true));

    document.getElementById("fixedTagAddBtn")?.addEventListener("click", addInputTag);
    document.getElementById("fixedTagSaveBtn")?.addEventListener("click", () => {
      S.setTitleFixedTags?.(clean, tempTags);
      closeDynamicModal("titleFixedTagModal");
      refreshTagPageAfterChange();
    });
    document.getElementById("fixedTagVideoBtn")?.addEventListener("click", () => {
      closeDynamicModal("titleFixedTagModal");
      openTagVideoModal(clean);
    });
    if (input) {
      // 한글 입력 중 Enter를 눌러도 바로 "추가" 버튼을 누른 것처럼 동작하게 처리.
      let enterAddTimer = null;
      const runEnterAdd = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (enterAddTimer) clearTimeout(enterAddTimer);
        enterAddTimer = setTimeout(() => {
          enterAddTimer = null;
          addInputTag();
        }, e.isComposing ? 30 : 0);
      };
      input.onkeydown = runEnterAdd;
      input.onkeyup = runEnterAdd;
      attachAutocomplete(input);
    }

    renderTemp();
    modal.classList.add("open");
    setTimeout(() => input?.focus(), 0);
  }

  function removeTagEverywhere(tag) {
    const clean = S.normalizeTag(tag);
    if (!clean) return 0;

    let changedSongs = 0;
    (S.ALL_STORES || []).forEach((store) => {
      const songs = S.cleanSongArray(S.readStorage(store.key));
      let changed = false;
      const next = songs.map((song) => {
        const before = S.normalizeTags(song.tags);
        const after = before.filter((item) => item !== clean);
        if (after.length !== before.length) {
          changed = true;
          changedSongs += 1;
          return { ...song, tags: after };
        }
        return song;
      });

      if (changed) S.writeStorage(store.key, next);
    });

    unregisterTitleTag(clean);
    S.unregisterPlaylistTag?.(clean);
    if (typeof S.readTagKinds === "function" && typeof S.writeTagKinds === "function") {
      const kinds = S.readTagKinds();
      delete kinds[clean];
      S.writeTagKinds(kinds);
    }
    if (typeof S.readTitleFixedTags === "function" && typeof S.writeTitleFixedTags === "function") {
      const fixed = S.readTitleFixedTags();
      delete fixed[clean];
      Object.keys(fixed).forEach((titleTag) => {
        fixed[titleTag] = S.normalizeTags(fixed[titleTag]).filter((item) => item !== clean);
        if (fixed[titleTag].length === 0) delete fixed[titleTag];
      });
      S.writeTitleFixedTags(fixed);
    }
    if (typeof updateDrawerCounts === "function") updateDrawerCounts();
    return changedSongs;
  }

  function flashDropZone(zone, text) {
    if (!zone) return;
    const old = zone.querySelector("strong")?.textContent || "";
    zone.classList.add("tag-drop-done");
    const strong = zone.querySelector("strong");
    if (strong && text) strong.textContent = text;
    window.setTimeout(() => {
      zone.classList.remove("tag-drop-done");
      if (strong && old) strong.textContent = old;
    }, 650);
  }

  function bindTagDragActions(root) {
    if (!root) return;

    root.querySelectorAll("[data-drag-tag]").forEach((chip) => {
      chip.addEventListener("dragstart", (e) => {
        const tag = S.normalizeTag(chip.getAttribute("data-drag-tag") || "");
        if (!tag) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-music-tag", tag);
        e.dataTransfer.setData("text/plain", `#${tag}`);
        chip.classList.add("is-dragging");
      });

      chip.addEventListener("dragend", () => {
        chip.classList.remove("is-dragging");
        root.querySelectorAll(".tag-drop-over").forEach((el) => el.classList.remove("tag-drop-over"));
        root.querySelectorAll(".tag-filter-drop-over").forEach((el) => el.classList.remove("tag-filter-drop-over"));
      });

      chip.addEventListener("contextmenu", (e) => {
        const tag = S.normalizeTag(chip.getAttribute("data-drag-tag") || "");
        if (!tag) return;
        e.preventDefault();
        const next = prompt(`태그 이름을 수정해줘.
현재: #${tag}`, tag) || "";
        const clean = S.normalizeTag(next);
        if (!clean || clean === tag) return;
        if (typeof S.renameTagEverywhere === "function") {
          S.renameTagEverywhere(tag, clean);
          if (document.body?.dataset?.page === "tag") {
            const currentTag = S.getCurrentTagParam?.() || "";
            if (currentTag === tag) {
              location.href = `tag.html?tag=${encodeURIComponent(clean)}`;
              return;
            }
          }
          refreshTagPageAfterChange();
          if (typeof updateLyricsDrawer === "function") updateLyricsDrawer();
        }
      });
    });

    root.querySelectorAll("[data-tag-drop-action]").forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        const hasTag = Array.from(e.dataTransfer?.types || []).includes("application/x-music-tag");
        if (!hasTag) return;
        e.preventDefault();
        zone.classList.add("tag-drop-over");
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      });

      zone.addEventListener("dragleave", () => {
        zone.classList.remove("tag-drop-over");
      });

      zone.addEventListener("drop", (e) => {
        const tag = S.normalizeTag(e.dataTransfer?.getData("application/x-music-tag") || "");
        if (!tag) return;
        e.preventDefault();
        zone.classList.remove("tag-drop-over");

        const action = zone.getAttribute("data-tag-drop-action");
        if (action === "delete") {
          const ok = confirm(`#${tag} 태그를 모든 노래/영상에서 삭제할까?\n되돌리려면 다시 태그를 넣어야 해.`);
          if (!ok) return;
          const count = removeTagEverywhere(tag);
          flashDropZone(zone, "삭제 완료");
          refreshTagPageAfterChange();
          if (count === 0) alert("삭제할 태그를 찾지 못했어.");
          return;
        }

        if (action === "register-title") {
          S.unregisterPlaylistTag?.(tag);
          registerTitleTag(tag);
          flashDropZone(zone, "등록 완료");
          refreshTagPageAfterChange();
          return;
        }

        if (action === "register-playlist") {
          unregisterTitleTag(tag);
          S.registerPlaylistTag?.(tag);
          flashDropZone(zone, "재생목록 완료");
          refreshTagPageAfterChange();
          return;
        }

        if (action === "unregister-title") {
          unregisterTitleTag(tag);
          flashDropZone(zone, "해제 완료");
          refreshTagPageAfterChange();
        }
      });
    });
  }

  function bindFilterDropActions(root) {
    if (!root) return;
    const dropModes = ["title", "playlist", "song", "lecture", "general", "pretty", "other"];

    root.querySelectorAll("[data-tag-filter]").forEach((btn) => {
      btn.addEventListener("dragover", (e) => {
        const hasTag = Array.from(e.dataTransfer?.types || []).includes("application/x-music-tag");
        if (!hasTag) return;
        const mode = btn.getAttribute("data-tag-filter") || "";
        if (!dropModes.includes(mode)) return;
        e.preventDefault();
        btn.classList.add("tag-filter-drop-over");
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      });

      btn.addEventListener("dragleave", () => btn.classList.remove("tag-filter-drop-over"));

      btn.addEventListener("drop", (e) => {
        const tag = S.normalizeTag(e.dataTransfer?.getData("application/x-music-tag") || "");
        const mode = btn.getAttribute("data-tag-filter") || "";
        if (!tag || !dropModes.includes(mode)) return;
        e.preventDefault();
        btn.classList.remove("tag-filter-drop-over");

        if (mode === "title") {
          S.unregisterPlaylistTag?.(tag);
          registerTitleTag(tag);
        } else if (mode === "playlist") {
          unregisterTitleTag(tag);
          S.registerPlaylistTag?.(tag);
        } else {
          unregisterTitleTag(tag);
          S.unregisterPlaylistTag?.(tag);
          S.setTagKind?.(tag, mode);
        }

        // 분류 저장만 하고, 현재 보고 있던 필터 화면은 바꾸지 않는다.
        refreshTagPageAfterChange();
      });
    });
  }

  function tagCountBadgeStyle(count, maxCount) {
    const safeCount = Math.max(1, Number(count) || 1);
    const safeMax = Math.max(1, Number(maxCount) || 1);
    const ratio = Math.min(1, Math.max(0, (safeCount - 1) / Math.max(1, safeMax - 1)));

    const stops = [
      { at: 0, color: [37, 99, 235] },
      { at: 0.25, color: [34, 197, 94] },
      { at: 0.5, color: [234, 179, 8] },
      { at: 0.75, color: [249, 115, 22] },
      { at: 1, color: [220, 38, 38] }
    ];

    let left = stops[0];
    let right = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      if (ratio >= stops[i].at && ratio <= stops[i + 1].at) {
        left = stops[i];
        right = stops[i + 1];
        break;
      }
    }

    const sectionSpan = Math.max(0.0001, right.at - left.at);
    const sectionRatio = Math.min(1, Math.max(0, (ratio - left.at) / sectionSpan));
    const r = Math.round(left.color[0] + (right.color[0] - left.color[0]) * sectionRatio);
    const g = Math.round(left.color[1] + (right.color[1] - left.color[1]) * sectionRatio);
    const b = Math.round(left.color[2] + (right.color[2] - left.color[2]) * sectionRatio);
    return `background:rgb(${r}, ${g}, ${b}); color:#fff;`;
  }

  function kindOptionsHTML(selected) {
    const allowed = (S.TAG_KIND_OPTIONS || [])
      .filter((item) => ["song", "lecture", "general", "pretty", "other"].includes(item.key));
    return allowed.map((item) => `
      <option value="${S.escapeHTML(item.key)}" ${item.key === selected ? "selected" : ""}>${S.escapeHTML(item.label)}</option>
    `).join("");
  }

  function tagChipHTML(tag, count, titleTags, maxCount = 1) {
    const clean = S.normalizeTag(tag);
    const safe = S.escapeHTML(clean);
    const registered = titleTags.includes(clean);
    const hasShared = registered && S.titleHasSharedText?.(clean);
    const kind = registered ? "title" : (S.getTagKind ? S.getTagKind(clean) : "song");
    const isPlaylist = S.isPlaylistTag?.(clean) || kind === "playlist";
    const visualKind = registered ? "title" : (isPlaylist ? "playlist" : kind);
    const badgeStyle = tagCountBadgeStyle(count, maxCount);
    const fixed = registered && S.getTitleFixedTags ? S.getTitleFixedTags(clean) : [];
    return `
      <a class="tag-chip tag-index-chip tag-kind-${visualKind} ${registered ? "is-title-tag" : ""} ${hasShared ? "has-title-shared" : ""} ${isPlaylist ? "is-playlist-tag" : ""}"
        href="${tagPageUrl(clean)}"
        draggable="true"
        data-drag-tag="${safe}"
        title="드래그: 삭제/분류이동 · 우클릭: 태그 이름 수정">
        #${safe}
        ${registered ? `<span class="tag-title-badge">${hasShared ? "가사 있음" : "제목"}</span>` : ""}
        ${fixed.length ? `<span class="tag-fixed-badge">고정 ${fixed.length}</span>` : ""}
        <span class="tag-count" style="${badgeStyle}">${count}</span>
      </a>
    `;
  }

  function filterTagCounts(counts, titleTags, mode) {
    const titleSet = new Set(titleTags);
    if (mode === "title") return counts.filter(([tag]) => titleSet.has(S.normalizeTag(tag)));
    if (mode === "playlist") return counts.filter(([tag]) => S.isPlaylistTag?.(tag));
    if (mode === "all") return counts;
    return counts.filter(([tag]) => {
      const clean = S.normalizeTag(tag);
      if (titleSet.has(clean)) return false;
      const kind = S.getTagKind ? S.getTagKind(clean) : "song";
      return kind === mode;
    });
  }

  function tagFilterButtonHTML(mode, label, current, count) {
    const active = current === mode;
    return `
      <button class="tag-filter-btn tag-filter-${mode} ${active ? "is-active" : ""}" type="button" data-tag-filter="${mode}" aria-pressed="${active ? "true" : "false"}">
        <span>${label}</span>
        <b>${count}</b>
      </button>
    `;
  }

  function bindIndexVideoAdd() {
    const urlInput = document.getElementById("tagIndexAddUrl");
    const tagInput = document.getElementById("tagIndexAddTags");
    const storeSelect = document.getElementById("tagIndexAddStore");
    const addBtn = document.getElementById("tagIndexAddBtn");

    const run = async () => {
      const tags = S.normalizeTags(tagInput?.value || "");
      S.ensureTagKinds?.(tags, "song");
      const result = await addVideoWithTags({
        ytUrl: S.safeLink(urlInput?.value),
        storeKey: storeSelect?.value || defaultStoreForTag(""),
        tags,
        button: addBtn
      });
      if (result?.ok) {
        if (urlInput) urlInput.value = "";
        if (tagInput) tagInput.value = "";
      }
    };

    addBtn?.addEventListener("click", run);
    urlInput?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      run();
    });
    tagInput?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      run();
    });
    attachAutocomplete(tagInput);
    bindYoutubeDropToAddArea(document.querySelector(".tag-index-add-video"), urlInput, run);
  }

  function indexVideoAddHTML() {
    return `
      <section class="tag-index-add-video" aria-label="태그창 영상 추가">
        <div class="tag-index-add-title">
          <strong>영상 추가</strong>
          <span>유튜브 주소를 이 영역에 끌어다 놓으면 바로 추가돼.</span>
        </div>
        <div class="tag-index-add-row">
          <input id="tagIndexAddUrl" placeholder="유튜브 링크" />
          <input id="tagIndexAddTags" placeholder="태그 예: 일본어, 밝은곡, 제목태그" />
          <select id="tagIndexAddStore" class="tag-modal-select">${storeOptionsHTML(defaultStoreForTag(""))}</select>
          <button id="tagIndexAddBtn" type="button">영상 추가</button>
        </div>
        <p class="tag-modal-small">새로 입력한 태그는 기본적으로 노래전용으로 저장돼. 태그 입력칸에 글자를 치면 기존 태그 추천이 떠.</p>
      </section>
    `;
  }

  function playlistTagsHTML() {
    const tags = S.readPlaylistTags ? S.readPlaylistTags() : [];
    return `
      <section class="tag-playlist-tag-add" aria-label="재생목록 태그 추가">
        <div class="tag-index-add-title">
          <strong>재생목록 태그</strong>
          <span>#메멘토모리, #보컬연습용, #커버참고처럼 묶음용 태그를 따로 등록.</span>
        </div>
        <div class="playlist-tag-row">
          <input id="playlistTagInput" placeholder="예: 메멘토모리, 보컬연습용, 커버참고" />
          <button id="playlistTagAddBtn" type="button">재생목록 태그 추가</button>
        </div>
        <div class="tag-cloud playlist-tag-cloud">
          ${tags.length ? tags.map((tag) => tagChipHTML(tag, new Map(S.getTagCounts("all")).get(tag) || 0, readTitleTags(), 1)).join("") : `<span class="tag-empty">아직 등록된 재생목록 태그가 없어.</span>`}
        </div>
      </section>
    `;
  }

  function bindPlaylistTagAdd(root) {
    const input = document.getElementById("playlistTagInput");
    const btn = document.getElementById("playlistTagAddBtn");
    const run = () => {
      const tags = S.normalizeTags(input?.value || "");
      if (tags.length === 0) return;
      tags.forEach((tag) => S.registerPlaylistTag?.(tag));
      if (input) input.value = "";
      renderTagIndex();
    };
    btn?.addEventListener("click", run);
    input?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      run();
    });
    attachAutocomplete(input);
  }

  function bindTagKindSelectors(root) {
    if (!root) return;
    root.querySelectorAll("[data-tag-kind-select]").forEach((select) => {
      select.addEventListener("change", () => {
        const tag = S.normalizeTag(select.getAttribute("data-tag-kind-select") || "");
        if (!tag) return;
        S.setTagKind?.(tag, select.value || "song");
        renderTagIndex();
      });
    });
  }

  function showTagIndex(root, counts) {
    const mainContent = document.getElementById("mainContent");
    const indexTitle = document.getElementById("tagIndexTitle") || document.querySelector("h1");
    const lyricsBtn = document.getElementById("lyricsBtn");
    if (mainContent) mainContent.hidden = true;
    if (lyricsBtn) lyricsBtn.hidden = true;
    if (root) root.hidden = false;
    if (indexTitle) indexTitle.hidden = false;

    if (!root) return;
    document.title = "# 태그 모음";
    if (indexTitle) indexTitle.textContent = "# 태그";

    const titleTags = readTitleTags();
    const knownCountMap = new Map(counts);
    if (typeof S.getAllKnownTags === "function") {
      S.getAllKnownTags().forEach((tag) => {
        if (!knownCountMap.has(tag)) knownCountMap.set(tag, 0);
      });
    }
    const allCounts = [...knownCountMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
    const currentFilter = getTagIndexFilter();
    const visibleCounts = filterTagCounts(allCounts, titleTags, currentFilter);
    const filterCounts = Object.fromEntries(TAG_FILTERS.map((item) => [item.key, filterTagCounts(allCounts, titleTags, item.key).length]));
    const maxCount = Math.max(1, ...allCounts.map(([, count]) => Number(count) || 1));
    const filterTitle = `# ${TAG_FILTERS.find((item) => item.key === currentFilter)?.label || "태그 모음"}`;

    root.innerHTML = `
      <div class="tag-drag-actions" aria-label="태그 드래그 작업 영역">
        <div class="tag-side-drop tag-side-drop-left">
          <div class="tag-drop-zone tag-drop-delete" data-tag-drop-action="delete">
            <strong>삭제</strong>
            <span>태그를 여기로 끌면 전체 삭제</span>
          </div>
        </div>
      </div>
      <section class="tag-page-card">
        <h2>${filterTitle}</h2>
        ${indexVideoAddHTML()}
        <div class="tag-filter-tabs" aria-label="태그 보기 필터">
          ${TAG_FILTERS.map((item) => tagFilterButtonHTML(item.key, item.label, currentFilter, filterCounts[item.key] || 0)).join("")}
        </div>
        <p class="tag-page-help">태그를 왼쪽 큰 영역으로 끌면 전체 삭제돼. 위 분류 버튼에 태그를 끌어놓으면 해당 분류로 저장되고, 현재 보고 있는 창은 그대로 유지돼. 태그를 우클릭하면 이름을 수정할 수 있어.</p>
        <div class="tag-cloud tag-index-cloud">
          ${visibleCounts.length ? visibleCounts.map(([tag, count]) => tagChipHTML(tag, count, titleTags, maxCount)).join("") : `<p class="empty-center">이 분류에 표시할 태그가 없어.</p>`}
        </div>
      </section>
    `;

    root.querySelectorAll("[data-tag-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setTagIndexFilter(btn.getAttribute("data-tag-filter") || "all");
        renderTagIndex();
      });
    });

    bindIndexVideoAdd();
    bindTagDragActions(root);
    bindFilterDropActions(root);
  }

  function bindPlayerVideoAdd(selected) {
    const input = document.getElementById("tagPlayerAddUrl");
    const extraInput = document.getElementById("tagPlayerAddExtraTags");
    const storeSelect = document.getElementById("tagPlayerAddStore");
    const btn = document.getElementById("tagPlayerAddBtn");

    const run = async () => {
      const extraTags = S.normalizeTags(extraInput?.value || "");
      S.ensureTagKinds?.(extraTags, "song");
      const result = await addVideoWithTags({
        ytUrl: S.safeLink(input?.value),
        storeKey: storeSelect?.value || defaultStoreForTag(selected),
        tags: S.addTags([selected], extraTags),
        button: btn
      });
      if (result?.ok) {
        if (input) input.value = "";
        if (extraInput) extraInput.value = "";
      }
    };

    btn?.addEventListener("click", run);
    input?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      run();
    });
    extraInput?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      run();
    });
    attachAutocomplete(extraInput);
    bindYoutubeDropToAddArea(document.querySelector(".tag-player-add-video"), input, run);
  }

  function showTagPlayer(root, selected, taggedSongs) {
    const mainContent = document.getElementById("mainContent");
    const indexTitle = document.getElementById("tagIndexTitle") || document.querySelector("h1");
    const lyricsBtn = document.getElementById("lyricsBtn");
    const title = document.getElementById("tagPlayerTitle") || mainContent?.querySelector("h1");
    const description = document.getElementById("tagPlayerDescription");
    const leftTitle = document.getElementById("tagPlaylistTitle");
    const playlistHead = document.querySelector(".tag-playlist-head");

    if (root) {
      root.hidden = true;
      root.innerHTML = "";
    }
    if (indexTitle) indexTitle.hidden = true;
    if (mainContent) mainContent.hidden = false;
    if (lyricsBtn) lyricsBtn.hidden = false;

    document.title = `#${selected} 태그`;
    if (title) title.textContent = `#${selected}`;
    if (description) description.textContent = `총 ${taggedSongs.length}개가 있어. 왼쪽 목록에서 바로 재생하고, 위쪽에서 저장 위치와 태그를 바로 볼 수 있어.`;
    if (leftTitle) leftTitle.textContent = `#${selected} 재생목록`;

    if (playlistHead) {
      const fixed = isTitleTag(selected) && S.getTitleFixedTags ? S.getTitleFixedTags(selected) : [];
      playlistHead.innerHTML = `
        <h2 id="tagPlaylistTitle">#${S.escapeHTML(selected)} 재생목록</h2>
        <p class="tag-page-help">여기 목록은 원래 페이지의 영상들을 모아 보여주는 거라, 메모/가사/기타 정보도 원래 영상 내용이 그대로 따라와.</p>
        <div class="tag-player-add-video">
          <div class="tag-player-add-head">
            <strong>영상 추가</strong>
            <span>#${S.escapeHTML(selected)} 태그로 바로 추가 · 링크 드래그 가능</span>
          </div>
          <div class="tag-player-add-row">
            <input id="tagPlayerAddUrl" placeholder="유튜브 링크" />
            <select id="tagPlayerAddStore" class="tag-modal-select">${storeOptionsHTML(defaultStoreForTag(selected))}</select>
            <button id="tagPlayerAddBtn" type="button">추가</button>
          </div>
          <input id="tagPlayerAddExtraTags" class="tag-player-extra-tags" placeholder="추가 태그 예: 밝은곡, 추천곡" />
          ${fixed.length ? `<p class="tag-modal-small">고정태그 자동 추가: ${fixed.map((item) => `#${S.escapeHTML(item)}`).join(" ")}</p>` : ""}
        </div>
      `;
      bindPlayerVideoAdd(selected);
    }

    if (typeof S.setSongsRaw === "function") S.setSongsRaw(taggedSongs);
    else S.songs = taggedSongs;
    if (!S.songs[S.current]) S.current = 0;
  }

  function renderTagIndex() {
    const root = document.getElementById("tagPageRoot");
    if (!root && !isTagPlayerPage()) return;

    const selected = tagParam();
    const counts = S.getTagCounts("all");

    if (!selected) {
      showTagIndex(root, counts);
      return;
    }

    const taggedSongs = S.getAllSongs().filter((song) => S.normalizeTags(song.tags).includes(selected));
    showTagPlayer(root, selected, taggedSongs);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeDynamicModal("tagVideoAddModal");
    closeDynamicModal("titleFixedTagModal");
  });

  document.addEventListener("DOMContentLoaded", renderTagIndex);
  window.renderTagIndex = renderTagIndex;
  window.openTagVideoModal = openTagVideoModal;
  window.openTitleFixedTagModal = openTitleFixedTagModal;
})();
