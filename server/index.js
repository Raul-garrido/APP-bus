import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Proxy público: no hay sesión ni credenciales de usuario que proteger, así que basta con
// abrir CORS a cualquier origen para que el frontend (servido aquí mismo o desde otro
// host en desarrollo) pueda consumirlo sin que salte el bloqueo CORS de crtm.es.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.use('/api', apiRouter);
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`APP-bus escuchando en http://localhost:${PORT}`);
});
