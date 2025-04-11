const express = require('express');
const pool = require('./db');
const app = express();

app.use(express.json());

require('./api_endpoints1')(app, pool);
require('./api_endpoints2')(app, pool);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server beží na http://localhost:${PORT}`);
});
