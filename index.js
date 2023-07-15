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
const steamWrapper = require('steam-js-api');
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
app.use(
  session({
    secret: config.sessionSecret,
    resave: true,
    saveUninitialized: true,
  }),
  bodyParser.urlencoded({ extended: true }),
  bodyParser.json({extended: true})
);

// Tell Express which Templating Engine we're using
app.set("view engine", "ejs");
// Specify the Folder for Statics
app.use(express.static("public"));
// Need this line to allow Express to parse values sent by POST forms
app.use(express.urlencoded({ extended: true }));

// TODO: Consolidate the two room structs (this & socketRooms) so we don't use extra memory.
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
  }, 303);
});

app.get("/join-room", async (req, res) => {
  res.render("join-room", {existingRooms: existingRooms});
}); 

app.post("/join-room", (req, res) => {
    let potentialRoomNum = req.body.roomnum;
    // DEBUG: Check the incoming data and the struct it's being compared to
    // console.log(`${potentialRoomNum}`);
    // console.log(existingRooms);
    if (existingRooms.includes(potentialRoomNum)) {
        console.log(`Room FOUND`);
        res.cookie("roomNumber", potentialRoomNum);
        res.render("empty-room", {roomNumber: potentialRoomNum, url: config.url});
    } else {
        console.log(`Room NOT FOUND`);
        res.render("join-room", {existingRooms: existingRooms});
    }
});

// TODO: Ensure that regardless of the proper routing, that all pages validate and ensure they have the data they need (e.g. empty-room will redirect the users to create/join room if they DONT have a Room Number in their cookies).
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
    res.redirect(303, "room-choice");
  } catch {
    console.log("Could not fetch information...");
  }
});

//Sockets used for members of the same room
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
    socket.join("room-" + roomNumber);

    let potentialRoom = socketRooms.find(x => x.roomNumber === roomNumber);
    // Using the variable above, we can check if there IS a room or not
    if (typeof potentialRoom != 'undefined') {
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
        let temp = new Room(roomNumber, [[data.steamID, data.username, data.avatar]]);
        socketRooms.push(temp);
    }
    
    // Refind the room again and set the output of users to the front-end
    potentialRoom = socketRooms.find(x => x.roomNumber === roomNumber);
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
    let roomNumber = data.roomNumber;
    let roomMembers = socketRooms.find(x => x.roomNumber === roomNumber).roomMembers;

    function Game(gameName, gameImage, gameLink) {
        this.gameName = gameName;
        this.gameImage = gameImage;
        this.gameLink = gameLink;
    }

    // We first start by gathering and generating all the games of each member
    // roomMembersGames will be a 2D array with each index being another array of all the games of that user.
    let roomMembersGames = [];

    // TODO: For efficiency sake, this essentially runs TWO major for-loops. One to build the data, and the second to process it. Can combine both into one to not waste computational space.

    for (let i = 0; i < roomMembers.length; i++) {

        let allInfo = [];
        let gameCount = 0;
    
        let curMembersID = roomMembers[i][0];

        await steamWrapper.getOwnedGames(curMembersID, null, true).then(result => {
            gameCount = result.data.count;
            allInfo = result.data.games;
        }).catch(console.error);

      // Build the temporary sub-array to be pushed at the end.
      let tempUserGames = [];
    // Run through each game for the relevant user and build their "libraries" to run through later.
      for (let j = 0; j < gameCount; j++) {
        // TODO: Here is where we could filter out games before they're added into each users array.

        let gameID = allInfo[j].appID;

        let gamePic = allInfo[j].url_store_header;
        
        let tempGame = new Game(allInfo[j].name, 
            gamePic, 
            allInfo[j].url_store);
        tempUserGames.push(tempGame);
      };
      roomMembersGames.push(tempUserGames);
    }

    let sharedGameNames = [];
    let ownedByWho = [];
    let gameImages = [];
    let gameLinks = [];

    // Will iterate through EVERY game in ALL members libraries so could possibly take some time (does the operation in O(m+n...) time where each X is the size of another users library).
    for (let i = 0; i < roomMembersGames.length; i++) {
      for (let j = 0; j < roomMembersGames[i].length; j++) {
        let currentGame = roomMembersGames[i][j];

        // Checking if the current game is in out checked list or not
        let indexOfGame = sharedGameNames.indexOf(currentGame.gameName);
        if (indexOfGame != -1) {
            // It IS THERE so just append the SteamID to the "current owners"
          ownedByWho[indexOfGame].push(i);
        } else {
          // it IS NOT there so make a new entry with name, image, & link
          sharedGameNames.push(currentGame.gameName);
          gameImages.push(currentGame.gameImage);
          gameLinks.push(currentGame.gameLink);
            // Add the SteamID to a new array and start the appending process
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
        images: gameImages,
        links: gameLinks,
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

server.listen(3000, () => {
  console.log(`SocketIO Server has Started!`);
});
