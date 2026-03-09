#!/usr/bin/env node
const requiredTables = ['whitelist','registrations','users','coffees','magic_link_tokens'];
const providedSuffix = process.argv[2];
const suffix = providedSuffix || new Date().toISOString().slice(0,10).replace(/-/g,'');

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

let pg;
try { ({ default: pg } = await import("pg")); }
catch { console.error("❌ Missing dependency: pg. Run npm install"); process.exit(1); }

const { Pool } = pg;
const useSSL = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}) });
const backupTableName = (table) => `backup_${table}_${suffix}`;

try {
  await pool.query("BEGIN");
  for (const table of requiredTables) {
    const backup = backupTableName(table);
    await pool.query(`DROP TABLE IF EXISTS ${backup}`);
    await pool.query(`CREATE TABLE ${backup} AS TABLE ${table}`);
  }
  await pool.query("COMMIT");
  console.log("✅ Backup created:", suffix);
} catch (e) {
  await pool.query("ROLLBACK");
  console.error("❌ Backup failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
