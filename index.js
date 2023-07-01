// Critical for Express itself
const express = require("express");
const app = express();
const cookieParser = require("cookie-parser");
app.use(cookieParser());

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
  })
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

app.get("/room-choice", (req, res) => {
  // const temp = localStorage.getItem("userID");
  // console.log(temp);
  res.render("room-choice");
});

app.get("/empty-room", (req, res) => {
  res.render("empty-room", {
    username: req.session.username,
    steamID: req.session.steamID,
  });
});

let roomMembers = [];
let ids = [];
//Socket.io used to room member data to the front end
io.on("connection", (socket) => {
  const roomNumber = `89641`;
  // DEBUG:
  // console.log(`User connected: ${socket.id}`);

  socket.on("message", (data) => {
    // DEBUG:
    // console.log(`Receiever: ${data}`);
    // let exists = false;
    // for (let i = 0; i < data.length; i++) {
    //     if (!roomMembers.includes(data[i][0])) {
    //         exists = false;
	// 		roomMembers.push(data);

    //     } else {
    //         exists = true;
    //     }
    // }

	if (!ids.includes(data.steamID)){
		roomMembers.push(data);
        ids.push(data.steamID);
	}

    console.log(`Room Members`);
    console.log(roomMembers);

    socket.join("room-" + roomNumber);
    io.sockets.in("room-" + roomNumber).emit("otherMsg", roomMembers);
    // io.sockets.in("room-" + roomNumber).emit('otherMsg', roomMembers.join(' '));
  });
});

app.get("/list", (req, res) => {
  var id = req.session.steamID;
  let sql = `SELECT UserID FROM Users WHERE UserID = ${id}`;
  database.all(sql, [], (err, rows) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log(rows[0].UserID);
      res.render("list", { steamID: rows[0].UserID });
    }
  });
});

server.listen(3000, () => {
  console.log(`SocketIO Server has Started!`);
});
