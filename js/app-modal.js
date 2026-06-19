// js/app-modal.js - 수정 팝업만 담당
(() => {
  function editEscapeHTML(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function openEditModal() {
    if (!songs[current]) {
      alert("먼저 수정할 노래를 하나 선택해줘!");
      return;
    }

    const modal = document.getElementById("editModal");
    const content = document.getElementById("editModalContent");

    if (!modal || !content) {
      alert("수정 모달 HTML을 찾을 수 없어!");
      return;
    }

    const s = songs[current];

    content.innerHTML = `
      <h2>노래 수정</h2>

      <input id="editTitle" placeholder="제목" value="${editEscapeHTML(s.title)}" />
      <input id="editAuthor" placeholder="채널/가수" value="${editEscapeHTML(s.author)}" />
      <input id="editYt" placeholder="유튜브 링크" value="${editEscapeHTML(s.ytUrl)}" />
      <input id="editMr" placeholder="MR 링크" value="${editEscapeHTML(s.mr)}" />
      <input id="editOriginal" placeholder="기타 / 원곡 링크" value="${editEscapeHTML(s.original || "")}" />
      <input id="editTags" placeholder="태그 예: 노래, 추천곡" value="${editEscapeHTML((s.tags || []).join(", "))}" />

      <div class="modal-actions">
        <button id="saveEditBtn" type="button">저장</button>
        <button id="cancelEditBtn" type="button">취소</button>
      </div>
    `;

    modal.classList.add("open");
    document.getElementById("saveEditBtn")?.addEventListener("click", saveEditModal);
    document.getElementById("cancelEditBtn")?.addEventListener("click", closeEditModal);
  }

  function closeEditModal() {
    document.getElementById("editModal")?.classList.remove("open");
  }

  function saveEditModal() {
    if (!songs[current]) return;

    const ytUrl = safeLink(document.getElementById("editYt")?.value);
    const id = extractID(ytUrl);

    if (!ytUrl || !id) {
      alert("유튜브 링크가 올바르지 않아!");
      return;
    }

    songs[current] = {
      ...songs[current],
      title: safeText(document.getElementById("editTitle")?.value) || "제목 없음",
      author: safeText(document.getElementById("editAuthor")?.value),
      ytUrl,
      id,
      mr: safeLink(document.getElementById("editMr")?.value),
      original: safeLink(document.getElementById("editOriginal")?.value),
      tags: normalizeTags(document.getElementById("editTags")?.value)
    };

    save();
    showList();
    updateLyricsDrawer();
    if (typeof renderTagTools === "function") renderTagTools();
    closeEditModal();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("editModal")?.addEventListener("click", closeEditModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeEditModal();
    });
  });

  window.openEditModal = openEditModal;
  window.closeEditModal = closeEditModal;
  window.saveEditModal = saveEditModal;
})();
