// Load environment configuration (only for local development)
if (!process.env.VERCEL) {
  const dotenv = require('dotenv');
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
  dotenv.config({ path: envFile });
}

// Critical for Express itself
const express = require("express");
const app = express();

// Add error handling for initialization
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Ensure API Keys and Confidential Data don't get published to Github
const config = {
  steamKey: process.env.STEAM_KEY,
  sessionSecret: process.env.SESSION_SECRET,
  url: process.env.SITE_URL,
  keyPath: process.env.SSL_KEY_PATH,
  certPath: process.env.SSL_CERT_PATH
};

// SSL certificate loading for local server hosting (not needed for Vercel deployment)
// Vercel automatically handles SSL certificates, but keep this code for local hosting
// let fs;
// let options;
// if (process.env.ENVIRO == "prod") {
//     fs = require("fs");
//     options = {
//       key: fs.readFileSync(config.keyPath),
//       cert: fs.readFileSync(config.certPath)
//     };
// }

// Modules used to facilitate data transfer and storage
const cookieParser = require("cookie-parser");
app.use(cookieParser());
const fetch = require("node-fetch");
const axios = require("axios");
const moment = require("moment");
// Library for scheduling daily quick updates & periodic deep updates
const cron = require('node-cron');

// ================== API RATE LIMITING & RETRIES ==================
// Centralized rate limiting wrapper for external API calls to reduce 429s.
const RATE_LIMITS = {
  steamStore: { minDelay: 400 }, // ~2.5 req/sec
  steamSpy: { minDelay: 65000 }, // 1+ minute per request
};

const _rlState = {
  steamStore: { last: 0, chain: Promise.resolve() },
  steamSpy: { last: 0, chain: Promise.resolve() },
};

function _delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _fetchWithBackoff(url, options, attempt = 0) {
  const res = await fetch(url, options);
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) return res; // give up after a few tries
    let wait = 1000 * Math.pow(2, attempt);
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (!isNaN(secs)) wait = Math.max(wait, secs * 1000);
    }
    await _delay(wait);
    return _fetchWithBackoff(url, options, attempt + 1);
  }
  return res;
}

function rateLimitedFetch(url, group = 'steamStore', options) {
  const state = _rlState[group];
  const minDelay = RATE_LIMITS[group].minDelay;
  state.chain = state.chain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, state.last + minDelay - now);
    if (wait) await _delay(wait);
    try {
      return await _fetchWithBackoff(url, options);
    } finally {
      state.last = Date.now();
    }
  });
  return state.chain;
}

// Server creation - use HTTP for both dev and production (Vercel handles HTTPS)
let server = require("http").createServer(app);
// For local SSL hosting, uncomment below and comment above:
// let server;
// if (process.env.ENVIRO=="prod") {
//     server = require("https").createServer(options, app);
// } else { // dev
//     server = require("http").createServer(app);
// }

// HTTP to HTTPS redirect server (only needed for local hosting, not Vercel)
// Vercel handles domain redirects automatically when you add a custom domain
// const http = require("http");
// const httpApp = express();
// 
// httpApp.all("*", (req, res) =>
//   res.redirect(301, process.env.REDIRECT_TARGET)
// );
// const httpServer = http.createServer(httpApp);
// httpServer.listen(80, () =>
//   console.log(`STARTUP: HTTP Redirecter Server Up on Port 80!\n Site running on: http://localhost`)
// );

// TODO: Double check what CORS policy will mean for our app.
const io = require("socket.io")(server, { cors: { origin: "*" } });

// Setting up a helper Wrapper library to make the Steam API much easier to use
const steamWrapper = require("steam-js-api");
steamWrapper.setKey(config.steamKey);

// Necessary for Steam Oauth
const SteamAuth = require("node-steam-openid");
const { type } = require("os");
const { diff } = require("semver");

// Setup for Steam Oauth
const steam = new SteamAuth({
  realm: config.url,
  returnUrl: config.url + "/auth/steam/authenticate",
  apiKey: config.steamKey,
});

// Utilizing a rate limiter to ensure we don't get DOS'ed
const rateLimiter = require('express-rate-limit')
const limiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
});

// Variables for counting our API requests per day, resets daily.
let steamAPICount = 0;
let spyAPICount = 0;

app.use(limiter);

// Tell Express which Templating Engine we're using
app.set("view engine", "ejs");
// Specify the Folder for Statics
app.use(express.static("public"));
// Need this line to allow Express to parse values sent by POST forms
app.use(express.urlencoded({ extended: true }));
// Setup our database connection (Supabase for production, SQLite for local dev)
let db;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    // Use Supabase for production/cloud deployment
    db = require('./database');
    console.log('Database: Using Supabase');
  } else {
    // Fallback to SQLite for local development
    const sqlite = require("better-sqlite3")(`./private/games.db`);
    sqlite.prepare(`CREATE TABLE IF NOT EXISTS PendingGames (
      gameID TEXT PRIMARY KEY,
      created_at TEXT
    )`).run();
    db = sqlite;
    console.log('Database: Using SQLite');
  }
} catch (error) {
  console.error("Database initialization failed:", error.message);
  // Create a mock database object to prevent crashes
  db = {
    prepare: () => ({
      run: () => ({ changes: 0 }),
      get: () => null,
      all: () => []
    })
  };
  console.log('Database: Using mock database');
}

