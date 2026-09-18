// js/app-enhancements.js - 실행 취소 / 자동 백업 / 다중선택 / 재생목록 불러오기 / 도움말 / UI 설정
(() => {
  const S = window.AppState;
  if (!S) return;

  const UNDO_SESSION_KEY = 'musicUndoSnapshotV2';
  const SETTINGS_KEY = 'musicUiSettingsV1';
  const BATCH_MIME = 'application/x-library-batch-v1';
  const AUTO_BACKUP_DB = 'musicLibraryAutoBackupsV1';
  const AUTO_BACKUP_STORE = 'snapshots';
  const MAX_BACKUPS = 7;

  let pendingMutation = null;
  let commitTimer = null;
  let lastUndo = null;
  let selectionMode = false;
  const selectedIndices = new Set();
  let autoBackupTimer = null;
  let textMutationTimer = null;

  function isManagedKey(key) {
    const text = String(key || '');
    if ((S.ALL_STORES || []).some((item) => item.key === text)) return true;
    if (text.startsWith('music') && !text.startsWith('musicUiSettings') && !text.startsWith('musicUndo') && !text.startsWith('musicAutoBackup')) return true;
    return text === 'addedVideosSortMode';
  }

  function takeSnapshot() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!isManagedKey(key)) continue;
      data[key] = localStorage.getItem(key);
    }
    return { version: 2, savedAt: Date.now(), data };
  }

  function snapshotFingerprint(snapshot) {
    const data = snapshot?.data || {};
    return Object.keys(data).sort().map((key) => `${key}:${data[key]}`).join('\n');
  }

  function storeUndo(snapshot, label = '작업') {
    lastUndo = { snapshot, label, createdAt: Date.now() };
    try { sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(lastUndo)); } catch {}
    updateUndoButton();
    showActionToast(`${label}을(를) 실행했어.`, true);
  }

  function loadUndo() {
    if (lastUndo) return lastUndo;
    try {
      const raw = JSON.parse(sessionStorage.getItem(UNDO_SESSION_KEY) || 'null');
      if (raw?.snapshot?.data) lastUndo = raw;
    } catch {}
    return lastUndo;
  }

  function beginMutation(label = '작업') {
    if (pendingMutation) {
      if (label && pendingMutation.label === '작업') pendingMutation.label = label;
      return pendingMutation;
    }
    pendingMutation = { label, before: takeSnapshot(), startedAt: Date.now() };
    return pendingMutation;
  }

  function commitMutation(label = '') {
    if (!pendingMutation) return false;
    const pending = pendingMutation;
    pendingMutation = null;
    clearTimeout(commitTimer);
    const after = takeSnapshot();
    if (snapshotFingerprint(pending.before) === snapshotFingerprint(after)) return false;
    storeUndo(pending.before, label || pending.label || '작업');
    scheduleAutoBackup(label || pending.label || '자동 백업');
    return true;
  }

  function scheduleCommit(label = '', delay = 80) {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => commitMutation(label), delay);
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot?.data) return false;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (isManagedKey(key)) keys.push(key);
    }
    keys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(snapshot.data, key)) localStorage.removeItem(key);
    });
    Object.entries(snapshot.data).forEach(([key, value]) => {
      if (!isManagedKey(key)) return;
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    });
    return true;
  }

  function undoLastAction() {
    const undo = loadUndo();
    if (!undo?.snapshot) {
      showActionToast('되돌릴 작업이 없어.', false);
      return;
    }
    const current = takeSnapshot();
    if (!restoreSnapshot(undo.snapshot)) return;
    // 한 번 되돌린 뒤 다시 되돌릴 수 있도록 현재 상태를 교환해 둔다.
    lastUndo = { snapshot: current, label: `${undo.label} 다시 적용`, createdAt: Date.now() };
    try { sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(lastUndo)); } catch {}
    location.reload();
  }

  function updateUndoButton() {
    const btn = document.getElementById('globalUndoBtn');
    if (!btn) return;
    const undo = loadUndo();
    btn.disabled = !undo;
    btn.title = undo ? `실행 취소: ${undo.label} (Ctrl+Alt+Z)` : '되돌릴 작업 없음';
  }

  function showActionToast(message, showUndo = false) {
    let toast = document.getElementById('globalActionToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'globalActionToast';
      toast.className = 'global-action-toast';
      toast.innerHTML = '<span></span><button type="button">실행 취소</button>';
      toast.querySelector('button')?.addEventListener('click', undoLastAction);
      document.body.appendChild(toast);
    }
    toast.querySelector('span').textContent = message;
    const undoBtn = toast.querySelector('button');
    if (undoBtn) undoBtn.hidden = !showUndo;
    toast.classList.add('show');
    clearTimeout(showActionToast._timer);
    showActionToast._timer = setTimeout(() => toast.classList.remove('show'), 3400);
  }

  // -------------------------
  // 자동 백업 (IndexedDB)
  // -------------------------
  function openBackupDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(AUTO_BACKUP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(AUTO_BACKUP_STORE)) db.createObjectStore(AUTO_BACKUP_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('backup db error'));
    });
  }

  async function listAutoBackups() {
    try {
      const db = await openBackupDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTO_BACKUP_STORE, 'readonly');
        const req = tx.objectStore(AUTO_BACKUP_STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.id - a.id));
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const fallback = JSON.parse(localStorage.getItem('musicAutoBackupFallbackV1') || 'null');
        return fallback ? [fallback] : [];
      } catch { return []; }
    }
  }

  async function saveAutoBackup(label = '자동 백업') {
    const record = { id: Date.now(), createdAt: new Date().toISOString(), label, snapshot: takeSnapshot() };
    try {
      const db = await openBackupDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTO_BACKUP_STORE, 'readwrite');
        tx.objectStore(AUTO_BACKUP_STORE).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      const all = await listAutoBackups();
      if (all.length > MAX_BACKUPS) {
        await new Promise((resolve) => {
          const tx = db.transaction(AUTO_BACKUP_STORE, 'readwrite');
          all.slice(MAX_BACKUPS).forEach((item) => tx.objectStore(AUTO_BACKUP_STORE).delete(item.id));
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      }
    } catch {
      try { localStorage.setItem('musicAutoBackupFallbackV1', JSON.stringify(record)); } catch {}
    }
  }

  function scheduleAutoBackup(label = '자동 백업') {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = setTimeout(() => saveAutoBackup(label), 1200);
  }

  async function restoreAutoBackup(id) {
    const list = await listAutoBackups();
    const found = list.find((item) => String(item.id) === String(id));
    if (!found?.snapshot) return false;
    if (!confirm('이 자동 백업 상태로 복원할까? 현재 상태는 실행 취소에 한 번 보관해둘게.')) return false;
    beginMutation('자동 백업 복원');
    restoreSnapshot(found.snapshot);
    commitMutation('자동 백업 복원');
    location.reload();
    return true;
  }

  // -------------------------
  // 여러 영상 선택 / 일괄 작업
  // -------------------------
  function selectedSongs() {
    return [...selectedIndices]
      .sort((a, b) => a - b)
      .map((index) => ({ index, song: S.songs?.[index] }))
      .filter((item) => item.song);
  }

  function isSelected(index) { return selectedIndices.has(Number(index)); }

  function toggleSelection(index, checked) {
    const n = Number(index);
    if (!Number.isInteger(n)) return;
    if (checked) selectedIndices.add(n);
    else selectedIndices.delete(n);
    syncSelectionUI();
  }

  function clearSelection() {
    selectedIndices.clear();
    syncSelectionUI();
  }

  function setSelectionMode(value) {
    selectionMode = !!value;
    document.body.classList.toggle('batch-selection-mode', selectionMode);
    const btn = document.getElementById('multiSelectToggle');
    const panel = document.getElementById('batchActionPanel');
    if (btn) btn.classList.toggle('active', selectionMode);
    if (panel) panel.hidden = !selectionMode;
    if (!selectionMode) selectedIndices.clear();
    syncSelectionUI();
  }

  function syncSelectionUI() {
    document.querySelectorAll('.batch-select-checkbox').forEach((checkbox) => {
      const idx = Number(checkbox.getAttribute('data-batch-index'));
      checkbox.checked = selectedIndices.has(idx);
      checkbox.closest('.pl-item')?.classList.toggle('is-batch-selected', selectedIndices.has(idx));
    });
    const count = document.getElementById('batchSelectedCount');
    if (count) count.textContent = `${selectedIndices.size}개 선택`;
    const buttons = document.querySelectorAll('[data-batch-requires-selection]');
    buttons.forEach((btn) => { btn.disabled = selectedIndices.size === 0; });
  }

  function sameVideo(a, b) {
    const aId = String(a?.id || S.extractID(a?.ytUrl || '') || '');
    const bId = String(b?.id || S.extractID(b?.ytUrl || '') || '');
    if (aId && bId) return aId === bId;
    const aUrl = S.safeLink(a?.ytUrl || '');
    const bUrl = S.safeLink(b?.ytUrl || '');
    return !!(aUrl && bUrl && aUrl === bUrl);
  }

  function targetOptionsHTML() {
    const stores = (S.ALL_STORES || []).map((item) => `<option value="store:${S.escapeHTML(item.key)}">${S.escapeHTML(`${item.emoji || ''} ${item.label}`.trim())}</option>`).join('');
    const playlists = (S.readPlaylistTags?.() || []).map((name) => `<option value="playlist:${S.escapeHTML(name)}">📁 ${S.escapeHTML(name)}</option>`).join('');
    return `<optgroup label="페이지">${stores}</optgroup>${playlists ? `<optgroup label="내 재생목록">${playlists}</optgroup>` : ''}`;
  }

  function addCopyToStore(song, targetKey) {
    const arr = S.cleanSongArray(S.readStorage(targetKey));
    if (arr.some((item) => sameVideo(item, song))) return { added: false, duplicate: true };
    const copy = S.cleanSong(song);
    if (!copy) return { added: false };
    copy.addedAt = Date.now();
    if (!copy.createdAt) copy.createdAt = Number(song?.createdAt || song?.addedAt || Date.now());
    arr.push(copy);
    S.writeStorage(targetKey, arr);
    return { added: true };
  }

  function removeItemsFromCurrent(entries) {
    if (!entries.length) return;
    if (S.isPlaylistPage?.()) {
      const playlist = S.getCurrentPlaylistParam?.();
      const removeSet = new Set(entries.map((item) => item.index));
      const next = (S.songs || []).filter((_, index) => !removeSet.has(index));
      S.writeCustomPlaylistSongs?.(playlist, next);
      S.songs = next;
      return;
    }

    if (S.isTagPage?.()) {
      // 태그 화면은 각 영상이 서로 다른 원본 목록에 있을 수 있다.
      const grouped = new Map();
      entries.forEach(({ song }) => {
        const key = String(song?.sourceKey || song?.storeKey || '');
        if (!key) return;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(song);
      });
      grouped.forEach((items, key) => {
        let arr = S.cleanSongArray(S.readStorage(key));
        arr = arr.filter((candidate) => !items.some((item) => sameVideo(candidate, item)));
        S.writeStorage(key, arr);
      });
      return;
    }

    const key = S.storeKey;
    const removeSet = new Set(entries.map((item) => item.index));
    const next = (S.songs || []).filter((_, index) => !removeSet.has(index));
    S.writeStorage(key, next);
    S.songs = next;
  }

  function refreshAfterBatch() {
    if (S.isTagPage?.() && !S.isPlaylistPage?.()) {
      location.reload();
      return;
    }
    if (S.isPlaylistPage?.()) {
      S.songs = S.cleanSongArray(S.readCustomPlaylistSongs?.(S.getCurrentPlaylistParam?.()) || []);
    } else if (S.storeKey && S.storeKey !== 'main') {
      S.songs = S.cleanSongArray(S.readStorage(S.storeKey));
    }
    S.current = Math.max(0, Math.min(Number(S.current || 0), Math.max(0, (S.songs || []).length - 1)));
    window.showList?.();
    window.updateLyricsDrawer?.();
    window.renderTagTools?.();
    clearSelection();
  }

  function parseBatchTarget(value) {
    const text = String(value || '');
    const sep = text.indexOf(':');
    if (sep < 0) return null;
    return { type: text.slice(0, sep), value: text.slice(sep + 1) };
  }

  function batchCopy(target) {
    const entries = selectedSongs();
    if (!entries.length || !target) return;
    beginMutation('여러 영상 복사');
    let added = 0;
    if (target.type === 'playlist') {
      entries.forEach(({ song }) => { if (S.addSongCopyToPlaylist?.(song, target.value)?.ok) added++; });
    } else if (target.type === 'store') {
      entries.forEach(({ song }) => { if (addCopyToStore(song, target.value).added) added++; });
    }
    commitMutation('여러 영상 복사');
    showActionToast(`${added}개 영상을 복사했어.`, true);
  }

  function batchMove(target) {
    const entries = selectedSongs();
    if (!entries.length || !target) return;
    if (target.type === 'store' && !S.isTagPage?.() && !S.isPlaylistPage?.() && target.value === S.storeKey) {
      showActionToast('이미 현재 페이지야.', false);
      return;
    }
    beginMutation('여러 영상 이동');
    let moved = 0;
    let removable = [];
    if (target.type === 'playlist') {
      entries.forEach((entry) => {
        const result = S.addSongCopyToPlaylist?.(entry.song, target.value);
        if (result?.ok) { moved++; removable.push(entry); }
      });
      // 사용자 재생목록으로 드래그할 때는 복사지만, 일괄 "이동" 버튼은 선택한 원본에서도 뺀다.
      removeItemsFromCurrent(removable);
    } else if (target.type === 'store') {
      entries.forEach((entry) => {
        const sourceKey = String(entry.song?.sourceKey || entry.song?.storeKey || S.storeKey || '');
        if (sourceKey && sourceKey === target.value && !S.isPlaylistPage?.()) return;
        const result = addCopyToStore(entry.song, target.value);
        if (result.added || result.duplicate) {
          // 대상에 이미 같은 영상이 있어도 "이동"이면 원본에서는 빼는 기존 이동 규칙을 따른다.
          moved++;
          removable.push(entry);
        }
      });
      removeItemsFromCurrent(removable);
    }
    const changed = commitMutation('여러 영상 이동');
    showActionToast(moved ? `${moved}개 영상을 이동했어.` : '이동할 영상이 없었어.', changed);
    if (moved) refreshAfterBatch();
  }

  function batchAddTag(tagText) {
    const tag = S.normalizeTag?.(tagText || '');
    const entries = selectedSongs();
    if (!tag || !entries.length) return;
    beginMutation('여러 영상 태그 추가');
    if (S.isPlaylistPage?.()) {
      entries.forEach(({ song }) => { song.tags = S.addTags(song.tags, [tag]); });
      S.writeCustomPlaylistSongs?.(S.getCurrentPlaylistParam?.(), S.songs || []);
    } else if (S.isTagPage?.()) {
      entries.forEach(({ song }) => {
        song.tags = S.addTags(song.tags, [tag]);
        S.saveSongToSource?.(song);
      });
    } else {
      entries.forEach(({ song }) => { song.tags = S.addTags(song.tags, [tag]); });
      S.save?.();
    }
    commitMutation('여러 영상 태그 추가');
    showActionToast(`#${tag} 태그를 ${entries.length}개 영상에 추가했어.`, true);
    refreshAfterBatch();
  }

  function batchDelete() {
    const entries = selectedSongs();
    if (!entries.length) return;
    const tagPage = S.isTagPage?.() && !S.isPlaylistPage?.();
    const message = tagPage
      ? `선택한 ${entries.length}개 영상에서 현재 태그만 제거할까?`
      : `선택한 ${entries.length}개 영상을 현재 목록에서 삭제할까?`;
    if (!confirm(message)) return;
    beginMutation(tagPage ? '여러 영상 태그 제거' : '여러 영상 삭제');
    if (tagPage) {
      const tag = S.getCurrentTagParam?.();
      entries.forEach(({ song }) => {
        song.tags = S.normalizeTags(song.tags).filter((item) => item !== tag);
        S.saveSongToSource?.(song);
      });
    } else {
      removeItemsFromCurrent(entries);
    }
    commitMutation(tagPage ? '여러 영상 태그 제거' : '여러 영상 삭제');
    showActionToast(`${entries.length}개를 처리했어.`, true);
    refreshAfterBatch();
  }

  function createBatchToolbar() {
    if (!document.querySelector('.left-library-panel') || document.getElementById('multiSelectToolbar')) return;
    const anchor = document.getElementById('pageSearchBox') || document.getElementById('libraryMoveToolbar') || document.getElementById('tagTools');
    if (!anchor) return;
    const bar = document.createElement('section');
    bar.id = 'multiSelectToolbar';
    bar.className = 'multi-select-toolbar';
    bar.innerHTML = `
      <button id="multiSelectToggle" type="button">☑ 여러 개 선택</button>
      <div id="batchActionPanel" class="batch-action-panel" hidden>
        <span id="batchSelectedCount">0개 선택</span>
        <button type="button" id="batchSelectVisible">보이는 것 전체</button>
        <button type="button" id="batchClearSelection">선택 해제</button>
        <select id="batchTargetSelect" aria-label="일괄 작업 대상">${targetOptionsHTML()}</select>
        <button type="button" data-batch-requires-selection id="batchMoveBtn">이동</button>
        <button type="button" data-batch-requires-selection id="batchCopyBtn">복사</button>
        <input id="batchTagInput" type="text" placeholder="#태그 추가" aria-label="일괄 태그 추가">
        <button type="button" data-batch-requires-selection id="batchTagBtn">태그 추가</button>
        <button type="button" data-batch-requires-selection id="batchDeleteBtn" class="batch-danger-btn">삭제</button>
      </div>`;
    anchor.insertAdjacentElement('afterend', bar);

    bar.querySelector('#multiSelectToggle')?.addEventListener('click', () => setSelectionMode(!selectionMode));
    bar.querySelector('#batchClearSelection')?.addEventListener('click', clearSelection);
    bar.querySelector('#batchSelectVisible')?.addEventListener('click', () => {
      document.querySelectorAll('.pl-item[data-song-index]').forEach((row) => selectedIndices.add(Number(row.dataset.songIndex)));
      syncSelectionUI();
    });
    const getTarget = () => parseBatchTarget(bar.querySelector('#batchTargetSelect')?.value || '');
    bar.querySelector('#batchCopyBtn')?.addEventListener('click', () => batchCopy(getTarget()));
    bar.querySelector('#batchMoveBtn')?.addEventListener('click', () => batchMove(getTarget()));
    bar.querySelector('#batchTagBtn')?.addEventListener('click', () => {
      const input = bar.querySelector('#batchTagInput');
      batchAddTag(input?.value || '');
      if (input) input.value = '';
    });
    bar.querySelector('#batchDeleteBtn')?.addEventListener('click', batchDelete);
    syncSelectionUI();
  }

  function bindBatchEvents() {
    document.addEventListener('change', (event) => {
      const checkbox = event.target.closest?.('.batch-select-checkbox');
      if (!checkbox) return;
      toggleSelection(Number(checkbox.getAttribute('data-batch-index')), !!checkbox.checked);
    });

    // 기존 단일 드래그 페이로드에 선택 묶음 페이로드를 덧붙인다.
    const originalDragStart = window.onDragStart;
    if (typeof originalDragStart === 'function' && !originalDragStart.__batchWrapped) {
      const wrapped = function(event, index) {
        originalDragStart(event, index);
        if (!selectionMode || !selectedIndices.has(Number(index)) || selectedIndices.size < 2) return;
        const payload = selectedSongs().map(({ index: i, song }) => ({
          index: i,
          song: S.cleanSong(song),
          sourceStoreKey: String(song?.sourceKey || song?.storeKey || S.storeKey || '')
        }));
        try { event.dataTransfer?.setData(BATCH_MIME, JSON.stringify(payload)); } catch {}
      };
      wrapped.__batchWrapped = true;
      window.onDragStart = wrapped;
    }

    const targetSelector = '[data-move-store], #drawer [data-side-drop-store], #drawer [data-playlist-drop-name]';
    document.addEventListener('dragover', (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes(BATCH_MIME)) return;
      const target = event.target.closest?.(targetSelector);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.classList.add('is-batch-dragover');
      if (event.dataTransfer) event.dataTransfer.dropEffect = target.dataset.playlistDropName ? 'copy' : 'move';
    }, true);
    document.addEventListener('dragleave', (event) => {
      event.target.closest?.(targetSelector)?.classList.remove('is-batch-dragover');
    }, true);
    document.addEventListener('drop', (event) => {
      const raw = event.dataTransfer?.getData(BATCH_MIME) || '';
      const destination = event.target.closest?.(targetSelector);
      if (!raw || !destination) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      destination.classList.remove('is-batch-dragover');
      const storeKey = destination.dataset.moveStore || destination.dataset.sideDropStore || '';
      const playlistName = destination.dataset.playlistDropName || '';
      if (playlistName) batchCopy({ type: 'playlist', value: playlistName });
      else if (storeKey) batchMove({ type: 'store', value: storeKey });
    }, true);

    const observer = new MutationObserver(() => syncSelectionUI());
    const list = document.getElementById('list');
    if (list) observer.observe(list, { childList: true, subtree: true });
  }

  // -------------------------
  // YouTube 재생목록 불러오기
  // -------------------------
  function parsePlaylistId(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text);
      return String(url.searchParams.get('list') || '').trim();
    } catch {
      return /^[A-Za-z0-9_-]{12,}$/.test(text) ? text : '';
    }
  }

  function waitForYouTubeApi() {
    return new Promise((resolve, reject) => {
      const finishIfReady = () => {
        if (window.YT && typeof window.YT.Player === 'function') { resolve(window.YT); return true; }
        return false;
      };
      if (finishIfReady()) return;
      try { window.ensurePlayerReady?.(() => finishIfReady()); } catch {}
      const started = Date.now();
      const timer = setInterval(() => {
        if (finishIfReady()) { clearInterval(timer); return; }
        if (Date.now() - started > 12000) { clearInterval(timer); reject(new Error('YouTube API timeout')); }
      }, 150);
    });
  }

  async function fetchPlaylistVideoIds(playlistId) {
    const YT = await waitForYouTubeApi();
    return await new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;overflow:hidden;';
      const playerEl = document.createElement('div');
      host.appendChild(playerEl);
      document.body.appendChild(host);
      let player = null;
      let lastLength = -1;
      let stable = 0;
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        try { player?.destroy?.(); } catch {}
        host.remove();
      };
      const finish = (ids) => { cleanup(); resolve([...new Set(ids.filter(Boolean))]); };
      const fail = (err) => { cleanup(); reject(err instanceof Error ? err : new Error(String(err || 'playlist error'))); };
      const poll = setInterval(() => {
        if (!player || done) return;
        let ids = [];
        try { ids = player.getPlaylist?.() || []; } catch {}
        if (!ids.length) return;
        if (ids.length === lastLength) stable++;
        else { lastLength = ids.length; stable = 0; }
        if (stable >= 3) finish(ids);
      }, 500);
      const timeout = setTimeout(() => {
        let ids = [];
        try { ids = player?.getPlaylist?.() || []; } catch {}
        if (ids.length) finish(ids);
        else fail(new Error('재생목록 영상을 읽지 못했어. 비공개/일부 제한 재생목록일 수 있어.'));
      }, 15000);

      try {
        player = new YT.Player(playerEl, {
          width: '2', height: '2',
          playerVars: { autoplay: 0, controls: 0, rel: 0 },
          events: {
            onReady: (event) => {
              try { event.target.cuePlaylist({ listType: 'playlist', list: playlistId, index: 0 }); }
              catch (error) { fail(error); }
            },
            onError: () => fail(new Error('YouTube 재생목록을 불러오지 못했어.'))
          }
        });
      } catch (error) { fail(error); }
    });
  }

  async function importPlaylist(input, button, status) {
    const playlistId = parsePlaylistId(input?.value || '');
    const storeKey = S.storeKey;
    if (!playlistId) { status.textContent = '재생목록 링크 또는 ID를 확인해줘.'; return; }
    if (!storeKey || storeKey === 'main' || !S.ALL_STORES.some((item) => item.key === storeKey)) {
      status.textContent = '이 페이지에서는 재생목록을 불러올 수 없어.'; return;
    }
    button.disabled = true;
    status.textContent = 'YouTube 재생목록을 읽는 중…';
    try {
      const ids = await fetchPlaylistVideoIds(playlistId);
      if (!ids.length) throw new Error('재생목록에 읽을 수 있는 영상이 없어.');
      let added = 0, skipped = 0, failed = 0;
      beginMutation('유튜브 재생목록 불러오기');
      for (let i = 0; i < ids.length; i++) {
        status.textContent = `${i + 1} / ${ids.length} 불러오는 중…`;
        const url = `https://www.youtube.com/watch?v=${encodeURIComponent(ids[i])}`;
        // 대량 불러오기에서는 완전히 같은 영상은 조용히 건너뛴다.
        const dup = S.collectExactVideoDuplicates?.({ ytUrl: url, id: ids[i] }) || [];
        if (dup.length) { skipped++; continue; }
        try {
          const result = await S.addVideoToStoreWithTags?.({ ytUrl: url, storeKey });
          if (result?.ok) added++;
          else if (result?.duplicate || result?.cancelled) skipped++;
          else failed++;
        } catch { failed++; }
      }
      commitMutation('유튜브 재생목록 불러오기');
      S.songs = S.cleanSongArray(S.readStorage(storeKey));
      window.showList?.();
      input.value = '';
      status.textContent = `완료 · 추가 ${added}개 / 건너뜀 ${skipped}개${failed ? ` / 실패 ${failed}개` : ''}`;
    } catch (error) {
      pendingMutation = null;
      status.textContent = error?.message || '재생목록을 불러오지 못했어.';
    } finally {
      button.disabled = false;
    }
  }

  function createPlaylistImporter() {
    if (!document.body?.dataset?.store || document.getElementById('playlistImportRow')) return;
    const section = document.querySelector('.add-song-section .add-song-fields');
    if (!section) return;
    const row = document.createElement('div');
    row.id = 'playlistImportRow';
    row.className = 'playlist-import-block';
    row.innerHTML = `
      <div class="add-song-row playlist-import-row">
        <label class="add-song-kind" for="playlistImportInput">재생목록</label>
        <input id="playlistImportInput" placeholder="YouTube 재생목록 링크" autocomplete="off">
        <button id="playlistImportBtn" class="add-song-btn" type="button">불러오기</button>
      </div>
      <p id="playlistImportStatus" class="playlist-import-status" aria-live="polite"></p>`;
    section.insertAdjacentElement('afterbegin', row);
    const input = row.querySelector('#playlistImportInput');
    const button = row.querySelector('#playlistImportBtn');
    const status = row.querySelector('#playlistImportStatus');
    button?.addEventListener('click', () => importPlaylist(input, button, status));
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); importPlaylist(input, button, status); }
    });
  }

  // -------------------------
  // 재생목록 이름 검색 / 정렬
  // -------------------------
  function createPlaylistDrawerTools() {
    const holder = document.getElementById('drawerCustomPlaylistList');
    if (!holder || document.getElementById('drawerPlaylistTools')) return;
    const tools = document.createElement('div');
    tools.id = 'drawerPlaylistTools';
    tools.className = 'drawer-playlist-tools';
    tools.innerHTML = `
      <input id="drawerPlaylistSearch" type="search" placeholder="재생목록 검색" autocomplete="off">
      <select id="drawerPlaylistSort" aria-label="재생목록 정렬"><option value="name">이름순</option><option value="count">영상 많은순</option></select>`;
    holder.parentElement?.insertBefore(tools, holder);
    let observer = null;
    const apply = () => {
      // 정렬 때문에 발생한 childList 변화를 다시 관찰해 무한 루프가 생기지 않도록
      // 적용하는 동안만 observer를 잠시 끊는다.
      observer?.disconnect();
      const q = String(tools.querySelector('#drawerPlaylistSearch')?.value || '').toLocaleLowerCase('ko').trim();
      const mode = tools.querySelector('#drawerPlaylistSort')?.value || 'name';
      const links = [...holder.querySelectorAll('.drawer-playlist-link')];
      links.forEach((link) => {
        const name = String(link.dataset.playlistDropName || link.textContent || '');
        link.hidden = !!q && !name.toLocaleLowerCase('ko').includes(q);
      });
      const sorted = links.sort((a, b) => {
        const an = a.dataset.playlistDropName || '';
        const bn = b.dataset.playlistDropName || '';
        if (mode === 'count') {
          const ac = S.readCustomPlaylistSongs?.(an)?.length || 0;
          const bc = S.readCustomPlaylistSongs?.(bn)?.length || 0;
          if (bc !== ac) return bc - ac;
        }
        return an.localeCompare(bn, 'ko', { numeric: true });
      });
      const current = [...holder.querySelectorAll('.drawer-playlist-link')];
      const needsReorder = sorted.some((link, idx) => current[idx] !== link);
      if (needsReorder) sorted.forEach((link) => holder.appendChild(link));
      observer?.observe(holder, { childList: true });
    };
    tools.addEventListener('input', apply);
    tools.addEventListener('change', apply);
    observer = new MutationObserver(apply);
    observer.observe(holder, { childList: true });
    apply();
  }

  // -------------------------
  // 단축키 도움말 / UI 설정
  // -------------------------
  const ACCENTS = {
    red: ['#c9274d', '#fff1f5'],
    wine: ['#991835', '#fff0f3'],
    rose: ['#d94b78', '#fff1f6'],
    purple: ['#7653b9', '#f5f0ff'],
    blue: ['#3976b8', '#eef6ff'],
    green: ['#438a5e', '#eef9f1'],
    neutral: ['#555555', '#f4f4f4']
  };

  function readSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { accent: raw.accent || 'red', density: raw.density || 'normal', thumb: raw.thumb || 'normal' };
    } catch { return { accent: 'red', density: 'normal', thumb: 'normal' }; }
  }

  function applySettings(settings = readSettings()) {
    const [accent, soft] = ACCENTS[settings.accent] || ACCENTS.red;
    document.documentElement.style.setProperty('--app-accent', accent);
    document.documentElement.style.setProperty('--app-accent-soft', soft);
    document.body.dataset.density = settings.density || 'normal';
    document.body.dataset.thumbSize = settings.thumb || 'normal';
  }

  function saveSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    applySettings(next);
  }

  function openShortcutHelp() {
    document.getElementById('shortcutHelpModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'shortcutHelpModal';
    overlay.className = 'enhance-modal-overlay';
    overlay.innerHTML = `
      <div class="enhance-modal shortcut-help-modal" role="dialog" aria-modal="true">
        <div class="enhance-modal-head"><h2>단축키 도움말</h2><button type="button" data-close>×</button></div>
        <div class="shortcut-grid">
          <kbd>A / S / D / F</kbd><span>일본 / 중국 / 한국 / 영어</span>
          <kbd>1~4</kbd><span>1P~4P 이동</span>
          <kbd>5 / 6</kbd><span>오른쪽 5P / 6P 패널 (Shift+5/6은 페이지)</span>
          <kbd>Tab</kbd><span>왼쪽 메뉴 열기/닫기</span>
          <kbd>\` / ₩</kbd><span>오른쪽 정보 패널</span>
          <kbd>Q / W</kbd><span>영상 링크 / 태그 입력칸</span>
          <kbd>Ctrl + Q</kbd><span>현재 영상 번호 이동</span>
          <kbd>Ctrl + Z / Ctrl + X</kbd><span>재생 기록 뒤 / 앞</span>
          <kbd>Ctrl + Alt + Z</kbd><span>최근 데이터 작업 실행 취소</span>
          <kbd>Space</kbd><span>재생 / 일시정지</span>
          <kbd>← / J · → / L</kbd><span>5초 뒤 / 앞으로</span>
          <kbd>Shift + , / .</kbd><span>배속 -0.25 / +0.25</span>
          <kbd>Shift + ; / '</kbd><span>배속 -0.10 / -0.50</span>
          <kbd>Shift만 눌렀다 떼기</kbd><span>배속 1.00x</span>
          <kbd>?</kbd><span>이 도움말 열기</span>
          <kbd>Esc</kbd><span>열린 창 닫기</span>
        </div>
        <p class="enhance-help">검색에서 <b>#태그</b>, <b>채널:이름</b>, <b>제목:단어</b>, <b>페이지:1P</b> 형식도 사용할 수 있어.</p>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.closest('[data-close]')) close(); });
  }

  async function openSettings() {
    document.getElementById('uiSettingsModal')?.remove();
    const settings = readSettings();
    const overlay = document.createElement('div');
    overlay.id = 'uiSettingsModal';
    overlay.className = 'enhance-modal-overlay';
    overlay.innerHTML = `
      <div class="enhance-modal settings-modal" role="dialog" aria-modal="true">
        <div class="enhance-modal-head"><h2>화면 설정 / 자동 백업</h2><button type="button" data-close>×</button></div>
        <div class="settings-grid">
          <label>특징색<select id="uiAccentSelect">${Object.keys(ACCENTS).map((key) => `<option value="${key}" ${settings.accent === key ? 'selected' : ''}>${{red:'빨강',wine:'와인레드',rose:'로즈',purple:'보라',blue:'파랑',green:'초록',neutral:'무채색'}[key]}</option>`).join('')}</select></label>
          <label>목록 간격<select id="uiDensitySelect"><option value="compact" ${settings.density==='compact'?'selected':''}>좁게</option><option value="normal" ${settings.density==='normal'?'selected':''}>기본</option><option value="comfortable" ${settings.density==='comfortable'?'selected':''}>넓게</option></select></label>
          <label>썸네일 크기<select id="uiThumbSelect"><option value="small" ${settings.thumb==='small'?'selected':''}>작게</option><option value="normal" ${settings.thumb==='normal'?'selected':''}>기본</option><option value="large" ${settings.thumb==='large'?'selected':''}>크게</option></select></label>
        </div>
        <div class="auto-backup-section">
          <div class="auto-backup-head"><h3>자동 백업</h3><button id="makeBackupNow" type="button">지금 백업</button></div>
          <p>최근 ${MAX_BACKUPS}개까지 브라우저 안에 자동 보관해. 큰 작업이나 삭제/이동 뒤에도 새 백업이 만들어져.</p>
          <div id="autoBackupList" class="auto-backup-list">불러오는 중…</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.closest('[data-close]')) close(); });
    const update = () => saveSettings({
      accent: overlay.querySelector('#uiAccentSelect')?.value || 'red',
      density: overlay.querySelector('#uiDensitySelect')?.value || 'normal',
      thumb: overlay.querySelector('#uiThumbSelect')?.value || 'normal'
    });
    overlay.querySelectorAll('select').forEach((select) => select.addEventListener('change', update));
    const renderBackups = async () => {
      const list = await listAutoBackups();
      const holder = overlay.querySelector('#autoBackupList');
      if (!holder) return;
      holder.innerHTML = list.length ? list.map((item) => {
        const d = new Date(item.createdAt || item.id);
        const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        return `<div class="auto-backup-item"><div><strong>${S.escapeHTML(item.label || '자동 백업')}</strong><span>${S.escapeHTML(date)}</span></div><button type="button" data-restore-backup="${item.id}">복원</button></div>`;
      }).join('') : '<p>아직 자동 백업이 없어.</p>';
      holder.querySelectorAll('[data-restore-backup]').forEach((btn) => btn.addEventListener('click', () => restoreAutoBackup(btn.dataset.restoreBackup)));
    };
    overlay.querySelector('#makeBackupNow')?.addEventListener('click', async () => { await saveAutoBackup('수동 자동백업'); renderBackups(); });
    renderBackups();
  }

  function createUtilityButtons() {
    if (document.getElementById('appUtilityDock')) return;
    const dock = document.createElement('div');
    dock.id = 'appUtilityDock';
    dock.className = 'app-utility-dock';
    dock.innerHTML = `
      <button id="globalUndoBtn" type="button" title="실행 취소 (Ctrl+Alt+Z)">↶</button>
      <button id="shortcutHelpBtn" type="button" title="단축키 도움말 (?)">?</button>
      <button id="uiSettingsBtn" type="button" title="화면 설정 / 자동 백업">⚙</button>`;
    document.body.appendChild(dock);
    dock.querySelector('#globalUndoBtn')?.addEventListener('click', undoLastAction);
    dock.querySelector('#shortcutHelpBtn')?.addEventListener('click', openShortcutHelp);
    dock.querySelector('#uiSettingsBtn')?.addEventListener('click', openSettings);
    updateUndoButton();
  }

  function bindGlobalTracking() {
    // 명시적으로 추적하지 않은 태그/수정/복사 같은 작업도 실제 저장값이 바뀐 경우에만 실행 취소 기록을 만든다.
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('button');
      if (!button || button.closest('#appUtilityDock') || button.closest('#shortcutHelpModal') || button.closest('#uiSettingsModal')) return;
      const label = String(button.textContent || button.title || '작업').trim().slice(0, 40) || '작업';
      const pending = beginMutation(label);
      // 비동기 추가도 잡을 수 있도록, 저장값이 실제로 바뀔 때까지 잠깐 기다린다.
      [120, 900, 2600].forEach((delay, index, arr) => setTimeout(() => {
        if (!pendingMutation || pendingMutation !== pending) return;
        const changed = snapshotFingerprint(pending.before) !== snapshotFingerprint(takeSnapshot());
        if (changed) commitMutation(label);
        else if (index === arr.length - 1) pendingMutation = null;
      }, delay));
    }, true);

    document.addEventListener('drop', (event) => {
      if (!event.dataTransfer) return;
      beginMutation('드래그 작업');
      setTimeout(() => commitMutation('드래그 작업'), 160);
    }, true);

    document.addEventListener('beforeinput', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement) && !target?.isContentEditable) return;
      if (target.matches?.('[type="search"], #yt, #playlistImportInput, #pageSongSearchInput, #drawerPlaylistSearch')) return;
      beginMutation('텍스트 수정');
      clearTimeout(textMutationTimer);
      textMutationTimer = setTimeout(() => commitMutation('텍스트 수정'), 900);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'z') {
        event.preventDefault(); event.stopPropagation(); undoLastAction(); return;
      }
      const typing = event.target?.matches?.('input,textarea,select') || event.target?.isContentEditable;
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === '?' || (event.shiftKey && event.code === 'Slash'))) {
        event.preventDefault(); openShortcutHelp();
      }
    }, true);
  }

  function closeEnhanceModalsOnEscape() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      document.getElementById('shortcutHelpModal')?.remove();
      document.getElementById('uiSettingsModal')?.remove();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applySettings();
    createUtilityButtons();
    createBatchToolbar();
    bindBatchEvents();
    createPlaylistImporter();
    // drawer는 nav.js가 같은 DOMContentLoaded에서 먼저 렌더되므로 한 틱 뒤에 도구를 붙인다.
    setTimeout(createPlaylistDrawerTools, 0);
    setTimeout(() => saveAutoBackup('페이지 시작 상태'), 1600);
    closeEnhanceModalsOnEscape();
    syncSelectionUI();
  });

  bindGlobalTracking();

  window.AppEnhancements = {
    beginMutation,
    commitMutation,
    undoLastAction,
    saveAutoBackup,
    listAutoBackups,
    openShortcutHelp,
    openSettings,
    isSelected,
    toggleSelection,
    setSelectionMode,
    clearSelection,
    syncSelectionUI,
    batchCopy,
    batchMove
  };
})();
