require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');

const apiRoutes = require('./api/routes');
const { router: livekitWebhook } = require('./api/livekit-webhook');
const { router: roomsRouter } = require('./api/rooms');
const { ping } = require('./db/pool');

const app = express();
const port = process.env.PORT || 3000;
const root = __dirname;

// --- Webhook de LiveKit ------------------------------------------------------
// Debe registrarse ANTES de express.json(): la firma se valida sobre el body
// crudo. La ruta aplica su propio `express.raw({ type: 'application/webhook+json' })`
// y NO usa el middleware JWT (la autentica la firma del SDK).
app.use('/api', livekitWebhook);

// --- Middleware ------------------------------------------------------------
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// No exponer archivos internos del servidor ni de la base de datos.
app.use((req, res, next) => {
  const blocked = /^\/(?:server\.js|package(?:-lock)?\.json|node_modules|db|_devserver\.ps1|\.env)/i;
  if (blocked.test(req.path)) return res.sendStatus(404);
  next();
});

// --- API -------------------------------------------------------------------
// Los datos de visitas/contactos son dinámicos: nunca se cachean.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, apiRoutes, roomsRouter);

// --- Entrada del sitio -----------------------------------------------------
// La raíz (y la app instalada) llevan siempre al acceso: nunca al panel ni a
// la landing. Si ya hay sesión, el propio login redirige a /index.html.
// `Cache-Control: no-store` evita que se guarde el 302 en la caché del navegador
// o del service worker y que más tarde se sirva un redirect obsoleto.
app.get(['/', '/index'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(302, '/login.html');
});

// --- Sitio estático --------------------------------------------------------
// HTML: siempre revalidar (no-cache). Assets con extensión (css/js/imagenes):
// caché larga porque no cambian con frecuencia; si cambian, se sube la versión
// del service worker y se renombra el archivo si hace falta.
const ASSET_MAX_AGE = 7 * 24 * 60 * 60; // 7 días en segundos
app.use(
  express.static(root, {
    extensions: ['html'],
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', `public, max-age=${ASSET_MAX_AGE}`);
      }
    },
  })
);

// --- Manejo de errores -----------------------------------------------------
app.use((error, req, res, next) => {
  console.error('[API]', error.message);
  res.status(500).json({ ok: false, errors: ['Error interno del servidor.'] });
});

// --- Arranque --------------------------------------------------------------
async function start() {
  try {
    await ping();
    console.log(`MySQL conectado (${process.env.DB_NAME || 'los_olivos_360'})`);
  } catch (error) {
    console.warn(`Aviso: no se pudo conectar a MySQL (${error.code || error.message}).`);
    console.warn('Los formularios fallarán hasta que ejecutes: npm run db:init');
  }

  app.listen(port, () => {
    console.log(`Servidor disponible en http://localhost:${port}`);
  });
}

start();