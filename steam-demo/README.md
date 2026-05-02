# Steam API Demo

A self-contained proof-of-concept for the WhatCanWePlay backend rebuild. Built to validate the Steam API approach before rewriting the main app.

## Purpose

The main app (`../index.js`) had several blockers going into the rebuild:

- The SteamSpy rate limit was coded as 65 seconds per request when the actual limit is 1 req/sec
- The Steam Store `appdetails` rate limit (200 req / 5 min) was not being respected, causing silent 429s
- All enrichment happened synchronously, blocking users with large libraries for minutes
- A single shared rate-limit queue meant one-off lookups got stuck behind bulk requests
- SteamSpy was the only source for multiplayer detection, when Steam's own `appdetails` categories are sufficient

This demo proves out the correct approach to all of the above.

## Running

```
npm install
node server.js
```

Open `http://localhost:3001`.

Requires a `.env` file with:

```
STEAM_API_KEY=your_key_here
PORT=3001
```

The `.env` file is already set up with the dev key. Do not commit it.

## File Structure

```
steam-demo/
  server.js           Express server and routes
  src/
    steamService.js   All Steam API logic, rate limiting, caching
  public/
    index.html        Demo UI
  .env                API keys (gitignored)
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/status` | Health check and cache stats |
| GET | `/api/library/:steamId` | Raw owned games list, no enrichment |
| GET | `/api/game/:appId` | Full details for one game (direct, no queue) |
| GET | `/api/multiplayer/:steamId` | Multiplayer games for one user, with filters |
| GET | `/api/multiplayer/:steamId/stream` | Same but SSE stream — results appear as they arrive |
| POST | `/api/shared` | Shared multiplayer games across multiple Steam IDs |

## What Each Section of the UI Shows

**Section 1 - User Library**
Raw `GetOwnedGames` call. Fast, no rate limiting. Shows total game count and a preview of titles.

**Section 2 - Single Game Details**
Full enriched data for one game. Bypasses both rate-limit queues so it responds in 1-2 seconds regardless of what else is running. Returns: name, multiplayer types, all Steam categories, Steam genres, user-defined tags (from SteamSpy), price with discount info, header image, description, store URL.

**Section 3 - My Multiplayer Games**
Fetches the user's library then enriches games via appdetails + SteamSpy. Key behaviors:
- Sorted by playtime descending so the most-played games appear first
- Results stream in one card at a time via SSE rather than waiting for the full batch
- Cached results appear instantly on repeat runs
- Default limit of 20 new API calls per run (~30 seconds). Re-run to load more from cache.
- Filters (category, genre, price) apply client-side after streaming completes, no extra API calls

**Section 4 - Shared Multiplayer Games**
The core WhatCanWePlay feature. Add 2 or more Steam IDs, find multiplayer games they all own. Same filter controls as Section 3.

## Key Technical Decisions

### Two Independent Rate-Limit Queues

`appdetails` (Steam Store) and SteamSpy run on separate promise chains. They never block each other. When enriching a game in bulk, both calls start at the same time and the result arrives in `max(1500ms, 1100ms)` instead of `1500 + 1100 = 2600ms`.

### Direct vs Queued Fetching

Single-game lookups (`getGameDetails`) call `fetchWithRetry` directly, bypassing both queues entirely. Bulk enrichment (`getGameDetailsQueued`) uses the rate-limited queues. This means a user looking up one game is never blocked by an in-progress stream.

### SSE Streaming

`GET /api/multiplayer/:steamId/stream` uses Server-Sent Events. The server enriches games one by one and pushes each result to the client as it finishes. Cached hits come through first (instant), then uncached games arrive every ~1500ms. This avoids the main UX problem in the original app where users with large libraries saw a blank spinner for 5+ minutes.

### Multiplayer Detection Without SteamSpy

Steam's `appdetails` returns a `categories` array with IDs. The following category IDs indicate multiplayer:

| ID | Description |
|----|-------------|
| 1  | Multi-player |
| 9  | Co-op |
| 27 | Cross-Platform Multiplayer |
| 36 | Online PvP |
| 37 | Online Co-op |
| 38 | LAN PvP |
| 39 | LAN Co-op |
| 47 | PvP |
| 48 | Online PvP (alt) |
| 49 | LAN Co-op (alt) |

The original app used SteamSpy for this and checked for the string `"Multi-player"` in the joined tags. That missed Co-op-only games and anything that didn't go through SteamSpy.

### SteamSpy for User Tags Only

SteamSpy is now used exclusively for user-defined tags ("Turn-Based Combat", "Story Rich", "Fantasy", etc.) which are not available from Steam's own API. The `appdetails` response has `categories` (Single-player, Co-op, etc.) and `genres` (Action, RPG, etc.) but no user tags.

Rate limit: 1 req/sec. The original app had this set to 65 seconds per request, which was wrong.

### Game Data Returned Per Game

| Field | Source |
|-------|--------|
| `name` | appdetails |
| `isMultiplayer` | derived from appdetails categories |
| `multiplayerTypes` | appdetails categories (multiplayer subset) |
| `categories` | appdetails categories (full list) |
| `genres` | appdetails genres |
| `tags` | SteamSpy user-defined tags |
| `price.final` | appdetails price_overview |
| `price.initial` | appdetails price_overview |
| `price.discountPct` | appdetails price_overview |
| `headerImage` | appdetails |
| `description` | appdetails short_description |
| `storeUrl` | constructed from appId |

## What Is Not Done Yet

- No database. All caching is in-memory and resets on server restart. The real rebuild needs Supabase for persistent game storage so enrichment only runs once per game per cache window.
- No pending queue backed by a database. The demo uses a per-request limit and defers the rest. The real app needs a `pending_games` table and a background processing route like the existing `/api/cron/process-pending`.
- No Steam OpenID authentication. The demo accepts any Steam ID directly.
- No shared game filtering applied server-side for the shared route. Filters are applied after the intersection is computed, which is fine for small rooms but worth revisiting.
- The SteamSpy dependency is still unofficial. If it goes down, tags become unavailable. No fallback is implemented.

## Relation to the Main App

This demo was built alongside the existing app in `../index.js`. It does not modify the main app. Once the rebuild is ready, the patterns here (rate limiters, direct vs queued fetching, streaming, multiplayer detection by category ID) should replace the equivalent logic in the main app.

The main app issues that still need addressing in the rebuild, independent of this demo:
- SQL injection in filter query construction (tagSelection, minPriceSelection interpolated directly into SQL strings)
- Socket.IO and Supabase Realtime running in parallel — Socket.IO should be removed
- Cookies missing httpOnly, secure, and sameSite flags
- `database.js` parses SQL strings with regex to determine intent — should be replaced with explicit named methods
