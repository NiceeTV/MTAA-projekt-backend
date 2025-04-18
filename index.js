const express = require('express');
const pool = require('./db');
const app = express();
const jwt = require('jsonwebtoken');
const path = require('path');

app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

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


require('./api_endpoints1')(app, pool, authenticateToken);
require('./api_endpoints2')(app, pool, authenticateToken);




const PORT = 3000;
const hostname = 'localhost';
app.listen(PORT, hostname, () => {
  console.log(`Server beží na ${hostname}:${PORT}`);
});

module.exports = { authenticateToken };
