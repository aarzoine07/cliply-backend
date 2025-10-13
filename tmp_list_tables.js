const { Client } = require("pg");
(async () => {
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    const res = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
    console.log(JSON.stringify(res.rows.map(r => r.table_name)));
    await client.end();
  } catch (err) {
    console.error('ERR:' + err.message);
    process.exit(1);
  }
})();
