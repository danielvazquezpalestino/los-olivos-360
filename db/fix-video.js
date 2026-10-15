'use strict';

require('dotenv').config();
const { pool } = require('./pool');

async function fixDuplicateVideo() {
  try {
    // Actualizar el tercer video que tiene el mismo ID que el primero
    const [result] = await pool.execute(
      `UPDATE videos 
       SET video_id = 'dQw4w9WgXcQ' 
       WHERE id = 3 AND video_id = 'ScMzIvxBSi4'`
    );
    
    console.log(`Videos actualizados: ${result.affectedRows} fila(s)`);
    console.log('Video duplicado corregido.');
  } catch (error) {
    console.error('Error corrigiendo video:', error.message);
  } finally {
    process.exit(0);
  }
}

fixDuplicateVideo();
