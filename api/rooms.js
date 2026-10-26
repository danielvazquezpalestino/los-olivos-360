'use strict';

// Salas de videollamada: creación de salas, emisión del token de LiveKit y
// consultas de historial. Reutiliza el middleware JWT existente (requireAuth)
// y las consultas parametrizadas de mysql2.

const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const { pool } = require('../db/pool');
const { requireAuth } = require('./auth');
const { mysqlUtcToIso } = require('./time');

const router = express.Router();

const MAX_PARTICIPANTS = 10;
const TOKEN_TTL = '1h';
const HISTORY_PAGE_SIZE = 20;
const HISTORY_MAX_PAGE_SIZE = 50;

// --- Configuración de LiveKit -------------------------------------------------
// Función pura: se lee en cada petición (no al cargar el módulo) para que las
// variables de .env estén disponibles y para no romper el arranque si faltan
// (en ese caso sólo fallan los endpoints de vídeo).
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ url: string, apiKey: string, apiSecret: string }|null}
 */
function livekitConfig(env = process.env) {
  const url = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

// --- Validación ---------------------------------------------------------------

/**
 * Convierte el id recibido a entero positivo o null.
 * @param {unknown} value
 * @returns {number|null}
 */
function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 4294967295 ? n : null;
}

/**
 * Nombre de sala: minúsculas, números y guiones; entre 3 y 64 caracteres.
 * LiveKit usa el nombre como identificador de sala, por eso lo restringimos.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRoomName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 64);
}

const ROOM_NAME_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/**
 * Deduplica y valida una lista de ids de usuario.
 * @param {unknown} value
 * @returns {{ ids: number[], invalid: boolean }}
 */
function normalizeUserIds(value) {
  if (!Array.isArray(value)) return { ids: [], invalid: true };
  const set = new Set();
  let invalid = false;
  for (const item of value) {
    const id = positiveInt(item);
    if (id === null) invalid = true;
    else set.add(id);
  }
  return { ids: [...set], invalid };
}

// --- Acceso -------------------------------------------------------------------

/**
 * Comprueba que el usuario es miembro de la sala.
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function isMember(roomId, userId) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? LIMIT 1',
    [roomId, userId]
  );
  return rows.length > 0;
}

/**
 * Comprueba si el usuario puede consultar una llamada: es miembro de su sala
 * o tiene rol admin.
 * @param {number} callId
 * @param {{ id: number, rol?: string }} user
 * @returns {Promise<{ call: object } | null>}
 */
async function findAuthorizedCall(callId, user) {
  const [rows] = await pool.execute(
    `SELECT c.id, c.room_id, c.livekit_room_sid, c.started_at, c.ended_at,
            c.duration_seconds, c.status, r.name AS room_name,
            EXISTS (
              SELECT 1 FROM room_members m WHERE m.room_id = c.room_id AND m.user_id = ?
            ) AS is_member
       FROM calls c
       JOIN rooms r ON r.id = c.room_id
      WHERE c.id = ?
      LIMIT 1`,
    [user.id, callId]
  );
  if (rows.length === 0) return null;
  const call = rows[0];
  if (!Number(call.is_member) && user.rol !== 'admin') return null;
  return { call };
}

