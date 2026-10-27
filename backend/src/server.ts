import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, getDb } from './db/index.js';

const app = createApp();

// Opening the database here (rather than on first request) means a bad DATABASE_PATH or
// a broken schema fails loudly at boot instead of on a user's first call.
getDb();

const server = app.listen(env.port, () => {
  console.log(
    `[confluencr-ledger] API listening on http://localhost:${env.port}${''}\n` +
      `  environment : ${env.nodeEnv}\n` +
      `  database    : ${env.databasePath}\n` +
      `  endpoints   : http://localhost:${env.port}/api/v1`,
  );
});

function shutdown(signal: string) {
  console.log(`[confluencr-ledger] received ${signal}, shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
