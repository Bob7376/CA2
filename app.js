require('dotenv').config(); // keeps the password in a .env file out of the code 
const express = require('express'); // the web server 
const session = require('express-session'); // remembers who logged in 
const mysql = require('mysql2'); // talks to the database 
const bcrypt = require('bcrypt'); // hash the passwords for security 

const app = express(); 
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true })); // lets the server read what the users type into forms 
app.use(express.static('public'));
app.use(express.json()); // Add this line to parse incoming JSON request bodies

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
    saveUninitialized: false,
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

function getClassList(callback) {
    const sql = `SELECT * FROM class;`; // or your class query
    pool.query(sql, (err, results) => {
        if (err) return callback(err, null);
        callback(null, results);
    });
}


function getModuleSlots(callback) {
    const sql = `
        SELECT DISTINCT module_slot 
        FROM attendance_records 
        WHERE module_slot IS NOT NULL AND module_slot != ''
        ORDER BY module_slot ASC;
    `;
    pool.query(sql, (err, results) => {
        if (err) return callback(err, null);
        callback(null, results);
    });
}

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
                console.error("DATABASE REGISTER ERROR:", err); // <-- Added log here
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.render('register', { error: 'That email is already registered.' });
                }
                console.error("Error registering user:", err);
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
        if (err) {
            console.error("Error logging in:", err);
            return res.render('login', { error: 'Invalid email or password.' });
        }
        if (results.length === 0) {
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
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const searchTerm = req.query.query || '';
    
    const sql = `
      SELECT
        s.student_id,
        s.student_name,
        s.class_id,
        s.image,
        s.module_slot,
        COALESCE(a.status, 'Not Marked') AS status,
        a.remarks
      FROM student s
      LEFT JOIN attendance_records a
        ON s.student_id = a.student_id AND a.date = CURDATE()
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
            SELECT
                s.student_id,
                s.student_name,
                s.class_id,
                s.image,
                COALESCE(a.status, 'Not Marked') AS status,
                a.remarks,
                COALESCE(NULLIF(s.module_slot, ''), NULLIF(a.module_slot, '')) AS module_slot
            FROM student s
            LEFT JOIN attendance_records a ON s.student_id = a.student_id AND a.date = CURDATE()
        `;
        const queryParams = [];

        if (selectedClass) {
            studentSql += " WHERE s.class_id = ?";
            queryParams.push(selectedClass);
        }

        studentSql += ` 
            GROUP BY 
                s.student_id, 
                s.student_name, 
                s.class_id, 
                s.image, 
                s.module_slot,
                a.status, 
                a.remarks, 
                a.module_slot
            ORDER BY s.student_id ASC;
        `;

        pool.query(studentSql, queryParams, (err, studentRows) => {
            if (err) {
                console.error("Error fetching students:", err);
                return res.status(500).send("Database error.");
            }

            res.render('filtering', {
                students: studentRows,
                classes: classes,
                selectedClass: selectedClass,
                user: req.session.user 
            });
        });
    });
});

// ================================
// Teacher Attendance Page
// ================================
app.get('/attendance', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'teacher') return res.status(403).send("Access denied.");

  // Include a.attendance_id so your template's form action works!
  // Subquery ensures only the latest record per student is joined if multiple exist.
  const sql = `
    SELECT 
      s.student_id, 
      s.student_name, 
      s.class_id, 
      s.module_slot, 
      a.attendance_id,
      a.status, 
      a.remarks
    FROM student s
    LEFT JOIN (
      SELECT * FROM attendance_records
      WHERE attendance_id IN (
        SELECT MAX(attendance_id) FROM attendance_records GROUP BY student_id
      )
    ) a ON s.student_id = a.student_id
  `;

  pool.query(sql, (err, students) => {
    if (err) {
      console.error('Error fetching attendance records:', err);
      return res.status(500).send('Database Error');
    }

    res.render('attendance', {
      students: students,
      user: req.session ? req.session.user : null
    });
  });
});