// ================== RUNTIME VARIABLES ==================

// TODO: Consolidate the two room structs (this & socketRooms) so we don't use extra memory.
let existingRooms = [];
// Sockets used for members of the same room
function Room(roomNumber, roomMembers) {
  this.roomNumber = roomNumber;
  this.roomMembers = roomMembers;
  this.roomSize = 0;
}
// TODO: we have roomSize but never use it. 
// A fix for the above is to do daily purging of "empty" rooms as w/out regular clearing of the web app, the room structure will continue to keep growing.

// Hard coded users for testing
let mainTestingRoom = new Room(`99999`, [
  [
    `76561198016716226`,
    `TidalWings`,
    `https://avatars.steamstatic.com/de63198a51c76b3ed2dfd72e82d2ce4d666ce449_medium.jpg`,
  ],
]);
let altTestingRoom = new Room(`11111`, [
  [
    `76561199516233321`,
    `drslurpeemd`,
    `https://avatars.steamstatic.com/b9fa08a1e25a9dadaebbab031b6b2974502416fa_medium.jpg`,
  ],
]);
let socketRooms = [];
socketRooms.push(mainTestingRoom);
socketRooms.push(altTestingRoom);
existingRooms.push(`99999`);
existingRooms.push(`11111`);

// ================== FUNCTIONS ==================

// Fetches details of game using its id
async function fetchTags(gameID) {
  const url = `https://steamspy.com/api.php?request=appdetails&appid=${gameID}`;
  // NOTE: SteamSpy is extremely rate limited. We keep the call but throttle hard.
  const response = await rateLimitedFetch(url, 'steamSpy');
  const result = await response.json();
  const tags = Object.keys(result.tags).join(",");
  spyAPICount += 1;
  return tags;
}

/**
 * deleteRoom will only be run on situations where the user is the LAST user in a room. It will go and delete the entire element from the array.
 * @param {Number} roomNumber the number of the room to be deleted
 */
function deleteRoom(roomNumber) {
  let indexOfRoom = -1;

  for (let i = 0; i < socketRooms.length; i++) {
    const curRoomNum = socketRooms[i].roomNumber;
    if (curRoomNum == roomNumber) {
      indexOfRoom = i;
    }
  }

  // Ensuring we ACTUALLY only delete the room if it's found
  if (indexOfRoom != -1) {
    socketRooms.splice(indexOfRoom, 1);
  }
}

/**
 * Removes user from the room
 * @param {*} roomNumber
 * @param {*} userID
 */
function deleteUserFromRoom(roomNumber, userID) {
  let indexOfRoom = -1;

  for (let i = 0; i < socketRooms.length; i++) {
    const curRoomNum = socketRooms[i].roomNumber;
    if (curRoomNum == roomNumber) {
      indexOfRoom = i;
    }
  }

  // Ensuring we ACTUALLY only delete the room if it's found
  if (indexOfRoom != -1) {
    let indexOfUser = -1;

    let curRoomMembers = socketRooms[indexOfRoom].roomMembers;
    for (let j = 0; j < curRoomMembers.length; j++) {
      if (curRoomMembers[j][0] == userID) {
        indexOfUser = j;
      }
    }

    if (indexOfUser != -1) {
      socketRooms[indexOfRoom].roomMembers.splice(indexOfUser, 1);
    }
  }
}

// Use inbuilt JS to compute the current date in a YYYY-MM-DD format.
function generateDate() {
  const curDate = new Date().toISOString().slice(0, 10);
  return curDate;
}

// Utilize MomentJS to compute the difference between two dates for another
// function to use to refresh game price data if needed.
function computeDateDiff(dateToCompare) {
  const daysBeforeRequery = 3; // can be changed later.
  // Convert dates to a MomentJS format & then compute the difference in days.
  let prevDate = moment(dateToCompare);
  let curDate = moment(generateDate());
  let diffDate = curDate.diff(prevDate, "days");

  return diffDate >= daysBeforeRequery;
}

// Used to get data that was not previously fetched using the game id
async function fetchGenresPrices(gameID) {
  // Then Steam's API for majority of the data. From this we want the "categories" and pricing of each game.
  const steamURL = `https://store.steampowered.com/api/appdetails?appids=${gameID}&l=en`;
  const response2 = await rateLimitedFetch(steamURL, 'steamStore');
  const result2 = await response2.json();
  steamAPICount += 1;
  let initial_price = 0;
  let final_price = 0;
  let genre = ``;
  let shortDesc = ``;
  let gameName = ``;
  let headerImg = ``;

  if (result2[`${gameID}`].success == true) {
    // ensures no de-listed games
    // Getting the price of the games
    // TODO: Certain games like GTA V don't even have price_overview but a convoluted layout, so there needs to be more searching for those edge cases.
    let priceOverview = result2[`${gameID}`].data.price_overview;
    if (typeof priceOverview != `undefined`) {
      final_price = priceOverview.final_formatted; // final
      initial_price = priceOverview.initial_formatted; // initial
      final_price = parseFloat(final_price.replace("$", ""));
      initial_price = parseFloat(initial_price.replace("$", ""));
    }
    // Getting the "categories" of the game
    let categories = result2[`${gameID}`].data.categories;
    let descriptions = ``;
    if (typeof categories != `undefined`) {
      descriptions = categories.map((category) => category.description);
      genre = descriptions.join();
    } else {
      genre = `Single-player`;
    }

    shortDesc = result2[`${gameID}`].data.short_description;
    gameName = result2[`${gameID}`].data.name;
    headerImg = result2[`${gameID}`].data.header_image;
  } else {
    genre = `Single-player`;
    initial_price = 0;
    final_price = 0;
  }

  return [genre, initial_price, final_price, shortDesc, gameName, headerImg];
}


