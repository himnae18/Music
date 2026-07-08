// js/app-state.js - 저장소/공통 유틸 + 통합 노래함/태그
(() => {
  const storeKey = document.body?.dataset?.store || "main";

  const COUNTRY_STORES = [
    { key: "jaSongs", label: "일본어", emoji: "🇯🇵", page: "japan/jaindex.html", old: ["jaBright", "jaMid", "jaDark", "jpBright", "jpMid", "jpDark"], mood: { jaBright: "밝은곡", jpBright: "밝은곡", jaMid: "중간곡", jpMid: "중간곡", jaDark: "어두운곡", jpDark: "어두운곡" } },
    { key: "cnSongs", label: "중국어", emoji: "🇨🇳", page: "china/cnindex.html", old: ["cnBright", "cnMid", "cnDark"], mood: { cnBright: "밝은곡", cnMid: "중간곡", cnDark: "어두운곡" } },
    { key: "krSongs", label: "한국어", emoji: "🇰🇷", page: "korea/krindex.html", old: ["krBright", "krMid", "krDark"], mood: { krBright: "밝은곡", krMid: "중간곡", krDark: "어두운곡" } },
    { key: "enSongs", label: "영어", emoji: "🇺🇸", page: "english/enindex.html", old: [], mood: {} },
    { key: "bgmSongs", label: "브금", emoji: "🎼", page: "bgm/bgmindex.html", old: [], mood: {} }
  ];

  const YOUTUBE_STORES = [
    { key: "yt1pVideos", label: "유튜브 영상 1P", emoji: "📺", page: "youtube/1p.html" },
    { key: "yt2pVideos", label: "유튜브 영상 2P", emoji: "📺", page: "youtube/2p.html" },
    { key: "yt3pVideos", label: "유튜브 영상 3P", emoji: "📺", page: "youtube/3p.html" },
    { key: "yt4pVideos", label: "유튜브 영상 4P", emoji: "📺", page: "youtube/4p.html" },
    { key: "yt5pVideos", label: "유튜브 영상 5P", emoji: "📺", page: "youtube/5p.html" },
    { key: "yt6pVideos", label: "유튜브 영상 6P", emoji: "📺", page: "youtube/6p.html" }
  ];

  const ALL_STORES = [...COUNTRY_STORES, ...YOUTUBE_STORES];
  const TITLE_TAGS_KEY = "musicTitleTags";
  const TITLE_SHARED_TEXT_KEY = "musicTitleSharedLyrics";
  const TITLE_FIXED_TAGS_KEY = "musicTitleFixedTags";
  const TAG_KINDS_KEY = "musicTagKinds";
  const PLAYLIST_TAGS_KEY = "musicPlaylistTags";
  const TAG_SHARED_DESCRIPTION_KEY = "musicTagSharedDescriptions";
  const REMOVED_VIDEO_ARCHIVE_KEY = "musicRemovedVideoArchive";
  const TITLE_SHARED_TEXT_FIELDS = ["lyrics", "lyricsOriginal", "lyricsPronunciation", "lyricsMeaning", "memo", "original"];
  const TAG_KIND_OPTIONS = [
    { key: "song", label: "노래전용" },
    { key: "lecture", label: "강의전용" },
    { key: "general", label: "일반(유머)" },
    { key: "pretty", label: "이쁜거(뮤비/일러)" },
    { key: "other", label: "기타" },
    { key: "playlist", label: "재생목록" }
  ];

  function readStorage(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key)) || [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  }

  function safeText(v) {
    if (v === undefined || v === null) return "";
    return String(v).trim();
  }

  function safeLink(url) {
    if (!url) return "";
    return String(url).trim();
  }

  function escapeHTML(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function extractID(url) {
    if (!url) return "";

    try {
      const u = new URL(url);
      const v = u.searchParams.get("v");
      if (v) return v;

      if (u.hostname.includes("youtu.be")) {
        return u.pathname.split("/").filter(Boolean)[0] || "";
      }

      const parts = u.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      const embedIndex = parts.indexOf("embed");
      if (shortsIndex !== -1 && parts[shortsIndex + 1]) return parts[shortsIndex + 1];
      if (embedIndex !== -1 && parts[embedIndex + 1]) return parts[embedIndex + 1];
    } catch {
      const text = String(url);
      const match =
        text.match(/[?&]v=([^&]+)/) ||
        text.match(/youtu\.be\/([^?&]+)/) ||
        text.match(/youtube\.com\/shorts\/([^?&]+)/) ||
        text.match(/youtube\.com\/embed\/([^?&]+)/);
      return match ? match[1] : "";
    }

    return "";
  }

  function normalizeTag(tag) {
    return safeText(tag).replace(/^#+/, "").replace(/\s+/g, "");
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) {
      return [...new Set(value.map(normalizeTag).filter(Boolean))];
    }
    return [...new Set(String(value || "")
      .split(/[#,，、\n\t ]+/)
      .map(normalizeTag)
      .filter(Boolean))];
  }

  function normalizeVideoAspect(value) {
    const text = String(value || "").trim().toLowerCase();
    if (["portrait", "vertical", "세로", "9:16", "1080x1920"].includes(text)) return "portrait";
    if (["landscape", "horizontal", "가로", "16:9", "1920x1080"].includes(text)) return "landscape";
    return "";
  }

  function addTags(existing, extra) {
    return normalizeTags([...(Array.isArray(existing) ? existing : normalizeTags(existing)), ...normalizeTags(extra)]);
  }

  function normalizeSearchText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function getSearchTerms(query) {
    return String(query ?? "")
      .split(/\s+/)
      .map(normalizeSearchText)
      .filter(Boolean);
  }

  function makeSongSearchHaystack(song) {
    const parts = [
      safeText(song?.title),
      safeText(song?.author),
      ...normalizeTags(song?.tags)
    ];
    return normalizeSearchText(parts.join(" "));
  }

  function songMatchesSearch(song, query) {
    const terms = getSearchTerms(query);
    if (!terms.length) return true;
    const haystack = makeSongSearchHaystack(song);
    return terms.every((term) => haystack.includes(term));
  }

  function searchSongs(query, scopeKey = "all") {
    const source = scopeKey && scopeKey !== "all"
      ? cleanSongArray(readStorage(scopeKey)).map((song, index) => ({ ...song, storeKey: scopeKey, index }))
      : getAllSongs();
    return source.filter((song) => songMatchesSearch(song, query));
  }

  function readTitleTags() {
    try {
      const data = JSON.parse(localStorage.getItem(TITLE_TAGS_KEY) || "[]");
      return normalizeTags(Array.isArray(data) ? data : []);
    } catch {
      return [];
    }
  }

  function writeTitleTags(tags) {
    localStorage.setItem(TITLE_TAGS_KEY, JSON.stringify(normalizeTags(tags)));
  }

  function isTitleTag(tag) {
    const clean = normalizeTag(tag);
    return !!clean && readTitleTags().includes(clean);
  }

  function readTitleSharedText() {
    try {
      const data = JSON.parse(localStorage.getItem(TITLE_SHARED_TEXT_KEY) || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) return {};

      const result = {};
      Object.entries(data).forEach(([rawTag, rawRecord]) => {
        const tag = normalizeTag(rawTag);
        if (!tag || !rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) return;
        const record = {};
        TITLE_SHARED_TEXT_FIELDS.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(rawRecord, field)) record[field] = String(rawRecord[field] ?? "");
        });
        if (Object.keys(record).length > 0) result[tag] = record;
      });
      return result;
    } catch {
      return {};
    }
  }

  function writeTitleSharedText(data) {
    const cleanData = {};
    if (data && typeof data === "object" && !Array.isArray(data)) {
      Object.entries(data).forEach(([rawTag, rawRecord]) => {
        const tag = normalizeTag(rawTag);
        if (!tag || !rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) return;
        const record = {};
        TITLE_SHARED_TEXT_FIELDS.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(rawRecord, field)) record[field] = String(rawRecord[field] ?? "");
        });
        if (Object.keys(record).length > 0) cleanData[tag] = record;
      });
    }
    localStorage.setItem(TITLE_SHARED_TEXT_KEY, JSON.stringify(cleanData));
  }


  function readTagSharedDescriptions() {
    try {
      const data = JSON.parse(localStorage.getItem(TAG_SHARED_DESCRIPTION_KEY) || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) return {};
      const result = {};
      Object.entries(data).forEach(([rawTag, rawValue]) => {
        const tag = normalizeTag(rawTag);
        if (!tag) return;
        result[tag] = String(rawValue ?? "");
      });
      return result;
    } catch {
      return {};
    }
  }

  function writeTagSharedDescriptions(data) {
    const cleanData = {};
    if (data && typeof data === "object" && !Array.isArray(data)) {
      Object.entries(data).forEach(([rawTag, rawValue]) => {
        const tag = normalizeTag(rawTag);
        if (!tag) return;
        cleanData[tag] = String(rawValue ?? "");
      });
    }
    localStorage.setItem(TAG_SHARED_DESCRIPTION_KEY, JSON.stringify(cleanData));
  }

  function getTagSharedDescription(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return "";
    return String(readTagSharedDescriptions()[clean] ?? "");
  }

  function setTagSharedDescription(tag, value) {
    const clean = normalizeTag(tag);
    if (!clean) return false;
    const data = readTagSharedDescriptions();
    data[clean] = String(value ?? "");
    writeTagSharedDescriptions(data);
    return true;
  }

  function appendTagSharedDescription(tag, value) {
    const clean = normalizeTag(tag);
    const text = String(value ?? "");
    if (!clean || !text) return false;
    const prev = getTagSharedDescription(clean).trimEnd();
    const next = prev ? `${prev}

${text}` : text;
    return setTagSharedDescription(clean, next);
  }

  function readRemovedVideoArchive() {
    try {
      const data = JSON.parse(localStorage.getItem(REMOVED_VIDEO_ARCHIVE_KEY) || "[]");
      if (!Array.isArray(data)) return [];
      return data.map((item) => ({
        title: String(item?.title || "제목 없음"),
        author: String(item?.author || ""),
        ytUrl: safeLink(item?.ytUrl || item?.url || ""),
        id: String(item?.id || extractID(item?.ytUrl || item?.url || "") || ""),
        lyrics: String(item?.lyrics || ""),
        memo: String(item?.memo || ""),
        original: String(item?.original || ""),
        tags: normalizeTags(item?.tags),
        primaryTag: normalizeTag(item?.primaryTag || ""),
        sourceStoreKey: String(item?.sourceStoreKey || ""),
        sourceIndex: Number.isFinite(Number(item?.sourceIndex)) ? Number(item.sourceIndex) : -1,
        removedAt: String(item?.removedAt || "")
      })).filter((item) => item.id || item.ytUrl);
    } catch {
      return [];
    }
  }

  function writeRemovedVideoArchive(list) {
    const clean = Array.isArray(list) ? list.map((item) => ({
      title: String(item?.title || "제목 없음"),
      author: String(item?.author || ""),
      ytUrl: safeLink(item?.ytUrl || item?.url || ""),
      id: String(item?.id || extractID(item?.ytUrl || item?.url || "") || ""),
      lyrics: String(item?.lyrics || ""),
      memo: String(item?.memo || ""),
      original: String(item?.original || ""),
      tags: normalizeTags(item?.tags),
      primaryTag: normalizeTag(item?.primaryTag || ""),
      sourceStoreKey: String(item?.sourceStoreKey || ""),
      sourceIndex: Number.isFinite(Number(item?.sourceIndex)) ? Number(item.sourceIndex) : -1,
      removedAt: String(item?.removedAt || "")
    })).filter((item) => item.id || item.ytUrl) : [];
    localStorage.setItem(REMOVED_VIDEO_ARCHIVE_KEY, JSON.stringify(clean));
  }

  function removedVideoMatches(record, { ytUrl = "", id = "", title = "" } = {}) {
    const cleanUrl = safeLink(ytUrl);
    const cleanId = safeText(id) || extractID(cleanUrl);
    const recordId = String(record?.id || extractID(record?.ytUrl) || "");
    if (cleanId && recordId && cleanId === recordId) return true;
    if (cleanUrl && safeLink(record?.ytUrl) === cleanUrl) return true;
    const titleKey = normalizeDuplicateTitle(title);
    return !!(titleKey && normalizeDuplicateTitle(record?.title) === titleKey);
  }

  function findRemovedVideoRecord({ ytUrl = "", id = "", title = "", storeKey: wantedStoreKey = "" } = {}) {
    const list = readRemovedVideoArchive().filter((record) => removedVideoMatches(record, { ytUrl, id, title }));
    const scoped = wantedStoreKey ? list.filter((record) => !record.sourceStoreKey || record.sourceStoreKey === wantedStoreKey) : list;
    return [...(scoped.length ? scoped : list)].sort((a, b) => String(b.removedAt).localeCompare(String(a.removedAt)))[0] || null;
  }

  function formatArchiveDateText(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yy}.${mm}.${dd}`;
  }

  function buildTagArchiveDescriptionBlock(record) {
    if (!record) return "";
    const dateText = formatArchiveDateText(record.removedAt || new Date());
    const title = String(record.title || "제목 없음");
    const url = safeLink(record.ytUrl);
    const desc = String(record.lyrics || "").trim();
    return [
      "============",
      "",
      `${dateText} /`,
      `${title} / ${url}`,
      "",
      desc,
      "",
      "============"
    ].join("\n");
  }

  function archiveRemovedVideo(song, options = {}) {
    if (!song) return null;
    const cleanSongData = cleanSong(song) || cleanSong({ title: song?.title || "제목 없음", ytUrl: song?.ytUrl || "", tags: song?.tags || [] });
    if (!cleanSongData) return null;
    const firstTag = normalizeTags(cleanSongData.tags)[0] || "";
    const removedAt = options.removedAt || new Date().toISOString();
    const record = {
      ...cleanSongData,
      primaryTag: firstTag,
      sourceStoreKey: String(options.sourceStoreKey || options.storeKey || storeKey || ""),
      sourceIndex: Number.isFinite(Number(options.sourceIndex)) ? Number(options.sourceIndex) : -1,
      removedAt
    };

    const list = readRemovedVideoArchive().filter((item) => !removedVideoMatches(item, record));
    list.unshift(record);
    writeRemovedVideoArchive(list);

    if (firstTag) appendTagSharedDescription(firstTag, buildTagArchiveDescriptionBlock(record));
    return record;
  }

  function renameTagEverywhere(oldTag, newTag) {
    const oldClean = normalizeTag(oldTag);
    const newClean = normalizeTag(newTag);
    if (!oldClean || !newClean) return { ok: false, reason: "invalid" };
    if (oldClean === newClean) return { ok: true, same: true, tag: newClean };

    ALL_STORES.forEach((store) => {
      const arr = cleanSongArray(readStorage(store.key));
      let changed = false;
      arr.forEach((song) => {
        const tags = normalizeTags(song.tags);
        if (!tags.includes(oldClean)) return;
        song.tags = addTags(tags.filter((item) => item !== oldClean), [newClean]);
        changed = true;
      });
      if (changed) writeStorage(store.key, arr);
    });

    try {
      if (Array.isArray(songs)) {
        songs.forEach((song) => {
          const tags = normalizeTags(song.tags);
          if (!tags.includes(oldClean)) return;
          song.tags = addTags(tags.filter((item) => item !== oldClean), [newClean]);
        });
      }
    } catch {}

    const titleTags = readTitleTags();
    if (titleTags.includes(oldClean)) writeTitleTags(addTags(titleTags.filter((item) => item !== oldClean), [newClean]));

    const playlistTags = readPlaylistTags();
    if (playlistTags.includes(oldClean)) writePlaylistTags(addTags(playlistTags.filter((item) => item !== oldClean), [newClean]));

    const tagKinds = readTagKinds();
    if (tagKinds[oldClean]) {
      tagKinds[newClean] = tagKinds[oldClean];
      delete tagKinds[oldClean];
      writeTagKinds(tagKinds);
    }

    const fixed = readTitleFixedTags();
    const nextFixed = {};
    Object.entries(fixed).forEach(([rawKey, rawTags]) => {
      const key = normalizeTag(rawKey) === oldClean ? newClean : normalizeTag(rawKey);
      const values = addTags(normalizeTags(rawTags).filter((item) => item !== oldClean), normalizeTags(rawTags).includes(oldClean) ? [newClean] : []);
      if (key) nextFixed[key] = values;
    });
    writeTitleFixedTags(nextFixed);

    const shared = readTitleSharedText();
    if (shared[oldClean]) {
      shared[newClean] = shared[oldClean];
      delete shared[oldClean];
      writeTitleSharedText(shared);
    }

    const tagDescriptions = readTagSharedDescriptions();
    if (Object.prototype.hasOwnProperty.call(tagDescriptions, oldClean)) {
      tagDescriptions[newClean] = tagDescriptions[oldClean];
      delete tagDescriptions[oldClean];
      writeTagSharedDescriptions(tagDescriptions);
    }

    const archive = readRemovedVideoArchive().map((item) => ({
      ...item,
      tags: addTags(normalizeTags(item.tags).filter((tag) => tag !== oldClean), normalizeTags(item.tags).includes(oldClean) ? [newClean] : []),
      primaryTag: normalizeTag(item.primaryTag) === oldClean ? newClean : normalizeTag(item.primaryTag)
    }));
    writeRemovedVideoArchive(archive);

    return { ok: true, tag: newClean };
  }

  function openArchivedDuplicateDialog(record) {
    return new Promise((resolve) => {
      const existing = document.getElementById("archiveDuplicateDialog");
      if (existing) existing.remove();

      const overlay = document.createElement("div");
      overlay.id = "archiveDuplicateDialog";
      overlay.className = "archive-duplicate-overlay";
      overlay.innerHTML = `
        <div class="archive-duplicate-box">
          <h3>이미 추가되었던 영상이야</h3>
          <p class="archive-duplicate-sub">다시 추가할지 선택해줘.</p>
          <div class="archive-duplicate-summary">
            <strong>${escapeHTML(record?.title || "제목 없음")}</strong>
            <span>${escapeHTML(formatArchiveDateText(record?.removedAt || new Date()))}</span>
          </div>
          <div class="archive-duplicate-actions">
            <button type="button" class="archive-duplicate-btn no-btn" data-archive-action="cancel">아니요</button>
            <button type="button" class="archive-duplicate-btn memo-btn" data-archive-action="memo">메모보기</button>
            <button type="button" class="archive-duplicate-btn add-btn" data-archive-action="add">추가할거임</button>
          </div>
          <div class="archive-duplicate-memo" hidden>
            <div><b>설명</b><pre>${escapeHTML(String(record?.lyrics || ""))}</pre></div>
            <div><b>메모</b><pre>${escapeHTML(String(record?.memo || ""))}</pre></div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const memoBox = overlay.querySelector('.archive-duplicate-memo');
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
        const btn = e.target.closest('[data-archive-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-archive-action');
        if (action === 'memo') {
          if (memoBox) memoBox.hidden = !memoBox.hidden;
          return;
        }
        overlay.remove();
        resolve(action === 'add');
      });
    });
  }

  function getSongTitleTag(song) {
    const titleTags = readTitleTags();
    if (!song || titleTags.length === 0) return "";
    return normalizeTags(song.tags).find((tag) => titleTags.includes(tag)) || "";
  }

  function getTitleSharedRecord(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return {};
    const data = readTitleSharedText();
    const record = data[clean];
    return record && typeof record === "object" && !Array.isArray(record) ? record : {};
  }

  function getSharedTextForSong(song, field, fallback = "") {
    const titleTag = getSongTitleTag(song);
    if (!titleTag || !TITLE_SHARED_TEXT_FIELDS.includes(field)) {
      return { shared: false, titleTag: "", value: fallback };
    }

    const record = getTitleSharedRecord(titleTag);
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      return { shared: true, titleTag, value: String(record[field] ?? "") };
    }
    return { shared: true, titleTag, value: fallback };
  }

  function setSharedTextForSong(song, field, value) {
    const titleTag = getSongTitleTag(song);
    if (!titleTag || !TITLE_SHARED_TEXT_FIELDS.includes(field)) return false;
    const data = readTitleSharedText();
    const record = data[titleTag] && typeof data[titleTag] === "object" ? { ...data[titleTag] } : {};
    record[field] = String(value ?? "");
    data[titleTag] = record;
    writeTitleSharedText(data);
    return true;
  }

  function pickSongTextField(song, field) {
    if (!song) return "";
    if (field === "lyricsOriginal") return song.lyricsOriginal ?? song.lyrics ?? song.lyricsJa ?? song.lyricsCn ?? song.lyricsKr ?? song.lyricsEn ?? "";
    if (field === "lyrics") return song.lyrics ?? song.lyricsOriginal ?? "";
    return song[field] ?? "";
  }

  function ensureTitleTagSharedTextFromSongs(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return false;
    const data = readTitleSharedText();
    if (data[clean] && TITLE_SHARED_TEXT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data[clean], field))) return true;

    const taggedSongs = getAllSongs().filter((song) => normalizeTags(song.tags).includes(clean));
    const record = {};
    TITLE_SHARED_TEXT_FIELDS.forEach((field) => {
      const found = taggedSongs.map((song) => String(pickSongTextField(song, field) ?? "")).find((text) => text.trim());
      if (found !== undefined) record[field] = found;
    });

    if (Object.keys(record).length > 0) {
      data[clean] = record;
      writeTitleSharedText(data);
    }
    return true;
  }

  function normalizeTitleFixedTags(data) {
    const result = {};
    if (!data || typeof data !== "object" || Array.isArray(data)) return result;

    Object.entries(data).forEach(([rawTitleTag, rawTags]) => {
      const titleTag = normalizeTag(rawTitleTag);
      if (!titleTag) return;
      const tags = normalizeTags(rawTags).filter((tag) => tag && tag !== titleTag);
      if (tags.length > 0) result[titleTag] = tags;
    });

    return result;
  }

  function readTitleFixedTags() {
    try {
      return normalizeTitleFixedTags(JSON.parse(localStorage.getItem(TITLE_FIXED_TAGS_KEY) || "{}"));
    } catch {
      return {};
    }
  }

  function writeTitleFixedTags(data) {
    localStorage.setItem(TITLE_FIXED_TAGS_KEY, JSON.stringify(normalizeTitleFixedTags(data)));
  }

  function getTitleFixedTags(titleTag) {
    const clean = normalizeTag(titleTag);
    if (!clean) return [];
    return readTitleFixedTags()[clean] || [];
  }

  function setTitleFixedTags(titleTag, tags) {
    const clean = normalizeTag(titleTag);
    if (!clean) return false;
    const data = readTitleFixedTags();
    const previousFixed = data[clean] || [];
    const fixed = normalizeTags(tags).filter((tag) => tag && tag !== clean);
    if (fixed.length > 0) data[clean] = fixed;
    else delete data[clean];
    writeTitleFixedTags(data);
    applyTitleFixedTagsToStores(clean, previousFixed);
    return true;
  }

  function applyTitleFixedTagsToTags(tags) {
    let result = normalizeTags(tags);
    const titleTags = readTitleTags();
    const fixedData = readTitleFixedTags();

    titleTags.forEach((titleTag) => {
      if (!result.includes(titleTag)) return;
      result = addTags(result, fixedData[titleTag] || []);
    });

    return result;
  }

  function applyTitleFixedTagsToStores(titleTag = "", previousFixedTags = []) {
    const cleanTitle = normalizeTag(titleTag);
    const titleTags = cleanTitle ? [cleanTitle] : readTitleTags();
    const fixedData = readTitleFixedTags();
    const previousMap = cleanTitle ? { [cleanTitle]: normalizeTags(previousFixedTags) } : {};
    let changedCount = 0;

    function nextTagsForTitle(tags) {
      let next = normalizeTags(tags);
      titleTags.forEach((tag) => {
        if (!next.includes(tag)) return;
        const currentFixed = normalizeTags(fixedData[tag] || []);
        const oldFixed = normalizeTags(previousMap[tag] || []);
        if (oldFixed.length > 0) {
          next = next.filter((item) => !oldFixed.includes(item) || currentFixed.includes(item));
        }
        next = addTags(next, currentFixed);
      });
      return next;
    }

    ALL_STORES.forEach((store) => {
      const arr = cleanSongArray(readStorage(store.key));
      let changed = false;
      let matched = false;

      arr.forEach((song) => {
        const tags = normalizeTags(song.tags);
        const matches = titleTags.some((tag) => tags.includes(tag));
        if (!matches) return;
        matched = true;
        const nextTags = nextTagsForTitle(tags);
        if (nextTags.join("\u0001") !== tags.join("\u0001")) {
          song.tags = nextTags;
          changed = true;
        }
        changedCount += 1;
      });

      if (changed || matched) writeStorage(store.key, arr);
    });

    try {
      if (Array.isArray(songs)) {
        songs.forEach((song) => {
          const tags = normalizeTags(song.tags);
          const matches = titleTags.some((tag) => tags.includes(tag));
          if (matches) song.tags = nextTagsForTitle(tags);
        });
      }
    } catch {}

    return changedCount;
  }

  function registerTitleTag(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return false;
    writeTitleTags(addTags(readTitleTags(), [clean]));
    ensureTitleTagSharedTextFromSongs(clean);
    applyTitleFixedTagsToStores(clean);
    return true;
  }

  function unregisterTitleTag(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return false;
    writeTitleTags(readTitleTags().filter((item) => item !== clean));
    return true;
  }


  function normalizeTagKind(kind) {
    const clean = String(kind || "").trim();
    return TAG_KIND_OPTIONS.some((item) => item.key === clean) ? clean : "";
  }

  function getTagKindLabel(kind) {
    if (kind === "title") return "제목태그";
    return TAG_KIND_OPTIONS.find((item) => item.key === kind)?.label || "노래전용";
  }

  function readTagKinds() {
    try {
      const data = JSON.parse(localStorage.getItem(TAG_KINDS_KEY) || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) return {};
      const result = {};
      Object.entries(data).forEach(([rawTag, rawKind]) => {
        const tag = normalizeTag(rawTag);
        const kind = normalizeTagKind(rawKind);
        if (tag && kind) result[tag] = kind;
      });
      return result;
    } catch {
      return {};
    }
  }

  function writeTagKinds(data) {
    const result = {};
    if (data && typeof data === "object" && !Array.isArray(data)) {
      Object.entries(data).forEach(([rawTag, rawKind]) => {
        const tag = normalizeTag(rawTag);
        const kind = normalizeTagKind(rawKind);
        if (tag && kind) result[tag] = kind;
      });
    }
    localStorage.setItem(TAG_KINDS_KEY, JSON.stringify(result));
  }

  function getTagKind(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return "song";
    if (isTitleTag(clean)) return "title";
    const kind = normalizeTagKind(readTagKinds()[clean]);
    return kind || "song";
  }

  function setTagKind(tag, kind) {
    const clean = normalizeTag(tag);
    const cleanKind = normalizeTagKind(kind) || "song";
    if (!clean) return false;
    const data = readTagKinds();
    data[clean] = cleanKind;
    writeTagKinds(data);
    return true;
  }

  function ensureTagKinds(tags, defaultKind = "song") {
    const cleanTags = normalizeTags(tags);
    if (cleanTags.length === 0) return false;
    const cleanKind = normalizeTagKind(defaultKind) || "song";
    const titleSet = new Set(readTitleTags());
    const data = readTagKinds();
    let changed = false;
    cleanTags.forEach((tag) => {
      if (!tag || titleSet.has(tag)) return;
      if (!normalizeTagKind(data[tag])) {
        data[tag] = cleanKind;
        changed = true;
      }
    });
    if (changed) writeTagKinds(data);
    return changed;
  }

  function readPlaylistTags() {
    try {
      const data = JSON.parse(localStorage.getItem(PLAYLIST_TAGS_KEY) || "[]");
      return normalizeTags(Array.isArray(data) ? data : []);
    } catch {
      return [];
    }
  }

  function writePlaylistTags(tags) {
    localStorage.setItem(PLAYLIST_TAGS_KEY, JSON.stringify(normalizeTags(tags)));
  }

  function registerPlaylistTag(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return false;
    writePlaylistTags(addTags(readPlaylistTags(), [clean]));
    setTagKind(clean, "playlist");
    return true;
  }

  function unregisterPlaylistTag(tag) {
    const clean = normalizeTag(tag);
    if (!clean) return false;
    writePlaylistTags(readPlaylistTags().filter((item) => item !== clean));
    const data = readTagKinds();
    if (data[clean] === "playlist") {
      delete data[clean];
      writeTagKinds(data);
    }
    return true;
  }

  function isPlaylistTag(tag) {
    const clean = normalizeTag(tag);
    return !!clean && readPlaylistTags().includes(clean);
  }

  function titleHasSharedText(tag) {
    const record = getTitleSharedRecord(tag);
    return TITLE_SHARED_TEXT_FIELDS.some((field) => String(record[field] ?? "").trim());
  }

  function getAllKnownTags() {
    const set = new Set();
    getTagCounts("all").forEach(([tag]) => set.add(normalizeTag(tag)));
    readTitleTags().forEach((tag) => set.add(normalizeTag(tag)));
    readPlaylistTags().forEach((tag) => set.add(normalizeTag(tag)));
    Object.keys(readTagKinds()).forEach((tag) => set.add(normalizeTag(tag)));
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
  }

  function tagMatchesSearch(tag, query) {
    const clean = normalizeTag(tag);
    const terms = getSearchTerms(query);
    if (!terms.length) return true;
    const kindText = getTagKindLabel(getTagKind(clean));
    const haystack = normalizeSearchText(`#${clean} ${clean} ${kindText}`);
    return terms.every((term) => haystack.includes(term));
  }

  function searchTags(query) {
    const counts = new Map(getTagCounts("all"));
    return getAllKnownTags()
      .filter((tag) => tagMatchesSearch(tag, query))
      .map((tag) => {
        const kind = getTagKind(tag);
        return {
          tag,
          count: counts.get(tag) || 0,
          kind,
          kindLabel: getTagKindLabel(kind),
          isTitle: isTitleTag(tag),
          isPlaylist: isPlaylistTag(tag)
        };
      });
  }

  function attachTagAutocomplete(input, options = {}) {
    if (!input || input.dataset.tagAutocompleteBound === "1") return;
    input.dataset.tagAutocompleteBound = "1";
    input.setAttribute("autocomplete", "off");

    const max = Number(options.max || 8);
    const dropdown = document.createElement("div");
    dropdown.className = "tag-autocomplete-list";
    dropdown.hidden = true;
    input.insertAdjacentElement("afterend", dropdown);

    function currentToken() {
      const value = String(input.value || "");
      const beforeCursor = value.slice(0, input.selectionStart ?? value.length);
      const parts = beforeCursor.split(/[#,，、\n\t ]+/);
      return normalizeTag(parts[parts.length - 1] || value);
    }

    function replaceCurrentToken(tag) {
      const clean = normalizeTag(tag);
      if (!clean) return;
      const value = String(input.value || "");
      const cursor = input.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const match = before.match(/^(.*?)([#]?[^#,，、\n\t ]*)$/);
      const prefix = match ? match[1] : "";
      const tail = after.replace(/^[^#,，、\n\t ]*/, "");
      const sep = prefix.trim() ? ", " : "";
      input.value = `${prefix}${sep}#${clean}${tail ? tail : ", "}`;
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (typeof options.onPick === "function") options.onPick(clean, input);
    }

    function hide() {
      dropdown.hidden = true;
      dropdown.innerHTML = "";
    }

    function render() {
      const query = currentToken();
      if (!query) {
        hide();
        return;
      }
      const exclude = new Set(normalizeTags(options.exclude || []));
      const candidates = searchTags(query)
        .filter((item) => !exclude.has(item.tag))
        .slice(0, max);
      if (candidates.length === 0) {
        hide();
        return;
      }
      dropdown.innerHTML = candidates.map((item) => `
        <button type="button" class="tag-autocomplete-item" data-tag-autocomplete-pick="${escapeHTML(item.tag)}">
          <span>#${escapeHTML(item.tag)}</span>
          <small>${escapeHTML(item.kindLabel)}${item.count ? ` · ${item.count}` : ""}</small>
        </button>
      `).join("");
      dropdown.hidden = false;
    }

    dropdown.addEventListener("mousedown", (e) => {
      const btn = e.target.closest("[data-tag-autocomplete-pick]");
      if (!btn) return;
      e.preventDefault();
      replaceCurrentToken(btn.getAttribute("data-tag-autocomplete-pick") || "");
      hide();
    });

    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("blur", () => setTimeout(hide, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hide();
      if (e.key !== "ArrowDown" || dropdown.hidden) return;
      e.preventDefault();
      dropdown.querySelector("button")?.focus();
    });
    dropdown.addEventListener("keydown", (e) => {
      const buttons = [...dropdown.querySelectorAll("button")];
      const idx = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        buttons[Math.min(buttons.length - 1, idx + 1)]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (idx <= 0) input.focus();
        else buttons[idx - 1]?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const tag = document.activeElement?.getAttribute("data-tag-autocomplete-pick") || "";
        replaceCurrentToken(tag);
        hide();
      } else if (e.key === "Escape") {
        hide();
        input.focus();
      }
    });
  }

  function cleanSong(song, extraTag = "") {
    if (!song || typeof song !== "object") return null;
    const ytUrl = String(song.ytUrl || song.url || "").trim();
    const id = String(song.id || extractID(ytUrl) || "").trim();
    const title = String(song.title || "제목 없음").trim() || "제목 없음";
    const thumbnailWidth = Number(song.thumbnailWidth || song.thumbnail_width || song.thumbWidth || 0) || 0;
    const thumbnailHeight = Number(song.thumbnailHeight || song.thumbnail_height || song.thumbHeight || 0) || 0;
    let aspect = normalizeVideoAspect(song.aspect || song.videoAspect || song.orientation || song.videoOrientation);
    if (!aspect && thumbnailWidth > 0 && thumbnailHeight > 0) {
      if (thumbnailHeight > thumbnailWidth * 1.15) aspect = "portrait";
      else if (thumbnailWidth > thumbnailHeight * 1.15) aspect = "landscape";
    }
    const legacyLyrics = String(song.lyrics || song.lyricsJa || song.lyricsCn || song.lyricsKr || song.lyricsEn || "");
    const lyricsOriginal = song.lyricsOriginal === undefined || song.lyricsOriginal === null
      ? legacyLyrics
      : String(song.lyricsOriginal);
    const lyricsPronunciation = song.lyricsPronunciation === undefined || song.lyricsPronunciation === null
      ? String(song.lyricsReading || song.lyricsPronounce || song.lyricsRomaji || "")
      : String(song.lyricsPronunciation);
    const lyricsMeaning = song.lyricsMeaning === undefined || song.lyricsMeaning === null
      ? String(song.lyricsTranslation || song.lyricsKrMeaning || "")
      : String(song.lyricsMeaning);

    const cleanTags = applyTitleFixedTagsToTags(addTags(song.tags, extraTag));
    ensureTagKinds(cleanTags, "song");

    return {
      title,
      author: String(song.author || "").trim(),
      ytUrl,
      id,
      lyrics: String(song.lyrics === undefined || song.lyrics === null ? lyricsOriginal : song.lyrics).trim(),
      lyricsOriginal,
      lyricsPronunciation,
      lyricsMeaning,
      lyricsJa: String(song.lyricsJa || "").trim(),
      lyricsCn: String(song.lyricsCn || "").trim(),
      lyricsKr: String(song.lyricsKr || "").trim(),
      lyricsEn: String(song.lyricsEn || "").trim(),
      mr: String(song.mr || "").trim(),
      score: String(song.score || "").trim(),
      original: String(song.original || song.origin || song.originalUrl || "").trim(),
      memo: String(song.memo || ""),
      tags: cleanTags,
      aspect,
      thumbnailWidth,
      thumbnailHeight
    };
  }

  function cleanSongArray(value, extraTag = "") {
    if (!Array.isArray(value)) return [];
    return value.map((song) => cleanSong(song, extraTag)).filter(Boolean);
  }

  function mergeSongArrays(arrays) {
    const merged = [];
    const seen = new Set();
    arrays.flat().forEach((song) => {
      const s = cleanSong(song);
      if (!s) return;
      const key = s.id || s.ytUrl || `${s.title}|${s.author}`;
      if (seen.has(key)) {
        const old = merged.find((item) => (item.id || item.ytUrl || `${item.title}|${item.author}`) === key);
        if (old) old.tags = addTags(old.tags, s.tags);
        return;
      }
      seen.add(key);
      merged.push(s);
    });
    return merged;
  }

  function removeLegacyStoreKeys(country) {
    (country.old || []).forEach((oldKey) => {
      try {
        localStorage.removeItem(oldKey);
      } catch {}
    });
  }

  function migrateUnifiedStores() {
    COUNTRY_STORES.forEach((country) => {
      const currentData = cleanSongArray(readStorage(country.key));
      const oldData = [];

      (country.old || []).forEach((oldKey) => {
        const moodTag = country.mood?.[oldKey] || "";
        oldData.push(...cleanSongArray(readStorage(oldKey), moodTag));
      });

      // 예전 저장소를 매번 다시 합치면 삭제한 곡/태그가 새로고침 후 다시 살아나는 문제가 생긴다.
      // 새 통합 저장소가 이미 있으면 예전 저장소는 재합치지 않고 정리한다.
      // 새 통합 저장소가 비어있을 때만, 옛날 버전에서 넘어온 데이터를 1회 복구한다.
      if (currentData.length > 0) {
        writeStorage(country.key, currentData);
        removeLegacyStoreKeys(country);
        return;
      }

      if (oldData.length > 0) {
        writeStorage(country.key, mergeSongArrays([oldData]));
        removeLegacyStoreKeys(country);
      }
    });
  }

  migrateUnifiedStores();

  let songs = cleanSongArray(readStorage(storeKey));
  let current = 0;
  let dragIndex = null;

  function isTagPage() {
    return document.body?.dataset?.page === "tag";
  }

  function getCurrentTagParam() {
    return normalizeTag(new URLSearchParams(location.search).get("tag") || "");
  }

  function setSongsRaw(value) {
    songs = Array.isArray(value) ? value : [];
  }

  function findSongIndexInStore(sourceKey, song) {
    const arr = cleanSongArray(readStorage(sourceKey));
    const wantedId = String(song?.sourceId || song?.id || extractID(song?.ytUrl) || "").trim();
    const wantedUrl = safeLink(song?.sourceUrl || song?.ytUrl);
    const wantedIndex = Number(song?.sourceIndex ?? song?.index);

    if (Number.isInteger(wantedIndex) && arr[wantedIndex]) {
      const candidate = arr[wantedIndex];
      const candidateId = candidate.id || extractID(candidate.ytUrl);
      if ((wantedId && candidateId === wantedId) || (wantedUrl && safeLink(candidate.ytUrl) === wantedUrl)) {
        return wantedIndex;
      }
    }

    return arr.findIndex((item) => {
      const itemId = item.id || extractID(item.ytUrl);
      const itemUrl = safeLink(item.ytUrl);
      return (wantedId && itemId === wantedId) || (wantedUrl && itemUrl === wantedUrl);
    });
  }

  function saveSongToSource(song) {
    const sourceKey = song?.sourceKey || song?.storeKey;
    if (!sourceKey || !ALL_STORES.some((item) => item.key === sourceKey)) return false;

    const arr = cleanSongArray(readStorage(sourceKey));
    const idx = findSongIndexInStore(sourceKey, song);
    if (idx < 0 || !arr[idx]) return false;

    arr[idx] = cleanSong(song);
    writeStorage(sourceKey, arr);
    song.sourceIndex = idx;
    song.index = idx;
    song.sourceId = song.id || extractID(song.ytUrl);
    song.sourceUrl = song.ytUrl;
    return true;
  }

  function save() {
    if (isTagPage()) {
      songs.forEach((song) => saveSongToSource(song));
    } else if (storeKey !== "main") {
      writeStorage(storeKey, songs);
    }
    if (typeof updateDrawerCounts === "function") updateDrawerCounts();
    if (typeof renderTagTools === "function") renderTagTools();
  }

  async function fetchYouTubeMeta(ytUrl) {
    try {
      const api = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(ytUrl);
      const res = await fetch(api);
      if (!res.ok) throw new Error("oEmbed 실패");
      const data = await res.json();
      const thumbnailWidth = Number(data.thumbnail_width || 0) || 0;
      const thumbnailHeight = Number(data.thumbnail_height || 0) || 0;
      let aspect = "";
      if (thumbnailWidth > 0 && thumbnailHeight > 0) {
        if (thumbnailHeight > thumbnailWidth * 1.15) aspect = "portrait";
        else if (thumbnailWidth > thumbnailHeight * 1.15) aspect = "landscape";
      }
      return {
        title: data.title || "제목 없음",
        author: data.author_name || "",
        aspect,
        thumbnailWidth,
        thumbnailHeight
      };
    } catch {
      return { title: "제목 없음", author: "", aspect: "", thumbnailWidth: 0, thumbnailHeight: 0 };
    }
  }

  function normalizeDuplicateTitle(value) {
    const text = safeText(value);
    if (!text || text === "제목 없음") return "";
    return text.toLowerCase().replace(/\s+/g, "");
  }

  function collectDuplicateSongs({ ytUrl = "", id = "", title = "", storeKey: duplicateStoreKey = "" } = {}) {
    const cleanUrl = safeLink(ytUrl);
    const cleanId = safeText(id) || extractID(cleanUrl);
    const titleKey = normalizeDuplicateTitle(title);
    const stores = duplicateStoreKey
      ? ALL_STORES.filter((item) => item.key === duplicateStoreKey)
      : ALL_STORES;

    const result = [];
    stores.forEach((collection) => {
      cleanSongArray(readStorage(collection.key)).forEach((song, index) => {
        const songId = song.id || extractID(song.ytUrl);
        const sameLink = !!((cleanId && songId && songId === cleanId) || (cleanUrl && safeLink(song.ytUrl) === cleanUrl));
        const sameTitle = !!(titleKey && normalizeDuplicateTitle(song.title) === titleKey);
        if (!sameLink && !sameTitle) return;
        result.push({
          song,
          index,
          storeKey: collection.key,
          store: collection,
          sameLink,
          sameTitle
        });
      });
    });
    return result;
  }

  function confirmDuplicateAdd(duplicates = []) {
    if (!Array.isArray(duplicates) || duplicates.length === 0) return true;
    if (typeof window.confirm !== "function") return true;

    const first = duplicates[0];
    const reasons = [];
    if (duplicates.some((item) => item.sameLink)) reasons.push("링크가 같음");
    if (duplicates.some((item) => item.sameTitle)) reasons.push("제목이 같음");
    const title = safeText(first?.song?.title) || "제목 없음";
    const place = safeText(first?.store?.label) || "현재 목록";
    const extra = duplicates.length > 1 ? ` 외 ${duplicates.length - 1}개` : "";

    return window.confirm(
      `이미 같은 영상이 있어.

` +
      `- 중복 이유: ${reasons.join(" / ") || "같은 영상"}
` +
      `- 기존 영상: ${title}${extra}
` +
      `- 위치: ${place}

` +
      `그래도 새로 추가할까?`
    );
  }

  async function addVideoToStoreWithTags({ ytUrl, storeKey: wantedStoreKey, tags = [], mr = "", original = "", lyrics = "" } = {}) {
    const cleanUrl = safeLink(ytUrl);
    const id = extractID(cleanUrl);
    const targetStore = ALL_STORES.find((item) => item.key === wantedStoreKey) || YOUTUBE_STORES[0] || ALL_STORES[0];

    if (!targetStore) return { ok: false, error: "저장 위치를 찾지 못했어." };
    if (!cleanUrl || !id) return { ok: false, error: "유튜브 링크가 올바르지 않아." };

    const meta = await fetchYouTubeMeta(cleanUrl);
    const archivedRecord = findRemovedVideoRecord({ ytUrl: cleanUrl, id, title: meta.title, storeKey: targetStore.key });
    if (archivedRecord) {
      const allowArchived = await openArchivedDuplicateDialog(archivedRecord);
      if (!allowArchived) return { ok: false, cancelled: true, duplicate: true, archived: true, record: archivedRecord, error: "이전에 추가했던 영상이라 취소했어." };
    }

    const duplicates = collectDuplicateSongs({ ytUrl: cleanUrl, id, title: meta.title, storeKey: targetStore.key });
    if (duplicates.length > 0 && !confirmDuplicateAdd(duplicates)) {
      return { ok: false, cancelled: true, duplicate: true, duplicates, error: "중복 추가를 취소했어." };
    }

    const baseTags = archivedRecord ? addTags(archivedRecord.tags, tags) : tags;
    ensureTagKinds(baseTags, "song");
    const finalTags = applyTitleFixedTagsToTags(baseTags);
    ensureTagKinds(finalTags, "song");
    const arr = cleanSongArray(readStorage(targetStore.key));

    arr.push(cleanSong({
      title: archivedRecord?.title || meta.title || "제목 없음",
      author: archivedRecord?.author || meta.author || "",
      ytUrl: cleanUrl,
      id,
      lyrics: archivedRecord ? String(archivedRecord.lyrics || "") : safeText(lyrics),
      mr: archivedRecord ? safeLink(archivedRecord.mr || "") : safeLink(mr),
      score: "",
      original: archivedRecord ? safeLink(archivedRecord.original || "") : safeLink(original),
      memo: archivedRecord ? String(archivedRecord.memo || "") : "",
      tags: finalTags,
      aspect: meta.aspect || archivedRecord?.aspect || "",
      thumbnailWidth: meta.thumbnailWidth || archivedRecord?.thumbnailWidth || 0,
      thumbnailHeight: meta.thumbnailHeight || archivedRecord?.thumbnailHeight || 0
    }));
    const index = arr.length - 1;

    writeStorage(targetStore.key, arr);

    if (storeKey === targetStore.key) {
      songs = cleanSongArray(readStorage(targetStore.key));
      current = index;
    }

    return { ok: true, storeKey: targetStore.key, store: targetStore, index, song: arr[index], updatedExisting: false, duplicateAllowed: duplicates.length > 0 || !!archivedRecord, archivedRecord };
  }

  function getAllSongs() {
    return ALL_STORES.flatMap((collection) =>
      cleanSongArray(readStorage(collection.key)).map((song, index) => ({
        ...song,
        storeKey: collection.key,
        sourceKey: collection.key,
        sourceIndex: index,
        sourceId: song.id || extractID(song.ytUrl),
        sourceUrl: song.ytUrl,
        country: collection,
        collection,
        index
      }))
    );
  }

  function getTagCounts(scopeKey = "all") {
    const source = scopeKey && scopeKey !== "all" ? cleanSongArray(readStorage(scopeKey)) : getAllSongs();
    const map = new Map();
    source.forEach((song) => {
      normalizeTags(song.tags).forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1));
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }

  function getTagPageUrl(tag, basePrefix = "") {
    const prefix = basePrefix || (location.pathname.includes("/japan/") || location.pathname.includes("/china/") || location.pathname.includes("/korea/") || location.pathname.includes("/english/") || location.pathname.includes("/youtube/") ? "../" : "");
    return `${prefix}tag.html?tag=${encodeURIComponent(tag)}`;
  }

  window.AppState = {
    get storeKey() { return storeKey; },
    get songs() { return songs; },
    set songs(v) { songs = cleanSongArray(v); },
    get current() { return current; },
    set current(v) { current = Number.isFinite(Number(v)) ? Number(v) : 0; },
    get dragIndex() { return dragIndex; },
    set dragIndex(v) { dragIndex = v; },
    COUNTRY_STORES,
    YOUTUBE_STORES,
    ALL_STORES,
    TAG_KIND_OPTIONS,
    readStorage,
    writeStorage,
    save,
    safeText,
    safeLink,
    escapeHTML,
    extractID,
    fetchYouTubeMeta,
    normalizeDuplicateTitle,
    collectDuplicateSongs,
    confirmDuplicateAdd,
    normalizeTag,
    normalizeTags,
    normalizeVideoAspect,
    addTags,
    normalizeSearchText,
    getSearchTerms,
    songMatchesSearch,
    searchSongs,
    readTitleTags,
    writeTitleTags,
    isTitleTag,
    registerTitleTag,
    unregisterTitleTag,
    readTagKinds,
    writeTagKinds,
    getTagKind,
    getTagKindLabel,
    setTagKind,
    ensureTagKinds,
    readPlaylistTags,
    writePlaylistTags,
    registerPlaylistTag,
    unregisterPlaylistTag,
    isPlaylistTag,
    titleHasSharedText,
    getAllKnownTags,
    searchTags,
    attachTagAutocomplete,
    readTitleFixedTags,
    writeTitleFixedTags,
    getTitleFixedTags,
    setTitleFixedTags,
    applyTitleFixedTagsToTags,
    applyTitleFixedTagsToStores,
    addVideoToStoreWithTags,
    readTitleSharedText,
    writeTitleSharedText,
    readTagSharedDescriptions,
    writeTagSharedDescriptions,
    getTagSharedDescription,
    setTagSharedDescription,
    appendTagSharedDescription,
    readRemovedVideoArchive,
    writeRemovedVideoArchive,
    findRemovedVideoRecord,
    buildTagArchiveDescriptionBlock,
    archiveRemovedVideo,
    formatArchiveDateText,
    renameTagEverywhere,
    openArchivedDuplicateDialog,
    getSongTitleTag,
    getSharedTextForSong,
    setSharedTextForSong,
    ensureTitleTagSharedTextFromSongs,
    cleanSong,
    cleanSongArray,
    getAllSongs,
    getTagCounts,
    getTagPageUrl,
    isTagPage,
    getCurrentTagParam,
    setSongsRaw,
    saveSongToSource,
    findSongIndexInStore
  };
})();

// 기존 전역 함수 방식도 계속 동작하게 연결
(() => {
  const S = window.AppState;
  if (!S) return;

  ["songs", "current", "dragIndex"].forEach((key) => {
    Object.defineProperty(window, key, {
      get: () => S[key],
      set: (v) => (S[key] = v),
      configurable: true
    });
  });

  ["save", "safeText", "safeLink", "escapeHTML", "extractID", "fetchYouTubeMeta", "normalizeTags", "getTagCounts"]
    .forEach((fn) => (window[fn] = S[fn]));
})();

// =========================
// 전체 저장 / 불러오기 기능
// =========================
(() => {
  const S = window.AppState;
  if (!S) return;

  const BACKUP_KEYS = (S.ALL_STORES || S.COUNTRY_STORES).map((item) => ({ key: item.key, label: item.label }));
  const OLD_TO_NEW = {
    jaBright: "jaSongs", jaMid: "jaSongs", jaDark: "jaSongs", jpBright: "jaSongs", jpMid: "jaSongs", jpDark: "jaSongs",
    cnBright: "cnSongs", cnMid: "cnSongs", cnDark: "cnSongs",
    krBright: "krSongs", krMid: "krSongs", krDark: "krSongs"
  };
  const OLD_MOOD = {
    jaBright: "밝은곡", jpBright: "밝은곡", cnBright: "밝은곡", krBright: "밝은곡",
    jaMid: "중간곡", jpMid: "중간곡", cnMid: "중간곡", krMid: "중간곡",
    jaDark: "어두운곡", jpDark: "어두운곡", cnDark: "어두운곡", krDark: "어두운곡"
  };

  function makeBackupData() {
    const stores = {};
    BACKUP_KEYS.forEach(({ key }) => {
      stores[key] = S.cleanSongArray(S.readStorage(key));
    });

    return {
      app: "my-music-library",
      version: 6,
      exportedAt: new Date().toISOString(),
      titleTags: typeof S.readTitleTags === "function" ? S.readTitleTags() : [],
      titleSharedLyrics: typeof S.readTitleSharedText === "function" ? S.readTitleSharedText() : {},
      titleFixedTags: typeof S.readTitleFixedTags === "function" ? S.readTitleFixedTags() : {},
      tagKinds: typeof S.readTagKinds === "function" ? S.readTagKinds() : {},
      playlistTags: typeof S.readPlaylistTags === "function" ? S.readPlaylistTags() : [],
      stores
    };
  }

  function downloadBackup() {
    const data = makeBackupData();
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const filename = `music-library-backup-${yyyy}${mm}${dd}-${hh}${mi}.json`;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeImportData(data) {
    const result = {};
    BACKUP_KEYS.forEach(({ key }) => (result[key] = []));

    const put = (key, value) => {
      const finalKey = OLD_TO_NEW[key] || key;
      if (!BACKUP_KEYS.some((item) => item.key === finalKey)) return;
      result[finalKey].push(...S.cleanSongArray(value, OLD_MOOD[key] || ""));
    };

    if (data && typeof data === "object" && data.stores && typeof data.stores === "object") {
      Object.entries(data.stores).forEach(([key, value]) => put(key, value));
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      Object.entries(data).forEach(([key, value]) => put(key, value));
    } else if (Array.isArray(data)) {
      const pageKey = document.body?.dataset?.store;
      if (pageKey && BACKUP_KEYS.some((item) => item.key === pageKey)) result[pageKey].push(...S.cleanSongArray(data));
    }

    Object.keys(result).forEach((key) => {
      result[key] = S.cleanSongArray(result[key]);
      if (result[key].length === 0) delete result[key];
    });
    return result;
  }

  function countImportSongs(stores) {
    return Object.values(stores).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  }

  function applyImportedStores(stores) {
    Object.entries(stores).forEach(([key, arr]) => {
      S.writeStorage(key, S.cleanSongArray(arr));
    });

    const pageKey = document.body?.dataset?.store;
    if (pageKey && stores[pageKey]) {
      S.songs = S.cleanSongArray(stores[pageKey]);
      S.current = 0;
      if (typeof showList === "function") showList();
      if (typeof updateLyricsDrawer === "function") updateLyricsDrawer();
      if (typeof updateControlLabels === "function") updateControlLabels();
    }

    if (typeof updateDrawerCounts === "function") updateDrawerCounts();
    if (typeof renderTagTools === "function") renderTagTools();
  }

  function openImportFilePicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || ""));
          const stores = normalizeImportData(data);
          const total = countImportSongs(stores);

          if (Object.keys(stores).length === 0) {
            alert("불러올 수 있는 노래 백업 파일이 아니야.");
            return;
          }

          const names = Object.keys(stores).map((key) => {
            const found = BACKUP_KEYS.find((item) => item.key === key);
            return `${found ? found.label : key} ${stores[key].length}곡`;
          }).join("\n");

          const ok = confirm(`이 백업 파일을 불러올까?\n\n총 ${total}곡\n${names}\n\n현재 저장된 목록은 백업 내용으로 바뀌어.`);
          if (!ok) return;

          applyImportedStores(stores);

          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "titleTags") && typeof S.writeTitleTags === "function") {
            S.writeTitleTags(data.titleTags);
          }
          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "titleSharedLyrics") && typeof S.writeTitleSharedText === "function") {
            S.writeTitleSharedText(data.titleSharedLyrics);
          }
          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "titleFixedTags") && typeof S.writeTitleFixedTags === "function") {
            S.writeTitleFixedTags(data.titleFixedTags);
          }
          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "tagKinds") && typeof S.writeTagKinds === "function") {
            S.writeTagKinds(data.tagKinds);
          }
          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "playlistTags") && typeof S.writePlaylistTags === "function") {
            S.writePlaylistTags(data.playlistTags);
          }
          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "tagSharedDescriptions") && typeof S.writeTagSharedDescriptions === "function") {
            S.writeTagSharedDescriptions(data.tagSharedDescriptions);
          }
          if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "removedVideoArchive") && typeof S.writeRemovedVideoArchive === "function") {
            S.writeRemovedVideoArchive(data.removedVideoArchive);
          }
          if (typeof S.applyTitleFixedTagsToStores === "function") S.applyTitleFixedTagsToStores();

          alert("불러오기 완료! 목록이 복원됐어.");
        } catch {
          alert("파일을 읽을 수 없어. 저장 버튼으로 받은 JSON 파일인지 확인해줘.");
        }
      };
      reader.readAsText(file, "utf-8");
    });

    input.click();
  }

  function createBackupButtons() {
    if (document.getElementById("backupTools")) return;
    if (document.body?.dataset?.store || document.body?.dataset?.page === "tag") return; // 노래 재생 페이지/태그 재생 페이지에는 저장/불러오기 박스를 띄우지 않음

    const box = document.createElement("div");
    box.id = "backupTools";
    box.className = "backup-tools";
    box.innerHTML = `
      <button id="exportBackupBtn" class="backup-btn" type="button">💾 저장</button>
      <button id="importBackupBtn" class="backup-btn" type="button">📂 불러오기</button>
      <p class="backup-help">저장은 JSON 파일로 다운로드되고, 불러오기는 그 파일을 다시 넣는 방식이야. 노래 페이지와 유튜브 1P~4P도 같이 저장돼.</p>
    `;

    const mainContent = document.getElementById("mainContent");
    const h1 = mainContent?.querySelector("h1") || document.querySelector("h1");
    if (h1) h1.insertAdjacentElement("afterend", box);
    else document.body.insertAdjacentElement("afterbegin", box);

    document.getElementById("exportBackupBtn")?.addEventListener("click", downloadBackup);
    document.getElementById("importBackupBtn")?.addEventListener("click", openImportFilePicker);
  }

  function isMainHomePage() {
    if (document.body?.dataset?.store || document.body?.dataset?.page === "tag") return false;
    const path = String(location.pathname || "");
    return /(?:^|\/)index\.html?$/.test(path) || path.endsWith("/");
  }

  function escapeAttr(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function getSongOpenHref(song) {
    const page = song?.collection?.page || song?.page || "index.html";
    const playKey = song?.id || song?.ytUrl || "";
    return `${page}${playKey ? `?play=${encodeURIComponent(playKey)}` : ""}`;
  }

  function mainSearchTagsHTML(song) {
    const tags = normalizeTags(song?.tags);
    if (!tags.length) return "";
    return `<div class="main-search-tags">${tags.map((tag) => `<span class="main-search-tag">#${escapeHTML(tag)}</span>`).join("")}</div>`;
  }

  function mainTagResultsHTML(query) {
    const tagResults = typeof S.searchTags === "function" ? S.searchTags(query).slice(0, 12) : [];
    if (!tagResults.length) return "";
    return tagResults.map((item) => `
      <a class="main-search-item main-search-tag-item" href="tag.html?tag=${encodeURIComponent(item.tag)}">
        <div class="main-search-meta">
          <div class="main-search-title">#${escapeHTML(item.tag)}</div>
          <div class="main-search-sub">${escapeHTML(item.kindLabel)}${item.count ? ` · 영상 ${item.count}개` : " · 아직 영상 없음"}</div>
        </div>
        <span class="main-search-open">태그 열기</span>
      </a>
    `).join("");
  }

  function renderMainSearchResults(query) {
    const resultBox = document.getElementById("mainSearchResults");
    const summary = document.getElementById("mainSearchSummary");
    if (!resultBox || !summary) return;

    const text = String(query ?? "").trim();
    if (!text) {
      summary.textContent = "노래 제목이나 태그를 검색해줘. 예: 오버, 잔잔함";
      resultBox.innerHTML = "";
      resultBox.hidden = true;
      return;
    }

    const results = searchSongs(text, "all");
    const tagHTML = mainTagResultsHTML(text);
    const tagCount = typeof S.searchTags === "function" ? S.searchTags(text).length : 0;
    summary.textContent = `태그 ${tagCount}개 / 영상 ${results.length}개 찾았어.`;
    resultBox.hidden = false;

    if (!results.length && !tagHTML) {
      resultBox.innerHTML = `<p class="empty-center main-search-empty">검색 결과가 없어.</p>`;
      return;
    }

    const songHTML = results.map((song) => {
      const badge = `${song?.collection?.emoji || ""} ${song?.collection?.label || ""}`.trim();
      const sub = [safeText(song?.author), badge].filter(Boolean).join(" · ");
      return `
        <a class="main-search-item" href="${escapeAttr(getSongOpenHref(song))}">
          <div class="main-search-meta">
            <div class="main-search-title">${escapeHTML(song?.title || "제목 없음")}</div>
            <div class="main-search-sub">${escapeHTML(sub)}</div>
            ${mainSearchTagsHTML(song)}
          </div>
          <span class="main-search-open">열기</span>
        </a>
      `;
    }).join("");
    resultBox.innerHTML = `${tagHTML}${songHTML}`;
  }

  function createMainSearchUI() {
    if (!isMainHomePage() || document.getElementById("mainSearchSection")) return;

    const backupTools = document.getElementById("backupTools");
    const anchor = backupTools || document.querySelector("h1");
    if (!anchor) return;

    const section = document.createElement("section");
    section.id = "mainSearchSection";
    section.className = "main-search-section";
    section.innerHTML = `
      <div class="add-song-section search-song-section search-song-section-main">
        <div class="add-song-row search-song-row">
          <input id="mainSongSearchInput" placeholder="노래 제목 / 태그 검색" aria-label="메인 노래 검색" />
          <button id="mainSongSearchBtn" class="add-song-btn search-song-btn" type="button">검색</button>
        </div>
        <p id="mainSearchSummary" class="search-song-help">노래 제목이나 태그를 검색해줘. 예: 오버, 잔잔함</p>
      </div>
      <div id="mainSearchResults" class="main-search-results" hidden></div>
    `;

    if (backupTools) backupTools.insertAdjacentElement("afterend", section);
    else anchor.insertAdjacentElement("afterend", section);

    const input = document.getElementById("mainSongSearchInput");
    const run = () => renderMainSearchResults(input?.value || "");
    document.getElementById("mainSongSearchBtn")?.addEventListener("click", run);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    });
    input?.addEventListener("input", run);
  }

  document.addEventListener("DOMContentLoaded", () => {
    createBackupButtons();
    createMainSearchUI();
  });

  window.downloadMusicLibraryBackup = downloadBackup;
  window.openMusicLibraryBackup = openImportFilePicker;
})();
