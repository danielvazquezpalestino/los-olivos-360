'use strict';

// Pruebas de integración de las videollamadas: token, permiso, historial y
// webhook. Usan MySQL y el servidor reales, y limpian lo que crean.
//
// Se ejecutan con: npm test
// Si MySQL no está disponible, la suite se omite (no falla).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// dotenv ANTES de db/pool: el pool lee DB_* al crearse.
require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const net = require('node:net');

const { pool, ping } = require('../db/pool');
const { generateToken } = require('../api/auth');
const { router: roomsRouter } = require('../api/rooms');
const { router: webhookRouter } = require('../api/livekit-webhook');

// Claves ficticias para las pruebas. Se fijan DESPUÉS de requerir los módulos
// para no depender de lo que haya (o no) en .env, y nunca tocan LiveKit real.
process.env.LIVEKIT_URL = 'wss://livekit.test';
process.env.LIVEKIT_API_KEY = 'test-api-key';
process.env.LIVEKIT_API_SECRET = 'test-api-secret-con-longitud-suficiente';

const TAG = `test-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

let server;
let baseUrl;
let dbReady = false;
let userIds = [];

// --- Utilidades ---------------------------------------------------------------

/**
 * Pide al sistema operativo un puerto TCP libre.
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function buildApp() {
  const app = express();
  // Mismo orden que server.js: webhook ANTES de express.json().
  app.use('/api', webhookRouter);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', roomsRouter);
  app.use((error, req, res, next) => {
    res.status(500).json({ ok: false, errors: [error.message] });
  });
  return app;
}

function tokenFor(user) {
  return generateToken({ id: user.id, email: user.email, rol: 'editor' });
}

async function api(path, { method = 'GET', body, token, raw, contentType, headers: extraHeaders } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, extraHeaders || {});
  let payload;
  if (raw !== undefined) {
    headers['Content-Type'] = contentType || 'application/json';
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = null;
  }
  return { status: res.status, json, text };
}

/**
 * Firma un evento como lo hace LiveKit: JWT HS256 con el checksum sha256 del body.
 * @param {object} payload
 * @returns {{ body: string, auth: string }}
 */
function signedWebhook(payload, secret = process.env.LIVEKIT_API_SECRET) {
  const body = JSON.stringify(payload);
  const sha256 = crypto.createHash('sha256').update(body).digest('base64');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: process.env.LIVEKIT_API_KEY,
      sub: process.env.LIVEKIT_API_KEY,
      sha256,
      exp: Math.floor(Date.now() / 1000) + 300,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return { body, auth: `${header}.${claims}.${signature}` };
}

function sendWebhook(payload, options = {}) {
  const { body, auth } = signedWebhook(payload, options.secret);
  const request = {
    method: 'POST',
    raw: options.tamperedBody || body,
    contentType: 'application/webhook+json',
  };
  // LiveKit manda el JWT en crudo en Authorization. Se usa un objeto Headers
  // para que el fetch de Node no añada `Bearer ` al detectar un JWT.
  if (!options.skipAuth) request.headers = { Authorization: auth };
  return api('/api/livekit/webhook', request);
}

async function createUser(nombre) {
  const email = `${TAG}-${crypto.randomBytes(4).toString('hex')}@example.test`;
  const hash = await bcrypt.hash('test-password', 4);
  const [result] = await pool.execute(
    'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
    [nombre, email, hash, 'editor']
  );
  userIds.push(result.insertId);
  return { id: result.insertId, nombre, email };
}

// --- Ciclo de vida ------------------------------------------------------------

test.before(async () => {
  try {
    await ping();
    const [tables] = await pool.query(
      "SHOW TABLES LIKE 'call_participants'"
    );
    dbReady = tables.length > 0;
  } catch (error) {
    dbReady = false;
  }

  if (!dbReady) return;

  // Se busca un puerto libre explícitamente: en Windows, fijar el puerto 0 a
  // veces deja `server.address()` en null al escuchar.
  const port = await freePort();
  server = buildApp().listen(port);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));

  if (dbReady && userIds.length > 0) {
    // ON DELETE CASCADE limpia room_members, rooms, calls y call_participants.
    const placeholders = userIds.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM usuarios WHERE id IN (${placeholders})`, userIds);
  }
  await pool.end().catch(() => { });
});

