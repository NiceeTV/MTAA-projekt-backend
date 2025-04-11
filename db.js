const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'API',
  password: 'DataB4S3',
  port: 5432,
});

module.exports = pool;