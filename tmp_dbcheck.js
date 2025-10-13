const { Client } = require('pg');
(async () => {
  try {
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const r = await c.query('select 1 as ok, current_database() as db');
    console.log('DB_OK', r.rows[0]);
    await c.end();
    process.exit(0);
  } catch (e) {
    console.error('DB_ERR', e.message);
    process.exit(1);
  }
})();
