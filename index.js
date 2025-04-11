const express = require('express');
const pool = require('./db');
const app = express();

app.use(express.json());

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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server beží na http://localhost:${PORT}`);
});
