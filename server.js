const express = require('express');
const path = require('node:path');

const app = express();
const port = process.env.PORT || 3000;
const root = __dirname;

app.use((req, res, next) => {
  if (/^\/(?:server\.js|package(?:-lock)?\.json|node_modules)(?:\/|$)/i.test(req.path)) {
    return res.sendStatus(404);
  }
  next();
});

app.use(express.static(root));

app.listen(port, () => {
  console.log(`Servidor disponible en http://localhost:${port}`);
});