app.get('/students/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const studentId = req.params.id;

    const [students] = await pool.promise().query(
      'SELECT * FROM student WHERE student_id = ?',
      [studentId]
    );

    if (students.length === 0) {
      return res.status(404).send('Student not found.');
    }

    const [attendanceRecords] = await pool.promise().query(
      'SELECT * FROM attendance_records WHERE student_id = ? ORDER BY date DESC, time DESC',
      [studentId]
    );

    res.render('show', {
      student: students[0],
      attendanceRecords: attendanceRecords,
      user: req.session.user
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/edit-attendance', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }

    const sql = `
    SELECT 
        s.student_id, 
        s.student_name, 
        s.class_id, 
        s.module_slot
    FROM student s
    LEFT JOIN attendance_records ar ON s.student_id = ar.student_id
    GROUP BY s.student_id
    ORDER BY s.student_id ASC;
`;

    pool.query(sql, (err, results) => {
        if (err) {
            console.error("EDIT ATTENDANCE DATABASE ERROR:", err.sqlMessage || err);
            return res.status(500).send("Database error: " + (err.sqlMessage || err.message));
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

        res.render('organizing', { 
            students: allStudents,
            groups: groups,
            user: req.session ? req.session.user : null
        }); 
    });
});

// ================================
// Update Attendance (Teacher)
// ================================
app.post('/attendance/update/:attendance_id', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    if (req.session.user.role !== 'teacher') {
        return res.status(403).send("Access denied.");
    }

    const studentId = req.body.student_id;
    const { status, remarks } = req.body;

    pool.query(
        "SELECT attendance_id FROM attendance_records WHERE student_id = ? AND date = CURDATE()",
        [studentId],
        (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Database Error");
            }

            if (rows.length > 0) {
                const sql = "UPDATE attendance_records SET status = ?, remarks = ? WHERE attendance_id = ?;";
                pool.query(sql, [status, remarks, rows[0].attendance_id], (err2) => {
                    if (err2) {
                        console.error(err2);
                        return res.status(500).send("Database Error");
                    }
                    res.redirect('/attendance');
                });
            } else {
                const sql = "INSERT INTO attendance_records (student_id, date, time, status, remarks) VALUES (?, CURDATE(), CURTIME(), ?, ?);";
                pool.query(sql, [studentId, status, remarks], (err2) => {
                    if (err2) {
                        console.error(err2);
                        return res.status(500).send("Database Error");
                    }
                    res.redirect('/attendance');
                });
            }
        }
    );
});

app.post('/admin/assign-group', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false });
    }

    const { groupName, studentIds } = req.body;

    if (!groupName || !studentIds || studentIds.length === 0) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const sql = "UPDATE student SET group_name = ? WHERE student_id IN (?);";
    
    pool.query(sql, [groupName, studentIds], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});

app.post('/admin/remove-student', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false });
    }
    const { studentId } = req.body;

    const sql = "DELETE FROM student WHERE student_id = ?;";
    pool.query(sql, [studentId], (err, result) => {
        if (err) {
            console.error(err);
            return res.json({ success: false });
        }
        res.json({ success: true });
    });
});

app.post('/admin/edit-student', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false });
    }

    const { studentId, student_name, class_id, image } = req.body;

    if (!studentId || !student_name || !class_id) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const photoPath = (image && image.trim()) ? image.trim() : 'default.png';

    const sql = "UPDATE student SET student_name = ?, class_id = ?, image = ? WHERE student_id = ?;";
    pool.query(sql, [student_name, class_id, photoPath, studentId], (err, result) => {
        if (err) {
            console.error("Error editing student:", err);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});

function getClassList(callback) {
    pool.query("SELECT class_id FROM class ORDER BY class_id;", (err, rows) => {
        if (err) return callback(err);
        callback(null, rows.map(row => row.class_id));
    });
}

app.get('/add-student', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }

    getClassList((err, classes) => {
        if (err) {
            console.error("Error fetching class list:", err);
            return res.status(500).send("Database error.");
        }

        getModuleSlots((slotErr, moduleSlots) => {
            if (slotErr) {
                console.error("Error fetching module slots:", slotErr);
                return res.status(500).send("Database error.");
            }

            res.render('add-new-info', {
                user: req.session.user,
                classes: classes,
                moduleSlots: moduleSlots, // Array of [{ module_slot: 'Slot 1 ...' }, ...]
                error: null,
                success: null
            });
        });
    });
});

// POST Route: Process student creation
app.post('/add-student', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }

    const { student_id, student_name, class_id, image, module_slot } = req.body;

    // Helper to re-render the page consistently on success or error
    const renderForm = (errorMsg, successMsg) => {
        getClassList((err, classes) => {
            getModuleSlots((slotErr, moduleSlots) => {
                res.render('add-new-info', {
                    user: req.session.user,
                    classes: classes || [],
                    moduleSlots: moduleSlots || [], // Always pass objects array from DB
                    error: errorMsg,
                    success: successMsg
                });
            });
        });
    };


    if (!student_id || !student_name || !class_id || !module_slot) {
    return renderForm("All required fields (ID, Name, Class, Module Slot) must be filled.", null);
    }

    // Convert empty string from input to NULL for MySQL
    const studentImage = image && image.trim() !== '' ? image : null;

    const sql = `
        INSERT INTO student (student_id, student_name, class_id, image, module_slot)
        VALUES (?, ?, ?, ?, ?);
    `;

    pool.query(sql, [student_id, student_name, class_id, studentImage, module_slot], (err, result) => {
        if (err) {
        // Look at your Node terminal output when submitting the form!
            console.error("EXACT MYSQL ERROR:", err.sqlMessage || err);
            return renderForm("Failed to add student: " + (err.sqlMessage || "Database error"), null);
        }

        renderForm(null, `Student ${student_name} added successfully!`);
    });
});


app.listen(3000, () => console.log('Running on http://localhost:3000'));