async function quickGameUpdate() {
    const localDB = db.prepare("SELECT gameID FROM Games");
    const localGame = localDB.all();
    let tempGameData = [];

    // Use Promise.all to wait for all async operations
    await Promise.all(localGame.map(async (curGame) => {
        const steamURL = `https://store.steampowered.com/api/appdetails?appids=${curGame.gameID}&l=en`;
        const response2 = await rateLimitedFetch(steamURL, 'steamStore');
        const result2 = await response2.json();
        steamAPICount += 1;
        let final_price = 0; 

        if (result2[`${curGame.gameID}`].success == true) {
            let priceOverview = result2[`${curGame.gameID}`].data.price_overview;
            if (typeof priceOverview != `undefined`) {
                final_price = priceOverview.final_formatted;
                final_price = parseFloat(final_price.replace("$", ""));
            }
        }
        // Push to array
        tempGameData.push([curGame.gameID, final_price]);
    }));
    // Now we have an array with update gameIDs and prices, run through and update our DB with that information.
    tempGameData.forEach((curGame) => {
        db.prepare(
              `UPDATE Games SET price = ? WHERE gameID = ?`
            ).run(curGame[1], curGame[0]);
    });
    
    return tempGameData.length;
}

async function deepGameUpdate() {
    const localDB = db.prepare("SELECT gameID FROM Games");
    const localGame = localDB.all();
    let tempGameData = [];

    // NOTE: we are purposely omitting querying the SteamSpy API for additional tags due to the limiting factor of 1 query per minute. 
    // While nice for coverage, would be too much work to build around and it'd be better to cut off our reliance on that API in general instead.

    // Use Promise.all to wait for all async operations
    await Promise.all(localGame.map(async (curGame) => {
        let temp = await fetchGenresPrices(curGame.gameID);
        // Push to array: gameID, gameName, genre, initial & final price, shortDesc, headerImg
        tempGameData.push([curGame.gameID, temp[4], temp[0], temp[1], temp[2], temp[3], temp[5]]);
    }));
    // Now we have an array with update gameIDs and prices, run through and update our DB with that information.
    tempGameData.forEach((curGame) => {
        db.prepare(
              `UPDATE Games SET name = ?, genre = ?, price = ?, initial_price = ?, header_image = ?, description = ? WHERE gameID = ?`
            ).run(curGame[1], curGame[2], curGame[4], curGame[3], curGame[6], curGame[5], curGame[0]);
    });
}

