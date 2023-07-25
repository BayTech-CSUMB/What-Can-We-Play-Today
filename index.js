// Critical for Express itself
const express = require("express");
const app = express();
const cookieParser = require("cookie-parser");
app.use(cookieParser());
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const axios = require("axios");

const server = require("http").createServer(app);
// TODO: Double check what CORS policy will mean for our app.
const io = require("socket.io")(server, { cors: { origin: "*" } });
// Ensure API Keys and Confidential Data don't get published to Github
const config = require("./private/keys.json");
// Setting up a helper Wrapper library to make the Steam API much easier to use
const steamWrapper = require("steam-js-api");
steamWrapper.setKey(config.steamKey);

// Necessary for Steam Oauth
const SteamAuth = require("node-steam-openid");
// Setup for Steam Oauth
const steam = new SteamAuth({
  // TODO: Eventually this will be set to the proper Domain name.
  realm: config.url,
  returnUrl: config.url + "/auth/steam/authenticate",
  apiKey: config.steamKey,
});

// Setup for keeping track of Users temporary data.
const session = require("express-session");
const { types } = require("util");
const { parse } = require("path");
app.use(
  session({
    secret: config.sessionSecret,
    resave: true,
    saveUninitialized: true,
  }),
  bodyParser.urlencoded({ extended: true }),
  bodyParser.json({ extended: true })
);

// Tell Express which Templating Engine we're using
app.set("view engine", "ejs");
// Specify the Folder for Statics
app.use(express.static("public"));
// Need this line to allow Express to parse values sent by POST forms
app.use(express.urlencoded({ extended: true }));
// Setup our SQLite DB for our game information.
const db = require("better-sqlite3")(`./private/games.db`);

// ================== RUNTIME VARIABLES ==================

// TODO: Consolidate the two room structs (this & socketRooms) so we don't use extra memory.
let existingRooms = [];
// Sockets used for members of the same room
function Room(roomNumber, roomMembers) {
  this.roomNumber = roomNumber;
  this.roomMembers = roomMembers;
}
let socketRooms = [];

// ================== FUNCTIONS ==================

async function fetchTags(gameID) {
  const url = `https://steamspy.com/api.php?request=appdetails&appid=${gameID}`;
  const response = await fetch(url);
  const result = await response.json();
  const tags = Object.keys(result.tags).join(",");
  return tags;
}

// TODO: Make this dynamically generate a YYYY-MM-DD format
function generateDate() {
  return `2023-07-20`;
}

