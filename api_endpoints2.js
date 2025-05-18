module.exports = (app, pool, authenticateToken) => {

    /*** DEPENDENCIES ***/
    const bcrypt = require('bcrypt');
    const upload = require('./multer_conf');
    const path = require('path');
    const fs = require('fs');
    const jwt = require('jsonwebtoken'); // Načítaj knižnicu pre JWT
    const dotenv = require('dotenv');    // Načítaj .env
    const fetch = (url, init) => import('node-fetch').then(module => module.default(url, init));

    dotenv.config();  // Načítaj premenné z .env

    const GROQ_API_KEY = process.env.API_KEY;
    const GOOGLE_MAPS_API = process.env.GOOGLE_MAPS_API;


    /*** FUNKCIE ***/
    async function checkUserExists(user_id, res) {
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
        if (userCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Používateľ s týmto ID neexistuje' });
        }

        return true;
    }

    async function checkTripExists(user_id,trip_id,res) {
        const tripCheck = await pool.query('SELECT trip_id FROM trip WHERE trip_id = $1 AND user_id = $2', [trip_id, user_id]);
        if (tripCheck.rowCount === 0) {
            return res.status(404).json({error: 'Výlet s týmto ID neexistuje alebo nepatrí tomuto používateľovi'});
        }

        return true;
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
            if (!userStatus) return;


            const imageUrls = [];

            if (image_type === 'trip_images') {
                if (!trip_id) {
                    return res.status(400).json({ error: 'Chýba trip_id pre nahrávanie trip obrázkov' });
                }

                const tripStatus = await checkTripExists(user_id, trip_id, res);
                if (!tripStatus) return;

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
    async function sendNotification(sender_id, target_id, trip_id = null, type = 'trip_share') {
        try {
            await pool.query(
                'INSERT INTO notifications (sender_id, target_id, trip_id, type) VALUES ($1, $2, $3, $4)',
                [sender_id, target_id, trip_id, type]
            );
        } catch (error) {
            console.error('Chyba pri vytváraní notifikácie:', error);
        }
    }


    const validateToken = async (token) => {
        try {
            /* overíme podpis tokenu */
            const decoded = jwt.verify(token, process.env.JWT_SECRET);


            /* nájdeme usera z tokena či je v db */
            const result = await pool.query(
                'SELECT * FROM users WHERE id = $1 AND username = $2',
                [decoded.userId, decoded.username]
            );


            /* ak sa nenašiel, token je nesprávny alebo neukazuje na platného usera */
            if (result.rows.length === 0) {
                console.log("user neecistuje");
                return { valid: false, reason: 'Používateľ neexistuje alebo nemá zadané používateľské meno.' };
            }


            const user = result.rows[0];

            /* user a token je platný */
            return { valid: true, user };
        } catch (err) {
            return { valid: false, reason: 'Neplatný token alebo podpis.', error: err.message };
        }
    };


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
            if (!username || !password) {
                throw new Error('Missing required fields');  // Vyvolať neočakávanú chybu
            }


            //skontroluj či už existuje user
            const userExists = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $2', [username, email]);
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

            const userId = newUser.rows[0].id;

            await pool.query(
                'INSERT INTO statistics (user_id, number_of_trips, total_distance, most_visited_place, time_spent_travelling) VALUES ($1, $2, $3, $4, $5)',
                [userId, 0, 0, null, '0']
            );


            //vytvor JWT token
            const token = jwt.sign(
                { userId: newUser.rows[0].id, username: newUser.rows[0].username },
                process.env.JWT_SECRET,
                { expiresIn: '100y' }
            );

            res.status(201).json({ token });
        } catch (err) {
            console.error(err.message);
            res.status(500).json({ message: err.message });
        }
    });


    /* login */
    app.post('/users/login', async (req, res) => {
        const { username, password } = req.body;

        try {
            if (!username || !password) {
                throw new Error('Missing required fields');  // Vyvolať neočakávanú chybu
            }

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
                { expiresIn: '100y' }
            );

            res.status(200).json({ token });
        } catch (err) {
            console.error(err.message);
            res.status(500).json({ message: err.message });
        }
    });



    /* autentifikuj token */
    app.post('/validate-token', async (req, res) => {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            console.log("token nie je ");
            return res.status(400).json({ valid: false, reason: 'No token provided' });
        }

        const result = await validateToken(token);


        if (!result.valid) {
            console.log("token neplatný");
            return res.status(401).json({ valid: false, reason: result.reason });
        }

        return res.status(200).json({
            valid: true,
            user: result.user,
            message: 'Token is valid',
        });
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
    app.get('/trip/:user_id/sort', authenticateToken, async (req, res) => {
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

        console.log(trip_id);

        try {
            const tripResult = await pool.query('SELECT * FROM trip WHERE trip_id = $1', [trip_id]);


            /* či existuje trip */
            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Trip neexistuje' });
            }

            /* obrázky pre daný trip */
            const imagesResult = await pool.query('SELECT image_url FROM trip_images WHERE trip_id = $1', [trip_id]);


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

        console.log(req.params);

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
            if (!userStatus) return;


            const tripStatus = await checkTripExists(user_id, trip_id, res);
            if (!tripStatus) return;

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
    app.get('/markers/getUserMarkers/:user_id', authenticateToken, async (req, res) => {
        const { user_id } = req.params;  // Získame user_id z parametrov URL

        try {
            const userStatus = await checkUserExists(user_id, res);
            if (!userStatus) return userStatus;


            const markersQuery = `
                SELECT * 
                FROM markers m
                WHERE m.user_id = $1;
            `;


            /* vráti výsledok, môže poslať aj [] ak nemá markery */
            const markersResult = await pool.query(markersQuery, [user_id]);
            res.status(200).json(markersResult.rows);

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


    /* pridaj markery do tripu */
    app.post('/trips/:trip_id/markers', authenticateToken, async (req, res) => {
        const trip_id = parseInt(req.params.trip_id);
        const { marker_ids } = req.body; // očakávame pole
        const user_id = req.user.userId;

        console.log(req.body);

        /* či obsahuje zoznam nejaké markery */
        if (!Array.isArray(marker_ids) || marker_ids.length === 0) {
            return res.status(400).json({ error: 'Nezadal si žiadne markery na pridanie.' });
        }

        try {
            /* Over, že trip patrí používateľovi */
            const tripCheck = await pool.query(
                'SELECT * FROM trip WHERE trip_id = $1 AND user_id = $2',
                [trip_id, user_id]
            );

            if (tripCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Výlet neexistuje alebo nepatrí používateľovi' });
            }

            /* over, že všetky markery patria používateľovi */
            const markerCheck = await pool.query(
                `SELECT marker_id FROM markers WHERE marker_id = ANY($1::int[]) AND user_id = $2`,
                [marker_ids, user_id]
            );

            const validMarkerIds = markerCheck.rows.map(row => row.marker_id);

            if (validMarkerIds.length !== marker_ids.length) {
                return res.status(403).json({ error: 'Niektoré markery neexistujú alebo nepatria používateľovi' });
            }

            /* vlož každý marker do trip_markers */
            const insertPromises = validMarkerIds.map(marker_id => {
                return pool.query(
                    'INSERT INTO trip_markers (trip_id, marker_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [trip_id, marker_id]
                );
            });

            await Promise.all(insertPromises);

            res.status(201).json({ message: 'Markery boli úspešne priradené k výletu.' });
        } catch (err) {
            console.error('Chyba pri pridávaní markerov do výletu:', err.message);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });



    /*** friends ***/
    /* getUserFriends */
    app.get('/GetUserFriends', authenticateToken, async (req, res) => {
        const user_id = req.user.userId;

        console.log(user_id);
        try {
            const friendsResult = await pool.query(
                `
                SELECT u.id, u.username, u.email
                FROM friends f
                JOIN users u ON (
                    (u.id = f.friend_id AND f.user_id = $1) OR
                    (u.id = f.user_id AND f.friend_id = $1)
                )
                WHERE f.status = 'accepted'
                  AND u.id != $1
                `,
                [user_id]
            );

            if (friendsResult.rowCount === 0) {
                return res.status(201).json({ message: 'Tento používateľ nemá žiadných priateľov.' });
            }
            else {
                return res.status(200).json({
                    friends: friendsResult.rows
                });
            }

        } catch (err) {
            console.error('Chyba pri získavaní priateľov:', err);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


    /* send friend request */
    app.post('/sendFriendRequest', authenticateToken, async (req, res) => {
    const sender_id = req.user.userId;
    const { target_user_id } = req.body;

    if (sender_id === target_user_id) {
        return res.status(400).json({ error: 'Nemôžete si poslať žiadosť o priateľstvo sám sebe.' });
    }

    try {
        // Over, či cieľový používateľ existuje
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [target_user_id]);
        if (userCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Cieľový používateľ neexistuje.' });
        }

        // Skontroluj, či už existuje nejaký vzťah
        const existing = await pool.query(
            `
            SELECT * FROM friends 
            WHERE (user_id = $1 AND friend_id = $2)
               OR (user_id = $2 AND friend_id = $1)
            `,
            [sender_id, target_user_id]
        );

        if (existing.rowCount > 0) {
            const friendship = existing.rows[0];

            if (friendship.status === 'blocked') {
                // Update z "blocked" na "pending"
                await pool.query(
                    `
                    UPDATE friends
                    SET status = 'pending', user_id = $1, friend_id = $2
                    WHERE (user_id = $1 AND friend_id = $2)
                       OR (user_id = $2 AND friend_id = $1)
                    `,
                    [sender_id, target_user_id]
                );

                await sendNotification(sender_id, target_user_id, null, 'friend_request');

                // Získaj meno odosielateľa
                const senderResult = await pool.query('SELECT username FROM users WHERE id = $1', [sender_id]);
                const fromUsername = senderResult.rows[0]?.username || 'Používateľ';

                return res.status(200).json({ message: 'Žiadosť bola odoslaná (obnovená z blokovania).' });
            } else {
                return res.status(400).json({ error: 'Žiadosť už existuje alebo ste už priatelia.' });
            }
        }

        // Ak neexistuje žiadny záznam
        await pool.query(
            `
            INSERT INTO friends (user_id, friend_id, status)
            VALUES ($1, $2, 'pending')
            `,
            [sender_id, target_user_id]
        );

        await sendNotification(sender_id, target_user_id, null, 'friend_request');

        // Získaj meno odosielateľa
        const senderResult = await pool.query('SELECT username FROM users WHERE id = $1', [sender_id]);
        const fromUsername = senderResult.rows[0]?.username || 'Používateľ';

        res.status(200).json({ message: 'Žiadosť o priateľstvo bola odoslaná.' });
    } catch (err) {
        console.error('Chyba pri odosielaní žiadosti o priateľstvo:', err);
        res.status(500).json({ error: 'Chyba na serveri.' });
    }
});




    /* prijať priateľstvo */
    app.put('/friendshipResponse', authenticateToken, async (req, res) => {
        const user_id = req.user.userId;
        const { sender_id, action } = req.body; // action: 'accept' alebo 'decline'


        /* či je správna odpoveď v requeste */
        const validActions = ['accept', 'decline'];
        if (!validActions.includes(action)) {
            return res.status(400).json({ error: 'Neplatná akcia. Použi "accept" alebo "decline".' });
        }

        try {
            /* či je nejaká žiadosť pending medzi nimi */
            const existing = await pool.query(
                `
                SELECT * FROM friends
                WHERE (user_id = $1 AND friend_id = $2)
                   OR (user_id = $2 AND friend_id = $1)
                AND status = $3
                `,
                [sender_id, user_id, "pending"]
            );


            /* ktorý záznam vo friends to je */
            let friendshipToUpdate;
            if (existing.rowCount > 0) {
                friendshipToUpdate = existing.rows[0].friendship_id;
            }
            else {
                return res.status(404).json({ error: "Neexistuje pozvánka na prijatie." });
            }


            if (sender_id === user_id) { /* nemôžem prijať vlastnú žiadosť */
                return res.status(401).json({ error: 'Nie si cieľom tejto žiadosti o priateľstvo.' });
            }

            /* friendship status */
            let statusToUpdate = action === 'accept' ? 'accepted' : 'blocked';

            await pool.query(
            `DELETE FROM notifications
             WHERE target_id = $1 AND sender_id = $2 AND type = 'friend_request'`,
            [user_id, sender_id]
        );
		
		await pool.query(
                `UPDATE friends SET status = $1 WHERE friendship_id = $2`,
                [statusToUpdate, friendshipToUpdate]
            );

            res.status(200).json({ message: `Žiadosť o priateľstvo bola ${statusToUpdate === 'accepted' ? 'prijatá' : 'odmietnutá'}.` });

        } catch (error) {
            console.error('Chyba pri spracovaní žiadosti o priateľstvo:', error);
            res.status(500).json({ error: error.message });
        }
    });


    /* delete friend */
    app.delete('/deleteFriend', authenticateToken, async (req, res) => {
        const user_id = req.user.userId;
        const { friend_to_delete_id } = req.body; // Identifikátory používateľov
        try {

            /* či sú priatelia */
            const existing = await pool.query(
    `
                SELECT * FROM friends
                WHERE (user_id = $1 AND friend_id = $2)
                   OR (user_id = $2 AND friend_id = $1)
                `,
                [friend_to_delete_id, user_id]
            );


            /* ak neexistuje, tak chyba */
            if (existing.rowCount === 0) {
                return res.status(404).json({ error: 'Priateľstvo neexistuje' });
            }

            /* vymaž priatelstvo */
            await pool.query(
                `
                DELETE FROM friends
                WHERE friendship_id = $1
                `,
                [existing.rows[0].friendship_id]
            );

            /* keď sa podarí */
            res.status(200).json({ message: 'Priateľstvo bolo úspešne odstránené.' });
        } catch (error) {
            console.error('Chyba pri odstraňovaní priateľstva:', error);
            res.status(500).json({ error: 'Neplatný vstup alebo iná chyba.' });
        }
    });



    /** multi day tripy **/
    app.post('/CreateMultiDayTrip', authenticateToken, async (req, res) => {
        const user_id = req.user.userId;
        const { title, description, trip_ids } = req.body;  /* trip id ktoré tam chcem pridať */

        try {
            /* či existuje user */
            const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
            if (userCheck.rowCount === 0) {
                return res.status(404).json({ error: 'Používateľ neexistuje' });
            }

            /* zoberiem tripy podľa trip_id z trip_ids */
            const tripResult = await pool.query(
                `SELECT trip_id, start_date, end_date
                 FROM trip
                 WHERE trip_id = ANY($1)
                 ORDER BY start_date`, [trip_ids]
            );

            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Vybrané tripy neexistujú' });
            }


            /* start_date z prvého tripu a end_date z posledného tripu */
            const trips = tripResult.rows;
            const start_date = trips[0].start_date;  /* prvý trip */
            const end_date = trips[trips.length - 1].end_date;  /* posledný trip */


            /* zapíšeme multi day trip do db */
            const result = await pool.query(
                `INSERT INTO multi_day_trip (user_id, title, description, start_date, end_date)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING multi_day_trip_id`,
                [user_id, title, description, start_date, end_date]
            );

            const multi_day_trip_id = result.rows[0].multi_day_trip_id;

            /* Priradíme tripy do multi-day tripu so správnym poradením */
            let trip_order = 1;  // Začneme od 1 pre poradie tripov
            for (const trip of trips) {
                await pool.query(
                    `INSERT INTO multi_day_trip_trip (multi_day_trip_id, trip_id, trip_order)
                    VALUES ($1, $2, $3)`,
                    [multi_day_trip_id, trip.trip_id, trip_order]
                );
                trip_order++;  // Inkrementujeme poradie pre každý trip
            }

            res.status(200).json({
                message: 'Multi-day trip bol úspešne vytvorený',
                multi_day_trip_id,
                title,
                start_date,
                end_date
            });
        } catch (error) {
            console.error('Chyba pri vytváraní multi-day tripu:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


    /* get multi day trip */
    app.get('/multiDayTrip/:id', authenticateToken, async (req, res) => {
        const user_id = req.user.userId;
        const multi_day_trip_id = parseInt(req.params.id);

        try {
            /* multi day trip podla id */
            const tripResult = await pool.query(
                `SELECT title, description, start_date, end_date
                 FROM multi_day_trip
                 WHERE multi_day_trip_id = $1 AND user_id = $2`,
                [multi_day_trip_id, user_id]
            );

            if (tripResult.rowCount === 0) {
                return res.status(404).json({ error: 'Multi-day trip neexistuje alebo nepatrí tomuto používateľovi.' });
            }

            const trip = tripResult.rows[0];

            // Získaj trip_ids a ich poradie
            const subTrips = await pool.query(
                `SELECT trip_id, trip_order
                 FROM multi_day_trip_trip
                 WHERE multi_day_trip_id = $1
                 ORDER BY trip_order`,
                [multi_day_trip_id]
            );

            res.status(200).json({
                title: trip.title,
                description: trip.description,
                start_date: trip.start_date,
                end_date: trip.end_date,
                trip_ids: subTrips.rows.map(t => ({
                    trip_id: t.trip_id,
                    order: t.trip_order
                }))
            });

        } catch (error) {
            console.error('Chyba pri načítaní multi-day tripu:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });



    /** AI CHAT ASISTENT **/

    const custom_instructions_type1 = `
        Si AI asistent na cestovanie. Vyhodnoť vstup používateľa a vykonaj jedno z nasledujúcich:

        1. Ak ide o požiadavku typu:
           - typ_1: 3 zaujímavé miesta v okolí, ak nie je určený iný počet (iba jeden typ miest)
           - typ_2: plánovanie viacdňového výletu, 3 dni ak nie je určené inak a pre každý deň 2 až 3 miesta (môže obsahovať viac typov miest)
           
          → typ_1 smie obsahovať **len jeden typ miesta**, ktorý najlepšie zodpovedá zadaniu. Povolené typy:
             - "tourist_attraction"
             - "restaurant"
             
        → Vráť výhradne štruktúrovaný JSON výstup v tomto formáte:
      
        {
          "type": "typ_X",
          "location": "určená lokalita alebo null",
          "days": počet_dní (iba pri typ_2),
          "itinerary": {
            "day1": { "tourist_attraction": x } // alebo restaurant, ale len jeden typ pri typ_1
          }
        }
        
        
        Pre typ_2 použi takýto formát: (môžeš použiť viac typov)
        {
          "type": "typ_X",
          "location": "určená lokalita alebo null",
          "days": počet_dní (iba pri typ_2),
          "itinerary": {
            "day1": { "tourist_attraction": x, "restaurant": y },
            "day2": { ... },
            ...
          }
        }
        
        2. Ak ide o:
           - typ_3: otázka o faktoch o cestovaní (víza, doprava, mena, zvyky atď.)
           → Odpovedz priamo na otázku faktickou odpoveďou. Na konci odpovede pridaj znak \`%\`.
        
        3. Ak ide o:
           - typ_4: pozdrav, poďakovanie alebo iná zdvorilostná fráza  
            → Odpovedz krátkou vetou (napr. "Ahoj! Som tu pre teba.") a na konci odpovede pridaj znak \`&\`.
        
        4. Ak ide o:
           - typ_5: otázka nesúvisiaca s cestovaním  
           → Odpovedz vetou: „Nemôžem odpovedať na otázky, ktoré nesúvisia s cestovaním.“ Na konci odpovede pridaj znak \`&\`.
        
        Používaj iba tieto kategórie typov (typ_1 až typ_5).  
        Nikdy nespájaj JSON výstup s iným typom odpovede. Ak vraciaš JSON, nevypisuj nič iné.  
        Ak odpovedáš na typ_3, 4 alebo 5, nevypisuj JSON.
        
        ### Príklady:
        
        #### Vstup: Kam ísť v okolí Pezinka?
        \`\`\`json
        {
          "type": "typ_1",
          "location": "Pezinok, Slovensko",
          "days": 1,
          "itinerary": {
            "day1": {
              "tourist_attraction": 3
            }
          }
        }
        \`\`\`
        
        #### Vstup: Naplánuj mi 3 dni v Trenčíne.
        \`\`\`json
        {
          "type": "typ_2",
          "location": "Trenčín",
          "days": 3,
          "itinerary": {
            "day1": {
              "tourist_attraction": 2,
              "restaurant": 1
            },
            "day2": {
              "tourist_attraction": 3
            },
            "day3": {
              "tourist_attraction": 2,
              "restaurant": 2
            }
          }
        }
        \`\`\`
        
        #### Vstup: Potrebujem víza do Kanady?
        **Odpoveď:** Občania Slovenska potrebujú eTA – elektronickú cestovnú autorizáciu – pre vstup do Kanady na turistiku.%  
        
        #### Vstup: Ďakujem!
        **Odpoveď:** Rádo sa stalo.&
        
        #### Vstup: Kto vyhral MS v hokeji?
        **Odpoveď:** Nemôžem odpovedať na otázky, ktoré nesúvisia s cestovaním.&
    `

    function parseResponse(response) {
        // Pokús sa najprv parsovať JSON

        const responseText = response.content;
        try {
            // Odstránim prípadné ```json bloky a trimnem
            const cleaned = responseText.replace(/```json|```/g, '').trim();
            const json = JSON.parse(cleaned);

            // Ak sa podarilo, vrátime typ a parsed JSON
            return { type: json.type, data: json };
        } catch {
            // Ak nie JSON, rozlíš typ podľa koncového znaku alebo textu

            if (responseText.endsWith('%')) {
                return { type: 'typ_3', data: responseText };
            } else if (responseText.endsWith('&')) {
                if (responseText.includes('Nemôžem odpovedať')) {
                    return { type: 'typ_5', data: responseText };
                } else {
                    return { type: 'typ_4', data: responseText };
                }
            } else {
                // Ak nevieš rozlíšiť, môžeš defaultne použiť typ_5 alebo typ_3
                return { type: 'unknown', data: responseText };
            }
        }
    }

    function countPlaceTypes(data) {
        const counts = {};

        if (!data) return counts;

        for (const dayKey in data) {
            const day = data[dayKey];
            for (const placeType in day) {
                const count = day[placeType];
                if (typeof count === 'number') {
                    counts[placeType] = (counts[placeType] || 0) + count;
                }
            }
        }

        return counts;
    }


    async function geocodeLocation(location) {
        const encodedPlace = encodeURIComponent(location);
        console.log(location);
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedPlace}&key=${GOOGLE_MAPS_API}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === "OK") {
            const { lat, lng } = data.results[0].geometry.location;
            return { lat, lng };
        } else {
            throw new Error(`Geocoding failed: ${data.status}`);
        }
    }


    async function searchPlaces(lat, lng, type, limit) {
        const radius = 5000; // polomer v metroch, uprav podľa potreby
        console.log(lat,lng);
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${GOOGLE_MAPS_API}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === "OK") {
            // vyber prvých 'limit' miest
            console.log(data.results.length, limit);

            const filtered = data.results
                .filter(place => place.types && place.types.includes(type)) // miesto obsahuje požadovaný typ
                .map(place => ({
                    name: place.name,
                    location: place.geometry.location,
                    place_id: place.place_id,
                    rating: place.rating ?? 0, // ak rating chýba, použije 0
                    types: place.types,
                }))
                .sort((a, b) => b.rating - a.rating) // zoradenie podľa ratingu
                .slice(0, limit); // obmedzi počet na požadovaný limit

            console.log(filtered);

            return filtered;

        } else {
            throw new Error(`Places API error: ${data.status}`);
        }
    }

    async function getPlacesForItinerary(location, itinerary) {
        const coords = await geocodeLocation(location);
        const enrichedItinerary = {};
        const usedPlaceIds = new Set();

        const totalTypeCounts = countPlaceTypes(itinerary);


        const allPlacesByType = {};
        for (const [type, totalCount] of Object.entries(totalTypeCounts)) {
            console.log(`Fetching ${totalCount} for type: ${type}`);
            const results = await searchPlaces(coords.lat, coords.lng, type, totalCount);
            // Zoradíme podľa ratingu a uložíme
            allPlacesByType[type] = results
                .filter(place => place.types.includes(type))
                .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
                .slice(0, totalCount);
        }

        for (const [day, types] of Object.entries(itinerary)) {
            enrichedItinerary[day] = [];

            for (const [type, count] of Object.entries(types)) {
                const pool = allPlacesByType[type] || [];

                let i = 0;
                while (enrichedItinerary[day].length < count && i < pool.length) {
                    const place = pool[i];
                    if (!usedPlaceIds.has(place.place_id)) {
                        enrichedItinerary[day].push(place);
                        usedPlaceIds.add(place.place_id);
                    }
                    i++;
                }
            }
        }

        return enrichedItinerary;
    }

    function simplifyItinerary(itinerary) {
        const simplified = {};

        for (const [day, places] of Object.entries(itinerary)) {
            simplified[day] = places.map(place => ({
                name: place.name,
                lat: place.location.lat,
                lng: place.location.lng
            }));
        }

        return simplified;
    }

    app.post('/chat', async (req, res) => {
        const { messages } = req.body;


        const fullMessages = [
            {
                role: 'system',
                content: custom_instructions_type1,
            },
            ...messages,
        ];

        const callGroqModel = async (model) => {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                },
                body: JSON.stringify({
                    model,
                    messages: fullMessages,
                    temperature: 1,
                    max_tokens: 1024,
                }),
            });

            return response.json();
        };

        try {
            console.log("Volám primárny model: llama-3-70b-instruct");

            let data = await callGroqModel('meta-llama/llama-4-maverick-17b-128e-instruct');

            if (data?.choices?.[0]?.message) {
                console.log("Odpoveď:", data.choices[0].message);

                const parsed = parseResponse(data.choices[0].message);

                if (parsed.type !== 'typ_1' && parsed.type !== 'typ_2') {
                    res.json({ reply: data.choices[0].message });
                    return;
                }


                /* nájdeme miesta a vložíme do itinerára */
                const result = await getPlacesForItinerary(parsed.data.location, parsed.data.itinerary);

                /* zjednodušíme itinerár len na to, čo potrebujeme na frontende */
                const simplified = simplifyItinerary(result);
                console.log(JSON.stringify(simplified, null, 2));



                res.json({
                    reply: {
                        role: "assistant",
                        content: simplified
                    }
                });
            } else {
                res.status(500).json({ error: 'Neprišla odpoveď od Groq.' });
            }
        } catch (error) {
            console.error('Chyba pri volaní Groq API:', error);
            res.status(500).json({ error: 'Chyba pri komunikácii s Groq API.' });
        }
    });




}