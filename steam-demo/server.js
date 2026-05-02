require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  getOwnedGames,
  getGameDetails,
  getMultiplayerGames,
  streamMultiplayerGames,
  getSharedMultiplayerGames,
  getCacheStats,
} = require('./src/steamService');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Filter helpers ────────────────────────────────────────────────────────────

function applyFilters(games, { category, genre, priceFilter, minPrice, maxPrice }) {
  return games.filter((g) => {
    if (category && !g.categories.includes(category)) return false;
    if (genre && !g.genres.includes(genre)) return false;

    const price = g.price.isFree ? 0 : parseFloat(g.price.final.replace(/[^0-9.]/g, '')) || 0;
    if (priceFilter === 'free'   && price !== 0)  return false;
    if (priceFilter === 'under10' && price > 10)  return false;
    if (priceFilter === 'under40' && price > 40)  return false;
    if (priceFilter === 'range') {
      const min = parseFloat(minPrice) || 0;
      const max = parseFloat(maxPrice) || Infinity;
      if (price < min || price > max) return false;
    }
    return true;
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health + cache stats
app.get('/api/status', (req, res) => {
  res.json({ ok: true, cache: getCacheStats(), timestamp: new Date().toISOString() });
});

// Raw library — fast, no rate limiting
app.get('/api/library/:steamId', async (req, res) => {
  try {
    const games = await getOwnedGames(req.params.steamId);
    res.json({ steamId: req.params.steamId, count: games.length, games });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Single game — full details
app.get('/api/game/:appId', async (req, res) => {
  try {
    const details = await getGameDetails(Number(req.params.appId));
    if (!details) return res.status(404).json({ error: 'Game not found or delisted' });
    res.json(details);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// SSE stream — multiplayer games appear one at a time as enrichment completes
// GET /api/multiplayer/:steamId/stream?limit=20
app.get('/api/multiplayer/:steamId/stream', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 60);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    for await (const item of streamMultiplayerGames(req.params.steamId, limit)) {
      send(item);
    }
  } catch (err) {
    console.error('[SSE]', err);
    send({ error: err.message });
  }

  res.end();
});

// Multiplayer games for one user — with optional filters
// GET /api/multiplayer/:steamId?limit=20&category=Co-op&priceFilter=under10
app.get('/api/multiplayer/:steamId', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const games = await getMultiplayerGames(req.params.steamId, limit);

    const filtered = applyFilters(games, {
      category:    req.query.category   || '',
      genre:       req.query.genre      || '',
      priceFilter: req.query.priceFilter || '',
      minPrice:    req.query.minPrice,
      maxPrice:    req.query.maxPrice,
    });

    // Collect all unique categories + genres from this user's multiplayer games
    const allCategories = [...new Set(games.flatMap((g) => g.categories))].sort();
    const allGenres     = [...new Set(games.flatMap((g) => g.genres))].sort();

    res.json({
      steamId:      req.params.steamId,
      total:        games.length,
      filtered:     filtered.length,
      allCategories,
      allGenres,
      games:        filtered,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Shared multiplayer games for multiple users — with optional filters
// POST /api/shared  { steamIds: [...], limit: 30, category, genre, priceFilter, minPrice, maxPrice }
app.post('/api/shared', async (req, res) => {
  try {
    const {
      steamIds,
      limit       = 30,
      category    = '',
      genre       = '',
      priceFilter = '',
      minPrice,
      maxPrice,
    } = req.body;

    if (!Array.isArray(steamIds) || steamIds.length < 2) {
      return res.status(400).json({ error: 'Provide at least 2 steamIds' });
    }

    const safeLimit = Math.min(parseInt(limit) || 30, 100);
    const shared = await getSharedMultiplayerGames(steamIds, safeLimit);

    const sharedGames = shared.map((e) => e.game);
    const filtered    = applyFilters(sharedGames, { category, genre, priceFilter, minPrice, maxPrice });

    // Collect all unique categories + genres from shared games (for filter dropdowns)
    const allCategories = [...new Set(sharedGames.flatMap((g) => g.categories))].sort();
    const allGenres     = [...new Set(sharedGames.flatMap((g) => g.genres))].sort();

    res.json({
      steamIds,
      total:        sharedGames.length,
      filtered:     filtered.length,
      allCategories,
      allGenres,
      games:        filtered.map((g) => ({ game: g, owners: steamIds })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Steam API demo  →  http://localhost:${PORT}`);
  console.log(`API key: ${process.env.STEAM_API_KEY ? '✓ loaded' : '✗ MISSING — set STEAM_API_KEY in .env'}`);
});
