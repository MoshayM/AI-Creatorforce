'use strict';

let createNestServer = null;
let loadError = null;

try {
  createNestServer = require('../dist/serverless').createNestServer;
} catch (err) {
  loadError = err;
  console.error('[serverless] load error:', err?.message);
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
      console.error('[serverless] init error:', err?.message);
    }
  }

  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Init failed', message: initError?.message }));
    return;
  }

  server(req, res);
};
