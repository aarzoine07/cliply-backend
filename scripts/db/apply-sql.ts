import fs from 'fs';
import { Client } from 'pg';

const files = ['db/schema.sql','db/rls.sql','db/functions.sql','db/seed.sql'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { throw new Error('DATABASE_URL is not set'); }

  // Force TLS but skip verification for local dev operations
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  for (const f of files) {
    if (fs.existsSync(f)) {
      const q = fs.readFileSync(f, 'utf8');
      if (q.trim().length > 0) {
        console.log('APPLY', f);
        await client.query(q);
      }
    }
  }

  await client.end();
  console.log('SQL_APPLIED');
}

main().catch((e) => {
  console.error('SQL_APPLY_ERR', e?.message || e);
  process.exit(1);
});
