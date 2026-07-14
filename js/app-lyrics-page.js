// js/app-lyrics-page.js - 노래 페이지들의 가사 있는 영상만 모아 정렬
(() => {
  const S = window.AppState;
  if (!S) return;

  const LYRICS_FIELDS = ["lyrics", "lyricsOriginal", "lyricsPronunciation", "lyricsMeaning", "lyricsJa", "lyricsCn", "lyricsKr", "lyricsEn"];

  function getLyricsSearchText(song) {
    return LYRICS_FIELDS.map((field) => {
      const fallback = song?.[field] || "";
      const shared = typeof S.getSharedTextForSong === "function"
        ? S.getSharedTextForSong(song, field, fallback)?.value
        : fallback;
      return String(shared || fallback || "").trim();
    }).filter(Boolean).join("\n");
  }

  function songHasLyrics(song) {
    return getLyricsSearchText(song).length > 0;
  }

  function normalizedTitleForSort(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/^[\s\p{P}\p{S}]+/u, "")
      .trim();
  }

  function firstMeaningfulCharacter(value) {
    return normalizedTitleForSort(value).charAt(0);
  }

  function titleBucket(title) {
    const ch = firstMeaningfulCharacter(title);
    if (/^[A-Za-z]$/.test(ch)) return 0;
    if (/^[가-힣ㄱ-ㅎㅏ-ㅣ]$/.test(ch)) return 1;
    if (/^[ぁ-んァ-ヶ]$/.test(ch)) return 2;
    if (/^[一-龯]$/.test(ch)) return 3;
    if (/^[0-9]$/.test(ch)) return 4;
    return 5;
  }

  function compareTitles(a, b) {
    const titleA = normalizedTitleForSort(a?.title || "제목 없음");
    const titleB = normalizedTitleForSort(b?.title || "제목 없음");
    const bucketDiff = titleBucket(titleA) - titleBucket(titleB);
    if (bucketDiff) return bucketDiff;

    const bucket = titleBucket(titleA);
    const locale = bucket === 0 ? "en" : bucket === 1 ? "ko" : bucket === 2 ? "ja" : bucket === 3 ? "zh" : "ko";
    return titleA.localeCompare(titleB, locale, { numeric: true, sensitivity: "base" });
  }

  const lyricsSongs = [];
  (S.COUNTRY_STORES || []).forEach((collection) => {
    const source = S.cleanSongArray(S.readStorage(collection.key));
    source.forEach((song, index) => {
      const enriched = {
        ...song,
        storeKey: collection.key,
        sourceKey: collection.key,
        sourceIndex: index,
        sourceId: song.id || S.extractID(song.ytUrl),
        sourceUrl: song.ytUrl,
        country: collection,
        collection,
        index
      };
      const lyricsSearchText = getLyricsSearchText(enriched);
      const titleTag = typeof S.getSongTitleTag === "function" ? S.getSongTitleTag(enriched) : "";
      const hasLyrics = Boolean(lyricsSearchText);

      // 가사 페이지에는 가사가 저장된 노래뿐 아니라 제목태그가 등록된 노래도 표시한다.
      // 제목태그 공유 가사가 존재하면 getLyricsSearchText에서 함께 감지된다.
      if (hasLyrics || titleTag) {
        lyricsSongs.push({
          ...enriched,
          lyricsSearchText,
          lyricsPageHasLyrics: hasLyrics,
          lyricsPageTitleTag: titleTag
        });
      }
    });
  });

  lyricsSongs.sort((a, b) => compareTitles(a, b) || String(a.author || "").localeCompare(String(b.author || ""), "ko", { sensitivity: "base" }));
  S.setSongsRaw(lyricsSongs);
  S.current = 0;

  document.addEventListener("DOMContentLoaded", () => {
    const count = document.getElementById("lyricsPageCount");
    if (count) {
      const files = new Map();
      lyricsSongs.forEach((song) => {
        const titleTag = String(song.lyricsPageTitleTag || "").trim();
        if (!titleTag) return;
        const current = files.get(titleTag) || { hasLyrics: false };
        current.hasLyrics = current.hasLyrics || !!song.lyricsPageHasLyrics;
        files.set(titleTag, current);
      });

      const fileList = [...files.values()];
      const filledCount = fileList.filter((file) => file.hasLyrics).length;
      const emptyCount = fileList.length - filledCount;
      count.textContent = fileList.length
        ? `제목태그 파일 ${fileList.length}개 · 가사 있음 ${filledCount}개(빨강) · 가사 없음 ${emptyCount}개(회색)`
        : "아직 제목태그 파일이 없어.";
    }
  });
})();
