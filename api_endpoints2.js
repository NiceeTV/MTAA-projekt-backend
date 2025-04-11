module.exports = (app, pool) => {
    const { authenticateToken } = require('./index');
    const bcrypt = require('bcrypt');
    require('./api_endpoints1')(app, pool);


    const jwt = require('jsonwebtoken'); // Načítaj knižnicu pre JWT
    const dotenv = require('dotenv');    // Načítaj .env

    dotenv.config();  // Načítaj premenné z .env


    app.get('/', (req, res) => {
        res.send('API beží správne 🚀');
    });



    //autentifikácia cez JWT
    // Registrácia používateľa
    app.post('/users/register', async (req, res) => {
        const { username, email, password } = req.body;

        try {
            // Skontroluj, či používateľ už existuje
            const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userExists.rows.length > 0) {
                return res.status(400).json({ message: 'User already exists' });
            }

            // Zahashuj heslo
            const hashedPassword = await bcrypt.hash(password, 10);

            // Ulož používateľa do DB
            const newUser = await pool.query(
                'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
                [username, email, hashedPassword]
            );

            // Vytvor JWT token
            const token = jwt.sign(
                { userId: newUser.rows[0].id, username: newUser.rows[0].username },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            res.status(201).json({ token });
        } catch (err) {
            console.error(err.message);
            res.status(500).json({ message: 'Server error' });
        }
    });


// Prihlásenie používateľa
    app.post('/users/login', async (req, res) => {
        const { username, password } = req.body;

        try {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
            const user = result.rows[0];

            if (!user) {
                return res.status(400).json({ message: 'Nesprávne meno alebo heslo.' });
            }

            // Porovnaj heslo s hashom
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({ message: 'Nesprávne meno alebo heslo.' });
            }

            // Vytvor JWT token
            const token = jwt.sign(
                { userId: user.id, username: user.username },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            res.status(200).json({ token });
        } catch (err) {
            console.error(err.message);
            res.status(500).json({ message: 'Chyba pri prihlasovaní' });
        }
    });






}