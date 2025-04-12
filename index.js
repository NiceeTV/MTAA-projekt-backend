

const express = require('express');
const pool = require('./db');
const app = express();
const jwt = require('jsonwebtoken');


app.use(express.json());


function authenticateToken(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Access denied, token missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    req.user = decoded; // uloženie používateľských informácií
    next(); // pokračovanie v spracovaní požiadavky
  });
}


require('./api_endpoints1')(app, pool);
require('./api_endpoints2')(app, pool, authenticateToken);




const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server beží na http://localhost:${PORT}`);
});

module.exports = { authenticateToken };
