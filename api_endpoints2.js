module.exports = (app, pool, authenticateToken) => {

    /*** DEPENDENCIES ***/
    const bcrypt = require('bcrypt');
    const upload = require('./multer_conf');
    const path = require('path');
    const fs = require('fs');
    const jwt = require('jsonwebtoken'); // Načítaj knižnicu pre JWT
    const dotenv = require('dotenv');    // Načítaj .env
    //require('./api_endpoints1')(app, pool);
    dotenv.config();  // Načítaj premenné z .env


    /*** FUNKCIE ***/
    async function checkUserExists(user_id, res) {
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
        if (userCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Používateľ s týmto ID neexistuje' });
        }
    }

    async function checkTripExists(user_id,trip_id,res) {
        const tripCheck = await pool.query('SELECT trip_id FROM trip WHERE trip_id = $1 AND user_id = $2', [trip_id, user_id]);
        if (tripCheck.rowCount === 0) {
            return res.status(404).json({error: 'Výlet s týmto ID neexistuje alebo nepatrí tomuto používateľovi'});
        }
    }


    /* Spoločná funkcia pre spracovanie nahrávania obrázkov */
    async function handleImageUpload(req, res) {
        const { user_id, image_type, trip_id } = req.params;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Žiadne obrázky neboli nahrané' });
        }

        try {
            const userStatus = await checkUserExists(user_id, res);
            if (userStatus) return userStatus;

            const imageUrls = [];

            if (image_type === 'trip_images') {
                if (!trip_id) {
                    return res.status(400).json({ error: 'Chýba trip_id pre nahrávanie trip obrázkov' });
                }

                const tripStatus = await checkTripExists(user_id, trip_id, res);
                if (tripStatus) return tripStatus;

                // Získaj najvyššiu existujúcu pozíciu v DB
                const result = await pool.query(
                    'SELECT MAX(position) AS max_pos FROM trip_images WHERE trip_id = $1',
                    [trip_id]
                );
                let nextPos = (result.rows[0].max_pos ?? 0); // Ak neexistujú žiadne obrázky, začne sa od 0

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const position = ++nextPos; // Priraď pozíciu a inkrementuj
                    const imagePath = `/images/${user_id}/trip_images/${trip_id}/${file.filename}`;
                    imageUrls.push(imagePath);

                    // Ulož obrázok do databázy s pozíciou
                    await pool.query(
                        'INSERT INTO trip_images (trip_id, image_url, position) VALUES ($1, $2, $3)',
                        [trip_id, imagePath, position]
                    );
                }
            }

            else if (image_type === 'profile_images') {
                const file = files[0];
                const newImagePath = `/images/${user_id}/profile_images/${file.filename}`;
                imageUrls.push(newImagePath);

                const result = await pool.query(
                    'SELECT image_url FROM profile_picture WHERE user_id = $1',
                    [user_id]
                );

                const oldImagePath = result.rows[0]?.image_url;

                if (oldImagePath) {
                    const fullOldPath = path.join(__dirname, oldImagePath);
                    if (fs.existsSync(fullOldPath)) {
                        fs.unlink(fullOldPath, (err) => {
                            if (err) console.error('Chyba pri mazaní starého profilového obrázka:', err);
                            else console.log('Starý profilový obrázok zmazaný:', fullOldPath);
                        });
                    }

                    await pool.query(
                        'UPDATE profile_picture SET image_url = $1 WHERE user_id = $2',
                        [newImagePath, user_id]
                    );
                } else {
                    await pool.query(
                        'INSERT INTO profile_picture (user_id, image_url) VALUES ($1, $2)',
                        [user_id, newImagePath]
                    );
                }
            }

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


    /* edit trip, len to čo určím sa upraví */
    app.put('/users/:id/trip/:trip_id', async (req, res) => {
        const user_id = parseInt(req.params.id); // používame ID z URL
        const trip_id = parseInt(req.params.trip_id); // ID výletu
        const {
            trip_title,
            trip_description,
            rating,
            visibility,
            start_date,
            end_date
        } = req.body;
        const allowedVisibility = ['public', 'private', 'friends'];

        if (visibility && !allowedVisibility.includes(visibility)) {
            return res.status(400).json({ error: 'Neplatná hodnota pre visibility' });
        }

        try {
            // Over kontrolu používateľa
            const userCheck = await pool.query(
                'SELECT id FROM users WHERE id = $1',
                [user_id]
            );

            if (userCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Používateľ neexistuje' });
            }


            /* či existuje trip */
            const tripResult = await pool.query('SELECT * FROM trip WHERE trip_id = $1', [trip_id]);
            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje' });
            }


            // Skladanie aktualizačného dotazu
            let updateQuery = 'UPDATE trip SET';
            const updateValues = [];
            let valueIndex = 1;

            if (trip_title) {
                updateQuery += ` trip_title = $${valueIndex},`;
                updateValues.push(trip_title);
                valueIndex++;
            }
            if (trip_description) {
                updateQuery += ` trip_description = $${valueIndex},`;
                updateValues.push(trip_description);
                valueIndex++;
            }
            if (rating) {
                updateQuery += ` rating = $${valueIndex},`;
                updateValues.push(rating);
                valueIndex++;
            }
            if (visibility) {
                updateQuery += ` visibility = $${valueIndex},`;
                updateValues.push(visibility);
                valueIndex++;
            }
            if (start_date) {
                updateQuery += ` start_date = $${valueIndex},`;
                updateValues.push(start_date);
                valueIndex++;
            }
            if (end_date) {
                updateQuery += ` end_date = $${valueIndex},`;
                updateValues.push(end_date);
                valueIndex++;
            }

            // Odstránenie poslednej zbytočnej čiarky
            updateQuery = updateQuery.slice(0, -1); // odstráni poslednú čiarku
            updateQuery += ' WHERE user_id = $' + valueIndex + ' AND trip_id = $' + (valueIndex + 1) + ' RETURNING *';

            updateValues.push(user_id);
            updateValues.push(trip_id);

            // Spustenie dotazu na aktualizáciu
            const result = await pool.query(updateQuery, updateValues);

            res.status(200).json({
                message: 'Výlet bol úspešne aktualizovaný',
                trip: result.rows[0]
            });
        } catch (error) {
            console.error('Chyba pri aktualizácii výletu:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


    /* sort tripov usera */
    app.get('/trip/:trip_id/sort', authenticateToken, async (req, res) => {
        const { order } = req.query;
        const user_id = req.user.user_id;

        const sortOrder = (order === 'desc') ? 'DESC' : 'ASC'; // defaultne ASC

        try {
            const result = await pool.query(
                `SELECT * FROM trip
                   WHERE user_id = $1
                   ORDER BY start_date ${sortOrder}`,
                            [user_id]
                        );

            res.status(200).json({
                message: `Výsledky zoradené podľa dátumu (${sortOrder})`,
                trips: result.rows
            });
        } catch (err) {
            console.error('Chyba pri získavaní výletov:', err);
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

            /* či existuje trip */
            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje' });
            }

            /* obrázky pre daný trip */
            const imagesResult = await pool.query('SELECT image_url FROM trip_images WHERE trip_id = $1', [trip_id]);

            if (imagesResult.rowCount === 0) {
                return res.status(404).json({ error: 'Žiadne obrázky k tomuto tripu' });
            }

            /* pole url obrázkov */
            const images = imagesResult.rows.map(row => row.image_url);

            /* vráti obrázky */
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


    /* edit trip obrázkov */
    /* funguje na báze imagesToAdd a imagesToDelete, z frontendu mi príde čo mám vymazať a čo pridať */
    app.put('/trip/:user_id/trip_images/:trip_id', upload.array('imagesToAdd'), async (req, res) => {
        const { user_id, trip_id } = req.params;
        const { imagesToDelete } = req.body; // JSON stringified array from frontend
        const files = req.files;

        const replacedImages = [];

        try {
            // Kontrola či existuje user a trip
            const userStatus = await checkUserExists(user_id, res);
            if (userStatus) return userStatus;

            const tripStatus = await checkTripExists(user_id, trip_id, res);
            if (tripStatus) return tripStatus;

            // Spracovanie vymazania obrázkov
            const toDelete = JSON.parse(imagesToDelete || '[]'); // frontend pošle JSON.stringify([...])


            // Získaj najvyššiu existujúcu pozíciu v DB
            const result = await pool.query(
                'SELECT MAX(position) AS max_pos FROM trip_images WHERE trip_id = $1',
                [trip_id]
            );
            let nextPos = (result.rows[0].max_pos ?? 0); // Ak neexistujú žiadne obrázky, začne sa od 0



            for (const position of toDelete) {
                const result = await pool.query(
                    'SELECT image_url FROM trip_images WHERE trip_id = $1 AND position = $2',
                    [trip_id, position]
                );


                if (result.rows.length > 0) {
                    const imageUrl = result.rows[0].image_url;
                    const fullPath = path.join(__dirname, imageUrl);


                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath); // Vymažeme súbor z disku
                    }

                    await pool.query(
                        'DELETE FROM trip_images WHERE trip_id = $1 AND position = $2',
                        [trip_id, position]
                    );

                    replacedImages.push(imageUrl);
                }
            }

            // Spracovanie pridania nových obrázkov
            const imageUrls = [];



            let pos;
            for (const [index, file] of files.entries()) {
                const imagePath = `/images/${user_id}/trip_images/${trip_id}/${file.filename}`;
                imageUrls.push(imagePath);

                if (typeof toDelete[index] === 'number') {
                    pos = toDelete[index];
                }
                else {
                    pos = ++nextPos;
                }

                await pool.query(
                    'INSERT INTO trip_images (trip_id, image_url, position) VALUES ($1, $2, $3)',
                    [trip_id, imagePath, pos]
                );

            }


            res.status(200).json({
                message: 'Obrázky boli aktualizované',
                addedImages: imageUrls,
                deletedImages: replacedImages
            });

        } catch (err) {
            console.error('Chyba pri aktualizácii obrázkov:', err);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


    /* situácie k update obrázkom */
    /*
        1. chcem nahradiť obrázok s position 1:1 - ✅
        2. chcem len pridať obrázok naviac okrem tých - ✅
        3. chcem len vymazať obrázok - ✅
        4. nahradiť obrázky aj pridať - ✅
     */





    /*** MARKERS ***/
    /* getUserMarkers */
    app.get('/markers/getMarkersByID/:user_id', authenticateToken, async (req, res) => {
        const { user_id } = req.params;  // Získame user_id z parametrov URL

        try {
            // SQL dopyt na získanie markerov používateľa
            const query = `
              SELECT *
              FROM markers m
              WHERE m.user_id = $1;
            `;

            const result = await pool.query(query, [user_id]);  // vykonáme dopyt

            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'Žiadne markery nenájdené pre tohoto používateľa.' });
            }

            // Vrátime výsledky
            res.status(200).json(result.rows);

        } catch (err) {
            console.error('Chyba pri získavaní markerov:', err);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });
}