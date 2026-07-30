// Vercel Node.js serverless entry point.
// vercel.json rewrites every request to this function; Express reads the
// original req.url (e.g. /api/dues/list) and routes it internally exactly
// like it does today when run as a normal server.
module.exports = require('../index.js');