// Process a queue of pending games to enrich details without hammering APIs
async function processPendingGames(limit = 30) {
  const pending = db.prepare("SELECT gameID FROM PendingGames ORDER BY created_at LIMIT ?").all(limit);
  if (!pending.length) return 0;

  for (const row of pending) {
    const gameID = row.gameID;
    try {
      const [genre, initial_price, final_price, shortDesc, gameName, headerImg] = await fetchGenresPrices(gameID);
      const is_multiplayer = genre && genre.includes('Multi-player') ? 1 : 0;
      const age = generateDate();
      const tags = ''; // Avoid SteamSpy to respect rate limits
      const storeUrl = `https://store.steampowered.com/app/${gameID}/`;

      db.prepare(
        `INSERT OR REPLACE INTO Games(gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url, description) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        `${gameID}`,
        gameName || '',
        genre || '',
        tags,
        age,
        final_price || 0,
        initial_price || 0,
        `${is_multiplayer}`,
        headerImg || '',
        storeUrl,
        shortDesc || ''
      );

      db.prepare("DELETE FROM PendingGames WHERE gameID = ?").run(`${gameID}`);
    } catch (e) {
      console.error(`PENDING: Failed to process game ${gameID}:`, e.message || e);
      // Leave it in queue; it can retry on next run
    }
  }
  return pending.length;
}

// Checks our database to see if we've got the game and then checks if the user is associated with said game
async function checkGames(steamID) {
  // First we'll fetch the list of owned games per the users steamID.
  // An API function that will set gameCount and gameInfo to the total count
  // of a users games and aan array of their games respectively.
  await steamWrapper
    .getOwnedGames(steamID, null, true)
    .then((result) => {
      gameCount = result.data.count;
      gameInfo = result.data.games;
    })
    .catch(console.error);
    // TODO: check documentation for how to change the output log of this error
    steamAPICount += 1;

  // We iterate through the users' games using the data from the above function
  for (let curGame = 0; curGame < gameCount; curGame++) {
    const gameName = gameInfo[curGame].name;
    const gamePic = gameInfo[curGame].url_store_header;
    const gameURL = gameInfo[curGame].url_store;
    const gameID = gameInfo[curGame].appID;

    // Variables that are et later with API fetches
    let tags = "";
    let genre = "";
    let final_price = 0;
    let initial_price = 0;
    let short_description = 0;

    // TODO: Add Short Description to our games so we can provide extended details on a game.

    // FIRST we query our database to see if we HAVE the game or not
    const localGame = db
      .prepare("SELECT * FROM Games WHERE gameID = ?")
      .get(`${gameID}`);

    // Then check if the user has the local game registered in the database
    const userPotentialGame = db
      .prepare("SELECT * FROM Users WHERE userID = ? AND gameID = ?")
      .get([`${steamID}`, `${gameID}`]);

    // if the game is located we check if the user has the game in their database
    if (localGame) {
      // IFF >= 3 days old then re-query. If the game is past it's "expiration"
      //   date we should go and reacquire the prices (in case of sales) and
      // update its database entry.
      if (computeDateDiff(localGame.age)) {
        // DEBUG: Check the game and its ID.
        // console.log(localGame);
        // console.log(localGame.gameID);

        let temp = await fetchGenresPrices(localGame.gameID);
        const initial_price = temp[1];
        const final_price = temp[2];
        const tempAge = generateDate();

        // console.log(`${final_price} ${initial_price} ${tempAge} ${localGame.gameID}`);

        // TODO: Could a single player game become a multiplayer one in the future?
        db.prepare(
          `UPDATE Games SET price = ?, initial_price = ?, age = ? WHERE gameID = ?`
        ).run(final_price, initial_price, tempAge, localGame.gameID);
      }
      // If they don't have the game in their table we add it to their database else do nothing
      if (!userPotentialGame) {
        db.prepare(`INSERT INTO Users (userID, gameID) VALUES (?, ?)`).run(
          steamID,
          `${gameID}`
        );
      }
    } else {
      // Game not in DB: throttle synchronous enrichment and queue the rest
      if (typeof globalThis.__processedNewGames === 'undefined') {
        globalThis.__processedNewGames = 0;
      }
      const MAX_SYNC_NEW_GAMES = parseInt(process.env.MAX_SYNC_NEW_GAMES || '20');

      if (globalThis.__processedNewGames < MAX_SYNC_NEW_GAMES) {
        try {
          // Enrich limited number of games synchronously (no SteamSpy tags)
          const temp = await fetchGenresPrices(gameID);
          genre = temp[0];
          initial_price = temp[1];
          final_price = temp[2];
          short_description = temp[3];
          let is_multiplayer = genre && genre.includes(`Multi-player`) ? 1 : 0;
          let age = generateDate();

          db.prepare(
            `INSERT INTO Games(gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url, description) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).run(
            `${gameID}`,
            gameName,
            genre || '',
            '', // omit SteamSpy tags to avoid limits
            age,
            final_price || 0,
            initial_price || 0,
            `${is_multiplayer}`,
            gamePic,
            gameURL,
            short_description || ''
          );
          globalThis.__processedNewGames++;
        } catch (e) {
          console.error(`CHECKGAMES: Failed to fetch details for ${gameID}:`, e.message || e);
          // Fallback: queue for later processing
          db.prepare(`INSERT OR IGNORE INTO PendingGames (gameID, created_at) VALUES (?, ?)`)
            .run(`${gameID}`, generateDate());
        }
      } else {
        // Queue remaining games for background processing
        db.prepare(`INSERT OR IGNORE INTO PendingGames (gameID, created_at) VALUES (?, ?)`)
          .run(`${gameID}`, generateDate());
      }

      // Always associate user to game (join will work once Games row is ready)
      db.prepare(`INSERT INTO Users (userID, gameID) VALUES (?,?)`).run(
        steamID,
        `${gameID}`
      );
    }
  }
}

/**
 * Given tags to parse and tags to ignore, builds and maintains an array of tags to return.
 * @param {String} inputTags are the incoming tags (in this format `FPS,Action,Strategy` etc.)
 * @param {Array} existingTags are tags that SHOULDN'T BE returned because they were previously added. In a array format.
 * @returns {Array} toReturn curated tag array.
 */
function maintainTags(inputTags, existingTags) {
  const splitTags = inputTags.split(",");
  let toReturn = existingTags;

  splitTags.forEach((tag) => {
    if (!toReturn.includes(tag)) {
      toReturn.push(tag);
    }
  });

  return toReturn;
}

// ================== ROUTES ==================

// corresponds to page.com
app.get("/", (req, res) => {
  res.render("index");
});

// Renders our privacy policy
app.get("/privacy-policy", (req, res) => {
  res.render("privacy-policy");
});

// Redirects user to steam login page
app.get("/auth/steam", async (req, res) => {
  const redirectUrl = await steam.getRedirectUrl();
  return res.redirect(redirectUrl);
});

// Gets user information and renders the rooms page
app.get("/auth/steam/authenticate", async (req, res) => {
  try {
    const user = await steam.authenticate(req);
    steamAPICount += 1;

    console.log(`LOGIN: ${user["username"]} has successfully logged in!`);

    // TODO: Check that this cookie storage method is best practices.
    res.cookie("steamID", user["steamid"]);
    res.cookie("username", user["username"]);
    res.cookie("avatar", user["avatar"]["medium"]);

    // DEBUG: Checking who is logged in via Backend
    // console.log(`${user["username"]} has logged in!`);

    res.render("room-choice");
  } catch (error) {
    console.error(`LOGIN: Couldn't Fetch! ${error}`);
  }
});

