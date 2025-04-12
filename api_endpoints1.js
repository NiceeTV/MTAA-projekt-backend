module.exports = (app, pool, authenticateToken) => {

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

    app.get('/users/:id', async (req, res) => {
        const { id } = req.params;
        console.log(`ID: ${id}`); // Pridaj logovanie ID

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

    app.get('/users', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM users');
            res.json(result.rows);
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Chyba na serveri');
        }
    });

    app.post('/users/:id/trip', async (req, res) => {
        const user_id = parseInt(req.params.id); // používame ID z URL
        const {
          trip_title,
          trip_description,
          rating,
          visibility,
          start_date,
          end_date
        } = req.body;
      
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
            RETURNING *`,
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
      
          res.status(201).json({
            message: 'Výlet bol úspešne vytvorený',
            trip: result.rows[0]
          });
        } catch (error) {
          console.error('Chyba pri vytváraní výletu:', error);
          res.status(500).json({ error: 'Chyba na serveri' });
        }
      });

      app.get('/users/:id/trip', async (req, res) => {
        const user_id = parseInt(req.params.id);
      
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

      // Odstránenie výletu pre používateľa
app.delete('/users/:id/trip/:trip_id', async (req, res) => {
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

  app.post('/markers', authenticateToken, async (req, res) => {
      const { x_pos, y_pos, marker_title, marker_description, trip_date } = req.body;
      const user_id = req.user.userId;  // Predpokladáme, že user_id je v decoded objekte

      console.log(user_id);
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

  app.get('/markers/:trip_id', async (req, res) => {
    const trip_id = parseInt(req.params.trip_id);
  
    try {
      const result = await pool.query(
        'SELECT * FROM markers WHERE trip_id = $1',
        [trip_id]
      );
  
      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Chyba pri načítaní markerov:', error);
      res.status(500).json({ error: 'Chyba na serveri' });
    }
  });

  app.delete('/markers/:marker_id', async (req, res) => {
    const marker_id = parseInt(req.params.marker_id);
  
    try {
      const result = await pool.query(
        'DELETE FROM markers WHERE marker_id = $1 RETURNING *',
        [marker_id]
      );
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Marker neexistuje' });
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

  app.post('/notifications', async (req, res) => {
    const { sender_id, target_id, type } = req.body;
  
    // Overenie, že sender a target sú rôzni
    if (sender_id === target_id) {
      return res.status(400).json({ error: 'Odosielateľ a príjemca musia byť rôzni.' });
    }
  
    try {
      // Overenie, že sender existuje
      const senderCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [sender_id]
      );
      if (senderCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Odosielateľ neexistuje.' });
      }
  
      // Overenie, že target existuje
      const targetCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [target_id]
      );
      if (targetCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Príjemca neexistuje.' });
      }
  
      // Vloženie notifikácie do databázy
      const result = await pool.query(
        `INSERT INTO notifications (sender_id, target_id, type)
         VALUES ($1, $2, $3)
         RETURNING *;`,
        [sender_id, target_id, type]
      );
  
      res.status(201).json({
        message: 'Notifikácia bola úspešne vytvorená.',
        notification: result.rows[0]
      });
    } catch (error) {
      console.error('Chyba pri vytváraní notifikácie:', error);
      res.status(500).json({ error: 'Chyba na serveri pri vytváraní notifikácie.' });
    }
  });

  app.get('/notifications', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM notifications ORDER BY created_at DESC'
      );
      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Chyba pri načítavaní notifikácií:', error);
      res.status(500).json({ error: 'Chyba na serveri pri načítavaní notifikácií.' });
    }
  });

  app.get('users/:user_id/statistics', async (req, res) => {
    const user_id = parseInt(req.params.user_id);
  
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