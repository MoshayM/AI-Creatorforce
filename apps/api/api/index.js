'use strict';

// Top-level require so Vercel's node-file-trace includes dist/ in the bundle.
// nest build outputs to apps/api/dist/ (not dist/src/), so the path is ../dist/serverless.
const { createNestServer } = require('../dist/serverless');

let server;

module.exports = async (req, res) => {
  if (!server) {
    server = await createNestServer();
  }
  server(req, res);
};