/**
 * Crea una sala de prueba con miembros.
 * @param {Array<object>} users
 */
async function createRoom(users) {
  const name = `${TAG.slice(0, 20)}-${crypto.randomBytes(3).toString('hex')}`;
  const res = await api('/api/rooms', {
    method: 'POST',
    token: tokenFor(users[0]),
    body: { name, member_ids: users.slice(1).map((u) => u.id) },
  });
  assert.equal(res.status, 201, res.text);
  return res.json.room;
}

// --- Pruebas ------------------------------------------------------------------

test('POST /api/video/token: miembro autenticado recibe token y url', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const [ana, luis] = [await createUser('Ana Test'), await createUser('Luis Test')];
  const room = await createRoom([ana, luis]);

  const res = await api('/api/video/token', {
    method: 'POST',
    token: tokenFor(luis),
    body: { room_id: room.id },
  });

  assert.equal(res.status, 200, res.text);
  assert.ok(res.json.token);
  assert.equal(res.json.url, process.env.LIVEKIT_URL);
  assert.equal(res.json.room.name, room.name);

  // El token es un JWT con los permisos mínimos y la identidad del usuario.
  const payload = JSON.parse(Buffer.from(res.json.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.sub, String(luis.id));
  assert.equal(payload.name, 'Luis Test');
  assert.equal(payload.video.room, room.name);
  assert.equal(payload.video.roomJoin, true);
  assert.equal(payload.video.canPublish, true);
  assert.equal(payload.video.canSubscribe, true);
  assert.equal(payload.video.roomAdmin, false);
  assert.ok(payload.exp - payload.nbf >= 3500, 'TTL de al menos 1 hora');
});

test('POST /api/video/token: sin JWT devuelve 401', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const res = await api('/api/video/token', { method: 'POST', body: { room_id: 1 } });
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
});

test('POST /api/video/token: usuario que no es miembro recibe 403', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const [ana, luis, intruso] = [
    await createUser('Ana Test'),
    await createUser('Luis Test'),
    await createUser('Intruso Test'),
  ];
  const room = await createRoom([ana, luis]);

  const res = await api('/api/video/token', {
    method: 'POST',
    token: tokenFor(intruso),
    body: { room_id: room.id },
  });

  assert.equal(res.status, 403);
  assert.equal(res.json.ok, false);
});

test('POST /api/video/token: room_id inválido devuelve 400', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const ana = await createUser('Ana Test');
  const res = await api('/api/video/token', {
    method: 'POST',
    token: tokenFor(ana),
    body: { room_id: 'DROP TABLE calls' },
  });
  assert.equal(res.status, 400);
});

test('webhook: firma inválida devuelve 401', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const payload = {
    event: 'room_started',
    room: { sid: `RM_${TAG}_bad`, name: 'sala-test' },
    createdAt: Math.floor(Date.now() / 1000),
  };

  const wrongSignature = await sendWebhook(payload, { secret: 'otro-secreto-distinto' });
  assert.equal(wrongSignature.status, 401);

  const noAuth = await sendWebhook(payload, { skipAuth: true });
  assert.equal(noAuth.status, 401);

  const tampered = await sendWebhook(payload, { tamperedBody: JSON.stringify({ ...payload, event: 'room_finished' }) });
  assert.equal(tampered.status, 401);

  // Nada de esto debe haber creado llamadas.
  const [rows] = await pool.execute('SELECT id FROM calls WHERE livekit_room_sid = ?', [payload.room.sid]);
  assert.equal(rows.length, 0);
});

