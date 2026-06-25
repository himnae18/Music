// nav.js - 햄버거 메뉴 + 깔끔한 카테고리형 사이드 메뉴
(() => {
  function prefix() {
    const p = location.pathname;
    return (p.includes('/japan/') || p.includes('/china/') || p.includes('/korea/') || p.includes('/english/') || p.includes('/bgm/') || p.includes('/youtube/')) ? '../' : '';
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
        </div>
      </div>

      <div class="drawer-divider"></div>

      <a class="drawer-tag-link" href="${pre}tag.html">태그</a>
    `;

    drawer.querySelectorAll('[data-toggle-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.toggleTarget);
        target?.classList.toggle('open');
      });
    });
  }

  function openDrawer() {
    document.getElementById('drawer')?.classList.add('open');
    document.getElementById('drawerOverlay')?.classList.add('open');
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

  function updateDrawerCounts() {
    // 예전 코드와 연결되어 있어도 오류 안 나게 남겨둔 빈 함수야.
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
      }
    });
  });

  window.updateDrawerCounts = updateDrawerCounts;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
})();
