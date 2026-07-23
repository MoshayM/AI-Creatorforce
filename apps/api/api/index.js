'use strict';

// Top-level require so Vercel's node-file-trace includes dist/ in the bundle.
const { createNestServer } = require('../dist/src/serverless');

let server;
let initError = null;

module.exports = async (req, res) => {
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
    res.end(JSON.stringify({ error: 'Server initialisation failed', message: initError?.message }));
    return;
  }

  server(req, res);
};
