# Plan: User Registration, Login & Access Control
**Stack:** Node.js + Express + EJS + MySQL (Railway) + Bootstrap 5 (CDN — zero custom CSS)

---

## The Big Picture (how the 3 features connect)

1. **Registration** — a person fills a form → we save them as a row in the `users` table (password scrambled, not plain text).
2. **Login** — they type email + password → we find their row → check the password matches → if yes, we "remember" them using a **session** (like a wristband at an event: the server stamps you once, then recognises you on every page after).
3. **Access Control** — before showing a page, we check the wristband: Are you logged in? Are you a teacher or a student? Wrong wristband = redirected away.

---

## Step 0a — Git: work on a branch, not on main

Your CA2 folder is already connected to `https://github.com/Bob7376/CA2.git`, so no cloning needed.

**One-time fix (E: drive only):** because the project sits on an external drive, Git may complain about "dubious ownership". Tell it the folder is safe — note the **double quotes** (single quotes don't work in Windows Command Prompt):

```bash
git config --global --add safe.directory "E:/Year 2 sem 1/C237 software application dev/CA 2/CA2"
```

**Why a branch?** A branch is like working on a photocopy instead of the original. You build the whole login feature on your copy (`feature/authentication`), and `main` stays clean and working for your teammates. Only when your feature is done and tested do you fold it back into `main` (that's the "merge").

**Before you start (do this once):**

```bash
git checkout main        # make sure you're on main
git pull origin main     # grab teammates' latest work first
git checkout -b feature/authentication   # create your branch and switch to it
```

`-b` means "make a new branch". Don't put `origin` in this command — `origin` is GitHub's side, and this step is local-only. You're now on `feature/authentication` — everything you commit lands here, not on main.

**As you work — commit after every step that works:**

```bash
git add .
git commit -m "Add registration form and route"
git push -u origin feature/authentication
```

(`-u` is only needed the first push; after that just `git push`.) Small, frequent commits beat one giant commit — if something breaks, you can see exactly which step did it.

**When the feature is done — merge into main.** Two ways:

*Option A — Pull Request on GitHub (recommended for a team):*
1. Push your final commits, then open `github.com/Bob7376/CA2` — GitHub shows a yellow "Compare & pull request" button.
2. Create the pull request. Teammates can see your changes line-by-line and comment.
3. Click **Merge pull request** → your work is now in `main`.
4. Back on your computer: `git checkout main` then `git pull origin main`.

*Option B — merge locally (fine if working alone):*

```bash
git checkout main
git pull origin main                # get latest main first
git merge feature/authentication    # fold your branch in
git push origin main
```

**If Git says "CONFLICT":** that means a teammate changed the same lines as you. Open the file — Git marks both versions with `<<<<<<<` and `>>>>>>>`. Delete the markers, keep the correct code, then `git add .` and `git commit`. Don't panic, nothing is lost.

**Golden rule:** `.env` (with the Railway password) must be in `.gitignore` *before* your first commit — once a password is pushed to GitHub, treat it as leaked.

---

## Step 0b — Database table (run once in MySQL Workbench on Railway)

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('teacher', 'student') NOT NULL DEFAULT 'student'
);
```

**Logic:** one row per user, each with their own password. `UNIQUE` on email means MySQL itself blocks duplicate accounts — we don't have to check twice. `role` is what access control reads later. `VARCHAR(255)` for password because the scrambled (hashed) version is much longer than what the user typed.

---

## Step 1 — Project setup

```bash
npm init -y
npm install express ejs mysql2 express-session bcrypt dotenv
```

What each one does, plainly:

| Package | Job |
|---|---|
| express | the web server — receives requests, sends pages back |
| ejs | lets us mix data into HTML (e.g. show the user's name) |
| mysql2 | talks to the Railway database |
| express-session | the "wristband" system — remembers who's logged in |
| bcrypt | scrambles passwords so nobody (even us) can read them |
| dotenv | keeps the Railway password in a `.env` file, out of the code |

**`.env` file** (add `.env` to `.gitignore` so the DB password never goes to GitHub):

```
DB_HOST=hayabusa.proxy.rlwy.net
DB_PORT=26065
DB_USER=root
DB_PASSWORD=WaddABoHajqFOmZPsVPSViOSVBNGgDdV
DB_NAME=railway
SESSION_SECRET=any-random-string-here
```

**`app.js` skeleton:**

```js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true })); // read form data

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

app.listen(3000, () => console.log('Running on http://localhost:3000'));
```

**Logic:** `express.urlencoded` is what lets the server read what users type into forms. The session `secret` is a signing key — it stops people from faking the wristband.

---

## Step 2 — Registration

### 2a. The form (`views/register.ejs`) — pure Bootstrap, no CSS

```html
<!DOCTYPE html>
<html>
<head>
  <title>Register</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">
  <div class="container mt-5" style="max-width: 480px;">
    <div class="card shadow">
      <div class="card-body">
        <h3 class="card-title text-center mb-4">Create Account</h3>

        <% if (typeof error !== 'undefined') { %>
          <div class="alert alert-danger"><%= error %></div>
        <% } %>

        <form action="/register" method="POST">
          <div class="mb-3">
            <label class="form-label">Full Name</label>
            <input type="text" name="name" class="form-control" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Email</label>
            <input type="email" name="email" class="form-control" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Password</label>
            <input type="password" name="password" class="form-control" minlength="6" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Role</label>
            <select name="role" class="form-select">
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>
          <button class="btn btn-primary w-100">Register</button>
        </form>
        <p class="text-center mt-3">Have an account? <a href="/login">Login</a></p>
      </div>
    </div>
  </div>
