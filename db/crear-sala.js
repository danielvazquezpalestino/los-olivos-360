'use strict';

// Crea (o reutiliza) una sala de videollamada con los emails que indiques.
//
// Uso:
//   node db/crear-sala.js reunion-familia ana@losolivos.es luis@losolivos.es
//
// El primer email actúa como creador (debe existir en `usuarios`). Todos los
// emails indicados quedan como miembros, que es lo que permite pedir el token
// de LiveKit y entrar a la llamada.

require('dotenv').config();

const { pool } = require('./pool');

async function main() {
  const [nombreSala, ...emails] = process.argv.slice(2);

  if (!nombreSala || emails.length === 0) {
    console.error('Uso: node db/crear-sala.js <nombre-sala> <email-creador> [email-miembro ...]');
    process.exit(1);
  }

  const nombre = nombreSala.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(nombre)) {
    console.error('El nombre de la sala debe tener 3-64 caracteres: minúsculas, números y guiones.');
    process.exit(1);
  }

  const normalizados = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  const placeholders = normalizados.map(() => '?').join(', ');

  const [usuarios] = await pool.execute(
    `SELECT id, nombre, email FROM usuarios WHERE activo = 1 AND email IN (${placeholders})`,
    normalizados
  );

  const encontrados = new Map(usuarios.map((u) => [u.email, u]));
  const faltan = normalizados.filter((email) => !encontrados.has(email));
  if (faltan.length > 0) {
    console.error(`No existen (o están inactivos): ${faltan.join(', ')}`);
    console.error('Créalos con: node db/create-admin.js <email> <contraseña> "<Nombre>"');
    process.exit(1);
  }

  const miembros = normalizados.map((email) => encontrados.get(email));
  const creador = miembros[0];

  let [salas] = await pool.execute('SELECT id FROM rooms WHERE name = ?', [nombre]);
  if (salas.length === 0) {
    const [result] = await pool.execute('INSERT INTO rooms (name, created_by) VALUES (?, ?)', [
      nombre,
      creador.id,
    ]);
    salas = [{ id: result.insertId }];
    console.log(`Sala creada: ${nombre} (id ${result.insertId})`);
  } else {
    console.log(`La sala ${nombre} ya existía (id ${salas[0].id}); sólo actualizo miembros.`);
  }

  const roomId = salas[0].id;
  for (const miembro of miembros) {
    await pool.execute('INSERT IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', [
      roomId,
      miembro.id,
    ]);
    console.log(`  miembro: ${miembro.nombre} <${miembro.email}> (id ${miembro.id})`);
  }

  console.log('');
  console.log('Entrad todos a esta misma URL, cada uno con su sesión iniciada:');
  console.log(`  http://localhost:3000/sala.html?room_id=${roomId}`);
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
