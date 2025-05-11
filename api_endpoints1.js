module.exports = (app, pool, authenticateToken) => {
    /*** ENDPOINTY ***/
    /* vymaž usera podla id  */
    app.delete('/users/:id', async (req, res) => {
        const { id } = req.params;

        try {
            // Vykonaj SQL dotaz na vymazanie používateľa podľa ID
            const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

            if (result.rowCount === 0) {
                return res.status(404).send('Používateľ s týmto ID neexistuje');
            }

            res.status(200).send(`Používateľ s ID ${id} bol úspešne vymazaný`);
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Chyba pri vymazávaní používateľa');
        }
    });


    /* get usera podla id */
    app.get('/users/:id', async (req, res) => {
        const { id } = req.params;

        try {
            const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);

            if (result.rowCount === 0) {
                return res.status(404).send('Používateľ s týmto ID neexistuje');
            }

            res.json(result.rows[0]); // Vráti prvý (a jediný) riadok, ktorý zodpovedá ID
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Chyba pri získavaní používateľa');
        }
    });

app.get('/users/search/:username', async (req, res) => {
    const { username } = req.params;

    try {
        const result = await pool.query(
            'SELECT id, username FROM users WHERE username ILIKE $1',
            [`%${username}%`]
        );

        console.log("Výsledok dotazu:", result.rows); // Pridaj log pre kontrolu odpovede
        res.json(result.rows); // Vráti iba id a username
    } catch (err) {
        console.error('Chyba pri získavaní používateľa:', err.message);
        res.status(500).send('Chyba pri získavaní používateľa');
    }
});






    /* všetci useri */
    app.get('/users', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM users');
            res.json(result.rows);
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Chyba na serveri');
        }
    });


app.put('/users/:id/biography', async (req, res) => {
    const { id } = req.params;
    const { bio } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).send('Používateľ s týmto ID neexistuje');
        }

        const updateQuery = 'UPDATE users SET bio = $1 WHERE id = $2 RETURNING *';
        const updatedUser = await pool.query(updateQuery, [bio, id]);

        res.json(updatedUser.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Chyba pri aktualizácii biografie');
    }
});

