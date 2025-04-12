module.exports = (app, pool, authenticateToken) => {

    const bcrypt = require('bcrypt');

    const upload = require('./multer_conf');


    require('./api_endpoints1')(app, pool);


    const jwt = require('jsonwebtoken'); // Načítaj knižnicu pre JWT
    const dotenv = require('dotenv');    // Načítaj .env

    dotenv.config();  // Načítaj premenné z .env


    async function checkUserExists(user_id, res) {
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
        if (userCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Používateľ s týmto ID neexistuje' });
        }
    }

    async function checkTripExists(user_id,trip_id,res) {
        console.log(user_id,trip_id);
        const tripCheck = await pool.query('SELECT trip_id FROM trip WHERE trip_id = $1 AND user_id = $2', [trip_id, user_id]);
        if (tripCheck.rowCount === 0) {
            return res.status(404).json({error: 'Výlet s týmto ID neexistuje alebo nepatrí tomuto používateľovi'});
        }
    }





    /* úvodná stránka api */
    app.get('/', (req, res) => {
        res.send('API beží správne 🚀');
    });


    /* autentifikácia cez JWT */
    /* register */
    app.post('/users/register', async (req, res) => {
        const { username, email, password } = req.body;

        try {
            //skontroluj či už existuje user
            const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userExists.rows.length > 0) {
                return res.status(400).json({ message: 'User already exists' });
            }

            //zahešuj jeslo
            const hashedPassword = await bcrypt.hash(password, 10);

            //ulož usera do db
            const newUser = await pool.query(
                'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
                [username, email, hashedPassword]
            );

            //vytvor JWT token
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


    /* login */
    app.post('/users/login', async (req, res) => {
        const { username, password } = req.body;

        try {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
            const user = result.rows[0];

            if (!user) {
                return res.status(400).json({ message: 'Nesprávne meno alebo heslo.' });
            }

            //porovná heslo
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({ message: 'Nesprávne meno alebo heslo.' });
            }

            //vytvorí JWT token
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


    /* trip management */
    /* vytvorenie tripu */
    app.post('/create-trip', authenticateToken, async (req, res) => {
        const { trip_title, trip_description, rating, start_date, end_date, visibility } = req.body;
        const userId = req.user.userId;


        try {
            /* či existuje user */
            const userStatus = await checkUserExists(userId, res);
            if (userStatus) return userStatus;


            const result = await pool.query(
                `INSERT INTO trip (user_id, trip_title, trip_description, rating, visibility, start_date, end_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
                [userId, trip_title, trip_description, rating, visibility, start_date, end_date]
            );

            res.status(201).json({
                message: 'Trip bol úspešne vytvorený',
                trip: result.rows[0]
            });
        } catch (err) {
            console.error('Chyba pri vytváraní tripu:', err);
            res.status(500).json({ error: 'Chyba na serveri pri vytváraní tripu' });
        }
    });



    /* trip image management */
    /* nahranie obrázka */
    app.post('/upload-trip-images/:user_id/:trip_id', authenticateToken, upload.array('images'), async (req, res) => {
        const { user_id, trip_id } = req.params; /* zoberieme user_id a trip_id kam to uložiť */
        const files = req.files;  //nahrané súbory

        if (!files || files.length === 0) { /* ak som nenahral nič */
            return res.status(400).json({ error: 'Žiadne obrázky neboli nahrané' });
        }

        try {
            /* či existuje user a trip */
            const userStatus = await checkUserExists(user_id, res);
            if (userStatus) return userStatus;

            const tripStatus = await checkTripExists(user_id, trip_id, res);
            if (tripStatus) return tripStatus;



            //pre každý obrázok spravíme unikátnu path
            const imageUrls = [];
            for (const file of files) {
                const imagePath = `/images/${user_id}/${trip_id}/${file.filename}`;
                imageUrls.push(imagePath);

                //upload do databázy
                await pool.query(
                    'INSERT INTO trip_images (trip_id, image_url) VALUES ($1, $2)',
                    [trip_id, imagePath]
                );
            }

            res.status(201).json({
                message: 'Obrázky boli úspešne nahrané',
                images: imageUrls
            });
        } catch (err) {
            console.error('Chyba pri ukladaní obrázkov:', err);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


}