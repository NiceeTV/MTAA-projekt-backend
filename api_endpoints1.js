module.exports = (app, pool) => {
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
    app.post('/users', async (req, res) => {
        const { username, email, bio, password } = req.body;

        try {
            const result = await pool.query(
                `INSERT INTO users (username, email, bio, password)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
                [username, email, bio, password]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Chyba pri ukladaní používateľa');
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
  
}