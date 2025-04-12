module.exports = (app, pool, authenticateToken) => {

    /*** DEPENDENCIES ***/
    const bcrypt = require('bcrypt');
    const upload = require('./multer_conf');
    const path = require('path');
    const fs = require('fs');
    const jwt = require('jsonwebtoken'); // Načítaj knižnicu pre JWT
    const dotenv = require('dotenv');    // Načítaj .env
    require('./api_endpoints1')(app, pool);
    dotenv.config();  // Načítaj premenné z .env


    /*** FUNKCIE ***/
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


    /* Spoločná funkcia pre spracovanie nahrávania obrázkov */
    async function handleImageUpload(req, res) {
        const { user_id, image_type, trip_id } = req.params;
        const files = req.files;

        if (!files || files.length === 0) { /* ak tam nie sú nahraté obrázky */
            return res.status(400).json({ error: 'Žiadne obrázky neboli nahrané' });
        }

        try {
            /* či existuje user */
            const userStatus = await checkUserExists(user_id, res);
            if (userStatus) return userStatus;

            const imageUrls = [];

            /* trip obrázky */
            if (image_type === 'trip_images') {
                if (!trip_id) { /* ak som nezadal trip_id */
                    return res.status(400).json({ error: 'Chýba trip_id pre nahrávanie trip obrázkov' });
                }

                /* či existuje trip záznam */
                const tripStatus = await checkTripExists(user_id, trip_id, res);
                if (tripStatus) return tripStatus;

                /* každý súbor sa uploadne */
                for (const file of files) {
                    const imagePath = `/images/${user_id}/trip_images/${trip_id}/${file.filename}`;
                    imageUrls.push(imagePath);

                    /* vkladanie do databázy url obrázkov */
                    await pool.query(
                        'INSERT INTO trip_images (trip_id, image_url) VALUES ($1, $2)',
                        [trip_id, imagePath]
                    );
                }
            }

            /* profilovka */
            else if (image_type === 'profile_images') {
                const file = files[0]; // len jeden profilový obrázok
                const newImagePath = `/images/${user_id}/profile_images/${file.filename}`;
                imageUrls.push(newImagePath);

                // Získaj pôvodný profilový obrázok z profile_picture tabuľky
                const result = await pool.query(
                    'SELECT image_url FROM profile_picture WHERE user_id = $1',
                    [user_id]
                );

                const oldImagePath = result.rows[0]?.image_url;

                // Vymaž starý obrázok ak existuje a nie je null
                if (oldImagePath) {
                    const fullOldPath = path.join(__dirname, oldImagePath);
                    if (fs.existsSync(fullOldPath)) {
                        fs.unlink(fullOldPath, (err) => {
                            if (err) console.error('Chyba pri mazaní starého profilového obrázka:', err);
                            else console.log('Starý profilový obrázok zmazaný:', fullOldPath);
                        });
                    }

                    // UPDATE existujúceho záznamu
                    await pool.query(
                        'UPDATE profile_picture SET image_url = $1 WHERE user_id = $2',
                        [newImagePath, user_id]
                    );
                } else {
                    // INSERT ak žiadny obrázok ešte neexistuje
                    await pool.query(
                        'INSERT INTO profile_picture (user_id, image_url) VALUES ($1, $2)',
                        [user_id, newImagePath]
                    );
                }
            }
            /* nesprávne napísaný image_type :) */
            else {
                return res.status(400).json({ error: 'Neznámy typ obrázkov (image_type)' });
            }

            res.status(201).json({
                message: 'Obrázky boli úspešne nahrané',
                images: imageUrls
            });

        } catch (err) {
            console.error('Chyba pri ukladaní obrázkov:', err);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    }





    /*** ENDPOINTY ***/
    /* úvodná stránka api */
    app.get('/', (req, res) => {
        res.send('API beží správne 🚀');
    });


    /** autentifikácia cez JWT **/
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
    /* get trips */
    app.get('/trip/:trip_id', authenticateToken, async (req, res) => {
        const trip_id = parseInt(req.params.trip_id); // získanie trip_id z parametrov URL
        try {
            // Overíme, či výlet s daným ID existuje
            const result = await pool.query(
                'SELECT * FROM trip WHERE trip_id = $1',
                [trip_id]
            );

            // Ak výlet neexistuje
            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Výlet s týmto ID neexistuje' });
            }

            // Vrátime detail výletu
            res.status(200).json({
                trip: result.rows[0]
            });
        } catch (error) {
            console.error('Chyba pri získavaní výletu:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });



    /* trip image management */
    /* nahranie profilovky */
    app.post('/upload-images/:user_id/:image_type', authenticateToken, upload.array('images'), handleImageUpload);

    /* nahranie trip obrázkov */
    app.post('/upload-images/:user_id/:image_type/:trip_id', authenticateToken, upload.array('images'), handleImageUpload);


    /* získanie obrázkov k tripu podla trip_id */
    app.get('/trip/:trip_id/images', async (req, res) => {
        const { trip_id } = req.params;  // získať trip_id z parametrov URL

        try {
            const tripResult = await pool.query('SELECT * FROM trip WHERE trip_id = $1', [trip_id]);

            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje' });
            }

            // Získať obrázky pre daný trip
            const imagesResult = await pool.query('SELECT image_url FROM trip_images WHERE trip_id = $1', [trip_id]);

            if (imagesResult.rowCount === 0) {
                return res.status(404).json({ error: 'Žiadne obrázky k tomuto tripu' });
            }

            // Vytvoriť pole obrázkových URL
            const images = imagesResult.rows.map(row => row.image_url);

            // Vrátiť obrázky
            res.status(200).json({
                message: 'Obrázky pre tento trip',
                images: images
            });

        } catch (err) {
            console.error('Chyba pri načítavaní obrázkov:', err);
            res.status(500).json({ error: 'Chyba na serveri pri načítavaní obrázkov' });
        }
    });


    /* funkcia na poslanie obrázka zo servera */
    function sendImage(res, imagePath) {
        if (fs.existsSync(imagePath)) {
            return res.sendFile(imagePath);
        } else {
            return res.status(404).json({ error: 'Obrázok neexistuje' });
        }
    }



    /* získanie jedného trip image obrázka z backendu cez url */
    app.get('/images/:user_id/trip_images/:trip_id/:filename', async (req, res) => {
        const { user_id, trip_id, filename } = req.params;
        const imagePath = path.join(__dirname, 'images', user_id, 'trip_images', trip_id, filename);
        return sendImage(res, imagePath);
    });


    /* získanie jedného profilového obrázka z backendu cez url */
    app.get('/images/:user_id/profile_images/:filename', async (req, res) => {
        const { user_id, filename } = req.params;
        const imagePath = path.join(__dirname, 'images', user_id, 'profile_images', filename);
        return sendImage(res, imagePath);
    });

}