// --- POST /api/rooms ----------------------------------------------------------
// Crea la sala en la base de datos y añade los miembros indicados.
router.post('/rooms', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const name = normalizeRoomName(body.name);
  const { ids: memberIds, invalid } = normalizeUserIds(body.member_ids ?? []);

  if (!ROOM_NAME_RE.test(name)) {
    return res.status(400).json({
      ok: false,
      errors: ['El nombre de la sala debe tener entre 3 y 64 caracteres: letras minúsculas, números y guiones.'],
    });
  }
  if (invalid) {
    return res.status(400).json({ ok: false, errors: ['La lista de miembros no es válida.'] });
  }

  // El creador siempre es miembro, aunque no se incluya en la lista.
  const allMemberIds = [...new Set([Number(req.user.id), ...memberIds])];

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Solo se pueden añadir usuarios activos existentes.
    const placeholders = allMemberIds.map(() => '?').join(', ');
    const [users] = await conn.execute(
      `SELECT id FROM usuarios WHERE activo = 1 AND id IN (${placeholders})`,
      allMemberIds
    );
    const validIds = users.map((u) => u.id);

    if (validIds.length !== allMemberIds.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, errors: ['Alguno de los miembros no existe o está inactivo.'] });
    }

    if (validIds.length > MAX_PARTICIPANTS) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        errors: [`Una sala admite como máximo ${MAX_PARTICIPANTS} participantes.`],
      });
    }

    const [existing] = await conn.execute('SELECT id FROM rooms WHERE name = ? LIMIT 1', [name]);
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ ok: false, errors: ['Ya existe una sala con ese nombre.'] });
    }

    const [result] = await conn.execute(
      'INSERT INTO rooms (name, created_by, max_participants) VALUES (?, ?, ?)',
      [name, Number(req.user.id), MAX_PARTICIPANTS]
    );
    const roomId = result.insertId;

    const values = validIds.map(() => '(?, ?)').join(', ');
    const params = validIds.flatMap((userId) => [roomId, userId]);
    await conn.execute(
      `INSERT IGNORE INTO room_members (room_id, user_id) VALUES ${values}`,
      params
    );

    await conn.commit();

    res.status(201).json({
      ok: true,
      room: { id: roomId, name, created_by: Number(req.user.id), members: validIds },
    });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => { });
    next(error);
  } finally {
    if (conn) conn.release();
  }
});

// --- POST /api/video/token ----------------------------------------------------
// Devuelve un token de acceso a LiveKit (1 h) sólo si el usuario es miembro.
router.post('/video/token', requireAuth, async (req, res, next) => {
  const roomId = positiveInt(req.body?.room_id);
  if (roomId === null) {
    return res.status(400).json({ ok: false, errors: ['El identificador de la sala no es válido.'] });
  }

  const config = livekitConfig();
  if (!config) {
    return res.status(503).json({
      ok: false,
      errors: ['Las videollamadas no están configuradas en el servidor.'],
    });
  }

  try {
    const [rooms] = await pool.execute(
      'SELECT id, name FROM rooms WHERE id = ? LIMIT 1',
      [roomId]
    );
    if (rooms.length === 0) {
      return res.status(404).json({ ok: false, errors: ['La sala no existe.'] });
    }

    if (!(await isMember(roomId, Number(req.user.id)))) {
      return res.status(403).json({ ok: false, errors: ['No tienes permiso para entrar en esta sala.'] });
    }

    const room = rooms[0];

    const [users] = await pool.execute(
      'SELECT nombre FROM usuarios WHERE id = ? AND activo = 1 LIMIT 1',
      [Number(req.user.id)]
    );
    if (users.length === 0) {
      return res.status(401).json({ ok: false, errors: ['Usuario no válido.'] });
    }

    const at = new AccessToken(config.apiKey, config.apiSecret, {
      identity: String(req.user.id),
      name: users[0].nombre,
      ttl: TOKEN_TTL,
    });
    // Permisos mínimos: entrar, publicar y suscribirse.
    at.addGrant({
      roomJoin: true,
      room: room.name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      roomCreate: false,
      roomAdmin: false,
      roomRecord: false,
      ingressAdmin: false,
    });

    const token = await at.toJwt();

    res.json({
      ok: true,
      token,
      url: config.url,
      room: { id: room.id, name: room.name },
      expires_in: 3600,
    });
  } catch (error) {
    next(error);
  }
});

