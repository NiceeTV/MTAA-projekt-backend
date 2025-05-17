const express = require('express');
const pool = require('./db');
const app = express();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

// HTTP server (potrebné pre WebSocket)
const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); // pripoj WebSocket server na rovnaký HTTP server

app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use(cors());

function authenticateToken(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Access denied, token missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    req.user = decoded;
    next();
  });
}

require('./api_endpoints1')(app, pool, authenticateToken);
require('./api_endpoints2')(app, pool, authenticateToken);

// WebSocket logika
wss.on('connection', (ws) => {
  console.log('📡 Klient sa pripojil na WebSocket');

  ws.on('message', (message) => {
    console.log('📨 Správa od klienta:', message.toString());
  });

  // Poslať notifikáciu iba raz
  if (ws.readyState === WebSocket.OPEN) {
    ws.send('Zdraví vás naša aplikácia!');
    console.log('📩 Notifikácia poslaná.');
  }

  ws.on('close', () => {
    console.log('❌ Klient sa odpojil');
  });
});

const PORT = 3000;
const hostname = '192.168.0.105';
server.listen(PORT, hostname, () => {
  console.log(`🌐 Server beží na http://${hostname}:${PORT}`);
});