test('webhook: ciclo completo y eventos repetidos son idempotentes', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const [ana, luis] = [await createUser('Ana Test'), await createUser('Luis Test')];
  const room = await createRoom([ana, luis]);
  const roomSid = `RM_${TAG}_ok`;
  const t0 = Math.floor(Date.now() / 1000);

  const started = {
    event: 'room_started',
    room: {
      sid: roomSid,
      name: room.name,
      creationTime: String(t0 * 1e9),
    },
    createdAt: t0,
  };

  // 1) room_started (dos veces: el segundo es un reenvío).
  assert.equal((await sendWebhook(started)).status, 200);
  assert.equal((await sendWebhook(started)).status, 200);

  const [calls] = await pool.execute(
    'SELECT id, started_at, status FROM calls WHERE livekit_room_sid = ?',
    [roomSid]
  );
  assert.equal(calls.length, 1, 'no debe duplicar la llamada');
  const callId = calls[0].id;
  assert.equal(calls[0].status, 'active');

  // 2) participant_joined (ana), repetido.
  const anaJoined = {
    event: 'participant_joined',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(ana.id) },
    createdAt: t0 + 5,
  };
  assert.equal((await sendWebhook(anaJoined)).status, 200);
  assert.equal((await sendWebhook(anaJoined)).status, 200);

  const [p1] = await pool.execute(
    'SELECT COUNT(*) AS n FROM call_participants WHERE call_id = ? AND user_id = ?',
    [callId, ana.id]
  );
  assert.equal(p1[0].n, 1, 'el reenvío no debe duplicar al participante');

  // luis entra más tarde.
  await sendWebhook({
    event: 'participant_joined',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(luis.id) },
    createdAt: t0 + 10,
  });

  // 3) participant_left (luis sale a los 50 s de entrar).
  const luisLeft = {
    event: 'participant_left',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(luis.id) },
    createdAt: t0 + 60,
  };
  assert.equal((await sendWebhook(luisLeft)).status, 200);
  // Reenvío con un instante posterior: no debe sobrescribir el tiempo ya fijado.
  assert.equal((await sendWebhook({ ...luisLeft, createdAt: t0 + 500 })).status, 200);

  const [luisRows] = await pool.execute(
    'SELECT duration_seconds, left_at FROM call_participants WHERE call_id = ? AND user_id = ?',
    [callId, luis.id]
  );
  assert.equal(luisRows[0].duration_seconds, 50);

  // 4) room_finished (dos veces).
  const finished = {
    event: 'room_finished',
    room: { sid: roomSid, name: room.name },
    createdAt: t0 + 120,
  };
  assert.equal((await sendWebhook(finished)).status, 200);
  assert.equal((await sendWebhook({ ...finished, createdAt: t0 + 900 })).status, 200);

  const [finalRows] = await pool.execute(
    'SELECT ended_at, duration_seconds, status FROM calls WHERE id = ?',
    [callId]
  );
  assert.equal(finalRows[0].status, 'ended');
  assert.equal(finalRows[0].duration_seconds, 120, 'el fin no se reescribe con el reenvío');

  // Ana nunca envió participant_left: room_finished cierra su entrada.
  const [anaRows] = await pool.execute(
    'SELECT left_at, duration_seconds FROM call_participants WHERE call_id = ? AND user_id = ?',
    [callId, ana.id]
  );
  assert.ok(anaRows[0].left_at);
  assert.equal(anaRows[0].duration_seconds, 115); // entró en t0+5, sala cerrada en t0+120
});

test('GET /api/calls/history y /api/calls/:id solo para miembros', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const [ana, luis, intruso] = [
    await createUser('Ana Test'),
    await createUser('Luis Test'),
    await createUser('Intruso Test'),
  ];
  const room = await createRoom([ana, luis]);
  const roomSid = `RM_${TAG}_hist`;
  const t0 = Math.floor(Date.now() / 1000);

  await sendWebhook({
    event: 'room_started',
    room: { sid: roomSid, name: room.name, creationTime: String(t0 * 1e9) },
    createdAt: t0,
  });
  await sendWebhook({
    event: 'participant_joined',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(ana.id) },
    createdAt: t0,
  });
  await sendWebhook({
    event: 'participant_left',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(ana.id) },
    createdAt: t0 + 30,
  });
  await sendWebhook({ event: 'room_finished', room: { sid: roomSid, name: room.name }, createdAt: t0 + 30 });

  const history = await api(`/api/calls/history?room_id=${room.id}`, { token: tokenFor(luis) });
  assert.equal(history.status, 200, history.text);
  assert.equal(history.json.total, 1);
  const call = history.json.calls[0];
  assert.equal(call.room_name, room.name);
  assert.equal(call.duration_seconds, 30);
  assert.equal(call.status, 'ended');
  assert.equal(call.participants.length, 1);
  assert.equal(call.participants[0].user_id, ana.id);
  assert.equal(call.participants[0].duration_seconds, 30);
  // Las horas salen en ISO UTC para que el navegador las pase a hora local.
  assert.match(call.started_at, /Z$/);

  const detail = await api(`/api/calls/${call.id}`, { token: tokenFor(ana) });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.call.participants[0].duration_seconds, 30);

  const intrusoHistory = await api('/api/calls/history', { token: tokenFor(intruso) });
  assert.equal(intrusoHistory.status, 200);
  assert.equal(intrusoHistory.json.total, 0, 'un no miembro no ve la llamada');

  const intrusoDetail = await api(`/api/calls/${call.id}`, { token: tokenFor(intruso) });
  assert.equal(intrusoDetail.status, 404);

  const sinJwt = await api('/api/calls/history');
  assert.equal(sinJwt.status, 401);
});