// --- GET /api/calls/history ---------------------------------------------------
// Historial paginado de las llamadas de las salas a las que pertenece el usuario.
router.get('/calls/history', requireAuth, async (req, res, next) => {
  const userId = Number(req.user.id);

  const pageRaw = Number(req.query.page ?? 1);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const sizeRaw = Number(req.query.page_size ?? HISTORY_PAGE_SIZE);
  const pageSize =
    Number.isInteger(sizeRaw) && sizeRaw > 0
      ? Math.min(sizeRaw, HISTORY_MAX_PAGE_SIZE)
      : HISTORY_PAGE_SIZE;

  const roomFilter = req.query.room_id ? positiveInt(req.query.room_id) : null;
  if (req.query.room_id && roomFilter === null) {
    return res.status(400).json({ ok: false, errors: ['El identificador de la sala no es válido.'] });
  }

  try {
    const where = ['EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = c.room_id AND m.user_id = ?)'];
    const params = [userId];
    if (roomFilter !== null) {
      where.push('c.room_id = ?');
      params.push(roomFilter);
    }
    const whereSql = where.join(' AND ');

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM calls c WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0].total);

    // LIMIT/OFFSET van parametrizados (mysql2 los envía como enteros).
    const [rows] = await pool.execute(
      `SELECT c.id, c.room_id, r.name AS room_name, c.started_at, c.ended_at,
              c.duration_seconds, c.status,
              (SELECT COUNT(*) FROM call_participants p WHERE p.call_id = c.id) AS participant_count
         FROM calls c
         JOIN rooms r ON r.id = c.room_id
        WHERE ${whereSql}
        ORDER BY c.started_at DESC, c.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    const callIds = rows.map((row) => row.id);
    const participantsByCall = new Map();

    if (callIds.length > 0) {
      const placeholders = callIds.map(() => '?').join(', ');
      const [participants] = await pool.execute(
        `SELECT p.call_id, p.user_id, u.nombre, p.joined_at, p.left_at, p.duration_seconds
           FROM call_participants p
           JOIN usuarios u ON u.id = p.user_id
          WHERE p.call_id IN (${placeholders})
          ORDER BY p.joined_at ASC, p.id ASC`,
        callIds
      );
      for (const p of participants) {
        if (!participantsByCall.has(p.call_id)) participantsByCall.set(p.call_id, []);
        participantsByCall.get(p.call_id).push({
          user_id: p.user_id,
          nombre: p.nombre,
          joined_at: mysqlUtcToIso(p.joined_at),
          left_at: mysqlUtcToIso(p.left_at),
          duration_seconds: p.duration_seconds === null ? null : Number(p.duration_seconds),
        });
      }
    }

    res.json({
      ok: true,
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      calls: rows.map((row) => ({
        id: row.id,
        room_id: row.room_id,
        room_name: row.room_name,
        started_at: mysqlUtcToIso(row.started_at),
        ended_at: mysqlUtcToIso(row.ended_at),
        duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        status: row.status,
        participant_count: Number(row.participant_count),
        participants: participantsByCall.get(row.id) || [],
      })),
    });
  } catch (error) {
    next(error);
  }
});

// --- GET /api/calls/:id -------------------------------------------------------
// Detalle de una llamada con el tiempo de cada participante.
router.get('/calls/:id', requireAuth, async (req, res, next) => {
  const callId = positiveInt(req.params.id);
  if (callId === null) {
    return res.status(400).json({ ok: false, errors: ['El identificador de la llamada no es válido.'] });
  }

  try {
    const found = await findAuthorizedCall(callId, req.user);
    if (!found) {
      return res.status(404).json({ ok: false, errors: ['La llamada no existe o no tienes permiso para verla.'] });
    }

    const [participants] = await pool.execute(
      `SELECT p.id, p.user_id, u.nombre, p.joined_at, p.left_at, p.duration_seconds
         FROM call_participants p
         JOIN usuarios u ON u.id = p.user_id
        WHERE p.call_id = ?
        ORDER BY p.joined_at ASC, p.id ASC`,
      [callId]
    );

    const call = found.call;
    res.json({
      ok: true,
      call: {
        id: call.id,
        room_id: call.room_id,
        room_name: call.room_name,
        started_at: mysqlUtcToIso(call.started_at),
        ended_at: mysqlUtcToIso(call.ended_at),
        duration_seconds: call.duration_seconds === null ? null : Number(call.duration_seconds),
        status: call.status,
        participants: participants.map((p) => ({
          id: p.id,
          user_id: p.user_id,
          nombre: p.nombre,
          joined_at: mysqlUtcToIso(p.joined_at),
          left_at: mysqlUtcToIso(p.left_at),
          duration_seconds: p.duration_seconds === null ? null : Number(p.duration_seconds),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// --- GET /api/rooms -----------------------------------------------------------
// Salas a las que pertenece el usuario (para elegir a cuál entrar).
router.get('/rooms', requireAuth, (req, res, next) => {
  pool
    .execute(
      `SELECT r.id, r.name, r.created_at, r.created_by,
              (SELECT COUNT(*) FROM room_members m2 WHERE m2.room_id = r.id) AS member_count
         FROM rooms r
         JOIN room_members m ON m.room_id = r.id
        WHERE m.user_id = ?
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [Number(req.user.id)]
    )
    .then(([rows]) => {
      res.json({
        ok: true,
        rooms: rows.map((room) => ({
          id: room.id,
          name: room.name,
          created_by: room.created_by,
          created_at: mysqlUtcToIso(room.created_at),
          member_count: Number(room.member_count),
        })),
      });
    })
    .catch(next);
});

