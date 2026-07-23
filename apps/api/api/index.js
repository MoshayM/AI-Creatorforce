'use strict';

const path = require('path');
const fs = require('fs');

let createNestServer = null;
let loadError = null;

// List what's actually in the dist/ directory at runtime for diagnostics
let distContents = [];
try {
  distContents = fs.readdirSync(path.resolve(__dirname, '..', 'dist'));
} catch (e) { distContents = ['ERROR: ' + e.message]; }

try {
  createNestServer = require('../dist/serverless').createNestServer;
} catch (err) {
  loadError = err;
  console.error('[serverless] require failed:', err?.message);
}

let server = null;
let initError = null;

module.exports = async (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Module load failed', message: loadError?.message, distContents }));
    return;
  }

  if (!server && !initError) {
    try {
      server = await createNestServer();
    } catch (err) {
      initError = err;
      console.error('[serverless] NestJS init failed:', err?.message);
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
