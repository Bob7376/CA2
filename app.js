require('dotenv').config();// keeps the password in a .env file out of the code 
const express = require('express'); // the web server 
const session = require('express-session'); // remembers who logged in 
const mysql = require('mysql2'); // talks to the database 
const bcrypt = require('bcrypt'); // hash the passwords for security 


const app = express(); 
app.set('view engine', 'ejs');
app.use(express.urlencoded({extended: true})); // lets the server read what the users type into forms 
app.use(express.static('public'));
// Add this line to parse incoming JSON request bodies
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET, // Add this line
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS, false for local localhost
}));




const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  // ADD THIS LINE TO FIX THE SSL ERROR:
  ssl: {
    rejectUnauthorized: false
  }
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
pool.query(sql, [name, email, hashedPassword, role], (err) => {
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

    pool.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
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

// Search Route
app.get('/search', (req, res) => {
    // Capture the search term from the URL query parameters (e.g., /search?query=Peter)
    const searchTerm = req.query.query || '';

    // SQL query using LIKE to search both name and student_id
    const sql = `
      SELECT 
        s.student_id, 
        s.student_name, 
        s.class_id, 
        s.image, 
        a.status, 
        a.remarks
      FROM attendance_records a
      INNER JOIN student s ON a.student_id = s.student_id
      WHERE s.student_name LIKE ? OR s.student_id LIKE ?;
    `;

    // Wrap the search term with SQL wildcards (%) so it matches partial text
    const queryValue = `%${searchTerm}%`;

    pool.query(sql, [queryValue, queryValue], (err, results) => {
        if (err) {
            console.error("Error executing search query:", err);
            return res.status(500).send("Database error occurred.");
        }

        // Render your search.ejs view and pass the query results
       res.render('search', { 
            students: results, 
            user: req.session.user // This gives navbar.ejs the data it is looking for!
        });
    });
});

app.get('/classes', (req, res) => {
    // 1. Safety check: Ensure the user is logged in
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const selectedClass = req.query.classId || ''; // Get the filter parameter from URL

    // 2. Fetch unique class IDs to populate your dropdown filter dynamically
    const classListSql = "SELECT DISTINCT class_id FROM student ORDER BY class_id;";
    
    pool.query(classListSql, (err, classRows) => {
        if (err) {
            console.error("Error fetching class list:", err);
            return res.status(500).send("Database error.");
        }

        // Extract class IDs into an array (e.g., ['1A', '1B'])
        const classes = classRows.map(row => row.class_id);

        // 3. Build the query to get students (optionally filtered by class_id)
        let studentSql = `
            SELECT s.student_id, s.student_name, s.class_id, s.image, a.status, a.remarks, a.session
            FROM student s
            LEFT JOIN attendance_records a ON s.student_id = a.student_id
        `;
        const queryParams = [];

        if (selectedClass) {
            studentSql += " WHERE s.class_id = ?";
            queryParams.push(selectedClass);
        }

        pool.query(studentSql, queryParams, (err, studentRows) => {
            if (err) {
                console.error("Error fetching students:", err);
                return res.status(500).send("Database error.");
            }

            // 4. Render the page, passing students, classes, selected class, and user
            res.render('classes', {
                students: studentRows,
                classes: classes,
                selectedClass: selectedClass,
                user: req.session.user // Kept for your navbar!
            });
        });
    });
});

app.get('/edit-attendance', (req, res) => {
    // 1. Select module_slot instead of session
    const query = `
        SELECT s.student_id, s.student_name, s.class_id, a.module_slot 
        FROM student s
        LEFT JOIN attendance_records a ON s.student_id = a.student_id
        ORDER BY s.student_name ASC;
    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).send("Database error.");
        }

        const allStudents = results;

        // 2. Map groups using the new module_slot key
        const groups = {};
        results.forEach(student => {
            if (student.module_slot) {
                if (!groups[student.module_slot]) {
                    groups[student.module_slot] = [];
                }
                groups[student.module_slot].push(student);
            }
        });

        res.render('edit-attendance', { 
            students: allStudents,
            groups: groups,
            user: req.session ? req.session.user : null
        }); 
    });
});

app.post('/admin/assign-group', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false });
    }

    const { groupName, studentIds } = req.body;

    if (!groupName || !studentIds || studentIds.length === 0) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Update the group_name for all selected student IDs
    const sql = "UPDATE student SET group_name = ? WHERE student_id IN (?);";
    
    pool.query(sql, [groupName, studentIds], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});



app.listen(3000, () => console.log('Running on http://localhost:3000'));