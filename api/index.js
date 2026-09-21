// Adaptador para Vercel: expone la misma app de Express (server/app.js, la que también
// usa `npm start` en local) como función serverless. El catch-all con corchetes
// (api/[...path].js) no enrutaba de forma fiable las rutas anidadas en un proyecto
// "Other" sin framework -- probado en vivo: /api/lines?q= funcionaba pero
// /api/lines/:codLine daba 404 de la propia plataforma Vercel, antes de llegar aquí.
// En su lugar: función fija + rewrite explícito en vercel.json que manda todo /api/*
// aquí, con el path original completo intacto (lo que espera el router de Express
// montado en '/api').
import app from '../server/app.js';

export default app;
