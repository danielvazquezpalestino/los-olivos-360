'use strict';

// Ejecuta, por orden alfabético, los .sql de db/migrations.
// Cada archivo es idempotente (CREATE TABLE IF NOT EXISTS), así que se puede
// volver a ejecutar sin borrar datos.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const migrationsDir = path.join(__dirname, 'migrations');

async function main() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No hay migraciones pendientes.');
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'los_olivos_360',
    multipleStatements: true,
  });

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await connection.query(sql);
      console.log(`Migración aplicada: ${file}`);
    }
    console.log('Migraciones al día.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Error ejecutando migraciones:', error.message);
  if (error.code === 'ER_BAD_DB_ERROR') {
    console.error('La base de datos no existe. Ejecuta antes: npm run db:init');
  }
  if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Revisa DB_USER y DB_PASSWORD en el archivo .env');
  }
  process.exit(1);
});