async function fetchGenresPrices(gameID) {
  // Then Steam's API for majority of the data. From this we want the "categories" and pricing of each game.
  const steamURL = `https://store.steampowered.com/api/appdetails?appids=${gameID}&l=en`;
  const response2 = await fetch(steamURL);
  const result2 = await response2.json();
  let initial_price = `Free`;
  let final_price = `Free`;
  let genre = ``;

  // DEBUG: Check Output
  // console.log(result2);

  if (result2[`${gameID}`].success == true) { // ensures no de-listed games
    // Getting the price of the games
    // TODO: Certain games like GTA V don't even have price_overview but a convoluted layout, so there needs to be more searching for those edge cases.
    let priceOverview = result2[`${gameID}`].data.price_overview;
    if (typeof priceOverview != `undefined`) {
      //   if (!result2[`${gameID}`].data.is_free) {
      final_price = priceOverview.final_formatted; // final
      initial_price = priceOverview.initial_formatted; // initial
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
  } else {
    genre = `Single-player`;
    initial_price = `Free`;
    final_price = `Free`;
  }

  return [genre, initial_price, final_price];
}

function computeDateDiff(dateToCompare) {
  const curDate = generateDate();

  // TODO: Utilize current date & the to compare one and see how many days "past expiration" it is. If it's greater than or equal to 3, return TRUE otherwise return FALSE
  return false; // placeholder return for now.
}

async function checkGames(steamid) {

  await steamWrapper
  .getOwnedGames(steamid, null, true)
  .then((result) => {
    console.log('Getting game data');
    gameCount = result.data.count;
    gameInfo = result.data.games;
  })
  .catch(console.error);

  // An API function that will set gameCount and gameInfo to the total count
  // of a users games and aan array of their games respectively.

  // We iterate through the users' games using the data from the above function

  for (let curGame = 0; curGame < gameCount; curGame++){
    const gameName = gameInfo[curGame].name;
    const gamePic = gameInfo[curGame].url_store_header;
    const gameURL = gameInfo[curGame].url_store;
    const gameID = gameInfo[curGame].appID;

    // Variables that are et later with API fetches
    let tags = '';
    let genre = '';
    let final_price = 'Free';
    let initial_price = 'Free';

    // FIRST we query our database to see if we HAVE the game or not
    const localGame = db
    .prepare("SELECT * FROM Games WHERE gameID = ?")
    .get(`${gameID}`);

    // We then check if the user has games registered in the database
    const userGames = db
      .prepare("SELECT * FROM Users WHERE userID = ? AND gameID = ?")
      .get([`${steamid}`, `${gameID}`]);

    // if the game is located we check if the user has the game in their database
    if(localGame){
      if (computeDateDiff(localGame.age)){
        // IFF >= 3 days old then re-query
      }

      // If they don't have the game in their table we add it to their database else do nothing 
      if(!userGames){
        db.prepare(
          `INSERT INTO Users (userID, gameID) VALUES (?, ?)`
        ).run(
          steamid,
          gameID
        )
      }
    } else {
      // Case if the game is not located in the database
      // We query game and add it tot the Games table along with the users personal table
      console.log(`Game data is not in the table, adding it...`);
      tags = await fetchTags(gameID);
      let temp = await fetchGenresPrices(gameID);
      genre = temp[0];
      initial_price = temp[1];
      final_price = temp [2];
      let is_multiplayer = 1;
      let age = generateDate();

      // If its single player
      if (!genre.includes(`Multi-player`)){
        is_multiplayer = 0;
      }
      
      console.log(gameID);
      db.prepare(
        `INSERT INTO Games(gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url) VALUES (?,?,?,?,?,?,?,?,?,?)`
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
        gameURL
      );

      db.prepare(
        `INSERT INTO Users (userID, gameID) VALUES (?,?)`
      ).run(
        steamid,
        `${gameID}`
      );
    }
  }
}

// ================== ROUTES ==================

// corresponds to page.com
app.get("/", (req, res) => {
  res.render("index");
});

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
    // DEBUG: Confirm the Users account details.
    // console.log(user);

    // TODO: Check that this cookie storage method is best practices.
    res.cookie("steamID", user["steamid"]);
    res.cookie("username", user["username"]);
    res.cookie("avatar", user["avatar"]["medium"]);
    
    let steamid = parseInt(user['steamid']);

    // DEBUG: Checking who is logged in via Backend
    console.log(`${user["username"]} has logged in!`);

    // TODO: Call the API and loop through all of a Users games and add them both to the Users table and the Games table if they're not present already.
    //      We're doing this so that during later parts of the site we can apply filters and only do DB queries instead of querying the API constantly again.

    //Gets user's games and adds them to database if they are not already there

    // An API function that will set gameCount and gameInfo to the total count
    // of a users games and aan array of their games respectively.

    
    /*
    await steamWrapper
      .getOwnedGames(steamid, null, true)
      .then((result) => {
        gameCount = result.data.count;
        gameInfo = result.data.games;
      })
      .catch(console.error);

      // We iterate through the users' games using the data from the above function
      for (let curGame = 0; curGame < gameCount; curGame++){
        console.log(`Checking current game: ${curGame}`)
        const gameName = gameInfo[curGame].name;
        const gamePic = gameInfo[curGame].url_store_header;
        const gameURL = gameInfo[curGame].url_store;
        const gameID = gameInfo[curGame].appID;

        // Variables that are set later with API fetches
        let tags = '';
        let genre = '';
        let final_price = 'Free';
        let initial_price = 'Free';

        // FIRST we query our database to see if we HAVE the game or not
        const localGame = db
          .prepare("SELECT * FROM Games WHERE gameID = ?")
          .get(`${gameID}`);

        // We then check if the user has games registered in the database
        const userGames = db
          .prepare("SELECT * From Users Where userID = ? AND gameID = ?")
          .get([`${steamid}`, `${gameID}`]);
        
        // if the game is located we check if the user has the game in their database
        if(localGame){
          if (computeDateDiff(localGame.age)){
            //Iff >= 3 days old then re-query
          }
          //If they don't have it we add it to their database else do nothing
          if(!userGames){
            db.prepare(
              `INSERT INTO Users (userID, gameID) VALUES (?,?)`
              .run(
                steamid,
                gameID
              )
            )
          }
        } else {
          // Case if the game is not located in the database
          // We query game and add it to the games table along with the users personal table

          tags = await fetchTags(gameID);
          let temp = await fetchGenresPrices(gameID);
          genre = temp[0];
          initial_price = temp[1];
          final_price = temp [2];
          let is_multiplayer = 1;
          let age = generateDate();

          // If its single player
          if(!tags.includes(`Multi-player`)){
            is_multiplayer = 0;
          }

          db.prepare(
            `INSERT INTO Games(gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            gameID,
            gameName,
            genre,
            tags,
            age,
            final_price,
            initial_price,
            is_multiplayer,
            gamePic,
            gameURL
          );

          db.prepare(
            `INSERT INTO Users (userID, gameID) VALUES (?,?)`
          ).run(
            steamid,
            gameID
          )
        }



      } */

    res.render("room-choice");
  } catch (error) {
    console.error(`ERROR: Couldn't Fetch! ${error}`);
  }
});

