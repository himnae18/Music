// js/app-transfer.js - 현재/드래그 영상을 다른 목록으로 조용히 이동
(() => {
  const TARGETS = [
    { key: "jaSongs", label: "일본" },
    { key: "krSongs", label: "한국" },
    { key: "enSongs", label: "영어" },
    { key: "yt1pVideos", label: "1P" },
    { key: "yt2pVideos", label: "2P" },
    { key: "yt3pVideos", label: "3P" },
    { key: "yt4pVideos", label: "4P" }
  ];

  function S() {
    return window.AppState || null;
  }

  function sameVideo(a, b) {
    const state = S();
    if (!state || !a || !b) return false;
    const aUrl = state.safeLink(a.ytUrl || a.sourceUrl || "");
    const bUrl = state.safeLink(b.ytUrl || b.sourceUrl || "");
    const aId = state.safeText(a.id || a.sourceId || state.extractID(aUrl));
    const bId = state.safeText(b.id || b.sourceId || state.extractID(bUrl));
    return !!((aId && bId && aId === bId) || (aUrl && bUrl && aUrl === bUrl));
  }

  function currentPlaylistName() {
    return S()?.getCurrentPlaylistParam?.() || "";
  }

  function isCustomPlaylistPage() {
    const state = S();
    return !!(state?.isPlaylistPage?.() && currentPlaylistName());
  }

  function getSourceStoreKey(song) {
    const state = S();
    if (!state) return "";
    if (isCustomPlaylistPage()) return "";
    if (state.isTagPage?.()) {
      return String(song?.sourceKey || song?.storeKey || "");
    }
    return String(state.storeKey || "");
  }

  function readTransferSong(event) {
    const state = S();
    if (!state) return null;
    const raw = event?.dataTransfer?.getData("application/x-library-song") || "";
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const song = state.cleanSong(parsed);
      if (!song || (!song.id && !song.ytUrl)) return null;
      return {
        song,
        sourceIndex: Number(parsed.sourceIndex),
        sourceStoreKey: String(parsed.sourceStoreKey || "")
      };
    } catch {
      return null;
    }
  }

  function findSongIndex(list, song, preferredIndex = -1) {
    const index = Number(preferredIndex);
    if (Number.isInteger(index) && index >= 0 && list[index] && sameVideo(list[index], song)) return index;
    return list.findIndex((item) => sameVideo(item, song));
  }

  function setStatus(message, kind = "ok") {
    const el = document.getElementById("libraryMoveStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind;
    el.hidden = false;
    clearTimeout(setStatus._timer);
    setStatus._timer = setTimeout(() => {
      if (el.textContent === message) el.hidden = true;
    }, 2200);
  }

  function stopPlayerIfEmpty() {
    try {
      if (window.ytPlayer && typeof window.ytPlayer.stopVideo === "function") window.ytPlayer.stopVideo();
      else if (typeof ytPlayer !== "undefined" && ytPlayer && typeof ytPlayer.stopVideo === "function") ytPlayer.stopVideo();
    } catch {}
  }

  function refreshAfterMove({ removedIndex, wasCurrent, previousCurrentSong }) {
    const state = S();
    if (!state) return;
    const list = state.songs || [];

    if (!list.length) {
      state.current = 0;
      stopPlayerIfEmpty();
      window.showList?.();
      window.updateLyricsDrawer?.();
      window.updateControlLabels?.();
      window.renderTagTools?.();
      updatePlaylistCountText();
      return;
    }

    if (wasCurrent) {
      const nextIndex = Math.max(0, Math.min(Number(removedIndex) || 0, list.length - 1));
      state.current = nextIndex;
      if (typeof window.play === "function") window.play(nextIndex, { resume: false });
      else {
        window.showList?.();
        window.updateLyricsDrawer?.();
        window.renderTagTools?.();
      }
      updatePlaylistCountText();
      return;
    }

    if (previousCurrentSong) {
      const nextCurrent = list.indexOf(previousCurrentSong);
      if (nextCurrent >= 0) state.current = nextCurrent;
      else {
        const sameIndex = list.findIndex((item) => sameVideo(item, previousCurrentSong));
        if (sameIndex >= 0) state.current = sameIndex;
      }
    }

    window.showList?.();
    window.updateLyricsDrawer?.();
    window.updateControlLabels?.();
    window.renderTagTools?.();
    updatePlaylistCountText();
  }

  function updatePlaylistCountText() {
    const state = S();
    if (!state || !isCustomPlaylistPage()) return;
    const el = document.getElementById("tagPlayerDescription");
    if (el) el.textContent = `총 ${(state.songs || []).length}개가 있어. 이 목록의 추가/수정/삭제는 원래 일본곡 데이터에 영향을 주지 않아.`;
  }

  function addToTarget(song, targetKey, sourcePlaylist = "") {
    const state = S();
    if (!state) return { ok: false };
    const target = TARGETS.find((item) => item.key === targetKey);
    if (!target) return { ok: false };

    const targetSongs = state.cleanSongArray(state.readStorage(targetKey));
    const existing = targetSongs.findIndex((item) => sameVideo(item, song));
    if (existing >= 0) return { ok: true, duplicate: true, index: existing };

    const copy = state.cleanSong(song);
    if (!copy) return { ok: false };

    // 사용자 재생목록에서 밖으로 이동할 때는 그 재생목록 이름 태그만 제거한다.
    // 그렇지 않으면 일본 목록으로 옮긴 뒤 일본→재생목록 단방향 동기화에서 다시 들어올 수 있다.
    if (sourcePlaylist) {
      copy.tags = state.normalizeTags(copy.tags).filter((tag) => tag !== sourcePlaylist);
    }
    copy.addedAt = Date.now();
    targetSongs.push(copy);
    state.writeStorage(targetKey, targetSongs);
    return { ok: true, duplicate: false, index: targetSongs.length - 1 };
  }

  function removeFromCustomPlaylist(song, preferredIndex) {
    const state = S();
    const playlist = currentPlaylistName();
    if (!state || !playlist) return { ok: false };

    const currentList = state.songs || [];
    const index = findSongIndex(currentList, song, preferredIndex);
    if (index < 0) return { ok: false };
    currentList.splice(index, 1);
    state.writeCustomPlaylistSongs(playlist, currentList);
    return { ok: true, index };
  }

  function removeFromStoreAndView(song, sourceKey, preferredIndex) {
    const state = S();
    if (!state || !sourceKey) return { ok: false };

    // 일반 음악/유튜브 페이지: 화면 목록 자체가 저장소 목록이다.
    if (!state.isTagPage?.() && sourceKey === state.storeKey) {
      const currentList = state.songs || [];
      const index = findSongIndex(currentList, song, preferredIndex);
      if (index < 0) return { ok: false };
      currentList.splice(index, 1);
      state.writeStorage(sourceKey, currentList);
      return { ok: true, index };
    }

    // 일반 태그 페이지: 화면은 여러 원본 저장소를 모아 보여주므로 원본과 화면 양쪽에서 뺀다.
    const sourceList = state.cleanSongArray(state.readStorage(sourceKey));
    const sourceIndex = findSongIndex(sourceList, song, preferredIndex);
    if (sourceIndex < 0) return { ok: false };
    sourceList.splice(sourceIndex, 1);
    state.writeStorage(sourceKey, sourceList);

    const view = state.songs || [];
    let viewIndex = view.findIndex((item) => {
      const itemKey = String(item?.sourceKey || item?.storeKey || "");
      return itemKey === sourceKey && sameVideo(item, song);
    });
    if (viewIndex < 0) viewIndex = view.findIndex((item) => sameVideo(item, song));
    if (viewIndex >= 0) view.splice(viewIndex, 1);
    return { ok: true, index: viewIndex >= 0 ? viewIndex : 0 };
  }

  function moveSong(song, targetKey, options = {}) {
    const state = S();
    if (!state || !song) return false;
    const target = TARGETS.find((item) => item.key === targetKey);
    if (!target) return false;

    const sourcePlaylist = isCustomPlaylistPage() ? currentPlaylistName() : "";
    const sourceKey = sourcePlaylist ? "" : (options.sourceStoreKey && options.sourceStoreKey !== "main"
      ? options.sourceStoreKey
      : getSourceStoreKey(song));

    if (!sourcePlaylist && sourceKey === targetKey) {
      setStatus(`이미 ${target.label} 목록에 있어.`, "same");
      return false;
    }

    const view = state.songs || [];
    const sourceIndexInView = findSongIndex(view, song, options.sourceIndex);
    const previousCurrentSong = view[state.current] || null;
    const wasCurrent = sourceIndexInView >= 0 && sourceIndexInView === state.current;

    const added = addToTarget(song, targetKey, sourcePlaylist);
    if (!added.ok) {
      setStatus(`${target.label}로 옮기지 못했어.`, "error");
      return false;
    }

    const removed = sourcePlaylist
      ? removeFromCustomPlaylist(song, options.sourceIndex)
      : removeFromStoreAndView(song, sourceKey, options.sourceIndex);

    if (!removed.ok) {
      // 원본 제거에 실패했으면 방금 넣은 신규 복사본만 되돌린다.
      if (!added.duplicate) {
        const targetSongs = state.cleanSongArray(state.readStorage(targetKey));
        const rollbackIndex = findSongIndex(targetSongs, song, added.index);
        if (rollbackIndex >= 0) {
          targetSongs.splice(rollbackIndex, 1);
          state.writeStorage(targetKey, targetSongs);
        }
      }
      setStatus(`원래 목록에서 영상을 찾지 못해서 이동을 취소했어.`, "error");
      return false;
    }

    refreshAfterMove({
      removedIndex: removed.index,
      wasCurrent,
      previousCurrentSong: wasCurrent ? null : previousCurrentSong
    });
    window.updateDrawerCounts?.();

    setStatus(
      added.duplicate
        ? `${target.label}에 이미 같은 영상이 있어서 원래 목록에서만 뺐어.`
        : `${target.label}로 이동했어.${wasCurrent ? " 다음 영상을 재생해." : ""}`,
      added.duplicate ? "same" : "ok"
    );
    return true;
  }

  function moveCurrent(targetKey) {
    const state = S();
    const song = state?.songs?.[state.current];
    if (!song) {
      setStatus("먼저 옮길 영상을 재생하거나 선택해줘.", "error");
      return;
    }
    moveSong(song, targetKey, {
      sourceIndex: state.current,
      sourceStoreKey: getSourceStoreKey(song)
    });
  }

  function makeToolbar() {
    if (document.getElementById("libraryMoveToolbar")) return;
    const state = S();
    if (!state) return;
    const anchor = document.getElementById("tagTools");
    const main = document.getElementById("mainContent");
    if (!anchor || !main) return;

    const bar = document.createElement("section");
    bar.id = "libraryMoveToolbar";
    bar.className = "library-move-toolbar";
    bar.setAttribute("aria-label", "영상 목록 이동");
    bar.innerHTML = `
      <div class="library-move-buttons">
        ${TARGETS.map((item) => `<button type="button" class="library-move-btn" data-move-store="${item.key}" title="현재 영상 클릭 또는 왼쪽 영상을 드래그해서 ${item.label}로 이동">${item.label}</button>`).join("")}
      </div>
      <p id="libraryMoveStatus" class="library-move-status" aria-live="polite" hidden></p>
    `;
    anchor.insertAdjacentElement("afterend", bar);

    bar.querySelectorAll("[data-move-store]").forEach((button) => {
      const targetKey = button.getAttribute("data-move-store") || "";
      if (!state.isTagPage?.() && state.storeKey === targetKey) button.classList.add("is-current-store");

      button.addEventListener("click", () => moveCurrent(targetKey));
      button.addEventListener("dragover", (event) => {
        const types = Array.from(event.dataTransfer?.types || []);
        if (!types.includes("application/x-library-song")) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        button.classList.add("is-dragover");
      });
      button.addEventListener("dragleave", () => button.classList.remove("is-dragover"));
      button.addEventListener("drop", (event) => {
        const transfer = readTransferSong(event);
        if (!transfer) return;
        event.preventDefault();
        event.stopPropagation();
        button.classList.remove("is-dragover");
        moveSong(transfer.song, targetKey, {
          sourceIndex: transfer.sourceIndex,
          sourceStoreKey: transfer.sourceStoreKey
        });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", makeToolbar);
  window.moveCurrentSongToStore = moveCurrent;
})();
