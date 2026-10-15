'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const { validateVisita, validateContacto } = require('./validation');

const router = express.Router();

/**
 * Devuelve la IP del cliente, teniendo en cuenta un proxy inverso.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? String(forwarded).split(',')[0].trim() : req.ip;
  return ip ? ip.slice(0, 45) : null;
}

// --- Solicitudes de visita -------------------------------------------------

router.post('/visitas', async (req, res, next) => {
  const { ok, errors, value } = validateVisita(req.body || {});
  if (!ok) return res.status(400).json({ ok: false, errors });

  const estados = ['pendiente', 'contactado', 'visitado', 'descartado'];
  const estado = estados.includes(req.body?.estado) ? req.body.estado : 'pendiente';

  try {
    const [result] = await pool.execute(
      `INSERT INTO visitas
         (nombre, email, telefono, fecha_preferida, franja, residente, mensaje, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value.nombre,
        value.email,
        value.telefono,
        value.fecha_preferida,
        value.franja,
        value.residente,
        value.mensaje,
        clientIp(req),
      ]
    );

    res.status(201).json({
      ok: true,
      id: result.insertId,
      mensaje: 'Hemos recibido tu solicitud. Te llamaremos para confirmar la visita.',
    });
  } catch (error) {
    next(error);
  }
});

router.put('/visitas/:id', async (req, res, next) => {
  const { ok, errors, value } = validateVisita(req.body || {});
  if (!ok) return res.status(400).json({ ok: false, errors });

  const estados = ['pendiente', 'contactado', 'visitado', 'descartado'];
  const estado = estados.includes(req.body?.estado) ? req.body.estado : 'pendiente';

  try {
    const [result] = await pool.execute(
      `UPDATE visitas SET
         nombre = ?, email = ?, telefono = ?, fecha_preferida = ?,
         franja = ?, residente = ?, mensaje = ?, estado = ?
       WHERE id = ?`,
      [
        value.nombre,
        value.email,
        value.telefono,
        value.fecha_preferida,
        value.franja,
        value.residente,
        value.mensaje,
        estado,
        req.params.id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, errors: ['La visita no existe.'] });
    }
    res.json({ ok: true, mensaje: 'Visita actualizada.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/visitas/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM visitas WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, errors: ['La visita no existe.'] });
    }
    res.json({ ok: true, mensaje: 'Visita eliminada.' });
  } catch (error) {
    next(error);
  }
});

router.get('/visitas', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, email, telefono, fecha_preferida, franja, residente,
              mensaje, estado, creado_en
         FROM visitas
        ORDER BY creado_en DESC
        LIMIT 200`
    );
    res.json({ ok: true, total: rows.length, visitas: rows });
  } catch (error) {
    next(error);
  }
});

// --- Mensajes de contacto --------------------------------------------------

router.post('/contacto', async (req, res, next) => {
  const { ok, errors, value } = validateContacto(req.body || {});
  if (!ok) return res.status(400).json({ ok: false, errors });

  try {
    const [result] = await pool.execute(
      `INSERT INTO contactos (nombre, email, telefono, asunto, mensaje, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [value.nombre, value.email, value.telefono, value.asunto, value.mensaje, clientIp(req)]
    );

    res.status(201).json({
      ok: true,
      id: result.insertId,
      mensaje: 'Gracias por escribirnos. Te responderemos lo antes posible.',
    });
  } catch (error) {
    next(error);
  }
});

router.put('/contactos/:id', async (req, res, next) => {
  const { ok, errors, value } = validateContacto(req.body || {});
  if (!ok) return res.status(400).json({ ok: false, errors });

  const leido = req.body?.leido ? 1 : 0;

  try {
    const [result] = await pool.execute(
      `UPDATE contactos SET
         nombre = ?, email = ?, telefono = ?, asunto = ?, mensaje = ?, leido = ?
       WHERE id = ?`,
      [value.nombre, value.email, value.telefono, value.asunto, value.mensaje, leido, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, errors: ['La consulta no existe.'] });
    }
    res.json({ ok: true, mensaje: 'Consulta actualizada.' });
  } catch (error) {
    next(error);
  }
});

router.patch('/contactos/:id/leido', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'UPDATE contactos SET leido = ? WHERE id = ?',
      [req.body?.leido ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, errors: ['La consulta no existe.'] });
    }
    res.json({ ok: true, mensaje: req.body?.leido ? 'Marcada como leída.' : 'Marcada como no leída.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/contactos/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM contactos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, errors: ['La consulta no existe.'] });
    }
    res.json({ ok: true, mensaje: 'Consulta eliminada.' });
  } catch (error) {
    next(error);
  }
});

router.get('/contactos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, email, telefono, asunto, mensaje, leido, creado_en
         FROM contactos
        ORDER BY creado_en DESC
        LIMIT 200`
    );
    res.json({ ok: true, total: rows.length, contactos: rows });
  } catch (error) {
    next(error);
  }
});

// --- Vídeos ----------------------------------------------------------------

router.get('/videos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, video_id, titulo, descripcion, orden
         FROM videos
        WHERE activo = 1
        ORDER BY orden ASC, id ASC`
    );
    res.json({ ok: true, videos: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