//Used in case users want to login through their steam id
app.get("/alt-login", (req, res) => {
    // We try to decode a previous Steam ID from the URI
    let steamID = decodeURIComponent(req.query.id);
    // If it doesn't exist we'll just set it to empty so the page doesn't 
    // load a big "undefined" in the input field.
    if (steamID === `undefined`) {
        steamID = ``;
    }
    res.render("alt-login", {"steamID": steamID});
});

// Users get shown the CREATE or JOIN room buttons. Here they'll start the process of generating a Room Number and allowing others to join them.
app.get("/room-choice", (req, res) => {
  if (req.cookies.steamID == null) {
    res.redirect("/");
  } else {
    res.render("room-choice");
  }
});

// Passes host role and creates a unique room
app.post("/room-choice", async (req, res) => {
  let roomNumber = Math.floor(Math.random() * 90000) + 10000;
  roomNumber = roomNumber.toString();
  // Ensures that room numbers are random and unique so we don't have colliding room IDs.
  while (existingRooms.includes(roomNumber)) {
    roomNumber = Math.floor(Math.random() * 90000) + 10000;
    roomNumber = roomNumber.toString();
  }

  // Add our now guaranteed unique room to the existing rooms & also add the number to the users cookies.
  existingRooms.push(roomNumber);
  res.cookie("roomNumber", roomNumber);

  // Render the next page for the Host now with the number on their page.
  res.redirect(
    "empty-room",
    {
      role: req.body.role,
      roomNumber: this.roomNumber,
      url: config.url,
    },
    303
  );
});

// Renders join room page with all the currently existing rooms
app.get("/join-room", (req, res) => {
  if (req.cookies.steamID == null) {
    res.redirect("/");
  } else {
    res.render("join-room", { existingRooms: existingRooms });
  }
});

// Gets data from front end and then adds user to the room if the code is valid
app.post("/join-room", async (req, res) => {
  // Our other main workhorse function, here we check the users entire steam library & adds them to the database if they're not in there already. Must be done either when a user makes a room or joins one.
  await checkGames(req.cookies.steamID);
  let potentialRoomNum = req.body.roomnum;

  if (existingRooms.includes(potentialRoomNum)) {
    res.cookie("roomNumber", potentialRoomNum);
    res.render("empty-room", { roomNumber: potentialRoomNum, url: config.url });
  } else {
    res.render("join-room", { existingRooms: existingRooms });
  }
});

// Renders list page
app.get("/list", async (req, res) => {
  // two guard clauses here to redirect users who shouldn't be in list w/out a steam ID & room number.
  if (req.cookies.roomNumber == null && req.cookies.steamID == null) {
    res.redirect("/");
  } else if (req.cookies.roomNumber == null) {
    res.redirect("/room-choice");
  } else {
    res.render("list", { url: config.url });
  }
});

// Renders the room with its users
app.get("/empty-room", async (req, res) => {
  if (req.cookies.steamID == null) {
    res.redirect("/");
  } else {
    // Our other main workhorse function, here we check the users entire steam library & adds them to the database if they're not in there already. Must be done either when a user makes a room or joins one.
    await checkGames(req.cookies.steamID);

    res.render("empty-room", {
      roomNumber: req.cookies.roomNumber,
      url: config.url,
    });
  }
});

