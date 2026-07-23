// Vercel serverless entry point for the NestJS API.
// Imports from the compiled dist/ which is produced by `nest build` during Vercel's build step.
'use strict';

let server;

module.exports = async (req, res) => {
  if (!server) {
    const { createNestServer } = require('../dist/src/serverless');
    server = await createNestServer();
  }
  server(req, res);
};
