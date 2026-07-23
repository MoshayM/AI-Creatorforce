'use strict';

// Top-level require so Vercel's node-file-trace includes dist/ in the bundle.
const { createNestServer } = require('../dist/src/serverless');

let server;

module.exports = async (req, res) => {
  if (!server) {
    server = await createNestServer();
  }
  server(req, res);
};
