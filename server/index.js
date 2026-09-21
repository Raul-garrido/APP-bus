// Arranque para desarrollo/local (`npm start`). En Vercel no se usa este archivo: la
// misma app de server/app.js se expone como función serverless desde api/[...path].js.
import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`APP-bus escuchando en http://localhost:${PORT}`);
});
