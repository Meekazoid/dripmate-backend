import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ts = new Date().toISOString().slice(0,10).replace(/-/g, "");
const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS backup_whitelist_${ts} AS TABLE whitelist;
CREATE TABLE IF NOT EXISTS backup_registrations_${ts} AS TABLE registrations;
CREATE TABLE IF NOT EXISTS backup_users_${ts} AS TABLE users;
CREATE TABLE IF NOT EXISTS backup_coffees_${ts} AS TABLE coffees;
CREATE TABLE IF NOT EXISTS backup_magic_link_tokens_${ts} AS TABLE magic_link_tokens;
COMMIT;`;

await pool.query(sql);
await pool.end();
console.log("Backup erstellt. Suffix:", ts);
