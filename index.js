// Critical for Express itself
const express = require('express');
const app = express();
// Tell Express which Templating Engine we're using
app.set("view engine", "ejs");
// Specific the Folder for Statics
app.use(express.static("public"));
// Need this line to allow Express to parse values sent by POST forms
// app.use(express.urlencoded({ extended: true }));

// corresponds to page.com
app.get('/', (req, res) => {
	res.send("Hello World");
});

// Tells server to listen for any request on Port 3000
app.listen(3000, () => {
	console.log(`Express Server Started`);
});