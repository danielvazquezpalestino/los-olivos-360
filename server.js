require('dotenv').config();

const express = require('express');

const apiRoutes = require('./api/routes');
const { ping } = require('./db/pool');

const app = express();
const port = process.env.PORT || 3000;
const root = __dirname;

// --- Middleware ------------------------------------------------------------
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));

// No exponer archivos internos del servidor ni de la base de datos.
app.use((req, res, next) => {
  const blocked = /^\/(?:server\.js|package(?:-lock)?\.json|node_modules|db|_devserver\.ps1|\.env)/i;
  if (blocked.test(req.path)) return res.sendStatus(404);
  next();
});

// --- API -------------------------------------------------------------------
app.use('/api', apiRoutes);

// --- Sitio estático --------------------------------------------------------
app.use(express.static(root, { extensions: ['html'] }));

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