test('POST /api/calls/:id/leave no sobrescribe un tiempo del webhook', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const ana = await createUser('Ana Test');
  const room = await createRoom([ana]);
  const roomSid = `RM_${TAG}_leave`;
  const t0 = Math.floor(Date.now() / 1000);

  await sendWebhook({
    event: 'room_started',
    room: { sid: roomSid, name: room.name, creationTime: String(t0 * 1e9) },
    createdAt: t0,
  });
  await sendWebhook({
    event: 'participant_joined',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(ana.id) },
    createdAt: t0,
  });
  await sendWebhook({
    event: 'participant_left',
    room: { sid: roomSid, name: room.name },
    participant: { identity: String(ana.id) },
    createdAt: t0 + 20,
  });

  const [calls] = await pool.execute('SELECT id FROM calls WHERE livekit_room_sid = ?', [roomSid]);
  const res = await api(`/api/calls/${calls[0].id}/leave`, {
    method: 'POST',
    token: tokenFor(ana),
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.updated, false, 'la fila ya estaba cerrada por el webhook');

  const [rows] = await pool.execute(
    'SELECT duration_seconds, time_source FROM call_participants WHERE call_id = ? AND user_id = ?',
    [calls[0].id, ana.id]
  );
  assert.equal(rows[0].duration_seconds, 20);
  assert.equal(rows[0].time_source, 'webhook');
});

test('POST /api/rooms: valida nombre y miembros', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const ana = await createUser('Ana Test');

  const malNombre = await api('/api/rooms', {
    method: 'POST',
    token: tokenFor(ana),
    body: { name: '../etc/passwd' },
  });
  assert.equal(malNombre.status, 400);

  const miembroInexistente = await api('/api/rooms', {
    method: 'POST',
    token: tokenFor(ana),
    body: { name: `${TAG.slice(0, 20)}-x`, member_ids: [999999999] },
  });
  assert.equal(miembroInexistente.status, 400);

  const sinJwt = await api('/api/rooms', { method: 'POST', body: { name: 'sala-sin-jwt' } });
  assert.equal(sinJwt.status, 401);
});

test('GET /api/users: directorio sin datos sensibles', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const ana = await createUser('Ana Test');

  const res = await api('/api/users', { token: tokenFor(ana) });
  assert.equal(res.status, 200, res.text);
  assert.ok(Array.isArray(res.json.users));

  // Nunca debe salir el hash de la contraseña ni el propio usuario.
  const texto = JSON.stringify(res.json);
  assert.ok(!/password|hash/i.test(texto));
  assert.ok(!res.json.users.some((u) => Number(u.id) === ana.id));
  for (const usuario of res.json.users) {
    assert.ok(usuario.id && usuario.nombre);
    assert.ok(!('password_hash' in usuario));
  }

  const sinJwt = await api('/api/users');
  assert.equal(sinJwt.status, 401);
});

test('GET /api/rooms/:id/members sólo para miembros o admin', async (t) => {
  if (!dbReady) return t.skip('MySQL no disponible');

  const [ana, luis, intruso] = [
    await createUser('Ana Test'),
    await createUser('Luis Test'),
    await createUser('Intruso Test'),
  ];
  const room = await createRoom([ana, luis]);

  const ok = await api(`/api/rooms/${room.id}/members`, { token: tokenFor(luis) });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(
    ok.json.members.map((m) => m.id).sort((a, b) => a - b),
    [ana.id, luis.id].sort((a, b) => a - b)
  );

  const ajeno = await api(`/api/rooms/${room.id}/members`, { token: tokenFor(intruso) });
  assert.equal(ajeno.status, 403);

  const inexistente = await api('/api/rooms/999999999/members', { token: tokenFor(ana) });
  assert.equal(inexistente.status, 404);
});
