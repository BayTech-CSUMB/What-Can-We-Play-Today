const fetch = require('node-fetch');

const STEAM_KEY = process.env.STEAM_API_KEY;

// Steam category IDs that mean the game has some form of multiplayer
const MULTIPLAYER_CATEGORY_IDS = new Set([1, 9, 27, 36, 37, 38, 39, 47, 48, 49]);

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Two independent queues — appdetails and SteamSpy never block each other.

// Steam Store appdetails: ~200 req / 5 min → 1 per 1500ms
const APPDETAILS_DELAY_MS = 1500;
let lastAppDetailsCall = 0;
let appDetailsChain = Promise.resolve();

function rateLimitedFetch(url) {
  appDetailsChain = appDetailsChain.then(async () => {
    const wait = Math.max(0, lastAppDetailsCall + APPDETAILS_DELAY_MS - Date.now());
    if (wait > 0) await delay(wait);
    try {
      return await fetchWithRetry(url);
    } finally {
      lastAppDetailsCall = Date.now();
    }
  });
  return appDetailsChain;
}

// SteamSpy: 1 req/sec → 1100ms to be safe
const STEAMSPY_DELAY_MS = 1100;
let lastSteamSpyCall = 0;
let steamSpyChain = Promise.resolve();

function rateLimitedSteamSpy(url) {
  steamSpyChain = steamSpyChain.then(async () => {
    const wait = Math.max(0, lastSteamSpyCall + STEAMSPY_DELAY_MS - Date.now());
    if (wait > 0) await delay(wait);
    try {
      return await fetchWithRetry(url);
    } finally {
      lastSteamSpyCall = Date.now();
    }
  });
  return steamSpyChain;
}

async function fetchWithRetry(url, attempt = 0) {
  const res = await fetch(url);
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const wait = 1000 * Math.pow(2, attempt);
    console.warn(`[steam] retry ${attempt + 1} for ${url} (status ${res.status})`);
    await delay(wait);
    return fetchWithRetry(url, attempt + 1);
  }
  return res;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── In-memory cache ───────────────────────────────────────────────────────────
const gameCache    = new Map(); // appId  → { data, expiresAt }
const libraryCache = new Map(); // steamId → { data, expiresAt }
const tagsCache    = new Map(); // appId  → { data, expiresAt }

const GAME_TTL_MS    = 24 * 60 * 60 * 1000;
const LIBRARY_TTL_MS = 10 * 60 * 1000;

function cacheGet(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { map.delete(key); return null; }
  return entry.data;
}

function cacheSet(map, key, data, ttl) {
  map.set(key, { data, expiresAt: Date.now() + ttl });
}

// ── SteamSpy tags ────────────────────────────────────────────────────────────

async function _fetchAndParseTags(appId, fetchFn) {
  const cached = cacheGet(tagsCache, appId);
  if (cached !== null && cached !== undefined) return cached;
  if (tagsCache.has(appId)) return [];

  try {
    const url = `https://steamspy.com/api.php?request=appdetails&appid=${appId}`;
    const res = await fetchFn(url);
    if (!res.ok) { cacheSet(tagsCache, appId, [], GAME_TTL_MS); return []; }
    const json = await res.json();
    const tags = json?.tags ? Object.keys(json.tags) : [];
    cacheSet(tagsCache, appId, tags, GAME_TTL_MS);
    console.log(`[steamspy] tags for ${appId}: ${tags.slice(0, 5).join(', ')}…`);
    return tags;
  } catch {
    cacheSet(tagsCache, appId, [], GAME_TTL_MS);
    return [];
  }
}

// Direct (no queue) — for single lookups
function getTagsDirect(appId) {
  return _fetchAndParseTags(appId, (url) => fetchWithRetry(url));
}

// Queued — for bulk enrichment (stream, shared games)
function getTagsQueued(appId) {
  return _fetchAndParseTags(appId, (url) => rateLimitedSteamSpy(url));
}

// ── Steam API calls ───────────────────────────────────────────────────────────

/**
 * Get all games owned by a Steam user.
 * Returns [{ appid, name, playtime_forever, img_icon_url }]
 */
