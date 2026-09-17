// Two distinct inputs: playlist import above, single video below.
(() => {
  'use strict';
  function playlistID(value) {
    try {
      const url = new URL(value.trim());
      if (!/^https?:$/.test(url.protocol) || !/^(www\.|m\.|music\.)?youtube\.com$|^youtu\.be$/i.test(url.hostname)) return '';
      const id = url.searchParams.get('list') || '';
      return /^[\w-]+$/.test(id) ? id : '';
    } catch { return ''; }
  }
  window.parseYouTubePlaylistID = playlistID;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function readPlaylist(id, host) {
    for (let i = 0; !window.YT?.Player; i++) {
      if (i >= 60) throw new Error('유튜브에 연결하지 못했어. 인터넷 연결을 확인하고 다시 시도해 줘.');
      await delay(250);
    }
    return new Promise((resolve, reject) => {
      let player, poll, done = false, previous = '', stable = 0;
      const finish = (error, ids) => {
        if (done) return;
        done = true;
        clearInterval(poll); clearTimeout(timeout);
        try { player?.destroy(); } catch {}
        host.replaceChildren();
        error ? reject(error) : resolve(ids);
      };
      const timeout = setTimeout(() => finish(new Error('재생목록을 읽지 못했어. 공개 여부와 링크를 확인해 줘. 유튜브에서 불러올 수 없는 목록은 추가되지 않아.')), 25000);
      const slot = document.createElement('div'); host.append(slot);
      player = new YT.Player(slot, {
        width: '100%', height: '220',
        playerVars: { autoplay: 0, playsinline: 1 },
        events: {
          onReady: event => {
            event.target.cuePlaylist({ listType: 'playlist', list: id, index: 0 });
            poll = setInterval(() => {
              const ids = event.target.getPlaylist?.() || [];
              const key = ids.join(',');
              stable = key && key === previous ? stable + 1 : 0;
              previous = key;
              if (ids.length && stable >= 4) finish(null, [...new Set(ids.filter(v => /^[\w-]{11}$/.test(v)))]);
            }, 400);
          },
          // An unavailable first video need not make the entire list unavailable.
          onError: () => {}
        }
      });
    });
  }
  let importing = false;
  function install() {
    document.querySelectorAll('#yt, #tagPlayerAddUrl').forEach(single => {
      const row = single.closest('.add-song-row, .tag-player-add-row');
      if (!row || row.previousElementSibling?.classList.contains('playlist-import-box')) return;
      const box = document.createElement('div'); box.className = 'playlist-import-box';
      box.innerHTML = '<div class="playlist-import-row"><label>재생목록<input type="url" placeholder="유튜브 재생목록 링크 (list= 포함)" aria-label="유튜브 재생목록 링크"></label><button type="button">추가</button></div><p class="playlist-import-status" role="status"></p><div class="playlist-import-preview"></div>';
      row.before(box);
      single.placeholder = '영상 한 개만 추가';
      single.setAttribute('aria-label', '유튜브 영상 한 개 링크');
      const input = box.querySelector('input'), button = box.querySelector('button');
      const status = box.querySelector('[role="status"]');
      const run = async () => {
        if (importing) return;
        const id = playlistID(input.value);
        if (!id) { status.textContent = 'list=가 포함된 유튜브 재생목록 링크를 넣어 줘.'; return; }
        importing = true; button.disabled = true; input.disabled = true;
        let added = 0, skipped = 0;
        const S = window.AppState;
        const params = new URLSearchParams(location.search);
        const playlist = params.get('playlist') || (S.isPlaylistTag?.(params.get('tag')) ? params.get('tag') : '');
        const tags = S.normalizeTags(document.getElementById('tagPlayerAddExtraTags')?.value || '');
        const tag = params.get('tag');
        if (tag && !playlist) tags.push(tag);
        const storeKey = document.getElementById('tagPlayerAddStore')?.value || S.storeKey;
        try {
          status.textContent = '재생목록을 불러오는 중…';
          const ids = await readPlaylist(id, box.querySelector('.playlist-import-preview'));
          if (!ids.length) throw new Error('추가할 수 있는 영상을 찾지 못했어.');
          for (let i = 0; i < ids.length; i++) {
            status.textContent = `영상 추가 중 ${i + 1}/${ids.length} · 추가 ${added} · 건너뜀 ${skipped}`;
            const ytUrl = `https://www.youtube.com/watch?v=${ids[i]}`;
            const result = playlist
              ? await S.addVideoToCustomPlaylist({ ytUrl, playlist, tags })
              : await S.addVideoToStoreWithTags({ ytUrl, storeKey, tags });
            if (result?.ok && !result.alreadyIncluded) added++; else skipped++;
          }
          input.value = '';
          status.textContent = `추가 완료: ${added}개 · 중복/취소 ${skipped}개. 유튜브에서 제공한 ${ids.length}개 기준이며 비공개·삭제 영상 등은 누락될 수 있어.`;
        } catch (error) {
          status.textContent = `${error.message || '추가 중 오류가 발생했어.'}${added ? ` 이미 추가된 ${added}개는 저장했어.` : ''}`;
        } finally {
          importing = false; button.disabled = false; input.disabled = false;
          if (playlist) S.setSongsRaw?.(S.readCustomPlaylistSongs(playlist));
          window.showList?.(); window.updateDrawerCounts?.();
        }
      };
      button.addEventListener('click', run);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(); } });
      // Keep the parent single-video drop handler from consuming playlist drops.
      box.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
      box.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); input.value = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n').find(x => x && !x.startsWith('#')) || ''; run(); });
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    install();
    new MutationObserver(install).observe(document.body, { childList: true, subtree: true });
  });
})();