//Used in case users want to login through their steam id
app.get("/alt-login", (req, res) => {
  res.render("alt-login");
});

// Users get shown the CREATE or JOIN room buttons. Here they'll start the process of generating a Room Number and allowing others to join them.
app.get("/room-choice", (req, res) => {
  res.render("room-choice");
});

//Passes host role
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

app.get("/join-room", async (req, res) => {
  await checkGames(req.cookies.steamID);
  res.render("join-room", { existingRooms: existingRooms });
});

app.post("/join-room", (req, res) => {
  let potentialRoomNum = req.body.roomnum;
  // DEBUG: Check the incoming data and the struct it's being compared to
  // console.log(`${potentialRoomNum}`);
  // console.log(existingRooms);
  if (existingRooms.includes(potentialRoomNum)) {
    console.log(`Room FOUND`);
    res.cookie("roomNumber", potentialRoomNum);
    res.render("empty-room", { roomNumber: potentialRoomNum, url: config.url });
  } else {
    console.log(`Room NOT FOUND`);
    res.render("join-room", { existingRooms: existingRooms });
  }
});

// TODO: Ensure that regardless of the proper routing, that all pages validate and ensure they have the data they need (e.g. empty-room will redirect the users to create/join room if they DONT have a Room Number in their cookies).
app.get("/empty-room", async (req, res) => {
  await checkGames(req.cookies.steamID);
  // console.log(req.cookies);
  res.render("empty-room", {
    roomNumber: req.cookies.roomNumber,
    url: config.url,
  });
});

