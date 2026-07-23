'use strict';

const path = require('path');
const fs = require('fs');

function safeLs(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return [`ERR:${e.code}`]; }
}
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }

// Collect filesystem state at module load time (before any require)
const base = '/var/task';
const fsInfo = {
  api_root: safeLs(`${base}/apps/api`),
  dist_top5: safeLs(`${base}/apps/api/dist`).slice(0, 5),
  nm_root_exists: exists(`${base}/node_modules`),
  nm_express_exists: exists(`${base}/node_modules/express`),
  nm_express_type: (() => { try { return fs.lstatSync(`${base}/node_modules/express`).isSymbolicLink() ? 'symlink' : 'dir'; } catch { return 'missing'; } })(),
  api_nm_exists: exists(`${base}/apps/api/node_modules`),
  api_nm_express_exists: exists(`${base}/apps/api/node_modules/express`),
  api_nm_express_type: (() => { try { return fs.lstatSync(`${base}/apps/api/node_modules/express`).isSymbolicLink() ? 'symlink' : 'dir'; } catch { return 'missing'; } })(),
};

let createNestServer = null;
let loadError = null;

try {
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
    res.end(JSON.stringify({ error: 'Module load failed', message: loadError?.message, fsInfo }));
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
    res.end(JSON.stringify({ error: 'Server init failed', message: initError?.message, fsInfo }));
    return;
  }

  server(req, res);
};
