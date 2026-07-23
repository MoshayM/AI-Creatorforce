'use strict';

const path = require('path');
const fs = require('fs');

let createNestServer = null;
let loadError = null;

// Attempt the require at module load time but catch it so the handler still runs
try {
  createNestServer = require('../dist/src/serverless').createNestServer;
} catch (err) {
  loadError = err;
  console.error('[serverless] require dist/src/serverless failed:', err?.message);
}

let server = null;
let initError = null;

module.exports = async (req, res) => {
  // Diagnostic: if module failed to load, return error + file listing
  if (loadError) {
    const taskDir = path.resolve(__dirname, '..');
    let files = [];
    try {
      files = fs.readdirSync(taskDir);
    } catch (_) {}
    let distFiles = [];
    try {
      const distPath = path.join(taskDir, 'dist', 'src');
      distFiles = fs.readdirSync(distPath);
    } catch (_) {}
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Module load failed',
      message: loadError?.message,
      taskDir,
      rootContents: files,
      distSrcContents: distFiles,
    }));
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
    res.end(JSON.stringify({ error: 'Server initialisation failed', message: initError?.message }));
    return;
  }

  server(req, res);
};
