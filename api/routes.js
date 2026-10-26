'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const { validateVisita, validateContacto } = require('./validation');
const { requireAuth, login, logout, me } = require('./auth');
const MemoryCache = require('./cache');

const router = express.Router();

// --- Caché en memoria para las lecturas (GET) ------------------------------
// TTL corto: si un admin tiene dos pestañas abiertas, ve datos de hace 30 s
// como máximo salvo que fuerce la recarga.
const CACHE_TTL_MS = 30_000;
const listCache = new MemoryCache({ ttlMs: CACHE_TTL_MS, maxEntries: 50 });

/**
 * Sirve un listado desde caché (30 s) o desde la base de datos.
 * Si el cliente envía `Cache-Control: no-cache`, se salta la caché (bypass).
 * @param {string} key Clave de caché (p. ej. 'visitas').
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 * @param {() => Promise<object>} loader Consulta que devuelve el objeto JSON a enviar.
 */
async function listFromCache(key, req, res, next, loader) {
  if (req.fresh) return res.sendStatus(304);

  const noCache = /no-cache/i.test(String(req.headers['cache-control'] || ''));
  const cached = noCache ? undefined : listCache.get(key);
  if (cached !== undefined) {
    res.set('X-Cache', 'hit');
    return res.json(cached);
  }

  try {
    const payload = await loader();
    listCache.set(key, payload);
    res.set('X-Cache', 'miss');
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

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

    // La caché se invalida tras cada escritura.
    listCache.flush();

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
    // Invalida la caché de listados tras cualquier escritura.
    listCache.flush();
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
    // Invalida la caché de listados tras cualquier escritura.
    listCache.flush();
    res.json({ ok: true, mensaje: 'Visita eliminada.' });
  } catch (error) {
    next(error);
  }
});

router.get('/visitas', (req, res, next) => {
  listFromCache('visitas', req, res, next, async () => {
    const [rows] = await pool.query(
      `SELECT id, nombre, email, telefono, fecha_preferida, franja, residente,
              mensaje, estado, creado_en
         FROM visitas
        ORDER BY creado_en DESC
        LIMIT 200`
    );
    return { ok: true, total: rows.length, visitas: rows };
  });
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

    // Invalida la caché de listados tras cualquier escritura.
    listCache.flush();
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
    // Invalida la caché de listados tras cualquier escritura.
    listCache.flush();
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
    // Invalida la caché de listados tras cualquier escritura.
    listCache.flush();
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
    // Invalida la caché de listados tras cualquier escritura.
    listCache.flush();
    res.json({ ok: true, mensaje: 'Consulta eliminada.' });
  } catch (error) {
    next(error);
  }
});

router.get('/contactos', (req, res, next) => {
  listFromCache('contactos', req, res, next, async () => {
    const [rows] = await pool.query(
      `SELECT id, nombre, email, telefono, asunto, mensaje, leido, creado_en
         FROM contactos
        ORDER BY creado_en DESC
        LIMIT 200`
    );
    return { ok: true, total: rows.length, contactos: rows };
  });
});

// --- Vídeos ----------------------------------------------------------------

router.get('/videos', (req, res, next) => {
  listFromCache('videos', req, res, next, async () => {
    const [rows] = await pool.query(
      `SELECT id, video_id, titulo, descripcion, orden
         FROM videos
        WHERE activo = 1
        ORDER BY orden ASC, id ASC`
    );
    return { ok: true, videos: rows };
  });
});

// --- Autenticación -----------------------------------------------------------

router.post('/auth/login', login);
router.post('/auth/logout', logout);
router.get('/auth/me', requireAuth, me);

module.exports = router;
