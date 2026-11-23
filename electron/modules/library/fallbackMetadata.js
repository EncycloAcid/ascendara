/**
 * Fallback Game Metadata & Artwork Service
 *
 * Used when a game is not found on Steam (for game info) or SteamGridDB (for photos).
 * Queries public, keyless sources in order:
 *   1. GOG Catalog + Products API (rich metadata, portrait/landscape covers, screenshots)
 *   2. Wikipedia Search + REST Summary API (broad coverage for console, indie, Epic, Battle.net, retro titles)
 *   3. CheapShark API (last-resort thumbnail artwork)
 */

const axios = require("axios");

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = "Ascendara/1.0 (Game Launcher Metadata Fallback)";

// In-memory TTL caches so repeated lookups for the same game are instant
const DETAILS_CACHE = new Map();
const ARTWORK_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_LIMIT = 500;

function setBoundedCache(map, key, value) {
  if (map.size >= CACHE_LIMIT) {
    map.delete(map.keys().next().value);
  }
  map.set(key, { value, timestamp: Date.now() });
}

function getBoundedCache(map, key) {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Clean repack tags, build IDs, version strings, and edition suffixes.
 */
function cleanGameName(gameName) {
  if (!gameName || typeof gameName !== "string") return "";
  return gameName
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*(?:repack|gog|steam|fitgirl|dodi|elamigos|portable|build|v\d)[^)]*\)/gi, "")
    .replace(/\s+\S*_\S*/g, "")
    .replace(/[\s,]+v+\d[\d.]*.*$/i, "")
    .replace(/[\s,]+(?:release|build)[\s._-]*\d.*$/i, "")
    .replace(/\s+(?:alpha|beta|hotfix|early access)(?:[\s._-]*[\d.]+)?$/i, "")
    .replace(/\s+(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}$/i, "")
    .replace(/\s+[A-Z]{3,}\d{2,}$/, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeForMatch(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\s*\(video game\)\s*$/i, "")
    .replace(/\s*\(\d{4} video game\)\s*$/i, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(edition|remastered|remake|goty|complete|definitive|enhanced|ultimate|deluxe|premium|gold|standard|the)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute a 0..1 title match score between query and candidate.
 */
function titleMatchScore(query, candidate) {
  const q = normalizeForMatch(query);
  const c = normalizeForMatch(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1.0;

  if (c.startsWith(q) || q.startsWith(c)) {
    const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
    if (ratio >= 0.55) return 0.8 + ratio * 0.15;
  }

  const qTokens = q.split(" ").filter(Boolean);
  const cTokens = c.split(" ").filter(Boolean);
  if (!qTokens.length || !cTokens.length) return 0;

  const qSet = new Set(qTokens);
  const cSet = new Set(cTokens);
  let overlap = 0;
  for (const token of qSet) {
    if (cSet.has(token)) overlap++;
  }

  const jaccard = overlap / (qSet.size + cSet.size - overlap);
  const containment = overlap / Math.min(qSet.size, cSet.size);
  return jaccard * 0.65 + containment * 0.35;
}

function stripHtmlTags(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveGogImageUrl(url, formatter = "") {
  if (!url || typeof url !== "string") return null;
  let resolved = url.trim();
  if (resolved.startsWith("//")) resolved = `https:${resolved}`;
  if (resolved.includes("{formatter}")) {
    resolved = resolved.replace("{formatter}", formatter);
  }
  return resolved;
}

/**
 * Search GOG public catalog API.
 */
async function searchGogGame(gameName) {
  const cleanName = cleanGameName(gameName);
  if (!cleanName) return null;

  try {
    const res = await axios.get("https://catalog.gog.com/v1/catalog", {
      params: {
        limit: 8,
        query: `like:${cleanName}`,
        productType: "in:game,pack",
      },
      headers: { "User-Agent": USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const products = Array.isArray(res.data?.products) ? res.data.products : [];
    if (!products.length) return null;

    let best = null;
    let bestScore = 0;
    for (const product of products) {
      const score = titleMatchScore(cleanName, product.title);
      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    }

    if (!best || bestScore < 0.65) return null;

    const coverVertical = resolveGogImageUrl(best.coverVertical);
    const coverHorizontal = resolveGogImageUrl(best.coverHorizontal);
    const screenshots = Array.isArray(best.screenshots)
      ? best.screenshots
          .map((shot, idx) => {
            const url = resolveGogImageUrl(
              typeof shot === "string" ? shot : shot?.url,
              "_ggvgm_2x"
            );
            if (!url) return null;
            return {
              id: `gog-${best.id}-${idx}`,
              image_id: `gog-${best.id}-${idx}`,
              url,
              width: 1920,
              height: 1080,
              formatted_url: url,
            };
          })
          .filter(Boolean)
      : [];

    const platforms = [];
    if (Array.isArray(best.operatingSystems)) {
      if (best.operatingSystems.includes("windows"))
        platforms.push({ id: 1, name: "Windows" });
      if (best.operatingSystems.includes("osx") || best.operatingSystems.includes("mac"))
        platforms.push({ id: 2, name: "Mac" });
      if (best.operatingSystems.includes("linux"))
        platforms.push({ id: 3, name: "Linux" });
    }

    const genres = Array.isArray(best.genres)
      ? best.genres
          .map((g, idx) => ({
            id: g?.slug || `gog-genre-${idx}`,
            name: typeof g === "string" ? g : g?.name || "",
          }))
          .filter(g => g.name)
      : [];

    let releaseDate = "";
    if (best.releaseDate) {
      const parsed = new Date(best.releaseDate);
      if (!Number.isNaN(parsed.getTime())) {
        releaseDate = parsed.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    }

    return {
      id: `gog-${best.id}`,
      gogId: best.id,
      name: best.title,
      developers: Array.isArray(best.developers) ? best.developers : [],
      publishers: Array.isArray(best.publishers) ? best.publishers : [],
      genres,
      platforms,
      release_date: releaseDate,
      coverVertical,
      coverHorizontal,
      screenshots,
      site_detail_url: best.storeLink || (best.slug ? `https://www.gog.com/en/game/${best.slug}` : null),
      source: "gog",
    };
  } catch (err) {
    console.warn(`[FallbackMetadata] GOG lookup failed for "${cleanName}":`, err.message);
    return null;
  }
}

/**
 * Fetch detailed description from GOG products API.
 */
async function fetchGogDescription(gogId) {
  if (!gogId) return { summary: "", description: "", aboutHtml: null };
  try {
    const res = await axios.get(`https://api.gog.com/products/${gogId}`, {
      params: { expand: "description" },
      headers: { "User-Agent": USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const desc = res.data?.description;
    const lead = stripHtmlTags(desc?.lead || "");
    const full = stripHtmlTags(desc?.full || "");
    const aboutHtml = desc?.full || desc?.lead || null;
    return {
      summary: lead || full.slice(0, 320),
      description: full || lead,
      aboutHtml,
    };
  } catch {
    return { summary: "", description: "", aboutHtml: null };
  }
}

/**
 * Enrich a Wikipedia game hit with structured metadata from Wikidata
 * (P178 developer, P123 publisher, P136 genre, P400 platform, P577 release date).
 */
async function fetchWikidataGameMeta(wikibaseItem) {
  const empty = {
    developers: [],
    publishers: [],
    genres: [],
    platforms: [],
    release_date: "",
  };
  if (!wikibaseItem || !/^Q\d+$/i.test(wikibaseItem)) return empty;

  try {
    const entityRes = await axios.get("https://www.wikidata.org/w/api.php", {
      params: {
        action: "wbgetentities",
        ids: wikibaseItem,
        props: "claims",
        format: "json",
      },
      headers: { "User-Agent": USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const claims = entityRes.data?.entities?.[wikibaseItem]?.claims;
    if (!claims) return empty;

    const getQIds = prop =>
      (claims[prop] || [])
        .map(c => c?.mainsnak?.datavalue?.value?.id)
        .filter(id => typeof id === "string" && /^Q\d+$/i.test(id))
        .slice(0, 6);

    const devIds = getQIds("P178");
    const pubIds = getQIds("P123");
    const genreIds = getQIds("P136");
    const platformIds = getQIds("P400");

    // Extract earliest P577 publication date
    let releaseDate = "";
    const dateTimes = (claims.P577 || [])
      .map(c => c?.mainsnak?.datavalue?.value?.time)
      .filter(t => typeof t === "string" && t.startsWith("+"))
      .sort();
    if (dateTimes.length > 0) {
      const iso = dateTimes[0].slice(1, 11).replace(/-00/g, "-01");
      const parsed = new Date(iso);
      if (!Number.isNaN(parsed.getTime())) {
        releaseDate = parsed.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    }

    const allIds = [...new Set([...devIds, ...pubIds, ...genreIds, ...platformIds])];
    const labels = {};
    if (allIds.length > 0) {
      const labelsRes = await axios.get("https://www.wikidata.org/w/api.php", {
        params: {
          action: "wbgetentities",
          ids: allIds.join("|"),
          props: "labels",
          languages: "en",
          format: "json",
        },
        headers: { "User-Agent": USER_AGENT },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const entities = labelsRes.data?.entities || {};
      for (const id of allIds) {
        const label = entities[id]?.labels?.en?.value;
        if (label) labels[id] = label;
      }
    }

    return {
      developers: devIds.map(id => labels[id]).filter(Boolean),
      publishers: pubIds.map(id => labels[id]).filter(Boolean),
      genres: genreIds
        .map(id => (labels[id] ? { id, name: labels[id] } : null))
        .filter(Boolean),
      platforms: platformIds
        .map(id => (labels[id] ? { id, name: labels[id] } : null))
        .filter(Boolean),
      release_date: releaseDate,
    };
  } catch {
    return empty;
  }
}

/**
 * Search Wikipedia for a video game page and fetch its REST summary, image, and Wikidata info.
 */
async function searchWikipediaGame(gameName) {
  const cleanName = cleanGameName(gameName);
  if (!cleanName) return null;

  try {
    const searchRes = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "query",
        list: "search",
        srsearch: `${cleanName} video game`,
        srlimit: 6,
        format: "json",
      },
      headers: { "User-Agent": USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const results = Array.isArray(searchRes.data?.query?.search)
      ? searchRes.data.query.search
      : [];
    if (!results.length) return null;

    const GAME_HINT_RE =
      /video game|action-adventure|role-playing|first-person|third-person|platformer|shooter|sandbox|developed by|published by|playStation|xbox|nintendo|steam|pc game|indie game|arcade game|roguelike|metroidvania/i;

    let best = null;
    let bestScore = 0;
    for (const item of results) {
      const snippetText = stripHtmlTags(item.snippet || "");
      const isGameLike =
        /\(video game\)|\(\d{4} video game\)/i.test(item.title) ||
        GAME_HINT_RE.test(snippetText);
      if (!isGameLike) continue;

      let score = titleMatchScore(cleanName, item.title);
      if (/\(video game\)|\(\d{4} video game\)/i.test(item.title)) {
        score = Math.min(1, score + 0.08);
      }
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    if (!best || bestScore < 0.65) return null;

    const summaryRes = await axios.get(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.title)}`,
      {
        headers: { "User-Agent": USER_AGENT },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    const data = summaryRes.data;
    if (!data || data.type === "disambiguation") return null;

    // Double-check description or extract indicates a game
    const combinedText = `${data.description || ""} ${data.extract || ""}`;
    if (
      !/\(video game\)|\(\d{4} video game\)/i.test(best.title) &&
      !GAME_HINT_RE.test(combinedText)
    ) {
      return null;
    }

    const imageUrl = data.originalimage?.source || data.thumbnail?.source || null;
    const wikiMeta = await fetchWikidataGameMeta(data.wikibase_item);

    return {
      id: `wiki-${data.pageid || best.pageid}`,
      name: (data.title || best.title).replace(/\s*\((?:\d{4}\s+)?video game\)\s*$/i, ""),
      summary: data.extract || "",
      description: data.extract || "",
      full_description: data.extract || "",
      about_the_game: data.extract_html || null,
      imageUrl,
      imageWidth: data.originalimage?.width || data.thumbnail?.width || 600,
      imageHeight: data.originalimage?.height || data.thumbnail?.height || 900,
      site_detail_url: data.content_urls?.desktop?.page || null,
      developers: wikiMeta.developers,
      publishers: wikiMeta.publishers,
      genres: wikiMeta.genres,
      platforms: wikiMeta.platforms,
      release_date: wikiMeta.release_date,
      source: "wikipedia",
    };
  } catch (err) {
    console.warn(
      `[FallbackMetadata] Wikipedia lookup failed for "${cleanName}":`,
      err.message
    );
    return null;
  }
}

/**
 * Search CheapShark for a fallback cover/header thumbnail.
 */
async function searchCheapSharkArtwork(gameName) {
  const cleanName = cleanGameName(gameName);
  if (!cleanName) return null;

  try {
    const res = await axios.get("https://www.cheapshark.com/api/1.0/games", {
      params: { title: cleanName, limit: 8 },
      headers: { "User-Agent": USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const list = Array.isArray(res.data) ? res.data : [];
    let best = null;
    let bestScore = 0;
    for (const item of list) {
      const score = titleMatchScore(cleanName, item.external);
      if (score > bestScore && item.thumb) {
        bestScore = score;
        best = item;
      }
    }
    if (!best || bestScore < 0.7) return null;
    return {
      grid: best.thumb,
      hero: best.thumb,
      header: best.thumb,
      source: "cheapshark",
    };
  } catch {
    return null;
  }
}

/**
 * Get full fallback game details formatted to match Steam's formattedDetails shape.
 * Order: GOG -> Wikipedia (merging descriptions/images when helpful).
 */
async function getFallbackGameDetails(gameName) {
  const cleanName = cleanGameName(gameName);
  if (!cleanName) return null;

  const cacheKey = cleanName.toLowerCase();
  const cached = getBoundedCache(DETAILS_CACHE, cacheKey);
  if (cached !== undefined) return cached;

  const gog = await searchGogGame(cleanName);
  if (gog) {
    const gogDesc = await fetchGogDescription(gog.gogId);
    let summary = gogDesc.summary;
    let description = gogDesc.description;
    let aboutHtml = gogDesc.aboutHtml;

    // If GOG had no description text, enrich from Wikipedia
    if (!summary) {
      const wiki = await searchWikipediaGame(cleanName);
      if (wiki?.summary) {
        summary = wiki.summary;
        description = wiki.description;
        aboutHtml = wiki.about_the_game;
      }
    }

    const coverUrl = gog.coverHorizontal || gog.coverVertical || null;
    const formatted = {
      id: gog.id,
      appid: null,
      name: gog.name,
      type: "game",
      summary: summary || "",
      description: description || summary || "",
      storyline: null,
      full_description: description || summary || "",
      about_the_game: aboutHtml,
      cover: coverUrl
        ? {
            id: gog.id,
            image_id: gog.id,
            url: coverUrl,
            width: 460,
            height: 215,
            formatted_url: coverUrl,
          }
        : null,
      screenshots: gog.screenshots,
      formatted_screenshots: gog.screenshots,
      videos: [],
      similar_games: [],
      genres: gog.genres,
      platforms: gog.platforms,
      developers: gog.developers,
      publishers: gog.publishers,
      release_date: gog.release_date,
      site_detail_url: gog.site_detail_url,
      system_requirements: null,
      controller_support: null,
      categories: [],
      features: [],
      source: "gog",
    };

    setBoundedCache(DETAILS_CACHE, cacheKey, formatted);
    return formatted;
  }

  const wiki = await searchWikipediaGame(cleanName);
  if (wiki) {
    const formatted = {
      id: wiki.id,
      appid: null,
      name: wiki.name,
      type: "game",
      summary: wiki.summary,
      description: wiki.description,
      storyline: null,
      full_description: wiki.full_description,
      about_the_game: wiki.about_the_game,
      cover: wiki.imageUrl
        ? {
            id: wiki.id,
            image_id: wiki.id,
            url: wiki.imageUrl,
            width: wiki.imageWidth,
            height: wiki.imageHeight,
            formatted_url: wiki.imageUrl,
          }
        : null,
      screenshots: wiki.imageUrl
        ? [
            {
              id: `${wiki.id}-cover`,
              image_id: `${wiki.id}-cover`,
              url: wiki.imageUrl,
              width: wiki.imageWidth,
              height: wiki.imageHeight,
              formatted_url: wiki.imageUrl,
            },
          ]
        : [],
      formatted_screenshots: wiki.imageUrl
        ? [
            {
              id: `${wiki.id}-cover`,
              image_id: `${wiki.id}-cover`,
              url: wiki.imageUrl,
              width: wiki.imageWidth,
              height: wiki.imageHeight,
              formatted_url: wiki.imageUrl,
            },
          ]
        : [],
      videos: [],
      similar_games: [],
      genres: wiki.genres || [],
      platforms: wiki.platforms || [],
      developers: wiki.developers || [],
      publishers: wiki.publishers || [],
      release_date: wiki.release_date || "",
      site_detail_url: wiki.site_detail_url,
      system_requirements: null,
      controller_support: null,
      categories: [],
      features: [],
      source: "wikipedia",
    };

    setBoundedCache(DETAILS_CACHE, cacheKey, formatted);
    return formatted;
  }

  setBoundedCache(DETAILS_CACHE, cacheKey, null);
  return null;
}

/**
 * Get fallback artwork URLs { grid, hero, header, source } when SteamGridDB has no match.
 * Order: GOG -> Wikipedia -> CheapShark.
 */
async function getFallbackArtwork(gameName) {
  const cleanName = cleanGameName(gameName);
  if (!cleanName) return { grid: null, hero: null, header: null, source: null };

  const cacheKey = cleanName.toLowerCase();
  const cached = getBoundedCache(ARTWORK_CACHE, cacheKey);
  if (cached !== undefined) return cached;

  const gog = await searchGogGame(cleanName);
  if (gog && (gog.coverVertical || gog.coverHorizontal || gog.screenshots.length > 0)) {
    const firstShot = gog.screenshots[0]?.url || null;
    const art = {
      grid: gog.coverVertical || gog.coverHorizontal || firstShot,
      hero: firstShot || gog.coverHorizontal || gog.coverVertical,
      header: gog.coverHorizontal || gog.coverVertical || firstShot,
      source: "gog",
    };
    setBoundedCache(ARTWORK_CACHE, cacheKey, art);
    return art;
  }

  const wiki = await searchWikipediaGame(cleanName);
  if (wiki?.imageUrl) {
    const art = {
      grid: wiki.imageUrl,
      hero: wiki.imageUrl,
      header: wiki.imageUrl,
      source: "wikipedia",
    };
    setBoundedCache(ARTWORK_CACHE, cacheKey, art);
    return art;
  }

  const cs = await searchCheapSharkArtwork(cleanName);
  if (cs) {
    setBoundedCache(ARTWORK_CACHE, cacheKey, cs);
    return cs;
  }

  const empty = { grid: null, hero: null, header: null, source: null };
  setBoundedCache(ARTWORK_CACHE, cacheKey, empty);
  return empty;
}

module.exports = {
  getFallbackGameDetails,
  getFallbackArtwork,
  // Exported for unit testing
  cleanGameName,
  normalizeForMatch,
  titleMatchScore,
};
