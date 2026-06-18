// js/app-tags.js - 메인 태그 목록 / 태그별 영상 모음 페이지
(() => {
  const S = window.AppState;
  if (!S) return;

  function tagParam() {
    return S.normalizeTag(new URLSearchParams(location.search).get("tag") || "");
  }

  function countryPage(country, song) {
    const prefix = location.pathname.includes("/tag.html") ? "" : "../";
    const id = song.id || "";
    return `${prefix}${country.page}${id ? `?play=${encodeURIComponent(id)}` : ""}`;
  }

  function renderTagIndex() {
    const root = document.getElementById("tagPageRoot");
    if (!root) return;

    const selected = tagParam();
    const counts = S.getTagCounts("all");

    if (!selected) {
      root.innerHTML = `
        <section class="tag-page-card">
          <h2># 태그 모음</h2>
          <p class="tag-page-help">직접 넣은 태그들이 ㄱㄴㄷ 순으로 정리돼. 태그를 누르면 그 태그가 달린 노래/영상만 모아볼 수 있어.</p>
          <div class="tag-cloud tag-index-cloud">
            ${counts.length ? counts.map(([tag, count]) => `
              <a class="tag-chip tag-index-chip" href="tag.html?tag=${encodeURIComponent(tag)}">#${S.escapeHTML(tag)} <span class="tag-count">${count}</span></a>
            `).join("") : `<p class="empty-center">아직 태그가 없어. 노래 페이지에서 태그를 먼저 넣어줘.</p>`}
          </div>
        </section>
      `;
      return;
    }

    const all = S.getAllSongs().filter((song) => S.normalizeTags(song.tags).includes(selected));
    document.title = `#${selected} 태그 영상`;
    const h1 = document.querySelector("h1");
    if (h1) h1.textContent = `#${selected}`;

    root.innerHTML = `
      <section class="tag-page-card">
        <div class="tag-page-topline">
          <h2>#${S.escapeHTML(selected)} 영상</h2>
          <a class="menu small-menu" href="tag.html">전체 태그 보기</a>
        </div>
        <p class="tag-page-help">총 ${all.length}개가 있어. 영상을 누르면 원래 페이지로 이동해.</p>
        <div class="tag-video-list">
          ${all.length ? all.map((song) => {
            const thumb = song.id ? `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg` : "";
            return `
              <a class="tag-video-card" href="${countryPage(song.country, song)}">
                <div class="tag-video-thumb">${thumb ? `<img src="${thumb}" alt="thumb">` : ""}</div>
                <div class="tag-video-meta">
                  <strong>${S.escapeHTML(song.title || "제목 없음")}</strong>
                  <span>${S.escapeHTML(song.author || "")}</span>
                  <em>${song.country.emoji} ${S.escapeHTML(song.country.label)}</em>
                </div>
              </a>
            `;
          }).join("") : `<p class="empty-center">이 태그가 달린 영상이 없어.</p>`}
        </div>
      </section>
    `;
  }

  document.addEventListener("DOMContentLoaded", renderTagIndex);
})();