// Used for the alternate Steam ID based login.
app.post("/alt-login", async (req, res) => {
  try {
    let steamID = req.body.userId;
    // DEBUG: For confirming user has logged in.
    // console.log("Getting user information...");
    const response = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${config.steamKey}&steamids=${steamID}`
    );
    steamAPICount += 1;
    let user = response.data.response.players;

    let username = user[0].personaname;
    let profileImg = user[0].avatarmedium;
    console.log(`ALT LOGIN: ${username} has logged in successfully!`);

    res.cookie("steamID", steamID);
    res.cookie("username", username);
    res.cookie("avatar", profileImg);
    res.redirect(303, "room-choice");
  } catch (error) {
    // TODO: a specific status code from Steam 429 shows up when we've reached 
    // our API limit from them, could display that too & other more specific 
    // messages.
    console.error(`ALT LOGIN: Could not fetch information on user. ${error}`);
    // Encode the "incorrect" Steam ID so that when the page is "redirected" it 
    // still is in the input field, making it easier for the user to tweak it.
    const steamID = encodeURIComponent(req.body.userId);
    res.redirect(`/alt-login?id=` + steamID);
  }
});

//Socket.io used to room member data to the front end
io.on("connection", (socket) => {
  // Used to refresh the list when a user joins/leaves a room
  socket.on("generateList", (data) => {
    socket.join("room-" + data.roomNumber);
    io.sockets.in("room-" + data.roomNumber).emit("refreshList");
  });

  // Used to refresh the empty-room page when a user leaves
  socket.on("generateList2", (data) => {
    socket.join("room-" + data.roomNumber);
    io.sockets.in("room-" + data.roomNumber).emit("refreshList2");
  });

  // Used to generate room with its members
  socket.on("message", (data) => {
    // Comes from the front end; number was made in another route (room choice).
    let roomNumber = data.roomNumber;
    // Validate roomNumber to ensure it consists of exactly 5 digits
    if (!/^\d{5}$/.test(roomNumber)) {
      console.error("SOCKET: Invalid room number provided:", roomNumber);
      // Optionally, send an error response back to the client to inform them of the invalid input
      return; // Stop further execution for this message
    }

    // Proceed with the validated roomNumber
    socket.join("room-" + roomNumber);

    let potentialRoom = socketRooms.find((x) => x.roomNumber === roomNumber);

    // Using the variable above, we can check if there IS a room or not
    if (typeof potentialRoom != "undefined") {
      // DEBUG: Checking our Logic
      // console.log(`Found Room: ${roomNumber}`);
      let foundMembers = potentialRoom.roomMembers;
      // Quickly loop and check if the USER is ALREADY there DON'T update
      let hasFound = false;
      for (let i = 0; i < foundMembers.length; i++) {
        if (foundMembers[i][0] == data.steamID) {
          hasFound = true;
        }
      }

      if (hasFound == false) {
        foundMembers.push([data.steamID, data.username, data.avatar]);
        potentialRoom.roomMembers = foundMembers;
      }
    } else {
      // DEBUG: Checking our Logic
      // console.log(`Room NOT Found: ${roomNumber}`);
      // Made a temp array to store the first user (HOST) and add to the array keeping track of existing socket rooms.
      let temp = new Room(roomNumber, [
        [data.steamID, data.username, data.avatar],
      ]);
      socketRooms.push(temp);
    }

    // Re-find the room again and send the output of users to the front-end
    potentialRoom = socketRooms.find((x) => x.roomNumber === roomNumber);
    roomMembers = potentialRoom.roomMembers;

    // Emits data to everyone in a room
    io.sockets.in("room-" + roomNumber).emit("otherMsg", roomMembers);
  });

  // Emits data to reroute users in a room
  socket.on("newList", (data) => {
    socket.join("room-" + data.roomNumber);
    io.sockets.in("room-" + data.roomNumber).emit("navigate");
  });

  // MAIN WORKHORSE FUNCTION. Gathers the SteamIDs of the room members and uses them to generate the massive list of shared games.
  // Sort by amount of time played and then generate shared list
  socket.on("generate", async (data) => {
    const roomNumber = data.roomNumber;
    const roomMembers = socketRooms.find(
      (x) => x.roomNumber === roomNumber
    ).roomMembers;

    // Queries all multiplayer games
    let query = `SELECT * FROM Games NATURAL JOIN Users WHERE userID = ? AND is_multiplayer = 1`;

    // Retrieve the users selected tags & reshape the SQL based on it.
    const tagSelection = data.tagSelection;
    const tagsPresent = !(tagSelection === null || tagSelection.trim() === "");
    if (tagsPresent) {
      query += ` AND tags LIKE '%${tagSelection}%'`;
    }

    // Retrieve the users selected genres & reshape the SQL based on it.
    const categorySelection = data.categorySelection;
    const categoryPresent = !(
      categorySelection === null || categorySelection.trim() === ""
    );
    if (categoryPresent) {
      query += ` AND genre LIKE '%${categorySelection}%'`;
    }

    // Retrieve the users selected price range or selection & reshape the SQL based on it.
    let priceSelection = data.priceSelection;
    const minPriceSelection = data.minPriceSelection;
    const maxPriceSelection = data.maxPriceSelection;
    if (priceSelection == `FREE`) {
      query += ` AND price = 0`;
    } else if (priceSelection == `Under $10`) {
      query += ` AND price <= 10`;
    } else if (priceSelection == `Under $40`) {
      query += ` AND price <= 40`;
    } else if (!(minPriceSelection == "" && maxPriceSelection == "")) {
      query += ` AND price >= ${minPriceSelection} AND price <= ${maxPriceSelection}`;
    }
    // Arrays to be sent to the front-end later.
    let sharedGameNames = [];
    let ownedByWho = [];
    let gameImages = [];
    let gameLinks = [];
    let gameTags = [];
    let gamePrices = [];
    let allPotentialTags = []; // for the drop-down
    let gameDesc = [];

    // First we'll iterate through EVERY room member. Goal is to run through each user and their games and "tick" off who owns what.
    for (let i = 0; i < roomMembers.length; i++) {
      const currentUserID = roomMembers[i][0];
      // Now we retrieve all the users recorded games and we'll loop those.
      // Query will only retrieve MULTI PLAYER games for the current user.
      const currentUsersGames = db.prepare(query).all(currentUserID);

      currentUsersGames.forEach((curGame) => {
        // TODO: Would it be better to use a games ID here? Can a game have the same name as another?
        const indexOfGame = sharedGameNames.indexOf(curGame.name);
        if (indexOfGame != -1) {
          // It IS THERE so curGame append the SteamID to the "current owners"
          ownedByWho[indexOfGame].push(i);
        } else {
          // It IS NOT there so make a new entry with name, image, & link
          sharedGameNames.push(curGame.name);
          gameImages.push(curGame.header_image);
          gameLinks.push(curGame.store_url);
          gameTags.push(curGame.tags);
          let prices = [];
          const initial_price = curGame.initial_price;
          const final_price = curGame.price;
          prices.push(final_price);
          if (initial_price != "" && initial_price != 0) {
            prices.push(initial_price);
          }
          gamePrices.push(prices);
          gameDesc.push(curGame.description);

          // Add the SteamID to a new array and start the appending process
          let temp = [];
          temp.push(i);
          ownedByWho.push(temp);

          // Lets process the tags to send to the front end
          // TODO: We should probably also remove the current (or previously) selected tags so they don't get queried again from the database.
          // TODO: Add ability for multiple tags to be selected. For example, of
          // all the games, only show NEW UNSELECTED tags.
          allPotentialTags = maintainTags(curGame.tags, allPotentialTags);
        }
      });

      // Locates the socket for that specific room
      socket.join("room-" + data.roomNumber);
    }

    // Finally emit the data to all room members INDIVIDUALLY so filtering options don't change the page for everyone.
    io.to(socket.id).emit("finalList", {
      roomMembers: roomMembers,
      games: sharedGameNames,
      owners: ownedByWho,
      images: gameImages,
      links: gameLinks,
      tags: gameTags,
      prices: gamePrices,
      categories: allPotentialTags,
      descriptions: gameDesc
    });
  });
});

// DEBUG: For checking HTML elements on a safe page.
app.get("/test", async (req, res) => {
    deepGameUpdate();
});

// DEBUG: For checking functions and other back-end code.
app.get("/altTest", async (req, res) => {
    // this is currently the code from checkGames() but modified w/ some starting variables to ensure that only a set amount of games are loaded at once.
    const steamID = `76561198016716226`;
    const gameLimit = 100;

    await steamWrapper
    .getOwnedGames(steamID, null, true)
    .then((result) => {
      gameCount = result.data.count;
      gameInfo = result.data.games;
    })
    .catch(console.error);
    steamAPICount += 1;

  // We iterate through the users' games using the data from the above function
  for (let curGame = 0; curGame < gameLimit; curGame++) {
    const gameName = gameInfo[curGame].name;
    const gamePic = gameInfo[curGame].url_store_header;
    const gameURL = gameInfo[curGame].url_store;
    const gameID = gameInfo[curGame].appID;

    // Variables that are et later with API fetches
    let tags = "";
    let genre = "";
    let final_price = 0;
    let initial_price = 0;
    let short_description = 0;

    // TODO: Add Short Description to our games so we can provide extended details on a game.

    // FIRST we query our database to see if we HAVE the game or not
    const localGame = db
      .prepare("SELECT * FROM Games WHERE gameID = ?")
      .get(`${gameID}`);

    // Then check if the user has the local game registered in the database
    const userPotentialGame = db
      .prepare("SELECT * FROM Users WHERE userID = ? AND gameID = ?")
      .get([`${steamID}`, `${gameID}`]);

    // if the game is located we check if the user has the game in their database
    if (localGame) {
      // IFF >= 3 days old then re-query. If the game is past it's "expiration"
      //   date we should go and reacquire the prices (in case of sales) and
      // update its database entry.
      if (computeDateDiff(localGame.age)) {
        // DEBUG: Check the game and its ID.
        // console.log(localGame);
        // console.log(localGame.gameID);

        let temp = await fetchGenresPrices(localGame.gameID);
        const initial_price = temp[1];
        const final_price = temp[2];
        const tempAge = generateDate();

        // console.log(`${final_price} ${initial_price} ${tempAge} ${localGame.gameID}`);

        // TODO: Could a single player game become a multiplayer one in the future?
        db.prepare(
          `UPDATE Games SET price = ?, initial_price = ?, age = ? WHERE gameID = ?`
        ).run(final_price, initial_price, tempAge, localGame.gameID);
      }
      // If they don't have the game in their table we add it to their database else do nothing
      if (!userPotentialGame) {
        db.prepare(`INSERT INTO Users (userID, gameID) VALUES (?, ?)`).run(
          steamID,
          `${gameID}`
        );
      }
    } else {
      // Case if the game is not located in the database
      // We query game and add it to the Games table along with the users personal table
      tags = await fetchTags(gameID);
      let temp = await fetchGenresPrices(gameID);
      genre = temp[0];
      initial_price = temp[1];
      final_price = temp[2];
      let is_multiplayer = 1;
      let age = generateDate();
      short_description = temp[3];

      // If its single player
      if (!genre.includes(`Multi-player`)) {
        is_multiplayer = 0;
      }

    //   console.log(`Added ${gameName} - ${gameID}!`);
      db.prepare(
        `INSERT INTO Games(gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url, description) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        `${gameID}`,
        gameName,
        genre,
        tags,
        age,
        final_price,
        initial_price,
        `${is_multiplayer}`,
        gamePic,
        gameURL,
        short_description
      );

      db.prepare(`INSERT INTO Users (userID, gameID) VALUES (?,?)`).run(
        steamID,
        `${gameID}`
      );
    }
  }
});