//Used for alt login
app.post("/alt-login", async (req, res) => {
  try {
    let steamID = req.body.userId;
    console.log("Getting user information...");
    const response = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${config.steamKey}&steamids=${steamID}`
    );
    //const players = response.data && response.data.response && response.data.response.players;
    let user = response.data.response.players;

    let username = user[0].personaname;
    let profileImg = user[0].avatarmedium;

    res.cookie("steamID", steamID);
    res.cookie("username", username);
    res.cookie("avatar", profileImg);
    res.redirect(303, "room-choice");
  } catch {
    console.log("Could not fetch information...");
  }
});

//Socket.io used to room member data to the front end
io.on("connection", (socket) => {

  // socket.on('query', (option, callback) => {
  //   const query = db.prepare(`SELECT * FROM Games WHERE tags LIKE ? AND is_multiplayer = 1`).all(`%${option}%`);
  //   console.log(`${option}`);
  //     if (query) {
  //       callback(query);
  //       console.log(query);
  //     }
  //     else{
  //       callback("NONE");
  //       console.log("IDK");
  //     }
  //   });

  // Used to generate room with its members
  socket.on("message", (data) => {
    let roomNumber = data.roomNumber;
    socket.join("room-" + roomNumber);

    let potentialRoom = socketRooms.find((x) => x.roomNumber === roomNumber);
    // Using the variable above, we can check if there IS a room or not
    if (typeof potentialRoom != "undefined") {
      // DEBUG: Checking our Logic
      console.log(`Found Room: ${roomNumber}`);
      let foundMembers = potentialRoom.roomMembers;
      // IF the USER is ALREADY there DONT update
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
      console.log(`Room NOT Found: ${roomNumber}`);
      // Made a temp array to store the first user (HOST) and add to the array keeping track of existing socket rooms.
      let temp = new Room(roomNumber, [
        [data.steamID, data.username, data.avatar],
      ]);
      socketRooms.push(temp);
    }

    // Refind the room again and set the output of users to the front-end
    potentialRoom = socketRooms.find((x) => x.roomNumber === roomNumber);
    roomMembers = potentialRoom.roomMembers;

    io.sockets.in("room-" + roomNumber).emit("otherMsg", roomMembers);
  });

  socket.on("newList", (data) => {
    socket.join("room-" + data.roomNumber);
    io.sockets.in("room-" + data.roomNumber).emit("navigate");
  });

  // MAIN WORKHORSE FUNCTION. Gathers the SteamIDs of the room members and uses them to generate the massive list of shared games.
  // Sort by amount of time played and then generate shared list
  socket.on("generate", async (data) => {
    const roomNumber = data.roomNumber;
    const roomMembers = socketRooms.find((x) => x.roomNumber === roomNumber).roomMembers;
    // Arrays to be sent to the front-end later.
    let sharedGameNames = [];
    let ownedByWho = [];
    let gameImages = [];
    let gameLinks = [];
    let gameTags = [];
    let gamePrices = [];
    let catagories = [];
    let unique = [];
    let filteredGames = [];


    // First we'll iterate through EVERY room member. Goal is to run through each user and their games and "tick" off who owns what.
    for (let i = 0; i < roomMembers.length; i++) {
      // A users total game count & an array of their games. For iterating & that'll be set later.
      let gameInfo = [];
      let gameCount = 0;
      // aka their SteamID.
      const curMembersID = roomMembers[i][0];

      // An API function that will set gameCount and gameInfo to the total count of a users games and an array of their games respectively.
      await steamWrapper
        .getOwnedGames(curMembersID, null, true)
        .then((result) => {
          gameCount = result.data.count;
          gameInfo = result.data.games;
        })
        .catch(console.error);

      // Now we can iterate through the CURRENT USERS GAMES using the data from the above function.
      for (let curGame = 0; curGame < gameCount; curGame++) {
        const gameName = gameInfo[curGame].name;
        const gamePic = gameInfo[curGame].url_store_header;
        const gameURL = gameInfo[curGame].url_store;
        const gameID = gameInfo[curGame].appID;
        // Variables to be set later with API fetches
        let tags = ``;
        let genre = ``;
        let final_price = `Free`;
        let initial_price = `Free`;

        // FIRST we query our database to see if we HAVE the game there or not
        const localGame = db
          .prepare("SELECT * FROM Games WHERE gameID = ?")
          .get(`${gameID}`);

        // TODO: Note that some de-listed games will have their prices listed as "free" but maybe we should put it as something else to show users it's de-listed so they don't get their hopes up at a "free" game that isn't actually the correct version?
        if (localGame) {
          // First we'll check to see if the game is SINGLE PLAYER and if it is then we'll just fetch some data and proceed.
          //   0 is Single; 1 is Multi.
          if (localGame.is_multiplayer == `1`) {
            if (computeDateDiff(localGame.age)) {
              // iff >= 3 days old
              // TODO: Re-query the APIs for data and update the database
              // TODO: Could also only requery price every 3 days and tags every week to keep the amount of total API queries low.
            } else {
              // normal fetch. Game is Multiplayer & less than 3 days old.
              tags = localGame.tags;
              catagories.push(tags);
              genre = localGame.genre;
              initial_price = localGame.initial_price;
              final_price = localGame.price;

              const indexOfGame = sharedGameNames.indexOf(gameName);
              // TODO: Would it be better to use a games ID here? Can a game have the same name as another?
              if (indexOfGame != -1) {
                // It IS THERE so curGame append the SteamID to the "current owners"
                ownedByWho[indexOfGame].push(i);
              } else {
                // it IS NOT there so make a new entry with name, image, & link
                sharedGameNames.push(gameName);
                gameImages.push(gamePic);
                gameLinks.push(gameURL);
                gameTags.push(tags);
                let prices = [];
                prices.push(final_price);
                if (initial_price != "" && initial_price != "Free") {
                  prices.push(initial_price);
                }
                gamePrices.push(prices);
                // Add the SteamID to a new array and start the appending process
                let temp = [];
                temp.push(i);
                ownedByWho.push(temp);
              }
            }
          }
        } else {
          // console.log(`Else: ${gameID}`);

          // Start by gathering detailed tags, categories & pricing from APIs
          tags = await fetchTags(gameID);
          catagories.push(tags);
          let temp = await fetchGenresPrices(gameID);
          genre = temp[0];
          initial_price = temp[1];
          final_price = temp[2];
          let is_multiplayer = 1;
          // Then the date of inserting for later "age" testing
          let age = generateDate();
          // let demo = `Multi-player,Single-player,Action`;

          if (!tags.includes(`Multi-player`)) {
            is_multiplayer = 0;
          }
          // Insert our new game into our own database.

          // const indexOfGame = sharedGameNames.indexOf(gameName);
          // TODO: Would it be better to use a games ID here? Can a game have the same name as another?

          if (is_multiplayer == 1) {
            if (indexOfGame != -1) {
              // It IS THERE so curGame append the SteamID to the "current owners"
              ownedByWho[indexOfGame].push(i);
            } else {
              // it IS NOT there so make a new entry with name, image, & link
              sharedGameNames.push(gameName);
              gameImages.push(gamePic);
              gameLinks.push(gameURL);
              gameTags.push(tags);
              let prices = [];
              prices.push(final_price);
              if (initial_price != "" && initial_price != "Free") {
                prices.push(initial_price);
              }
              gamePrices.push(prices);
              // Add the SteamID to a new array and start the appending process
              let temp = [];
              temp.push(i);
              ownedByWho.push(temp);
            }
          }
          db.prepare(
            `INSERT INTO Games (gameID, name, genre, tags, age, price, initial_price, is_multiplayer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            `${gameID}`,
            gameName,
            genre,
            tags,
            age,
            final_price,
            initial_price,
            `${is_multiplayer}`
          );
        }
      }

    // Parse through the "massive" list of tags and ensure only unique ones are sent to the front end
      catagories = catagories.toString().split(",");
      for (let i = 0; i < catagories.length; i++) {
        if (!unique.includes(catagories[i])) {
          unique.push(catagories[i]);
        }
      }

    }

    socket.on('query', (option, callback) => {
      
      const query = db.prepare(`SELECT * FROM Games WHERE tags LIKE ? AND is_multiplayer = 1`).all(`%${option}%`);
      console.log(`${option}`);
      console.log("SHARED" + sharedGameNames);
      
        if (query) {
          for(let i = 0; i < query.length; i++ ){
            const indexOfGame = sharedGameNames.indexOf(query[i].name);
            if(sharedGameNames.includes(query[i].name)){
                // if (indexOfGame != -1) {
                //   // It IS THERE so curGame append the SteamID to the "current owners"
                //   ownedByWho[indexOfGame].push(i);
                // } else {
                  // it IS NOT there so make a new entry with name, image, & link
                  sharedGameNames.push(query[i].name);
                  gameImages.push(query[i].header_image);
                  gameLinks.push(query[i].store_url);
                  gameTags.push(query[i].tags);
                  let prices = [];
                  prices.push(query[i].price);
                  if (query[i].initial_price != "" && query[i].initial_price != "Free") {
                    prices.push(initial_price);
                  }
                  gamePrices.push(prices);
                  // Add the SteamID to a new array and start the appending process
                  let temp = [];
                  temp.push(i);
                  ownedByWho.push(temp);
                  callback(query);
                  console.log(query);
                  filteredGames = [];
                  // filteredGames.push(query[i].name);
            }
          }
        } else {
          callback("NONE");
        }
        // socket.join("room-" + roomNumber);
        io.sockets.in("room-" + roomNumber).emit("finalList", {
          roomMembers: roomMembers,
          games: sharedGameNames,
          owners: ownedByWho,
          images: gameImages,
          links: gameLinks,
          tags: gameTags,
          prices: gamePrices,
          catagories: unique,
        });
        
      });

    // Finally emit the data to all room members.
    socket.join("room-" + roomNumber);
    io.sockets.in("room-" + roomNumber).emit("finalList", {
      roomMembers: roomMembers,
      filteredGames: filteredGames,
      games: sharedGameNames,
      owners: ownedByWho,
      images: gameImages,
      links: gameLinks,
      tags: gameTags,
      prices: gamePrices,
      catagories: unique,
    });
  });
});

