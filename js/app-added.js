(() => {
  const S = window.AppState;
  const $ = id => document.getElementById(id);
  const esc = S.escapeHTML;
  const size = 24;
  let page = 1;
  let records = [];
  const sourceName = key => (S.ALL_STORES || []).find(s => s.key === key)?.label || key || '기록 없음';
  const tagsOf = r => S.normalizeTags([...(r.tags || []), r.primaryTag || '']);
  function refresh() {
    records = S.readRemovedVideoArchive();
    const source = $('archiveSource').value, tag = $('archiveTag').value;
    $('archiveSource').innerHTML = '<option value="">전체 페이지</option>' + [...new Set(records.map(r => r.sourceStoreKey).filter(Boolean))].sort().map(key => `<option value="${esc(key)}">${esc(sourceName(key))}</option>`).join('');
    $('archiveTag').innerHTML = '<option value="">전체 태그</option><option value="__none">태그 없음</option>' + [...new Set(records.flatMap(tagsOf))].sort((a,b) => a.localeCompare(b,'ko')).map(tag => `<option value="${esc(tag)}">#${esc(tag)}</option>`).join('');
    $('archiveSource').value = [...$('archiveSource').options].some(o => o.value === source) ? source : '';
    $('archiveTag').value = [...$('archiveTag').options].some(o => o.value === tag) ? tag : '';
    render();
  }
  function render() {
    const query = $('archiveSearch').value.trim().toLocaleLowerCase();
    const source = $('archiveSource').value, tag = $('archiveTag').value;
    const list = records.filter(r => (!source || source === r.sourceStoreKey) && (!tag || (tag === '__none' ? !tagsOf(r).length : tagsOf(r).includes(tag))) && (!query || [r.title,r.author,r.lyrics,r.memo,...tagsOf(r)].join(' ').toLocaleLowerCase().includes(query)));
    const date = r => Date.parse(r.removedAt) || 0;
    const sort = $('archiveSort').value;
    list.sort((a,b) => sort === 'title' || sort === 'author' ? String(a[sort] || '').localeCompare(String(b[sort] || ''),'ko') : sort === 'old' ? date(a)-date(b) : date(b)-date(a));
    const pages = Math.max(1, Math.ceil(list.length / size));
    page = Math.min(page,pages);
    $('archiveCount').textContent = `전체 ${records.length}개 · 검색 결과 ${list.length}개`;
    $('archiveList').innerHTML = list.slice((page-1)*size,page*size).map(r => {
      const rawId = r.id || S.extractID(r.ytUrl);
      const id = /^[a-zA-Z0-9_-]{11}$/.test(rawId) ? rawId : '';
      const url = id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
      const time = date(r) ? new Date(date(r)).toLocaleDateString('ko-KR') : '날짜 없음';
      return `<article class="archive-card">${id ? `<img src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg" alt="" loading="lazy">` : ''}<div class="archive-card-body"><h2>${esc(r.title || '제목 없음')}</h2><div class="archive-meta">${esc(r.author || '채널 정보 없음')}<br>${esc(sourceName(r.sourceStoreKey))} · ${esc(time)}</div><div class="archive-tags">${tagsOf(r).map(t => `<button type="button" class="archive-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('') || '<span class="archive-meta">태그 없음</span>'}</div>${r.lyrics || r.memo ? `<details><summary>설명 / 메모 보기</summary><pre>${esc([r.lyrics,r.memo].filter(Boolean).join('\n\n'))}</pre></details>` : ''}${url ? `<a class="archive-watch" href="${esc(url)}" target="_blank" rel="noopener noreferrer">유튜브에서 보기 ↗</a>` : '<span class="archive-meta">영상 링크를 확인할 수 없어.</span>'}</div></article>`;
    }).join('') || `<p class="archive-empty">${records.length ? '조건에 맞는 영상이 없어.' : '아직 추가한 영상이 없어. 1~6P에서 영상 옆 빨간 추가 버튼을 눌러줘.'}</p>`;
    $('archivePageNumber').textContent = `${page} / ${pages}`;
    $('archivePrev').disabled = page <= 1;
    $('archiveNext').disabled = page >= pages;
  }
  ['archiveSearch','archiveSource','archiveTag','archiveSort'].forEach(id => $(id).addEventListener(id === 'archiveSearch' ? 'input' : 'change', () => {page=1;render();}));
  $('archiveReset').addEventListener('click', () => {['archiveSearch','archiveSource','archiveTag'].forEach(id => $(id).value='');$('archiveSort').value='new';page=1;render();});
  $('archivePrev').addEventListener('click', () => {page--;render();});
  $('archiveNext').addEventListener('click', () => {page++;render();});
  $('archiveList').addEventListener('click', event => {const button=event.target.closest('[data-tag]');if(button){$('archiveTag').value=button.dataset.tag;page=1;render();}});
  window.addEventListener('storage', refresh);
  window.addEventListener('focus', refresh);
  refresh();
})();