// Route to demo the core functionality of the site, the game list generation page. /
app.get("/demo", async (req, res) => {
    // Setup our "user" as an alt account
    res.cookie("steamID", `76561199516233321`);
    res.cookie("username", `drslurpeemd`);
    res.cookie("avatar", `https://avatars.steamstatic.com/b9fa08a1e25a9dadaebbab031b6b2974502416fa_medium.jpg`);
    res.cookie("isDemo", "true");

    // Reuse code snippet from above to generate a random room, so that users can demo in "safe" environments w/out joining each other.
    // TODO: maybe could turn this into a function?
    let roomNumber = Math.floor(Math.random() * 90000) + 10000;
    roomNumber = roomNumber.toString();
    while (existingRooms.includes(roomNumber)) {
        roomNumber = Math.floor(Math.random() * 90000) + 10000;
        roomNumber = roomNumber.toString();
    }

    let demoRoom = new Room(roomNumber, [
        [
          `76561198110151106`,
          `divinusmessor`,
          `https://avatars.steamstatic.com/175253b0d40f2bdf52f35622e6a4a0a104b5f444_medium.jpg`,
        ],
      ]);
    socketRooms.push(demoRoom);
    existingRooms.push(roomNumber);

    res.cookie("roomNumber", roomNumber);
    res.redirect("/empty-room");
});