async function getOwnedGames(steamId) {
  const cached = cacheGet(libraryCache, steamId);
  if (cached) {
    console.log(`[steam] library cache hit  ${steamId}`);
    return cached;
  }

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/`
    + `?key=${STEAM_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`GetOwnedGames ${res.status} for ${steamId}`);
  const json = await res.json();
  const games = json?.response?.games ?? [];

  cacheSet(libraryCache, steamId, games, LIBRARY_TTL_MS);
  console.log(`[steam] GetOwnedGames ${steamId} → ${games.length} games`);
  return games;
}

/**
 * Get full enriched details for a single app from the Steam Store API.
 *
 * Returns:
 * {
 *   appId, name,
 *   isMultiplayer,          // true/false
 *   multiplayerTypes,       // ["Multi-player", "Online Co-op", ...]  (subset of categories)
 *   categories,             // ALL Steam categories  ["Single-player", "Multi-player", "Steam Achievements", ...]
 *   genres,                 // Steam genres  ["Action", "RPG", ...]
 *   price: { final, initial, discountPct, isFree },
 *   headerImage, description, storeUrl
 * }
 * or null if delisted.
 */
// Shared parse logic — accepts pre-fetched tags so callers can run both in parallel
async function _parseAppDetails(appId, res, tags = []) {
  if (!res.ok) throw new Error(`appdetails ${res.status} for ${appId}`);
  const json = await res.json();

  const entry = json?.[`${appId}`];
  if (!entry?.success || !entry?.data) {
    cacheSet(gameCache, appId, null, GAME_TTL_MS);
    return null;
  }

  const d = entry.data;

  // Categories (what the current app calls "genre" in the DB)
  const allCategories = (d.categories ?? []).map((c) => c.description);
  const multiplayerTypes = (d.categories ?? [])
    .filter((c) => MULTIPLAYER_CATEGORY_IDS.has(c.id))
    .map((c) => c.description);
  const isMultiplayer = multiplayerTypes.length > 0;

  // Steam genres (Action, RPG, Strategy…) — separate from categories
  const genres = (d.genres ?? []).map((g) => g.description);

  // Price
  const po = d.price_overview;
  const price = po
    ? {
        final:       po.final_formatted,
        initial:     po.initial_formatted,
        discountPct: po.discount_percent,
        isFree:      false,
      }
    : { final: 'Free', initial: 'Free', discountPct: 0, isFree: true };

  const result = {
    appId,
    name:             d.name,
    isMultiplayer,
    multiplayerTypes,
    categories:       allCategories,
    genres,
    tags,                              // user-defined tags from SteamSpy
    price,
    headerImage:      d.header_image ?? '',
    description:      d.short_description ?? '',
    storeUrl:         `https://store.steampowered.com/app/${appId}/`,
  };

  cacheSet(gameCache, appId, result, GAME_TTL_MS);
  return result;
}

/**
 * Get details for a single game — skips both rate-limit queues so it responds
 * immediately. Fetches appdetails + SteamSpy tags in parallel.
 */
async function getGameDetails(appId) {
  const cached = cacheGet(gameCache, appId);
  if (cached !== undefined && cached !== null) return cached;
  if (gameCache.has(appId)) return null;

  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=en`;
  console.log(`[steam] appdetails+tags direct  ${appId}`);
  // Run both in parallel — neither is queued so no wait
  const [res, tags] = await Promise.all([
    fetchWithRetry(url),
    getTagsDirect(appId),
  ]);
  return _parseAppDetails(appId, res, tags);
}

/**
 * Rate-limited version for bulk enrichment (stream, shared games).
 * appdetails and SteamSpy use separate queues so they interleave rather than stack.
 */
async function getGameDetailsQueued(appId) {
  const cached = cacheGet(gameCache, appId);
  if (cached !== undefined && cached !== null) return cached;
  if (gameCache.has(appId)) return null;

  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=en`;
  console.log(`[steam] appdetails+tags queued  ${appId}`);
  // Both queued but on independent chains — they run concurrently
  const [res, tags] = await Promise.all([
    rateLimitedFetch(url),
    getTagsQueued(appId),
  ]);
  return _parseAppDetails(appId, res, tags);
}

// ── Higher-level helpers ──────────────────────────────────────────────────────

