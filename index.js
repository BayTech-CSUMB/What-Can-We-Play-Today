// Critical for Express itself
const express = require('express');
const app = express();

// const express2 = require('express');
// const app2 = express2();
// const server = require('http').createServer(app2);
// const io = require('socket.io')(server, { cors: { origin: "*"}});

const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*"}});
// // Ensure API Keys and Confidential Data don't get published to Github 
const config = require("./private/keys.json");

// Necessary for Steam Oauth
const SteamAuth = require("node-steam-openid");
// Setup for Steam Oauth
const steam = new SteamAuth({
    // TODO: Eventually this will be set to the proper Domain name.
    // realm: "http://localhost:3000",
	realm: config.url,
    returnUrl: config.url + "/auth/steam/authenticate",
    apiKey: config.steamKey 
});

// Setup for keeping track of Users temporary data.
const session = require('express-session'); 
const { types } = require('util');
app.use(session( {
    secret: config.sessionSecret, 
    resave: true,
    saveUninitialized: true
}));

// Setup and Connect a SQLite3 Database for Room/User data storage.
const sqlite3 = require('sqlite3').verbose();
let databaseFilePath = `./private/rooms.db`;
let database = new sqlite3.Database(databaseFilePath, sqlite3.OPEN_READWRITE, (_) => { console.log('Connected to database!')});

// Tell Express which Templating Engine we're using
app.set("view engine", "ejs");
// Specify the Folder for Statics
app.use(express.static("public"));
// Need this line to allow Express to parse values sent by POST forms
// app.use(express.urlencoded({ extended: true }));

// corresponds to page.com
app.get('/', (req, res) => {
	res.render('index') //might need to be changed to res.render('page')
});

app.get('/privacy-policy', (req, res) => {
	res.render('privacy-policy')
});

//Redirects user to steam login page
app.get("/auth/steam", async (req, res) =>{
	const redirectUrl = await steam.getRedirectUrl();
	return res.redirect(redirectUrl);
});

//Gets user information and renders the rooms page
app.get("/auth/steam/authenticate", async(req, res)=>{
	try{
		const user = await steam.authenticate(req);
        // DEBUG: Confirm the Users account details.
		// console.log(user);
        // TODO: Check that this cookie storage method is best practices.
        // DEBUG: Check indexing into User obj
        // console.log(user['username'], user['steamid']);
        // localStorage.setItem("username", user['username']);
        // localStorage.setItem("userID", user['steamid']);
		req.session.username = user['username'];
		// console.log(req.session.username);
        // console.log(user['steamid']);
		// console.log(req.session.username);
		console.log(`${user['username']} has logged in!`);

		res.render('room-choice');
	} catch (error){
		console.error("couldnt fetch");
        console.error(error);
	}
})

app.get('/steam-login', (req, res) => {
	res.render('steam-login')
});

app.get('/alt-login', (req, res) => {
	res.render('alt-login')
});

app.get('/room-choice', (req, res) => {
    // const temp = localStorage.getItem("userID");
    // console.log(temp);
	res.render('room-choice');
});


// app.get('/empty-room', async (req, res) => {
// 	const roomNumber = 89641;
// 	let roomMembers = [];
// 	try {
// 		let sql = `SELECT UserID
// 					From Rooms
// 					WHERE RoomID = 89641`;
		
// 		await database.each(sql, (err, row) => {
// 			roomMembers.push(req.session.username);

// 		});
// 		console.log(`Final: ${roomMembers}`);
// 	//  res.render('empty-room', {"roomNumber": roomNumber, "username": req.session.username, "roomMembers": roomMembers});

// 	} catch (error){
// 		console.log(error);
// 	}

//     // TODO: Generate random room numbers instead of hard coding
//     //const roomNumber = 89641;
//     console.log(`${req.session.username} has entered the room!`);
// 	res.render('empty-room', {"roomNumber": roomNumber, "username": req.session.username, "roomMembers": roomMembers});
//     // let roomMembers = [];
    
// 	// let sql = `SELECT UserID
// 	// 			FROM Rooms
// 	// 			WHERE RoomID = 89641`;

//     // database.each(sql, (err, row) => {
//     //     console.log(`DB Result: ${row.UserID}`);
//     //     roomMembers.push(row.UserID);
// 	// 	console.log(roomMembers);
//     // });
//     //console.log(`Final: ${roomMembers}`);

// 	res.render('empty-room', {"roomNumber": roomNumber, "username": req.session.username, "roomMembers": roomMembers});
// });

app.get('/empty-room', (req, res) => {
	// const roomMembers = [];
	// roomMembers.push(req.session.username);

	res.render('empty-room', {"username": req.session.username});
});

let roomMembers = [];
io.on('connection', (socket) => {
    const roomNumber = `89641`;
    
	console.log(`User connected: ${socket.id}`);

	socket.on("message", (data) => {
		console.log(`Receiever: ${data}`);
        // console.log(typeof(data));
		// io.emit(data);
        if (!roomMembers.includes(data)) {
            roomMembers.push(data);
        }

        socket.join("room-" + roomNumber);
        io.sockets.in("room-" + roomNumber).emit('otherMsg', roomMembers.join(' '));
        // socket.emit('finalMsg', roomMembers.join(' '));
	});

})

// Tells server to listen for any request on Port 3000
// app.listen(3000, () => {
//     console.log(`Express Server has Started`);
// });

server.listen(3000, () => {
    console.log(`SocketIO Server has Started!`);
});
// server.listen(3001, () => {
//     console.log(`SocketIO Server has Started!`);
// });