app.get("/list", async (req, res) => {
  res.render("list", { url: config.url });
});

// DEBUG: For checking HTML elements on a safe page.
app.get("/test", async (req, res) => {
  res.render("test");
});

// DEBUG: For checking functions and other back-end code.
app.get("/altTest", async (req, res) => {
  console.log("Checking for new games to add...");

  let gameInfo = [];
  let gameCount = 0;
  // Set this to whomever's account to pre-add their games to the database
  const curMembersID = `76561198016716226`;

  // An API function that will set gameCount and gameInfo to the total count of a users games and an array of their games respectively.
  await steamWrapper
    .getOwnedGames(curMembersID, null, true)
    .then((result) => {
      gameCount = result.data.count;
      gameInfo = result.data.games;
    })
    .catch(console.error);

  // Now we can iterate through the CURRENT USERS GAMES using the data from the above function.

  // SET THIS TO SOME NUMBER TO TEST ADDING UP TO THAT MANY GAMES.
  // Can ignore if you don't have too many games.
  // gameCount = ?

  for (let curGame = 0; curGame < gameCount; curGame++) {
    const gameName = gameInfo[curGame].name;
    const gameID = gameInfo[curGame].appID;
    // Variables to be set later with API fetches
    let tags = ``;
    let genre = ``;
    let final_price = `Free`;
    let initial_price = `Free`;

    // FIRST we query our database to see if we HAVE the game there or not
    const localGame = db
      .prepare("SELECT * FROM Games WHERE gameID = ?")
      .get(`${gameID}`);

    if (!localGame) {
      tags = await fetchTags(gameID);
      [genre, initial_price, final_price] = await fetchGenresPrices(gameID);
      let age = generateDate();

      //
      db.prepare(
        `INSERT INTO Games (gameID, name, genre, tags, age, price, initial_price, is_multiplayer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        gameID,
        gameName,
        genre,
        tags,
        age,
        final_price,
        initial_price,
        `1`
      );
    }
  }

  console.log("Finished adding games!");

  res.render("altTest");
});

app.get("/logout", (req, res) => {
  res.clearCookie("steamID");
  res.clearCookie("username");
  res.clearCookie("avatar");
  res.clearCookie("roomNumber");

  res.render("index");
});

server.listen(3000, () => {
  console.log(`SocketIO Server has Started!`);
});