// Intended to be the FULL logout from Steam & the Room.
app.get("/logout", (req, res) => {
  const roomNumber = req.cookies.roomNumber;
  const curUsersID = req.cookies.steamID;
  let potentialRoom = socketRooms.find((x) => x.roomNumber === roomNumber);

  if (potentialRoom) {
    // our room was found so delete the user
    if (potentialRoom.roomMembers.length == 1) {
      // user is the sole person in the room
      deleteRoom(roomNumber);
      // otherwise they're in a populated room and need to be specifically removed
    } else {
      deleteUserFromRoom(roomNumber, curUsersID);
    }
  } else {
    console.error(
      `LOGOUT: User was in a room that doesn't exist.`
    );
  }

  console.log(`LOGOUT: ${req.cookies.username} has successfully logged out!`);

  // After removing them from a room, we'll clear their cookies.
  res.clearCookie("steamID");
  res.clearCookie("username");
  res.clearCookie("avatar");
  res.clearCookie("roomNumber");
  res.clearCookie("isDemo");

  // While it'd be nice to use just normal index ("/") we have to use alt for now to prevent users from hitting back on their browser and breaking the site.
  // This also lets us display a "logout" message properly to users. 
  res.render("alt-index");
});

// Same functionality as logout but only clear the roomNumber
app.get("/leave", (req, res) => {
  if (req.cookies.steamID == null) {
    res.redirect("/");
  } else {
    const roomNumber = req.cookies.roomNumber;
    const curUsersID = req.cookies.steamID;
    let potentialRoom = socketRooms.find((x) => x.roomNumber === roomNumber);
    const isDemo = req.cookies.isDemo;

    if (potentialRoom) {
      // our room was found so delete the user
      if (potentialRoom.roomMembers.length == 1) {
        // user is the sole person in the room
        deleteRoom(roomNumber);
        // otherwise they're in a populated room and need to be specifically removed
      } else {
        deleteUserFromRoom(roomNumber, curUsersID);
      }
    } else {
      console.error(
        `LEAVE: User tried to leave a room that doesn't exist.`
      );
    }

    res.clearCookie("roomNumber");
    if (isDemo == `true`) {
        // Since a user might try to leave a demo, this should just in a sense act as "logout" and clear their cookies & bring them back to the homepage.
        res.clearCookie("steamID");
        res.clearCookie("username");
        res.clearCookie("avatar");
        res.clearCookie("isDemo");
        res.redirect("/");
    } else {
        res.render("room-choice");
    } 
  }
});

// TODO: Make this look like a 404 Page, not super important rn though.
app.get("*", (req, res) => {
  res.send("Error 404: Hit Back on your Browser. You shouldn't be here.");
});

// ======== SERVER LINES ========

// Start server on appropriate port based on environment
if (process.env.ENVIRO === "prod") {
  server.listen(443, () => {
    console.log("STARTUP: HTTPS server running on port 443\n Secure site running on: https://localhost");
  });
} else {
  server.listen(3000, () => {
    console.log("STARTUP: HTTP server running on port 3000\n Development site running on: http://localhost:3000");
  });
}

// Here is where we setup our daily quick updates. Currently set to 9am.
cron.schedule('0 9 * * *', () => {
    // get the number of games updated in total from our quickUpdate function
    // TODO: this was throwing 429 Errors? Could add some error checking incase this is sending to many requests.
    // const numOfGames = quickGameUpdate();
    // const date = new Date(); // add both game count & month/day to output logs
    // console.log(`Successfully updated games ${numOfGames} on ${date.getMonth()+1}-${date.getDate()}!`);
    
    // TODO: Finish code on resetting our API Counts & persistently store the data on our DB
    // steamAPICount = 0;
    // spyAPICount = 0;
});

// Background job to process queued games in small, safe batches
cron.schedule('*/10 * * * *', async () => {
  try {
    const batchLimit = parseInt(process.env.PENDING_BATCH_LIMIT || '50');
    const processed = await processPendingGames(batchLimit);
    if (processed > 0) {
      console.log(`PENDING: processed ${processed} queued game(s).`);
    }
  } catch (e) {
    console.error('PENDING: batch processing error', e.message || e);
  }
});
