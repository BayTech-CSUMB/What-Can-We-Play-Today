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
app.use(
  session({
    secret: config.sessionSecret,
    resave: true,
    saveUninitialized: true,
  }),
  bodyParser.urlencoded({ extended: true }),
  bodyParser.json()
);

// Setup and Connect a SQLite3 Database for Room/User data storage.
const sqlite3 = require("sqlite3").verbose();
let databaseFilePath = `./private/rooms.db`;
let database = new sqlite3.Database(
  databaseFilePath,
  sqlite3.OPEN_READWRITE,
  (_) => {
    console.log("Connected to database!");
  }
);

// Tell Express which Templating Engine we're using
app.set("view engine", "ejs");
// Specify the Folder for Statics
app.use(express.static("public"));
// Need this line to allow Express to parse values sent by POST forms
// app.use(express.urlencoded({ extended: true }));

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
    req.session.username = user["username"];
    req.session.steamID = user["steamid"];
    req.session.profileImg = user["avatar"]["medium"];

    res.cookie("steamID", user["steamid"]);
    res.cookie("username", user["username"]);
    res.cookie("avatar", user["avatar"]["medium"]);

    let sql = "INSERT INTO Users[(userID)] VALUES " + user[`steamid`];
    console.log(sql);
    // DEBUG:
    // console.log(`${user['username']} has logged in!`);
    res.render("room-choice");
  } catch (error) {
    console.error("ERROR: Couldnt Fetch");
    console.error(error);
  }
});

app.get("/steam-login", (req, res) => {
  res.render("steam-login");
});

app.get("/alt-login", (req, res) => {
  res.render("alt-login");
});

// Users get shown the CREATE or JOIN room buttons. Here they'll start the process of generating a Room Number and allowing others to join them.
app.get("/room-choice", (req, res) => {
  // const temp = localStorage.getItem("userID");
  // console.log(temp);
  res.render("room-choice");
});

app.get("/empty-room", (req, res) => {
  let roomNumber = `89641`;
  res.render("empty-room", {
    username: req.session.username,
    steamID: req.session.steamID,
    roomNumber: roomNumber,
    url: config.url,
  });
});

//Used for alt login
app.post("/empty-room", async (req, res) => {
  try {
    let steamID = req.body.userId;
    let roomNumber = "89641";
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
    res.cookie("roomNumber", roomNumber);
    res.render("empty-room", {
      username: username,
      steamID: steamID,
      roomNumber: roomNumber,
    });
  } catch {
    console.log("Could not fetch information...");
  }
});

//Sockets used for members of the same room
let roomMembers = [];
let ids = [];
//Socket.io used to room member data to the front end
io.on("connection", (socket) => {
  const roomNumber = `89641`;

  //Used to generate room with its members
  socket.on("message", (data) => {
    if (!ids.includes(data.steamID)) {
      roomMembers.push(data);
      ids.push(data.steamID);
    }
    socket.join("room-" + roomNumber);
    io.sockets.in("room-" + roomNumber).emit("otherMsg", roomMembers);
  });

  socket.on("newList", (data)=>{
    io.emit('navigate');
  });

  // MAIN WORKHORSE FUNCTION. Gathers the SteamIDs of the room members and uses them to generate the massive list of shared games.
  // Sort by amount of time played and then generate shared list
  socket.on("generate", async (data) => {
    if (!ids.includes(data.steamID)) {
      roomMembers.push(data);
      ids.push(data.steamID);
    }

    function findSimilarGames(user1, user2) {
      const result = user1.filter((x) => user2.indexOf(x) !== -1);
      return result;
    }
    // let idVar = req.cookies.steamID;
    // let roomnumber = req.cookies.roomNumber;
    // console.log(idVar + "this is the id");

    // let url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${config.steamKey}&steamid=${data.steamID}&include_appinfo=true&include_played_free_games=true&appids_filter=1`;

    // let response = await fetch(url);

    // let data2 = await response.json();
    // let allInfo = data2.response.games;
    // let gameName2 = [];
    // for (let i = 0; i < roomMembers.length; i++) {
    //   for (let j = 0; j < allInfo.length; j++) {
    //     gameName2.push(allInfo[j].name);
    //   }
    //   return gameName2;
    // }

    let roomMembersGames = [];
    for (let i = 0; i < roomMembers.length; i++) {
      let url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${config.steamKey}&steamid=${roomMembers[i].steamID}&include_appinfo=true&include_played_free_games=true&appids_filter=1`;

      let response = await fetch(url);
      let data2 = await response.json();
      let allInfo = data2.response.games;
      let gameCount = data2.response.game_count;
    //   let allInfo = [];
    //   allInfo.push(data2.response.games);
    //   allInfo.push(data2.response.games);
    //   console.log(allInfo);
      let temp = [];
      for (let j = 0; j < gameCount; j++) {
        temp.push(allInfo[j].name);
      }
    //   console.log(temp);
      roomMembersGames.push(temp);
    }

    // console.log(roomMembersGames);
    // let gameName = [`Guild Wars 2`, `Risk of Rain`];
    // // for (let i = 0; i < allInfo.length; i++){
    // //     gameName.push(allInfo[i].name);
    // // }

    // let gameName2 = [`Guild Wars 2`];
    // for (let i = 0; i < allInfo.length; i++){
    //     gameName2.push(allInfo[i].name);
    // }
    let checkSame = [];
    // DOES NOT HANDLE A SOLO MEMBER.
    if (roomMembers.length > 2) {
        checkSame = findSimilarGames(roomMembersGames[0], roomMembersGames[1]);
        for (let i = 2; i < roomMembers.length; i++) {
            checkSame = findSimilarGames(checkSame, roomMembersGames[i]);
        }
    } else {
        checkSame = findSimilarGames(roomMembersGames[0], roomMembersGames[1]);
    }

    // let checkSame = [];
    // if (roomMembers.length > 2) {
    //     let temp = findSimilarGames(roomMembersGames[0], roomMembersGames[1]);
    //     checkSame = findSimilarGames(temp, roomMembersGames[2]);
    // } else {
    //     checkSame = findSimilarGames(roomMembersGames[0], roomMembersGames[1]);
    // }
    console.log(checkSame);
    socket.join("room-" + roomNumber);
    io.sockets.in("room-" + roomNumber).emit("finalList", {roomMembers: roomMembers, games: checkSame});
  });
});

app.get("/list", async (req, res) => {
  //   // var id = req.session.steamID;
  //   // let sql = `SELECT UserID FROM Users WHERE UserID = ${id}`;
  //   // database.all(sql, [], (err, rows) => {
  //   //   if (err) {
  //   //     console.error(err.message);
  //   //   } else {
  //   //     console.log(rows[0].UserID);
  //   //     res.render("list", { steamID: rows[0].UserID });
  //   //   }
  //   // });

  // let idVar = req.cookies.steamID;
  // let roomnumber = req.cookies.roomNumber;
  // // console.log(idVar + "this is the id");

  // let url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${config.steamKey}&steamid=${idVar}&include_appinfo=true&include_played_free_games=true&appids_filter=1`;

  // let response = await fetch(url);

  // let data = await response.json();
  // let allInfo = data.response.games;
  // let gameName = [];
  // for (let i = 0; i < allInfo.length; i++){
  //     gameName.push(allInfo[i].name);
  // }

  // gameName = []; // empty array so that the page doesn't fill up immediately
  // res.render("list", { games: gameName, steamID: idVar, roomNumber: roomnumber});

  res.render("list", { url: config.url });
});

server.listen(3000, () => {
  console.log(`SocketIO Server has Started!`);
});