// --- GET /api/rooms/:id/members ----------------------------------------------
// Miembros de una sala (sólo para sus miembros y admins).
router.get('/rooms/:id/members', requireAuth, async (req, res, next) => {
  const roomId = positiveInt(req.params.id);
  if (roomId === null) {
    return res.status(400).json({ ok: false, errors: ['El identificador de la sala no es válido.'] });
  }

  try {
    const [rooms] = await pool.execute('SELECT id, name FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    if (rooms.length === 0) {
      return res.status(404).json({ ok: false, errors: ['La sala no existe.'] });
    }
    if (!(await isMember(roomId, Number(req.user.id))) && req.user.rol !== 'admin') {
      return res.status(403).json({ ok: false, errors: ['No tienes permiso para ver esta sala.'] });
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.nombre, u.email, u.rol
         FROM room_members m
         JOIN usuarios u ON u.id = m.user_id
        WHERE m.room_id = ? AND u.activo = 1
        ORDER BY u.nombre ASC`,
      [roomId]
    );

    res.json({ ok: true, members: rows });
  } catch (error) {
    next(error);
  }
});

// --- GET /api/users -----------------------------------------------------------
// Directorio para elegir a quién invitar a una videollamada. Nunca devuelve
// hashes ni ningún dato sensible: sólo lo justo para identificarse.
router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const me = Number(req.user.id);
    const [rows] = await pool.query(
      `SELECT id, nombre, email, rol
         FROM usuarios
        WHERE activo = 1 AND id <> ?
        ORDER BY nombre ASC
        LIMIT 200`,
      [me]
    );
    res.json({ ok: true, users: rows });
  } catch (error) {
    next(error);
  }
});

// --- POST /api/calls/:id/leave ------------------------------------------------
// Respaldo cuando el navegador se cierra y el webhook puede tardar. Nunca
// sobrescribe tiempos marcados por el webhook; sólo cubre el hueco.
router.post('/calls/:id/leave', requireAuth, async (req, res, next) => {
  const callId = positiveInt(req.params.id);
  if (callId === null) {
    return res.status(400).json({ ok: false, errors: ['El identificador de la llamada no es válido.'] });
  }

  try {
    const found = await findAuthorizedCall(callId, req.user);
    if (!found) {
      return res.status(404).json({ ok: false, errors: ['La llamada no existe o no tienes permiso para verla.'] });
    }

    const [result] = await pool.execute(
      `UPDATE call_participants
          SET left_at = COALESCE(left_at, UTC_TIMESTAMP(3)),
              duration_seconds = COALESCE(
                duration_seconds,
                GREATEST(0, TIMESTAMPDIFF(SECOND, joined_at, UTC_TIMESTAMP(3)))
              ),
              time_source = 'client'
        WHERE call_id = ? AND user_id = ? AND left_at IS NULL`,
      [callId, Number(req.user.id)]
    );

    res.json({ ok: true, updated: result.affectedRows > 0 });
  } catch (error) {
    next(error);
  }
});

module.exports = { router, livekitConfig };
