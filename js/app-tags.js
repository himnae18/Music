// js/app-tags.js - 메인 태그 목록 / 태그별 플레이어 페이지
(() => {
  const S = window.AppState;
  if (!S) return;

  function tagParam() {
    return S.normalizeTag(new URLSearchParams(location.search).get("tag") || "");
  }

  function isTagPlayerPage() {
    return document.body?.dataset?.page === "tag";
  }

  function tagPageUrl(tag) {
    return `tag.html?tag=${encodeURIComponent(tag)}`;
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

    root.innerHTML = `
      <section class="tag-page-card">
        <h2># 태그 모음</h2>
        <p class="tag-page-help">직접 넣은 태그들이 ㄱㄴㄷ 순으로 정리돼. 태그를 누르면 그 태그가 달린 노래/영상을 재생목록처럼 모아볼 수 있어.</p>
        <div class="tag-cloud tag-index-cloud">
          ${counts.length ? counts.map(([tag, count]) => `
            <a class="tag-chip tag-index-chip" href="${tagPageUrl(tag)}">#${S.escapeHTML(tag)} <span class="tag-count">${count}</span></a>
          `).join("") : `<p class="empty-center">아직 태그가 없어. 노래 페이지에서 태그를 먼저 넣어줘.</p>`}
        </div>
      </section>
    `;
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
