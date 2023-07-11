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
app.use(express.urlencoded({ extended: true }));

let existingRooms = [];

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
  res.render("room-choice");
});

//Passes host role
app.post("/room-choice", async (req, res) => {
  let roomNumber = Math.floor(Math.random()*90000) + 10000;
  roomNumber = roomNumber.toString();
    // Ensures that room numbers are random and unique so we don't have colliding room IDs.
  while (existingRooms.includes(roomNumber)) {
    roomNumber = Math.floor(Math.random()*90000) + 10000;
    roomNumber = roomNumber.toString();
  }

// Add our now guaranteed unique room to the existing rooms & also add the number to the users cookies.
  existingRooms.push(roomNumber);
  res.cookie("roomNumber", roomNumber);

// Render the next page for the Host now with the number on their page.
  res.redirect("empty-room", {
    role: req.body.role,
    roomNumber: this.roomNumber,
    url: config.url,
  }, 200);
});

app.get("/join-room", async (req, res) => {
  res.render("join-room");
}); 

app.post("/join-room", (req, res) => {
    let potentialRoomNum = req.body.roomnum;
    // console.log(`${potentialRoomNum}`);
    console.log(existingRooms);
    // IF ELSE 
    console.log(existingRooms.includes(potentialRoomNum));
    if (existingRooms.includes(potentialRoomNum)) {
        console.log(`Room FOUND`);
        res.cookie("roomNumber", potentialRoomNum);
        res.render("empty-room", {roomNumber: potentialRoomNum, url: config.url});
    } else {
        console.log(`Room NOT FOUND`);
    }
});

app.get("/empty-room", (req, res) => {
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
    res.render("/room-choice", {
      username: username,
      steamID: steamID,
    });
  } catch {
    console.log("Could not fetch information...");
  }
});

//Sockets used for members of the same room
// let roomMembers = [];
// let ids = [];

function Room(roomNumber, roomMembers) {
  this.roomNumber = roomNumber;
  this.roomMembers = roomMembers;
}
let socketRooms = [];

//Socket.io used to room member data to the front end
io.on("connection", (socket) => {
  // Used to generate room with its members
  socket.on("message", (data) => {
    let roomNumber = data.roomNumber;
    console.log(`Message Room Number: ${roomNumber}`);
    socket.join("room-" + roomNumber);

    let potentialRoom = socketRooms.find(x => x.roomNumber === roomNumber);
    console.log(`BEFORE: ${potentialRoom}`);

    if (typeof potentialRoom != 'undefined') {
        console.log(`FOUND`);
        let arr = potentialRoom.roomMembers;
        console.log(arr);
        // IF the USER is ALREADY there DONT update
        let hasFound = false;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i][0] == data.steamID) {
                hasFound = true;
            }
        }
        
        if (hasFound == false) {
            arr.push([data.steamID, data.username, data.avatar]);
            potentialRoom.roomMembers = arr;
        }
    } else {
        console.log(`NOT FOUND`);
        // Made a temp array to store the first user (HOST)
        // Added Host to Rooms
        let temp = new Room(roomNumber, [[data.steamID, data.username, data.avatar]]);
        socketRooms.push(temp);
        // ['12345', ['Y']]
    }
    
    potentialRoom = socketRooms.find(x => x.roomNumber === roomNumber);
    console.log(`AFTER:`);
    console.log(potentialRoom);

    // if (!ids.includes(data.steamID)) {
    //   roomMembers.push(data);
    //   ids.push(data.steamID);
    // }

    roomMembers = potentialRoom.roomMembers;

    io.sockets.in("room-" + roomNumber).emit("otherMsg", roomMembers);
  });

  socket.on("newList", (data) => {
    io.emit("navigate");
  });

  // MAIN WORKHORSE FUNCTION. Gathers the SteamIDs of the room members and uses them to generate the massive list of shared games.
  // Sort by amount of time played and then generate shared list
  socket.on("generate", async (data) => {
    let roomNumber = data.roomNumber;
    let roomMembers = socketRooms.find(x => x.roomNumber === roomNumber).roomMembers;
    // if (!ids.includes(data.steamID)) {
    //   roomMembers.push(data);
    //   ids.push(data.steamID);
    // }

    // ----- FUNCTIONS ------

    function findSimilarGames(user1, user2) {
      const result = user1.filter((x) => user2.indexOf(x) !== -1);
      return result;
    }

    // TODO: Start using objects to store all the relevant game data per game.
    // function Game(gameName, gameImage, gameLink) {
        // this.gameName = gameName;
        // this.gameImage = gameImage;
        // this.gameLink = gameLink;
    // }

    // We first start by gathering and generating all the games of each member
    // roomMembersGames will be a 2D array with each index being another array of all the games of that user.
    // TODO: Here is where we could filter out games before they're added into each users array.
    let roomMembersGames = [];
    for (let i = 0; i < roomMembers.length; i++) {
      // Do our FETCH calls
      let url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${config.steamKey}&steamid=${roomMembers[i][0]}&include_appinfo=true&include_played_free_games=true&appids_filter=1`;
      let response = await fetch(url);
      let result = await response.json();
      // Process results to two separate variables per user
      let allInfo = result.response.games;
      let gameCount = result.response.game_count;
      // Build the temporary sub-array to be pushed at the end.
      let temp = [];
      for (let j = 0; j < gameCount; j++) {
        temp.push(allInfo[j].name)
        // TODO: Check if these are the right names in the API
        // let tempGame = Game(allInfo[j].name, allInfo[j].image, allInfo[j].link);
        // temp.push(tempGame);
      };
      roomMembersGames.push(temp);
    }

    let sharedGameNames = [];
    let ownedByWho = [];
    let gameImages = [];
    let gameLinks = [];

    // Will iterate through EVERY game in ALL members libraries so could possibly take some time (does the operation in O(n+n...) time where each n is the size of another users library).
    for (let i = 0; i < roomMembersGames.length; i++) {
      for (let j = 0; j < roomMembersGames[i].length; j++) {
        let curGame = roomMembersGames[i][j];
        // Checking if the current game is in out checked list or not
        let indexOfGame = sharedGameNames.indexOf(curGame);
        // let indexOfGame = sharedGameNames.indexOf(curGame.gameName);
        if (indexOfGame != -1) {
          ownedByWho[indexOfGame].push(i);
        } else {
          // it IS NOT there so make a new entry
          sharedGameNames.push(curGame);
        //   sharedGameNames.push(curGame.gameName);
          let temp = [];
          temp.push(i);
          ownedByWho.push(temp);
        //   gameImages.push(curGame.gameImage);
        //   gameLinks.push(curGame.gameLink);
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
        // images: gameImages,
        // links: gameLinks,
      });
  });
});

app.get("/list", async (req, res) => {
  res.render("list", { url: config.url });
});

server.listen(3000, () => {
  console.log(`SocketIO Server has Started!`);
});