</body>
</html>
```

**Logic:** Bootstrap classes (`card`, `form-control`, `btn`) do all the styling. `required` and `minlength` make the browser reject empty/short input before it even reaches the server — free validation. The `alert-danger` block only appears if the server sends back an error message.

### 2b. The routes (in `app.js`)

```js
// Show the form
app.get('/register', (req, res) => res.render('register'));

// Handle the form submission
app.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;

  bcrypt.hash(password, 10, (err, hashedPassword) => {
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
```

**Logic, step by step:**
1. Grab what the user typed (`req.body`).
2. `bcrypt.hash` scrambles the password. "10" is how many times to scramble — 10 is the standard. Even if someone steals the database, they see `$2b$10$xK9...` not the real password.
3. Insert the row using `?` placeholders — this is important: it stops **SQL injection** (someone typing sneaky code into the form to hack the database). Never glue user input directly into SQL text.
4. If MySQL complains about a duplicate email (`ER_DUP_ENTRY`), show a friendly message instead of crashing.
5. Success → send them to the login page.

---

## Step 3 — Login

### 3a. The form (`views/login.ejs`)

Same card layout as register — just email + password fields posting to `/login`. (Copy `register.ejs`, delete the name/role fields, change the title and `action`.)

### 3b. The routes

```js
app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    // Step 1: does this email exist?
    if (err || results.length === 0) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    const user = results[0];

    // Step 2: does the password match?
    bcrypt.compare(password, user.password, (err, match) => {
      if (!match) {
        return res.render('login', { error: 'Invalid email or password.' });
      }

      // Step 3: put on the wristband (save who they are in the session)
      req.session.user = { id: user.id, name: user.name, role: user.role };

      // Step 4: send them to the right place for their role
      if (user.role === 'teacher') res.redirect('/teacher/dashboard');
      else res.redirect('/student/dashboard');
    });
  });
});
```

**Logic:**
- Find the user's row by email.
- `bcrypt.compare` scrambles what they just typed and checks it against the stored scramble. We never unscramble — that's not possible, which is the whole point.
- We deliberately say **"Invalid email or password"** for both failures. If we said "email not found" vs "wrong password", a hacker could figure out which emails have accounts.
- `req.session.user` is the wristband: from now on, every request from this browser carries their id, name, and role. Notice we do **not** put the password in the session.

---

## Step 4 — Access Control (the gatekeepers)

Two small "middleware" functions. Middleware = a checkpoint a request must pass through before reaching the page.

```js
// Gate 1: must be logged in
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next(); // logged in — let them through
}

// Gate 2: must have a specific role
function requireRole(role) {
  return (req, res, next) => {
    if (req.session.user.role !== role) {
      return res.status(403).render('forbidden'); // "you can't be here" page
    }
    next();
  };
}
```

Then bolt the gates onto routes:

```js
// Any logged-in user
app.get('/profile', requireLogin, (req, res) => {
  res.render('profile', { user: req.session.user });
});

// Teachers only
app.get('/teacher/dashboard', requireLogin, requireRole('teacher'), (req, res) => {
  res.render('teacherDashboard', { user: req.session.user });
});

// Students only
app.get('/student/dashboard', requireLogin, requireRole('student'), (req, res) => {
  res.render('studentDashboard', { user: req.session.user });
});
```

**Logic:** the request walks through the gates left to right. Not logged in? Gate 1 bounces you to `/login`. Logged in as a student trying a teacher page? Gate 2 shows a 403 "forbidden" page. Only if both gates say `next()` does the actual page render. This means even if a student *types the teacher URL directly*, they still can't get in — hiding a link is not security, the gate is.

You can also show/hide things inside a page by role:

```html
<% if (user.role === 'teacher') { %>
  <a href="/attendance/take" class="btn btn-success">Take Attendance</a>
<% } %>
```

---

## Step 5 — Logout

```js
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
```

**Logic:** cut off the wristband and send them back to the door.

---

## Suggested build order

1. Step 0a — pull latest main, create `feature/authentication` branch
2. Step 0b + 1 — table, packages, `app.js` runs and connects to Railway → **commit**
3. Step 2 — register a test teacher and test student, confirm rows appear in Workbench (passwords should look like `$2b$10$...`) → **commit**
4. Step 3 — log in as each, land on different dashboards → **commit**
5. Step 4 — try to open `/teacher/dashboard` while logged in as a student → should be blocked → **commit**
6. Step 5 — logout, then try `/profile` → should bounce to login → **commit, push, open pull request, merge into main**

## Test checklist

- [ ] Register with an email that already exists → friendly error, no crash
- [ ] Password in Workbench is hashed, not readable
- [ ] Wrong password → "Invalid email or password"
- [ ] Student typing teacher URL directly → 403 page
- [ ] After logout, back button / protected URLs → redirected to login
- [ ] `.env` is in `.gitignore` (Railway password not on GitHub)
- [ ] All work committed on `feature/authentication`, merged into `main` via pull request, and `main` pulled locally after the merge
