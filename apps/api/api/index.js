'use strict';

let createNestServer = null;
let loadError = null;

try {
  // Top-level require so Vercel's node-file-trace includes dist/ in the bundle.
  // nest build with sourceRoot:src + outDir:./dist writes to dist/ not dist/src/.
  createNestServer = require('../dist/serverless').createNestServer;
} catch (err) {
  loadError = err;
  console.error('[serverless] Module load error:', err?.message);
}

let server = null;
let initError = null;

module.exports = async (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Module load failed', message: loadError?.message }));
    return;
  }

  if (!server && !initError) {
    try {
      server = await createNestServer();
    } catch (err) {
      initError = err;
      console.error('[serverless] NestJS init failed:', err?.message, err?.stack);
    }
  }

  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server init failed', message: initError?.message }));
    return;
  }

  server(req, res);
};
