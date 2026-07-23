'use strict';

// Top-level require so Vercel's node-file-trace includes dist/ in the bundle.
// nest build with sourceRoot:src + outDir:./dist writes to dist/ not dist/src/.
const { createNestServer } = require('../dist/serverless');

let server;

module.exports = async (req, res) => {
  if (!server) {
    server = await createNestServer();
  }
  server(req, res);
};
