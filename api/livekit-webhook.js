'use strict';

// Webhook de LiveKit: fuente de verdad para la hora de inicio, la hora de fin y
// la duración de cada llamada y de cada participante.
//
// Se monta en server.js ANTES de express.json() y con `express.raw`, porque la
// firma se calcula sobre el body EXACTO que envía LiveKit.
//
// Tiempos: se usa `event.createdAt` (segundos Unix, reloj del servidor LiveKit),
// nunca la hora del navegador del usuario.
//
// Idempotencia (los webhooks pueden repetirse o llegar desordenados):
//   * calls: clave única por livekit_room_sid; el inicio se queda con el más
//     antiguo y el fin no se reescribe si la llamada ya estaba cerrada.
//   * call_participants: una entrada abierta por (call_id, user_id); un reenvío
//     no duplica filas y no sustituye una duración válida por otra peor.

const express = require('express');
const { WebhookReceiver } = require('livekit-server-sdk');
const { pool } = require('../db/pool');
const { toMysqlUtc, nowUtc, secondsBetween } = require('./time');

/**
 * Instante del evento en formato DATETIME UTC de MySQL.
 * `createdAt` es bigint (segundos). Si faltase, se usa la hora del servidor.
 * @param {object} event
 * @returns {string}
 */
function eventTime(event) {
  const seconds = Number(event.createdAt);
  if (Number.isFinite(seconds) && seconds > 0) return toMysqlUtc(seconds * 1000);
  return nowUtc();
}

/**
 * Verifica la firma del webhook con la API key/secret.
 * @param {import('express').Request} req
 * @param {{ apiKey?: string, apiSecret?: string }} [config]
 * @returns {Promise<{ ok: true, event: object } | { ok: false, status: number, error: string }>}
 */
async function readEvent(req, config = {}) {
  const apiKey = config.apiKey || process.env.LIVEKIT_API_KEY;
  const apiSecret = config.apiSecret || process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return { ok: false, status: 503, error: 'Webhook no configurado.' };
  }

  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!body) {
    return { ok: false, status: 400, error: 'Cuerpo del webhook no válido.' };
  }

  // LiveKit documenta la cabecera `Authorization` con el JWT en crudo, pero
  // algunos proxies/SDK lo envían como `Bearer <jwt>`: se aceptan ambas.
  const authHeader = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!authHeader) {
    return { ok: false, status: 401, error: 'Falta la firma del webhook.' };
  }

  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    // receive() comprueba la firma del JWT y devuelve el evento decodificado.
    const event = await receiver.receive(body, authHeader);
    return { ok: true, event };
  } catch (error) {
    if (process.env.DEBUG_WEBHOOK) console.error('[webhook debug]', error.message);
    return { ok: false, status: 401, error: 'Firma del webhook no válida.' };
  }
}

/**
 * Busca la fila de `calls` por SID de sala.
 * @param {string} roomSid
 * @returns {Promise<object|null>}
 */
async function findCallBySid(roomSid) {
  const [rows] = await pool.execute(
    `SELECT id, room_id, started_at, ended_at, status
       FROM calls WHERE livekit_room_sid = ? LIMIT 1`,
    [String(roomSid)]
  );
  return rows[0] || null;
}

/**
 * Devuelve el id de la sala por nombre. Si la sala se creó directamente en
 * LiveKit (no desde la API), se registra usando la identidad del participante
 * como creador para no perder el registro del tiempo.
 * @param {string} roomName
 * @param {unknown} identity
 * @returns {Promise<number|null>}
 */
async function resolveRoomId(roomName, identity) {
  const name = String(roomName || '').slice(0, 64);
  if (!name) return null;

  const [rows] = await pool.execute('SELECT id FROM rooms WHERE name = ? LIMIT 1', [name]);
  if (rows.length > 0) return rows[0].id;

  const userId = Number(identity);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const [users] = await pool.execute(
    'SELECT id FROM usuarios WHERE id = ? AND activo = 1 LIMIT 1',
    [userId]
  );
  if (users.length === 0) return null;

  await pool.execute(
    'INSERT IGNORE INTO rooms (name, created_by) VALUES (?, ?)',
    [name, userId]
  );
  const [created] = await pool.execute('SELECT id FROM rooms WHERE name = ? LIMIT 1', [name]);
  if (created.length === 0) return null;

  await pool.execute('INSERT IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', [
    created[0].id,
    userId,
  ]);
  return created[0].id;
}

// --- Handlers por evento ------------------------------------------------------

