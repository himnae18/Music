// js/app-tags.js - 메인 태그 목록 / 태그별 플레이어 페이지
(() => {
  const S = window.AppState;
  if (!S) return;

  const TITLE_TAGS_KEY = "musicTitleTags";

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
    try {
      const data = JSON.parse(localStorage.getItem(TITLE_TAGS_KEY) || "[]");
      return S.normalizeTags(Array.isArray(data) ? data : []);
    } catch {
      return [];
    }
  }

  function writeTitleTags(tags) {
    localStorage.setItem(TITLE_TAGS_KEY, JSON.stringify(S.normalizeTags(tags)));
  }

  function isTitleTag(tag) {
    return readTitleTags().includes(S.normalizeTag(tag));
  }

  function registerTitleTag(tag) {
    const clean = S.normalizeTag(tag);
    if (!clean) return false;
    const tags = S.addTags(readTitleTags(), [clean]);
    writeTitleTags(tags);
    return true;
  }

  function unregisterTitleTag(tag) {
    const clean = S.normalizeTag(tag);
    if (!clean) return false;
    writeTitleTags(readTitleTags().filter((item) => item !== clean));
    return true;
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
          renderTagIndex();
          if (count === 0) alert("삭제할 태그를 찾지 못했어.");
          return;
        }

        if (action === "register-title") {
          registerTitleTag(tag);
          flashDropZone(zone, "등록 완료");
          renderTagIndex();
          return;
        }

        if (action === "unregister-title") {
          unregisterTitleTag(tag);
          flashDropZone(zone, "해제 완료");
          renderTagIndex();
        }
      });
    });
  }

  function tagCountBadgeStyle(count, maxCount) {
    const safeCount = Math.max(1, Number(count) || 1);
    const safeMax = Math.max(1, Number(maxCount) || 1);
    const ratio = Math.min(1, Math.max(0, (safeCount - 1) / Math.max(1, safeMax - 1)));

    const stops = [
      { at: 0, color: [37, 99, 235] },   // blue
      { at: 0.25, color: [34, 197, 94] }, // green
      { at: 0.5, color: [234, 179, 8] },  // yellow
      { at: 0.75, color: [249, 115, 22] },// orange
      { at: 1, color: [220, 38, 38] }     // red
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

  function tagChipHTML(tag, count, titleTags, maxCount = 1) {
    const clean = S.normalizeTag(tag);
    const safe = S.escapeHTML(clean);
    const registered = titleTags.includes(clean);
    const badgeStyle = tagCountBadgeStyle(count, maxCount);
    return `
      <a class="tag-chip tag-index-chip ${registered ? "is-title-tag" : ""}"
        href="${tagPageUrl(clean)}"
        draggable="true"
        data-drag-tag="${safe}"
        title="드래그해서 왼쪽은 삭제, 오른쪽은 제목등록">
        #${safe}
        ${registered ? `<span class="tag-title-badge">제목</span>` : ""}
        <span class="tag-count" style="${badgeStyle}">${count}</span>
      </a>
    `;
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

    root.innerHTML = `
      <div class="tag-drag-actions" aria-label="태그 드래그 작업 영역">
        <div class="tag-side-drop tag-side-drop-left">
          <div class="tag-drop-zone tag-drop-delete" data-tag-drop-action="delete">
            <strong>삭제</strong>
            <span>태그를 여기로 끌면 전체 삭제</span>
          </div>
          <div class="tag-drop-zone tag-drop-unregister" data-tag-drop-action="unregister-title">
            <strong>제목등록해제</strong>
            <span>제목 표시만 해제</span>
          </div>
        </div>
        <div class="tag-side-drop tag-side-drop-right">
          <div class="tag-drop-zone tag-drop-register" data-tag-drop-action="register-title">
            <strong>제목등록</strong>
            <span>노래 제목 태그로 표시</span>
          </div>
        </div>
      </div>
      <section class="tag-page-card">
        <h2># 태그 모음</h2>
        <p class="tag-page-help">직접 넣은 태그들이 ㄱㄴㄷ 순으로 정리돼. 태그를 누르면 그 태그가 달린 노래/영상을 재생목록처럼 모아볼 수 있어. 태그를 끌어서 왼쪽은 삭제, 오른쪽은 제목등록, 왼쪽 아래는 제목등록해제로 쓸 수 있어.</p>
        <div class="tag-cloud tag-index-cloud">
          ${counts.length ? counts.map(([tag, count]) => tagChipHTML(tag, count, titleTags, counts[0]?.[1] || 1)).join("") : `<p class="empty-center">아직 태그가 없어. 노래 페이지에서 태그를 먼저 넣어줘.</p>`}
        </div>
      </section>
    `;

    bindTagDragActions(root);
  }

  function showTagPlayer(root, selected, taggedSongs) {
    const mainContent = document.getElementById("mainContent");
    const indexTitle = document.getElementById("tagIndexTitle") || document.querySelector("h1");
    const lyricsBtn = document.getElementById("lyricsBtn");
    const title = document.getElementById("tagPlayerTitle") || mainContent?.querySelector("h1");
    const description = document.getElementById("tagPlayerDescription");
    const leftTitle = document.getElementById("tagPlaylistTitle");

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

    if (typeof S.setSongsRaw === "function") S.setSongsRaw(taggedSongs);
    else S.songs = taggedSongs;
    S.current = 0;
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

  document.addEventListener("DOMContentLoaded", renderTagIndex);
  window.renderTagIndex = renderTagIndex;
})();
