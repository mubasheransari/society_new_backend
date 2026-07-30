// Minimal smoke test used as the CI gate before deploying.
// It does not need a live database: config/db.js only opens a connection
// pool lazily, so simply requiring the app proves every route file parses
// and every `require(...)` resolves.
try {
  const app = require('../index.js');
  if (typeof app !== 'function') {
    throw new Error('index.js did not export the Express app');
  }
  console.log('✅ Backend app module loads cleanly.');
  process.exit(0);
} catch (error) {
  console.error('❌ Backend failed to load:', error);
  process.exit(1);
}
