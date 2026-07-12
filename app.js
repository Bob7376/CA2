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




app.get('/', (req, res) => {
    res.redirect('/register');
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    const { name, email, password, role } = req.body;

    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            return res.render('register', { error: 'Something went wrong. Try again.' });
        }

        const sql = 'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)';
        db.query(sql, [name, email, hashedPassword, role], (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.render('register', { error: 'That email is already registered.' });
                }
                return res.render('register', { error: 'Something went wrong. Try again.' });
            }
            res.redirect('/login');
        });
    });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err || results.length === 0) {
            return res.render('login', { error: 'Invalid email or password.' });
        }

        const user = results[0];

        bcrypt.compare(password, user.password, (err, match) => {
            if (!match) {
                return res.render('login', { error: 'Invalid email or password.' });
            }

            req.session.user = { id: user.id, name: user.name, role: user.role };
            res.redirect('/dashboard');
        });
    });
});

function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

app.get('/dashboard', requireLogin, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});






app.listen(3000, () => console.log('Running on http://localhost:3000'));