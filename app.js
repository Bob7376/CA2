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

const sessionSecret = process.env.SESSION_SECRET || 'development-only-session-secret';

if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET is missing. Using a development-only fallback secret.');
}

if (!process.env.DB_NAME) {
    console.warn('DB_NAME is missing from .env. Database queries will fail until it is set.');
}

app.use(session({

    secret: sessionSecret,
    resave: false,
    saveUninitialized: false
}));




app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS, false for local
}));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  
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


app.get('/search', (req, res) => {
const searchTerm = req.query.query || '';


const sql = `
      SELECT 
        s.student_id, 
        s.student_name, 
        s.class_id, 
        s.image, 
        a.status, 
        a.remarks,
        a.module_slot
      FROM attendance_records a
      INNER JOIN student s ON a.student_id = s.student_id
      WHERE s.student_name LIKE ? OR s.student_id LIKE ?;
    `;


    const queryValue = `%${searchTerm}%`;

    pool.query(sql, [queryValue, queryValue], (err, results) => {
        if (err) {
            console.error("Error executing search query:", err);
            return res.status(500).send("Database error occurred.");
        }


       res.render('search', { 
            students: results, 
            user: req.session.user 
        });
    });
});

app.get('/classes', (req, res) => {

    if (!req.session.user) {
        return res.redirect('/login');
    }

    const selectedClass = req.query.classId || ''; 
    const classListSql = "SELECT DISTINCT class_id FROM student ORDER BY class_id;";
    
    pool.query(classListSql, (err, classRows) => {
        if (err) {
            console.error("Error fetching class list:", err);
            return res.status(500).send("Database error.");
        }

        
        const classes = classRows.map(row => row.class_id);


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

            
            res.render('classes', {
                students: studentRows,
                classes: classes,
                selectedClass: selectedClass,
                user: req.session.user 
            });
        });
    });
});

// Student Details Route //
app.get('/students/:studentId', requireLogin, (req, res) => {
    const studentId = req.params.studentId;

    const studentSql = `SELECT * FROM student WHERE student_id = ?`;
    const attendanceSql = `
        SELECT *
        FROM attendance_records
        WHERE student_id = ?
        ORDER BY session DESC;
    `;

    db.query(studentSql, [studentId], (err, studentRows) => {
        if (err) {
            console.error("Error fetching student info:", err);
            return res.status(500).send("Database error.");
        }

        if (studentRows.length === 0) {
            return res.status(404).send("Student not found.");
        }

        const student = studentRows[0];

        db.query(attendanceSql, [studentId], (err, attendanceRows) => {
            if (err) {
                console.error("Error fetching attendance records:", err);
                return res.status(500).send("Database error.");
            }

            res.render('show', {
                student,
                attendanceRecords: attendanceRows,
                user: req.session.user
            });
        });
    });
});
// Student Details Route //

app.get('/edit-attendance', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }

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


app.get('/add-student', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }

    res.render('add-new-info', {
        user: req.session.user,
        error: null,
        success: null
    });
});

app.post('/add-student', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }

    const { student_id, student_name, class_id, image } = req.body;

    if (!student_id || !student_name || !class_id) {
        return res.render('add-new-info', {
            user: req.session.user,
            error: 'Student ID, Name, and Class are required.',
            success: null
        });
    }

    // Default image fallback if left empty
    const photoPath = (image && image.trim()) ? image.trim() : 'default.png';

    // Note: Updated table name to 'students' (double check your MySQL table name!)
    const sql = 'INSERT INTO students (student_id, student_name, class_id, image) VALUES (?, ?, ?, ?)';

    pool.query(sql, [student_id, student_name, class_id, photoPath], (err) => {
        if (err) {
            console.error("Error adding student:", err);

            if (err.code === 'ER_DUP_ENTRY') {
                return res.render('add-student', {
                    user: req.session.user,
                    error: 'A student with that ID already exists.',
                    success: null
                });
            }

            return res.render('add-new-info', {
                user: req.session.user,
                error: 'Something went wrong. Try again.',
                success: null
            });
        }

        res.render('add-student', {
            user: req.session.user,
            error: null,
            success: `Student "${student_name}" (${student_id}) was added successfully.`
        });
    });
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));