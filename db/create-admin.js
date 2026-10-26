'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

async function createAdmin() {
  const email = process.argv[2] || 'admin@losolivos.es';
  const password = process.argv[3] || 'admin123';
  const nombre = process.argv[4] || 'Administrador';

  try {
    // Generar hash de la contraseña
    const password_hash = await bcrypt.hash(password, 10);

    // Insertar usuario
    const [result] = await pool.execute(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
       VALUES (?, ?, ?, 'admin', 1)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [nombre, email.toLowerCase(), password_hash]
    );

    console.log(`✓ Usuario admin creado/actualizado:`);
    console.log(`  Email: ${email}`);
    console.log(`  Contraseña: ${password}`);
    console.log(`  Nombre: ${nombre}`);
    console.log(`  ID: ${result.insertId || 'existente'}`);
  } catch (error) {
    console.error('Error creando admin:', error.message);
  } finally {
    process.exit(0);
  }
}

createAdmin();
