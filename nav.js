// nav.js - 햄버거 메뉴 + 카테고리형 사이드 메뉴 + 사용자 재생목록
(() => {
  function prefix() {
    const p = location.pathname;
    return (p.includes('/japan/') || p.includes('/china/') || p.includes('/korea/') || p.includes('/english/') || p.includes('/bgm/') || p.includes('/youtube/')) ? '../' : '';
  }

  function state() {
    return window.AppState || null;
  }

  function escapeHTML(value) {
    const S = state();
    if (S?.escapeHTML) return S.escapeHTML(value);
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function playlistTagUrl(tag) {
    return `${prefix()}tag.html?playlist=${encodeURIComponent(tag)}`;
  }

  function getPlaylistTags() {
    const S = state();
    return typeof S?.readPlaylistTags === 'function' ? S.readPlaylistTags() : [];
  }

  function customPlaylistLinksHTML() {
    const tags = getPlaylistTags();
    if (!tags.length) {
      return `<div class="drawer-playlist-empty">+ 버튼으로 목록을 만들 수 있어</div>`;
    }

    return tags.map((tag) => `
      <a class="drawer-menu-link drawer-playlist-link"
         href="${playlistTagUrl(tag)}"
         data-playlist-drop-name="${escapeHTML(tag)}"
         title="#${escapeHTML(tag)} 재생목록">
        <span>${escapeHTML(tag)}</span><span>›</span>
      </a>
    `).join('');
  }

  function renderCustomPlaylistLinks() {
    const holder = document.getElementById('drawerCustomPlaylistList');
    if (!holder) return;
    holder.innerHTML = customPlaylistLinksHTML();
    bindPlaylistDropTargets(holder);
  }

  function setPlaylistCreateMessage(message = '', isError = false) {
    const el = document.getElementById('drawerPlaylistCreateMessage');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
  }

  function hidePlaylistCreate() {
    const box = document.getElementById('drawerPlaylistCreateBox');
    const input = document.getElementById('drawerPlaylistNameInput');
    if (box) box.hidden = true;
    if (input) input.value = '';
    setPlaylistCreateMessage('');
  }

  function showPlaylistCreate() {
    const box = document.getElementById('drawerPlaylistCreateBox');
    const input = document.getElementById('drawerPlaylistNameInput');
    if (!box) return;
    box.hidden = false;
    setPlaylistCreateMessage('');
    setTimeout(() => input?.focus(), 0);
  }

  function createCustomPlaylist() {
    const S = state();
    const input = document.getElementById('drawerPlaylistNameInput');
    if (!S || !input) return;

    const clean = typeof S.normalizeTag === 'function'
      ? S.normalizeTag(input.value || '')
      : String(input.value || '').trim().replace(/^#+/, '').replace(/\s+/g, '');

    if (!clean) {
      setPlaylistCreateMessage('목록 이름을 입력해줘.', true);
      input.focus();
      return;
    }

    const existed = getPlaylistTags().includes(clean);
    S.registerPlaylistTag?.(clean);
    renderCustomPlaylistLinks();

    if (existed) {
      setPlaylistCreateMessage('이미 있는 재생목록이야.', true);
      input.select();
      return;
    }

    input.value = '';
    hidePlaylistCreate();
  }

  function parseDraggedSong(e) {
    const raw = e.dataTransfer?.getData('application/x-library-song') || '';
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function bindPlaylistDropTargets(root = document) {
    root.querySelectorAll?.('[data-playlist-drop-name]').forEach((link) => {
      if (link.dataset.playlistDropBound === '1') return;
      link.dataset.playlistDropBound = '1';

      link.addEventListener('dragover', (e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes('application/x-library-song')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        link.classList.add('is-playlist-dragover');
      });

      link.addEventListener('dragleave', () => {
        link.classList.remove('is-playlist-dragover');
      });

      link.addEventListener('drop', (e) => {
        const payload = parseDraggedSong(e);
        if (!payload) return;
        e.preventDefault();
        e.stopPropagation();
        link.classList.remove('is-playlist-dragover');

        const tag = link.getAttribute('data-playlist-drop-name') || '';
        const S = state();
        const result = S?.addSongCopyToPlaylist?.(payload, tag);
        if (!result?.ok) {
          link.classList.add('is-playlist-drop-error');
          setTimeout(() => link.classList.remove('is-playlist-drop-error'), 700);
          return;
        }

        link.classList.add('is-playlist-drop-success');
        setTimeout(() => link.classList.remove('is-playlist-drop-success'), 700);

        // 재생목록은 별도 저장소이므로 원본 페이지는 수정하지 않는다.
        try { window.renderTagIndex?.(); } catch {}
      });
    });
  }

  function bindPlaylistCreateUI(drawer) {
    const addBtn = drawer.querySelector('#drawerPlaylistAddBtn');
    const saveBtn = drawer.querySelector('#drawerPlaylistCreateSave');
    const cancelBtn = drawer.querySelector('#drawerPlaylistCreateCancel');
    const input = drawer.querySelector('#drawerPlaylistNameInput');

    addBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const box = document.getElementById('drawerPlaylistCreateBox');
      if (box?.hidden) showPlaylistCreate();
      else hidePlaylistCreate();
    });
    saveBtn?.addEventListener('click', createCustomPlaylist);
    cancelBtn?.addEventListener('click', hidePlaylistCreate);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        createCustomPlaylist();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hidePlaylistCreate();
      }
    });
  }

  function renderDrawer() {
    const drawer = document.getElementById('drawer');
    if (!drawer) return;

    const pre = prefix();
    drawer.innerHTML = `
      <a class="drawer-menu-link drawer-home-link drawer-home-top" href="${pre}index.html"><span>🏠 메인으로</span><span>›</span></a>

      <div class="drawer-divider"></div>

      <div class="drawer-menu-block">
        <button class="drawer-category drawer-category-song" type="button" data-toggle-target="drawerSongGroup">
          노래
        </button>
        <div id="drawerSongGroup" class="drawer-link-group open">
          <a class="drawer-menu-link" href="${pre}japan/jaindex.html"><span>일본어</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}china/cnindex.html"><span>중국어</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}korea/krindex.html"><span>한국어</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}english/enindex.html"><span>영어</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}bgm/bgmindex.html"><span>브금</span><span>›</span></a>
        </div>
      </div>

      <div class="drawer-divider"></div>

      <div class="drawer-menu-block">
        <button class="drawer-category drawer-category-youtube" type="button" data-toggle-target="drawerYoutubeGroup">
          유튜브 영상
        </button>
        <div id="drawerYoutubeGroup" class="drawer-link-group open">
          <a class="drawer-menu-link" href="${pre}youtube/1p.html"><span>1P</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}youtube/2p.html"><span>2P</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}youtube/3p.html"><span>3P</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}youtube/4p.html"><span>4P</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}youtube/5p.html"><span>5P</span><span>›</span></a>
          <a class="drawer-menu-link" href="${pre}youtube/6p.html"><span>6P</span><span>›</span></a>
        </div>
      </div>

      <div class="drawer-divider drawer-playlist-divider"></div>

      <div class="drawer-menu-block drawer-custom-playlist-block">
        <div class="drawer-playlist-category">
          <button class="drawer-category drawer-category-playlist" type="button" data-toggle-target="drawerCustomPlaylistList">
            재생목록
          </button>
          <button id="drawerPlaylistAddBtn" class="drawer-playlist-add-btn" type="button" title="새 재생목록 추가" aria-label="새 재생목록 추가">+</button>
        </div>
        <div id="drawerCustomPlaylistList" class="drawer-link-group open">
          ${customPlaylistLinksHTML()}
        </div>
        <div id="drawerPlaylistCreateBox" class="drawer-playlist-create-box" hidden>
          <input id="drawerPlaylistNameInput" type="text" maxlength="50" autocomplete="off" placeholder="재생목록 이름" />
          <p class="drawer-playlist-create-help">이 이름으로 별도 재생목록이 저장되고, 일본곡에서는 같은 이름의 재생목록 태그로 자동 추가할 수 있어.</p>
          <div class="drawer-playlist-create-actions">
            <button id="drawerPlaylistCreateCancel" type="button">취소</button>
            <button id="drawerPlaylistCreateSave" type="button">추가</button>
          </div>
          <div id="drawerPlaylistCreateMessage" class="drawer-playlist-create-message" aria-live="polite"></div>
        </div>
      </div>

      <div class="drawer-divider"></div>

      <a class="drawer-tag-link" href="${pre}tag.html">태그</a>
      <a class="drawer-lyrics-link" href="${pre}lyrics.html">가사</a>
    `;

    drawer.querySelectorAll('[data-toggle-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.toggleTarget);
        target?.classList.toggle('open');
      });
    });

    bindPlaylistCreateUI(drawer);
    bindPlaylistDropTargets(drawer);
  }

  function openDrawer() {
    document.getElementById('drawer')?.classList.add('open');
    document.getElementById('drawerOverlay')?.classList.add('open');
    renderCustomPlaylistLinks();
  }

  function closeDrawer() {
    document.getElementById('drawer')?.classList.remove('open');
    document.getElementById('drawerOverlay')?.classList.remove('open');
  }

  function toggleDrawer() {
    const drawer = document.getElementById('drawer');
    if (drawer?.classList.contains('open')) closeDrawer();
    else openDrawer();
  }

  function goShortcutPage(page) {
    location.href = `${prefix()}${page}`;
  }

  function openFivePDrawerOrPage() {
    if (typeof window.openLyricsDrawer === 'function' && document.getElementById('lyricsDrawer')) {
      window.openLyricsDrawer('fivep');
      return;
    }
    goShortcutPage('youtube/5p.html');
  }

  function openSixPDrawerOrPage() {
    if (typeof window.openLyricsDrawer === 'function' && document.getElementById('lyricsDrawer')) {
      window.openLyricsDrawer('sixp');
      return;
    }
    goShortcutPage('youtube/6p.html');
  }

  function updateDrawerCounts() {
    renderCustomPlaylistLinks();
  }

  function isTypingTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderDrawer();
    document.getElementById('hamburgerBtn')?.addEventListener('click', toggleDrawer);
    document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
        return;
      }

      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        toggleDrawer();
        return;
      }

      const code = e.code || '';
      const key = String(e.key || '').toLowerCase();

      if (e.shiftKey && code === 'Digit5') {
        e.preventDefault();
        goShortcutPage('youtube/5p.html');
        return;
      }

      if (e.shiftKey && code === 'Digit6') {
        e.preventDefault();
        goShortcutPage('youtube/6p.html');
        return;
      }

      if (!e.shiftKey) {
        if (key === 'a') { e.preventDefault(); goShortcutPage('japan/jaindex.html'); return; }
        if (key === 's') { e.preventDefault(); goShortcutPage('china/cnindex.html'); return; }
        if (key === 'd') { e.preventDefault(); goShortcutPage('korea/krindex.html'); return; }
        if (key === 'f') { e.preventDefault(); goShortcutPage('english/enindex.html'); return; }
        if (key === '1') { e.preventDefault(); goShortcutPage('youtube/1p.html'); return; }
        if (key === '2') { e.preventDefault(); goShortcutPage('youtube/2p.html'); return; }
        if (key === '3') { e.preventDefault(); goShortcutPage('youtube/3p.html'); return; }
        if (key === '4') { e.preventDefault(); goShortcutPage('youtube/4p.html'); return; }
        if (key === '5') { e.preventDefault(); openFivePDrawerOrPage(); return; }
        if (key === '6') { e.preventDefault(); openSixPDrawerOrPage(); return; }
      }
    });
  });

  window.updateDrawerCounts = updateDrawerCounts;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.renderCustomPlaylistLinks = renderCustomPlaylistLinks;
})();
