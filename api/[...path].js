// Adaptador para Vercel: expone la misma app de Express (server/app.js, la que también
// usa `npm start` en local) como función serverless. El nombre de archivo [...path].js
// (catch-all) hace que Vercel enrute aquí cualquier request bajo /api/*, con el path
// original completo -- que es justo lo que espera el router de Express montado en '/api'.
import app from '../server/app.js';

export default app;
