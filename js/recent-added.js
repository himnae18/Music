(() => {
  const S = window.AppState;
  if (!S) return;
  const byKey = new Map();

  function videoKey(song) {
    const id = String(song?.id || S.extractID(song?.ytUrl || '') || '');
    if (id) return `id:${id}`;
    const url = S.safeLink(song?.ytUrl || '');
    return url ? `url:${url}` : `text:${song?.title || ''}|${song?.author || ''}`;
  }

  function collect() {
    byKey.clear();
    (S.ALL_STORES || []).forEach((store) => {
      S.cleanSongArray(S.readStorage(store.key)).forEach((song, index) => {
        const key = videoKey(song);
        const createdAt = Number(song.createdAt || song.addedAt || 0) || 0;
        const entry = { ...song, storeKey: store.key, sourceKey: store.key, collection: store, index, createdAt };
        const old = byKey.get(key);
        if (!old || (!old.createdAt && createdAt) || (createdAt && createdAt < old.createdAt)) byKey.set(key, entry);
      });
    });

    const playlists = S.readCustomPlaylists?.() || {};
    Object.entries(playlists).forEach(([name, songs]) => {
      S.cleanSongArray(songs).forEach((song, index) => {
        const key = videoKey(song);
        if (byKey.has(key)) return;
        byKey.set(key, {
          ...song,
          storeKey: `playlist:${name}`,
          sourceKey: `playlist:${name}`,
          collection: { key: `playlist:${name}`, label: `재생목록 · ${name}`, emoji: '📁', page: `tag.html?playlist=${encodeURIComponent(name)}` },
          index,
          createdAt: Number(song.createdAt || song.addedAt || 0) || 0
        });
      });
    });
    return [...byKey.values()].filter((song) => Number(song.createdAt || 0) > 0);
  }

  function fmt(ts) {
    const d = new Date(Number(ts || 0));
    if (Number.isNaN(d.getTime())) return '날짜 없음';
    return d.toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function pageHref(song) {
    const page = String(song?.collection?.page || 'index.html');
    return page;
  }

  function render() {
    const input = document.getElementById('recentAddSearch');
    const period = document.getElementById('recentAddPeriod')?.value || 'all';
    const sort = document.getElementById('recentAddSort')?.value || 'newest';
    const query = input?.value || '';
    const now = Date.now();
    let items = collect().filter((song) => S.songMatchesSearch?.(song, query) !== false);
    if (period === 'today') {
      const d = new Date();
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      items = items.filter((song) => Number(song.createdAt) >= start);
    } else if (/^\d+$/.test(period)) {
      const days = Number(period);
      items = items.filter((song) => Number(song.createdAt) >= now - days * 86400000);
    }
    items.sort((a, b) => sort === 'oldest' ? Number(a.createdAt) - Number(b.createdAt) : Number(b.createdAt) - Number(a.createdAt));
    document.getElementById('recentAddCount').textContent = `${items.length}개`;
    const list = document.getElementById('recentAddList');
    if (!items.length) {
      list.innerHTML = '<div class="added-empty-state">조건에 맞는 영상이 없어.</div>';
      return;
    }
    list.innerHTML = items.map((song, order) => {
      const id = song.id || S.extractID(song.ytUrl || '');
      const thumb = id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : '';
      const where = `${song.collection?.emoji || ''} ${song.collection?.label || song.storeKey || ''}`.trim();
      const tags = S.normalizeTags(song.tags).slice(0, 5);
      const yt = S.safeLink(song.ytUrl || '');
      return `<article class="recent-add-card">
        <div class="recent-add-order">${order + 1}</div>
        <div class="recent-add-thumb">${thumb ? `<img src="${S.escapeHTML(thumb)}" alt="">` : '<span>▶</span>'}</div>
        <div class="recent-add-meta">
          <strong>${S.escapeHTML(song.title || '제목 없음')}</strong>
          <span>${S.escapeHTML(song.author || '채널 정보 없음')} · ${S.escapeHTML(where)}</span>
          <small>최초 등록 ${S.escapeHTML(fmt(song.createdAt))}</small>
          <div class="recent-add-tags">${tags.map((tag) => `<span>#${S.escapeHTML(tag)}</span>`).join('')}</div>
        </div>
        <div class="recent-add-actions">
          <a href="${S.escapeHTML(pageHref(song))}">페이지</a>
          ${yt ? `<a href="${S.escapeHTML(yt)}" target="_blank" rel="noopener noreferrer">유튜브</a>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['recentAddSearch', 'recentAddPeriod', 'recentAddSort'].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener(id === 'recentAddSearch' ? 'input' : 'change', render);
    });
    render();
  });
})();