async function onRoomStarted(event) {
  const room = event.room || {};
  if (!room.sid || !room.name) return;

  const roomSid = String(room.sid);
  // El inicio de la sala es el de su creación en LiveKit (creationTime, en
  // nanosegundos); si no viniera, el instante del evento.
  const creationNs = Number(room.creationTime);
  const startedAt =
    Number.isFinite(creationNs) && creationNs > 0
      ? toMysqlUtc(creationNs / 1e6)
      : eventTime(event);

  const existing = await findCallBySid(roomSid);
  if (existing) {
    if (existing.status === 'active') {
      // Reenvío: conserva el inicio más antiguo.
      await pool.execute('UPDATE calls SET started_at = LEAST(started_at, ?) WHERE id = ?', [
        startedAt,
        existing.id,
      ]);
    }
    return;
  }

  const roomId = await resolveRoomId(room.name, event.participant?.identity);
  if (!roomId) return;

  await pool.execute(
    `INSERT INTO calls (room_id, livekit_room_sid, started_at, status)
     VALUES (?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [roomId, roomSid, startedAt]
  );
}

async function onParticipantJoined(event) {
  const room = event.room || {};
  const identity = event.participant?.identity;
  if (!room.sid || !identity) return;

  const userId = Number(identity);
  if (!Number.isInteger(userId) || userId <= 0) return;

  const call = await findCallBySid(room.sid);
  if (!call) return;

  const joinedAt = eventTime(event);

  // Entrada ya abierta (reenvío del mismo evento): no se duplica.
  const [open] = await pool.execute(
    `SELECT id FROM call_participants
      WHERE call_id = ? AND user_id = ? AND left_at IS NULL
      LIMIT 1`,
    [call.id, userId]
  );
  if (open.length > 0) {
    await pool.execute(
      'UPDATE call_participants SET joined_at = LEAST(joined_at, ?) WHERE id = ?',
      [joinedAt, open[0].id]
    );
    return;
  }

  await pool.execute(
    `INSERT INTO call_participants (call_id, user_id, livekit_identity, joined_at, time_source)
     VALUES (?, ?, ?, ?, 'webhook')`,
    [call.id, userId, String(identity).slice(0, 64), joinedAt]
  );
}

async function onParticipantLeft(event) {
  const room = event.room || {};
  const identity = event.participant?.identity;
  if (!room.sid || !identity) return;

  const userId = Number(identity);
  if (!Number.isInteger(userId) || userId <= 0) return;

  const call = await findCallBySid(room.sid);
  if (!call) return;

  const [rows] = await pool.execute(
    `SELECT id, joined_at, left_at
       FROM call_participants
      WHERE call_id = ? AND user_id = ?
      ORDER BY joined_at DESC, id DESC
      LIMIT 1`,
    [call.id, userId]
  );
  if (rows.length === 0) return;

  // Ya cerrada por un webhook previo o por room_finished: no se toca.
  if (rows[0].left_at) return;

  const leftAt = eventTime(event);
  await pool.execute(
    `UPDATE call_participants
        SET left_at = ?, duration_seconds = ?, time_source = 'webhook'
      WHERE id = ? AND left_at IS NULL`,
    [leftAt, secondsBetween(rows[0].joined_at, leftAt), rows[0].id]
  );
}

async function onRoomFinished(event) {
  const room = event.room || {};
  if (!room.sid) return;

  const call = await findCallBySid(room.sid);
  if (!call) return;

  // Ya cerrada: idempotente.
  if (call.status === 'ended' && call.ended_at) return;

  const endedAt = eventTime(event);

  await pool.execute(
    `UPDATE calls SET ended_at = ?, duration_seconds = ?, status = 'ended' WHERE id = ?`,
    [endedAt, secondsBetween(call.started_at, endedAt), call.id]
  );

  // Cierra las entradas que no recibieron participant_left (caída del servidor).
  const [open] = await pool.execute(
    'SELECT id, joined_at FROM call_participants WHERE call_id = ? AND left_at IS NULL',
    [call.id]
  );
  for (const row of open) {
    await pool.execute(
      `UPDATE call_participants
          SET left_at = ?, duration_seconds = ?, time_source = 'webhook'
        WHERE id = ? AND left_at IS NULL`,
      [endedAt, secondsBetween(row.joined_at, endedAt), row.id]
    );
  }
}

const HANDLERS = {
  room_started: onRoomStarted,
  participant_joined: onParticipantJoined,
  participant_left: onParticipantLeft,
  room_finished: onRoomFinished,
};

// --- Ruta ---------------------------------------------------------------------

const router = express.Router();

router.post(
  '/livekit/webhook',
  express.raw({ type: 'application/webhook+json', limit: '256kb' }),
  async (req, res) => {
    // Lectura explícita de las claves en cada petición (nunca van al frontend).
    const result = await readEvent(req, {
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
    });
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, errors: [result.error] });
    }

    const { event } = result;
    const handler = HANDLERS[event.event];

    // Eventos no registrados (track_*, egress_*...): se aceptan y se ignoran.
    if (!handler) return res.json({ ok: true, ignored: true, event: event.event });

    try {
      await handler(event);
    } catch (error) {
      console.error('[LiveKit webhook]', event.event, error.message);
      // 500 hace que LiveKit reintente: preferible a perder el registro.
      return res.status(500).json({ ok: false, errors: ['Error procesando el webhook.'] });
    }

    res.json({ ok: true, event: event.event });
  }
);

module.exports = { router, HANDLERS, eventTime };
