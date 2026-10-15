'use strict';


require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const schemaPath = path.join(__dirname, 'schema.sql');

async function main() {
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    await connection.query(schema);
    console.log(`Base de datos "${process.env.DB_NAME || 'los_olivos_360'}" lista.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Error inicializando la base de datos:', error.message);
  if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Revisa DB_USER y DB_PASSWORD en el archivo .env');
  }
  process.exit(1);
});
