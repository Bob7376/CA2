require('dotenv').config();// keeps the password in a .env file out of the code 
const express = require('express'); // the web server 
const session = require('express-session'); // remembers who logged in 
const mysql = require('mysql2'); // talks to the database 
const bcrypt = require('bcrypt'); // hash the passwords for security 


const app = express(); 
app.set('view engine', 'ejs');
app.use(express.urlencoded({extended: true})); // lets the server read what the users type into forms 


app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));


const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME

});




app.get('/register', (req, res) => {
    res.render('register');
});






app.listen(3000, () => console.log('Running on http://localhost:3000'));