app.put('/users/:id/profile_picture', async (req, res) => {
    const { id } = req.params;
    const { image_url } = req.body;  // Predpokladáme, že obsahuje URL obrázku

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (userResult.rowCount === 0) {
            return res.status(404).send('Používateľ s týmto ID neexistuje');
        }

        // Skontrolujeme, či už existuje profilová fotka pre tohto používateľa
        const pictureResult = await pool.query('SELECT * FROM profile_picture WHERE user_id = $1', [id]);

        if (pictureResult.rowCount === 0) {
            // Ak fotka neexistuje, vložíme novú
            const insertQuery = 'INSERT INTO profile_picture (user_id, image_url) VALUES ($1, $2) RETURNING *';
            const newPicture = await pool.query(insertQuery, [id, image_url]);
            res.json(newPicture.rows[0]);
        } else {
            // Ak fotka existuje, aktualizujeme URL
            const updateQuery = 'UPDATE profile_picture SET image_url = $1 WHERE user_id = $2 RETURNING *';
            const updatedPicture = await pool.query(updateQuery, [image_url, id]);
            res.json(updatedPicture.rows[0]);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Chyba pri aktualizácii profilovej fotky');
    }
});


    /* pridaj user trip*/
    app.post('/users/:id/trip', async (req, res) => {
        const user_id = parseInt(req.params.id); // používame ID z URL
        const {
          trip_title,
          trip_description,
          rating,
          visibility,
          start_date,
          end_date
        } = req.body.tripData;

        try {
          // Over kontrolu používateľa
          const userCheck = await pool.query(
            'SELECT id FROM users WHERE id = $1',
            [user_id]
          );
      
          if (userCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Používateľ neexistuje' });
          }
      
          const result = await pool.query(
            `INSERT INTO trip (
              user_id, trip_title, trip_description, rating,
              visibility, start_date, end_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING trip_id`,
            [
              user_id,
              trip_title,
              trip_description,
              rating,
              visibility,
              start_date,
              end_date
            ]
          );


          await pool.query(
              'UPDATE statistics SET number_of_trips = number_of_trips + 1 WHERE user_id = $1',
              [user_id]
          );


          res.status(201).json({
            message: 'Výlet bol úspešne vytvorený',
            trip: result.rows[0]
          });
        } catch (error) {
          console.error('Chyba pri vytváraní výletu:', error);
          res.status(500).json({ error: 'Chyba na serveri' });
        }
      });


      /* get user trips */
      app.get('/users/:id/trip', authenticateToken, async (req, res) => {
        let user_id = parseInt(req.params.id);
        if (!user_id) {
            user_id = req.user.userId;
        }
      
        try {
          const result = await pool.query(
            'SELECT * FROM trip WHERE user_id = $1',
            [user_id]
          );
      
          res.json(result.rows);
        } catch (err) {
          console.error('Chyba pri načítavaní výletov:', err.message);
          res.status(500).send('Chyba na serveri');
        }
      });


    /* odstrani trip pre usera podla trip_id */
    app.delete('/users/:id/trip/:trip_id', authenticateToken, async (req, res) => {
    const user_id = parseInt(req.params.id); // Získanie user_id z URL parametra
    const trip_id = parseInt(req.params.trip_id); // Získanie trip_id z URL parametra
  
    try {
      // Over, či tento používateľ vlastní daný výlet
      const result = await pool.query(
        'SELECT * FROM trip WHERE user_id = $1 AND trip_id = $2',
        [user_id, trip_id]
      );
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Výlet neexistuje alebo nepatrí tomuto používateľovi.' });
      }
  
      // Ak existuje výlet, odstráni ho
      await pool.query(
        'DELETE FROM trip WHERE user_id = $1 AND trip_id = $2',
        [user_id, trip_id]
      );
  
      res.status(200).json({ message: 'Výlet bol úspešne odstránený.' });
    } catch (err) {
      console.error('Chyba pri odstraňovaní výletu:', err.message);
      res.status(500).send('Chyba na serveri');
    }
  });


  /* vytvor marker */
  app.post('/markers', authenticateToken, async (req, res) => {
      const { x_pos, y_pos, marker_title, marker_description, trip_date } = req.body;
      const user_id = req.user.userId;  // Predpokladáme, že user_id je v decoded objekte

      try {
          const result = await pool.query(
              `INSERT INTO markers (user_id, x_pos, y_pos, marker_title, marker_description, trip_date)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *`,
              [user_id, x_pos, y_pos, marker_title, marker_description, trip_date]
          );

          res.status(201).json({
              message: 'Marker bol úspešne vytvorený',
              marker: result.rows[0]
            });
      } catch (error) {
          console.error('Chyba pri vytváraní markeru:', error);
          res.status(500).json({ error: 'Chyba na serveri' });
    }
  });


  /* get marker podla trip id */
  app.get('/markers/:trip_id', authenticateToken, async (req, res) => {
      const trip_id = parseInt(req.params.trip_id);
      const user_id = req.user.userId; // alebo userId ak si to tak používal

      try {
          const result = await pool.query(
            `
            SELECT m.*
            FROM markers m
            JOIN trip_markers tm ON tm.marker_id = m.marker_id
            WHERE tm.trip_id = $1 AND m.user_id = $2
            `,
                [trip_id, user_id]
            );


            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Tento výlet nemá žiadne markery alebo neexistuje.' });
            }

            res.status(200).json(result.rows);


        } catch (error) {
            console.error('Chyba pri načítaní markerov:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
  });


    /* get marker by marker_id */
    app.get('/markers/getMarkerByMarkerID/:marker_id', authenticateToken, async (req, res) => {
        const marker_id = parseInt(req.params.marker_id);
        const user_id = req.user.userId;

        try {
            const result = await pool.query(
                'SELECT * FROM markers WHERE marker_id = $1 AND user_id = $2',
                [marker_id, user_id]
            );

            console.log(result);

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Marker neexistuje alebo nepatrí používateľovi.' });
            }

            res.status(200).json(result.rows[0]);
        } catch (error) {
            console.error('Chyba pri načítavaní markeru:', error);
            res.status(500).json({ error: 'Chyba na serveri' });
        }
    });


  /* vymaz marker podla id */
  app.delete('/markers/:marker_id', authenticateToken, async (req, res) => {
    const marker_id = parseInt(req.params.marker_id);
    const user_id = req.user.userId;

    try {
      const result = await pool.query(
        'DELETE FROM markers WHERE marker_id = $1 AND user_id = $2 RETURNING *',
        [marker_id, user_id]
      );
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Marker neexistuje alebo nepatrí používateľovi.' });
      }
  
      res.status(200).json({
        message: 'Marker bol úspešne odstránený',
        deleted: result.rows[0]
      });
    } catch (error) {
      console.error('Chyba pri mazaní markeru:', error);
      res.status(500).json({ error: 'Chyba na serveri' });
    }
  });


  /* získaj všetky notifikácie usera */
  app.get('/notifications', authenticateToken, async (req, res) => {
    const user_id = req.user.userId;

    try {
      const result = await pool.query(
        'SELECT * FROM notifications where target_id = $1 ORDER BY created_at DESC', [user_id]
      );

      if (result.rowCount === 0) {
          res.status(201).json({ message: 'Tento používateľ nemá žiadne notifikácie.' });
      }
      else {
          res.status(200).json(result.rows);
      }


    } catch (error) {
      console.error('Chyba pri načítavaní notifikácií:', error);
      res.status(500).json({ error: 'Chyba na serveri pri načítavaní notifikácií.' });
    }
  });


  /* získaj štatistiku usera */
  app.get('/users/:user_id/statistics', authenticateToken, async (req, res) => {
    let user_id = parseInt(req.params.user_id);


    if (!user_id) {
        user_id = req.user.userId;
    }
  
    try {
      const result = await pool.query(
        'SELECT * FROM statistics WHERE user_id = $1',
        [user_id]
      );
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Štatistiky pre daného používateľa neexistujú' });
      }
  
      res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error('Chyba pri načítavaní štatistík:', error.message);
      res.status(500).send('Chyba na serveri');
    }
  });

}