/**
 * Get multiplayer games for a single user (enriched, rate-limited).
 * Sorts by playtime descending so the most-played games are enriched first.
 * `limit` caps how many NEW (uncached) appdetails calls are made this request.
 */
async function getMultiplayerGames(steamId, limit = 20) {
  const owned = await getOwnedGames(steamId);
  // Most-played first — these are the games people actually want to see
  const sorted = [...owned].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
  console.log(`[steam] enriching up to ${limit} new games for ${steamId} (${sorted.length} total, sorted by playtime)`);

  const results = [];
  let fetched = 0;

  for (const game of sorted) {
    const cached = cacheGet(gameCache, game.appid);

    if (cached !== null && cached !== undefined) {
      if (cached?.isMultiplayer) results.push(cached);
      continue;
    }
    if (gameCache.has(game.appid)) continue; // delisted, skip

    if (fetched >= limit) {
      console.log(`[steam] hit limit (${limit}) — remaining games deferred`);
      break;
    }

    const details = await getGameDetailsQueued(game.appid);
    fetched++;
    if (details?.isMultiplayer) results.push(details);
  }

  return results;
}

/**
 * Async generator version of getMultiplayerGames.
 * Yields each multiplayer game as soon as it's enriched so the caller
 * can stream results to the client without waiting for the full batch.
 */
async function* streamMultiplayerGames(steamId, limit = 20) {
  const owned = await getOwnedGames(steamId);
  const sorted = [...owned].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));

  // First pass: yield cached hits instantly (no delay)
  for (const game of sorted) {
    const cached = cacheGet(gameCache, game.appid);
    if (cached !== null && cached !== undefined) {
      if (cached?.isMultiplayer) yield { game: cached, fromCache: true };
    }
  }

  // Second pass: enrich uncached games up to limit, yielding each result as it arrives
  let fetched = 0;
  for (const game of sorted) {
    if (gameCache.has(game.appid)) continue; // already cached (including null/delisted)
    if (fetched >= limit) break;

    const details = await getGameDetailsQueued(game.appid);
    fetched++;
    if (details?.isMultiplayer) yield { game: details, fromCache: false };
  }

  // Signal how many were deferred
  const uncached = sorted.filter(g => !gameCache.has(g.appid)).length;
  yield { done: true, totalOwned: sorted.length, deferred: Math.max(0, uncached - limit) };
}

/**
 * Find multiplayer games shared by ALL given Steam IDs.
 * Returns [{ game, owners: [steamId, ...] }]
 */
async function getSharedMultiplayerGames(steamIds, limit = 30) {
  // Fetch all libraries in parallel (no appdetails = no rate limit concern)
  const libraries = await Promise.all(
    steamIds.map(async (id) => {
      const games = await getOwnedGames(id);
      return { steamId: id, appIds: new Set(games.map((g) => g.appid)) };
    })
  );

  const [first, ...rest] = libraries;
  const sharedAppIds = [...first.appIds].filter((id) =>
    rest.every((lib) => lib.appIds.has(id))
  );

  console.log(`[steam] ${sharedAppIds.length} shared app IDs across ${steamIds.length} users, enriching up to ${limit}`);

  const shared = [];
  let fetched = 0;

  for (const appId of sharedAppIds) {
    const cached = cacheGet(gameCache, appId);

    if (cached !== null && cached !== undefined) {
      if (cached?.isMultiplayer) shared.push({ game: cached, owners: steamIds });
      continue;
    }
    if (gameCache.has(appId)) continue;

    if (fetched >= limit) break;

    const details = await getGameDetailsQueued(appId);
    fetched++;
    if (details?.isMultiplayer) shared.push({ game: details, owners: steamIds });
  }

  return shared;
}

function getCacheStats() {
  return {
    cachedGames:      gameCache.size,
    cachedTags:       tagsCache.size,
    cachedLibraries:  libraryCache.size,
    appdetailsDelayMs: APPDETAILS_DELAY_MS,
    steamspyDelayMs:   STEAMSPY_DELAY_MS,
  };
}

module.exports = {
  getOwnedGames,
  getGameDetails,
  getMultiplayerGames,
  streamMultiplayerGames,
  getSharedMultiplayerGames,
  getCacheStats,
};
