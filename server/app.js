import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Proxy público: no hay sesión ni credenciales de usuario que proteger, así que basta con
// abrir CORS a cualquier origen para que el frontend (servido aquí mismo o desde otro
// host en desarrollo) pueda consumirlo sin que salte el bloqueo CORS de crtm.es.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.use('/api', apiRouter);
// Leaflet se sirve como archivo estático normal desde public/vendor/leaflet (vendorizado
// en el propio repo, no desde node_modules) para que funcione igual en local y en Vercel.
app.use(express.static(path.join(__dirname, '..', 'public')));

export default app;
