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


    /* Pomocná funkcia na poslanie notifikácie */
    async function sendNotification(sender_id, target_id, trip_id) {
        try {
            await pool.query(
                'INSERT INTO notifications (sender_id, target_id, trip_id, type) VALUES ($1, $2, $3, $4)',
                [sender_id, target_id, trip_id, 'trip_share']
            );
        } catch (error) {
            console.error('Chyba pri vytváraní notifikácie:', error);
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
        const user_id = parseInt(req.params.id);
        const trip_id = parseInt(req.params.trip_id);
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
            // Overenie existencie používateľa
            const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
            if (userCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Používateľ neexistuje' });
            }

            // Overenie existencie tripu
            const tripCheck = await pool.query('SELECT * FROM trip WHERE trip_id = $1 AND user_id = $2', [trip_id, user_id]);
            if (tripCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje alebo nepatrí používateľovi' });
            }

            // Update s COALESCE - nemení hodnoty ak nie sú zadané
            const updateQuery = `
            UPDATE trip
            SET 
                trip_title = COALESCE($1, trip_title),
                trip_description = COALESCE($2, trip_description),
                rating = COALESCE($3, rating),
                visibility = COALESCE($4, visibility),
                start_date = COALESCE($5, start_date),
                end_date = COALESCE($6, end_date)
            WHERE user_id = $7 AND trip_id = $8
            RETURNING *;
            `;

            const result = await pool.query(updateQuery, [
                trip_title ?? null,
                trip_description ?? null,
                rating ?? null,
                visibility ?? null,
                start_date ?? null,
                end_date ?? null,
                user_id,
                trip_id
            ]);

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
        const user_id = req.user.userId;

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


    /* share trip */
    app.post('/trip/:trip_id/share', authenticateToken, async (req, res) => {
        const user_id = req.user.userId;
        const { trip_id, target_user_id } = req.body;  // ID používateľa, ktorému chceme trip zdieľať

        try {
            /* či existuje ten, komu to chceme poslať */
            const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [target_user_id]);
            if (userCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Používateľ neexistuje' });
            }

            if (user_id === target_user_id) {
                return res.status(404).json({ error: 'Cieľový používateľ nemôže byť odosielateľ.' });
            }

            /* či je to moj trip */
            const tripCheck = await pool.query('SELECT * FROM trip WHERE trip_id = $1 AND user_id = $2', [trip_id, user_id]);
            if (tripCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje alebo nepatrí tomuto používateľovi' });
            }

            /* zoberiem trip a jeho visibility */
            const trip = tripCheck.rows[0];

            // Zdieľanie tripu je možné pre 'public' tripy alebo 'friends' tripy, podľa visibility
            if (trip.visibility === 'public' || trip.visibility === 'friends') {
                // Vytvoriť notifikáciu o zdieľaní
                await sendNotification(user_id, target_user_id, trip_id);
                return res.status(200).json({ message: 'Trip bol úspešne zdieľaný.' });
            } else {
                return res.status(403).json({ error: 'Tento trip nemôže byť zdieľaný.' }); /* lebo je private */
            }

        } catch (error) {
            console.error('Chyba pri zdieľaní tripu:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


    /* get shared trip */
    app.get('/shared_trip/:trip_id', authenticateToken, async (req, res) => {
        const user_id = req.user.id;  // Prístup používateľa cez autentifikáciu tokenu
        const { trip_id } = req.params;

        try {
            // Over, či trip existuje
            const tripResult = await pool.query('SELECT * FROM trip WHERE trip_id = $1', [trip_id]);

            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje' });
            }

            const trip = tripResult.rows[0];

            /* public sa zobrazí každému */
            if (trip.visibility === 'public') {
                return res.status(200).json(trip);
            }

            /* ak je visibility friends, tak zistíme či je priatel usera ktorý to zdielal */
            if (trip.visibility === 'friends') {
                // len ak sú priatelia
                const friendship = await pool.query(`
                SELECT * FROM friends 
                WHERE (
                    (user_id = $1 AND friend_id = $2) OR 
                    (user_id = $2 AND friend_id = $1)
                ) AND status = 'accepted'
                `, [req.user.userId, trip.user_id]);

                if (friendship.rowCount > 0) {
                    return res.status(200).json(trip);
                } else {
                    return res.status(403).json({ error: 'Nemáte oprávnenie zobraziť tento trip (friends only).' });
                }

            }

            /* private trip, nemôže si ho pozrieť, prípad keď si vlastník prepne trip na privátny a potom to niekto otvorí  */
            if (trip.visibility === 'private') {
                return res.status(403).json({ error: 'Nemáte prístup k tomuto súkromnému tripu.' });
            }

            return res.status(400).json({ error: 'Neplatná hodnota pre visibility.' });

        } catch (error) {
            console.error('Chyba pri načítaní tripu:', error);
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


    /* updateMarker */
    app.put('/markers/:marker_id', authenticateToken, async (req, res) => {
        const { marker_id } = req.params;
        const { marker_title, marker_description, trip_date } = req.body;
        const user_id = req.user.userId;

        try {
            // Overenie, že marker patrí prihlásenému používateľovi
            const check = await pool.query(
                'SELECT * FROM markers WHERE marker_id = $1 AND user_id = $2',
                [marker_id, user_id]
            );

            if (check.rowCount === 0) {
                return res.status(404).json({ error: 'Marker neexistuje alebo k nemu nemáš prístup' });
            }

            // Update iba zadaných polí
            const updateQuery = `
                  UPDATE markers
                  SET 
                    marker_title = COALESCE($1, marker_title),
                    marker_description = COALESCE($2, marker_description),
                    trip_date = COALESCE($3, trip_date)
                  WHERE marker_id = $4
                  RETURNING *
                `;

            const result = await pool.query(updateQuery, [
                marker_title || null,
                marker_description || null,
                trip_date || null,
                marker_id
            ]);

            res.status(200).json({
                message: 'Marker bol úspešne aktualizovaný',
                marker: result.rows[0]
            });

        } catch (error) {
            console.error('Chyba pri aktualizácii markeru:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });

}