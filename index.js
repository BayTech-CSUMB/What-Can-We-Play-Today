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
    res.cookie("steamID", user["steamid"]);
    res.cookie("username", user["username"]);
    res.cookie("avatar", user["avatar"]["medium"]);

    // DEBUG: Checking who is logged in via Backend
    console.log(`${user["username"]} has logged in!`);

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
  // const temp = localStorage.getItem("userID");
  // console.log(temp);
  //let steamID = Cookies.get('steamID');
  //console.log(steamID + "created the room");

  res.render("room-choice");
});

app.get("/empty-room", (req, res) => {
  let roomNumber = `89641`;
  res.render("empty-room", {
    roomNumber: roomNumber,
    url: config.url,
  });
});

app.post("/room-choice", async (req, res) => {
  let roomNumber = `89641`;
  res.render("empty-room", {
    role: req.body.role,
    roomNumber: roomNumber,
    url: config.url,
  });
});
//Used for alt login
app.post("/alt-login", async (req, res) => {
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
    res.render("room-choice", {
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

  socket.on("newList", (data) => {
    io.emit("navigate");
  });

  // MAIN WORKHORSE FUNCTION. Gathers the SteamIDs of the room members and uses them to generate the massive list of shared games.
  // Sort by amount of time played and then generate shared list
  socket.on("generate", async (data) => {
    if (!ids.includes(data.steamID)) {
      roomMembers.push(data);
      ids.push(data.steamID);
    }

    // ----- FUNCTIONS ------

    function findSimilarGames(user1, user2) {
      const result = user1.filter((x) => user2.indexOf(x) !== -1);
      return result;
    }

    // We first start by gathering and generating all the games of each member
    // roomMembersGames will be a 2D array with each index being another array of all the games of that user.
    // TODO: Here is where we could filter out games before they're added into each users array.
    let roomMembersGames = [];
    for (let i = 0; i < roomMembers.length; i++) {
      // Do our FETCH calls
      let url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${config.steamKey}&steamid=${roomMembers[i].steamID}&include_appinfo=true&include_played_free_games=true&appids_filter=1`;
      let response = await fetch(url);
      let result = await response.json();
      // Process results to two separate variables per user
      let allInfo = result.response.games;
      let gameCount = result.response.game_count;
      // Build the temporary sub-array to be pushed at the end.
      let temp = [];
      for (let j = 0; j < gameCount; j++) temp.push(allInfo[j].name);
      roomMembersGames.push(temp);
    }

    // TODO: Delete this after consolidating the payload generation.
    // let checkSame = [];
    // // DOES NOT HANDLE A SOLO MEMBER.
    // if (roomMembers.length > 2) {
    //     checkSame = findSimilarGames(roomMembersGames[0], roomMembersGames[1]);
    //     for (let i = 2; i < roomMembers.length; i++) {
    //         checkSame = findSimilarGames(checkSame, roomMembersGames[i]);
    //     }
    // } else {
    //     checkSame = findSimilarGames(roomMembersGames[0], roomMembersGames[1]);
    // }

    // console.log(checkSame);

    let sharedGameNames = [];
    let ownedByWho = [];

    // Will iterate through EVERY game in ALL members libraries so could possibly take some time (does the operation in O(n+n...) time where each n is the size of another users library).
    for (let i = 0; i < roomMembersGames.length; i++) {
      for (let j = 0; j < roomMembersGames[i].length; j++) {
        let curGame = roomMembersGames[i][j];
        // Checking if the current game is in out checked list or not
        let indexOfGame = sharedGameNames.indexOf(curGame);
        if (indexOfGame != -1) {
          ownedByWho[indexOfGame].push(i);
        } else {
          // it IS NOT there so make a new entry
          sharedGameNames.push(curGame);
          let temp = [];
          temp.push(i);
          ownedByWho.push(temp);
        }
      }
    }

    socket.join("room-" + roomNumber);
    io.sockets
      .in("room-" + roomNumber)
      .emit("finalList", {
        roomMembers: roomMembers,
        games: sharedGameNames,
        owners: ownedByWho,
      });
    // io.sockets.in("room-" + roomNumber).emit("finalList", {roomMembers: roomMembers, games: checkSame});
  });
});

app.get("/list", async (req, res) => {
  res.render("list", { url: config.url });
});

server.listen(3000, () => {
  console.log(`SocketIO Server has Started!`);
});
