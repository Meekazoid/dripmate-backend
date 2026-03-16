// ==========================================
// DRIPMATE DATABASE MODULE V5.2
// Device-Binding + Grinder Variants (8) + Method Preference + Water Hardness
// ==========================================

import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

// Internal DB instance and dialect tracker.
// Named _db to avoid shadowing the local `conn` variable used throughout queries.
let _db    = null;
let dbType = null;

// ==========================================
// VALID VALUES (exported for route validation)
// ==========================================

const VALID_GRINDERS = [
    'comandante_mk4', 'comandante_mk3',
    'fellow_gen2',    'fellow_gen1',
    'timemore_s3',    'timemore_c2',
    '1zpresso',       'baratza',
];

const VALID_METHODS = ['v60', 'chemex', 'aeropress'];

// ==========================================
// DIALECT HELPER
// ==========================================

/**
 * Execute a SQL query against the active database.
 *
 * Accepts SQL written with PostgreSQL-style placeholders ($1, $2, ...).
 * When the active dialect is SQLite, placeholders are auto-rewritten to ?.
 * This eliminates the need for duplicate SQL strings in every query.
 *
 * @param {'get'|'all'|'run'} method
 * @param {string} pgSql   - SQL with $1/$2/... placeholders
 * @param {Array}  [params=[]]
 */
function q(method, pgSql, params = []) {
    const conn = getDatabase();
    if (dbType === 'postgresql') {
        return conn[method](pgSql, params);
    } else {
        const sqliteSql = pgSql.replace(/\$\d+/g, '?');
        return conn[method](sqliteSql, params);
    }
}

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

/**
 * Initialize the database connection and run all schema migrations.
 * Uses PostgreSQL when NODE_ENV=production and DATABASE_URL is set.
 * Falls back to SQLite for local development.
 */
export async function initDatabase() {
    const isProduction   = process.env.NODE_ENV === 'production';
    const hasDatabaseUrl = !!process.env.DATABASE_URL;

    if (isProduction && hasDatabaseUrl) {
        console.log('[DB] Initializing PostgreSQL...');
        dbType = 'postgresql';

        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        try {
            await pool.query('SELECT NOW()');
            console.log('[DB] PostgreSQL connection successful');

            const dbInfo = await pool.query('SELECT current_database() AS database, current_schema() AS schema');
            if (dbInfo.rows[0]) {
                console.log(`[DB] Connected DB context: database=${dbInfo.rows[0].database}, schema=${dbInfo.rows[0].schema}`);
            }
        } catch (err) {
            console.error('[DB] PostgreSQL connection failed:', err.message);
            throw err;
        }

        // Wrap pg Pool in a unified interface matching the SQLite API shape
        _db = {
            pool,
            async exec(sql) {
                const statements = sql.split(';').filter(s => s.trim());
                for (const statement of statements) {
                    if (statement.trim()) await pool.query(statement);
                }
            },
            async get(sql, params = []) {
                const result = await pool.query(sql, params);
                return result.rows[0] || null;
            },
            async all(sql, params = []) {
                const result = await pool.query(sql, params);
                return result.rows;
            },
            async run(sql, params = []) {
                const result = await pool.query(sql, params);
                return { lastID: result.rows[0]?.id, changes: result.rowCount };
            }
        };

        await runPostgreSQLMigrations();
        console.log('[DB] PostgreSQL ready');

    } else {
        console.log('[DB] Initializing SQLite...');
        dbType = 'sqlite';

        let sqlite3, sqliteOpen;
        try {
            sqlite3    = (await import('sqlite3')).default;
            sqliteOpen = (await import('sqlite')).open;
        } catch (e) {
            console.error('[DB] sqlite3 not found. Run: npm install sqlite3 sqlite');
            console.error('     Error:', e.message);
            throw e;
        }

        const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'dripmate.db');
        _db = await sqliteOpen({ filename: dbPath, driver: sqlite3.Database });

        await runSQLiteMigrations();
        console.log('[DB] SQLite ready:', dbPath);
    }

    // --- NEU: Automatische Migration aller alten JSON Blobs auf das kanonische Schema ---
    await migrateCoffeeJSONBlobs();

    return { db: _db, dbType };
}

/**
 * One-time migration to ensure all JSON blobs in the database use the canonical schema.
 * Tolerant & idempotent.
 */
async function migrateCoffeeJSONBlobs() {
    const conn = getDatabase();
    console.log('[DB] Running JSON canonical schema migration...');
    const coffees = await q('all', 'SELECT id, data FROM coffees');
    let updated = 0;

    for (const row of coffees) {
        try {
            const data = JSON.parse(row.data);
            let changed = false;

            if (data.coffee_name !== undefined) { data.name = data.name || data.coffee_name; delete data.coffee_name; changed = true; }
            if (data.roaster !== undefined) { data.roastery = data.roastery || data.roaster; delete data.roaster; changed = true; }
            if (data.variety !== undefined) { data.cultivar = data.cultivar || data.variety; delete data.variety; changed = true; }
            if (data.tasting_notes !== undefined) { data.tastingNotes = data.tastingNotes || data.tasting_notes; delete data.tasting_notes; changed = true; }
            if (data.color_tag !== undefined) { data.colorTag = data.colorTag || data.color_tag; delete data.color_tag; changed = true; }

            if (changed) {
                await q('run', 'UPDATE coffees SET data = $1 WHERE id = $2', [JSON.stringify(data), row.id]);
                updated++;
            }
        } catch (e) {
            console.error(`[DB] Failed to migrate coffee JSON for ID ${row.id}:`, e.message);
        }
    }

    if (updated > 0) {
        console.log(`[DB] Migrated ${updated} coffee records to the canonical schema.`);
    } else {
        console.log('[DB] All coffee records are already in the canonical schema.');
    }
}

// ==========================================
// POSTGRESQL MIGRATIONS
// ==========================================

/**
 * Idempotent schema setup for PostgreSQL.
 * Safe to run on every startup - all steps use IF NOT EXISTS.
 */
async function runPostgreSQLMigrations() {
    const conn = getDatabase();

    // Step 1: Core tables
    await conn.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id         SERIAL PRIMARY KEY,
            username   TEXT NOT NULL UNIQUE,
            token      TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS coffees (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            coffee_uid TEXT NOT NULL,
            data       TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, coffee_uid)
        );
    `);

    // Step 2: Add user columns introduced after V4 (idempotent via IF NOT EXISTS)
    try {
        await conn.pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS device_id          TEXT,
            ADD COLUMN IF NOT EXISTS device_info        TEXT,
            ADD COLUMN IF NOT EXISTS last_login_at      TIMESTAMP,
            ADD COLUMN IF NOT EXISTS grinder_preference TEXT DEFAULT 'fellow',
            ADD COLUMN IF NOT EXISTS water_hardness     DECIMAL(4,1) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS method_preference  VARCHAR(20) DEFAULT 'v60';
        `);
    } catch (err) {
        console.log('[DB] Note: user columns may already exist');
    }

    // Step 3: Add coffees.method column (per-coffee brew method override)
    try {
        await conn.pool.query(`ALTER TABLE coffees ADD COLUMN IF NOT EXISTS method VARCHAR(20) DEFAULT 'v60';`);
    } catch (err) {
        console.log('[DB] Note: coffees.method may already exist');
    }

    // Step 4: Add stable coffee_uid for idempotent upserts
    try {
        await conn.pool.query(`ALTER TABLE coffees ADD COLUMN IF NOT EXISTS coffee_uid TEXT;`);
        await conn.pool.query(`UPDATE coffees SET coffee_uid = id::text WHERE coffee_uid IS NULL OR coffee_uid = '';`);
        await conn.pool.query(`ALTER TABLE coffees ALTER COLUMN coffee_uid SET NOT NULL;`);
        await conn.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coffees_user_uid ON coffees(user_id, coffee_uid);`);
    } catch (err) {
        console.log('[DB] Note: coffees.coffee_uid migration may already exist');
    }

    // Step 5: Migrate legacy unversioned grinder keys to versioned equivalents
    try {
        const grinderMigrations = [
            { old: 'fellow',     new: 'fellow_gen2'    },
            { old: 'comandante', new: 'comandante_mk3' },
            { old: 'timemore',   new: 'timemore_s3'    },
        ];
        for (const { old: oldKey, new: newKey } of grinderMigrations) {
            const result = await conn.pool.query(
                `UPDATE users SET grinder_preference = $1 WHERE grinder_preference = $2`,
                [newKey, oldKey]
            );
            if (result.rowCount > 0) {
                console.log(`[DB] Migrated ${result.rowCount} user(s): grinder ${oldKey} -> ${newKey}`);
            }
        }
    } catch (err) {
        console.log('[DB] Note: grinder key migration may have already run');
    }

    // Step 6: Indexes (must run after all column additions)
    await conn.exec(`
        CREATE INDEX IF NOT EXISTS idx_coffees_user_id      ON coffees(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_token          ON users(token);
        CREATE INDEX IF NOT EXISTS idx_users_device_id      ON users(device_id);
        CREATE INDEX IF NOT EXISTS idx_coffees_user_created ON coffees(user_id, created_at DESC);
    `);

    // Step 7: Beta access tables
    await conn.pool.query(`
        CREATE TABLE IF NOT EXISTS whitelist (
            id       SERIAL PRIMARY KEY,
            email    TEXT NOT NULL UNIQUE,
            name     TEXT DEFAULT '',
            website  TEXT DEFAULT '',
            note     TEXT DEFAULT '',
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registrations (
            id         SERIAL PRIMARY KEY,
            email      TEXT NOT NULL UNIQUE,
            token      TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used       BOOLEAN DEFAULT FALSE
        );
    `);
    console.log('[DB] Whitelist & registrations tables ready');
    // Step 8: Email column for magic link recovery
    try {
        await conn.pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
        await conn.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`);
        console.log('[DB] users.email column ready');
    } catch (err) {
        console.log('[DB] Note: users.email may already exist');
    }

    // Step 9: Magic link tokens table
    try {
        await conn.pool.query(`
            CREATE TABLE IF NOT EXISTS magic_link_tokens (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token      TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                used       BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await conn.pool.query(`CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_link_tokens(token)`);
        console.log('[DB] magic_link_tokens table ready');
    } catch (err) {
        console.log('[DB] Note: magic_link_tokens may already exist');
    }


    // Step 10: Per-user successful AI scan usage (daily quota)
    try {
        await conn.pool.query(`
            CREATE TABLE IF NOT EXISTS ai_scan_usage_daily (
                id            SERIAL PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                usage_date    DATE NOT NULL,
                success_count INTEGER NOT NULL DEFAULT 0,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, usage_date)
            )
        `);
        await conn.pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_scan_usage_user_date ON ai_scan_usage_daily(user_id, usage_date)`);
        console.log('[DB] ai_scan_usage_daily table ready');
    } catch (err) {
        console.log('[DB] Note: ai_scan_usage_daily may already exist');
    }
}

// ==========================================
// SQLITE MIGRATIONS
// ==========================================

/**
 * Idempotent schema setup for SQLite.
 * Fresh install: all columns included from the start.
 * V4 upgrade: ALTER TABLE adds missing columns gracefully.
 */
async function runSQLiteMigrations() {
    const conn = getDatabase();

    // Step 1: Core tables with all current columns
    await conn.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            username            TEXT NOT NULL UNIQUE,
            token               TEXT NOT NULL UNIQUE,
            device_id           TEXT UNIQUE,
            device_info         TEXT,
            last_login_at       DATETIME,
            grinder_preference  TEXT DEFAULT 'fellow_gen2',
            water_hardness      REAL DEFAULT NULL,
            method_preference   TEXT DEFAULT 'v60',
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS coffees (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            coffee_uid TEXT NOT NULL,
            data       TEXT NOT NULL,
            method     TEXT DEFAULT 'v60',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, coffee_uid)
        );

        CREATE INDEX IF NOT EXISTS idx_coffees_user_id      ON coffees(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_token          ON users(token);
        CREATE INDEX IF NOT EXISTS idx_users_device_id      ON users(device_id);
        CREATE INDEX IF NOT EXISTS idx_coffees_user_created ON coffees(user_id, created_at DESC);
    `);

    // Step 2: V4 -> V5 column migrations (silently ignored on fresh installs)
    const alterations = [
        `ALTER TABLE users   ADD COLUMN method_preference TEXT DEFAULT 'v60'`,
        `ALTER TABLE coffees ADD COLUMN method TEXT DEFAULT 'v60'`,
        `ALTER TABLE coffees ADD COLUMN coffee_uid TEXT`,
    ];
    for (const sql of alterations) {
        try { await conn.run(sql); } catch (_) { /* column already exists */ }
    }

    // Step 3: Back-fill coffee_uid from row id for any existing rows
    try {
        await conn.run(`UPDATE coffees SET coffee_uid = CAST(id AS TEXT) WHERE coffee_uid IS NULL OR coffee_uid = ''`);
    } catch (_) { /* ignore */ }

    try {
        await conn.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coffees_user_uid ON coffees(user_id, coffee_uid)`);
    } catch (_) { /* already exists */ }

    // Step 4: Migrate legacy unversioned grinder keys to versioned equivalents
    const grinderMigrations = [
        { old: 'fellow',     new: 'fellow_gen2'    },
        { old: 'comandante', new: 'comandante_mk3' },
        { old: 'timemore',   new: 'timemore_s3'    },
    ];
    for (const { old: oldKey, new: newKey } of grinderMigrations) {
        try {
            await conn.run(`UPDATE users SET grinder_preference = ? WHERE grinder_preference = ?`, [newKey, oldKey]);
        } catch (_) { /* ignore */ }
    }

    // Step 5: Beta access tables
    await conn.exec(`
        CREATE TABLE IF NOT EXISTS whitelist (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            email    TEXT NOT NULL UNIQUE,
            name     TEXT DEFAULT '',
            website  TEXT DEFAULT '',
            note     TEXT DEFAULT '',
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registrations (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            email      TEXT NOT NULL UNIQUE,
            token      TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            used       INTEGER DEFAULT 0
        );
    `);
    console.log('[DB] Whitelist & registrations tables ready');
    // Step 8: Email column for magic link recovery
    try {
        await conn.run("ALTER TABLE users ADD COLUMN email TEXT").catch(() => {});
    } catch (err) {
        // column already exists - ignore
    }

    // Step 9: Magic link tokens table
    try {
        await conn.exec(`CREATE TABLE IF NOT EXISTS magic_link_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        await conn.run(`CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_link_tokens(token)`).catch(() => {});
        console.log('[DB] magic_link_tokens table ready');
    } catch (_) {
        // already exists
    }


    // Step 10: Per-user successful AI scan usage (daily quota)
    try {
        await conn.exec(`
            CREATE TABLE IF NOT EXISTS ai_scan_usage_daily (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                usage_date    TEXT NOT NULL,
                success_count INTEGER NOT NULL DEFAULT 0,
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, usage_date)
            )
        `);
        await conn.run(`CREATE INDEX IF NOT EXISTS idx_ai_scan_usage_user_date ON ai_scan_usage_daily(user_id, usage_date)`).catch(() => {});
        console.log('[DB] ai_scan_usage_daily table ready');
    } catch (_) {
        // already exists
    }
}

// ==========================================
// ACCESSORS
// ==========================================

export function getDatabase() {
    if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
    return _db;
}

export function getDatabaseType() {
    return dbType;
}

// ==========================================
// TRANSACTIONS
// ==========================================

export async function beginTransaction() {
    const conn = getDatabase();
    if (dbType === 'postgresql') {
        await conn.pool.query('BEGIN');
    } else {
        await conn.exec('BEGIN TRANSACTION');
    }
}

export async function commit() {
    const conn = getDatabase();
    if (dbType === 'postgresql') {
        await conn.pool.query('COMMIT');
    } else {
        await conn.exec('COMMIT');
    }
}

export async function rollback() {
    const conn = getDatabase();
    if (dbType === 'postgresql') {
        await conn.pool.query('ROLLBACK');
    } else {
        await conn.exec('ROLLBACK');
    }
}

export async function closeDatabase() {
    if (_db && dbType === 'postgresql') {
        await _db.pool.end();
        console.log('[DB] PostgreSQL connection closed');
    } else if (_db && dbType === 'sqlite') {
        await _db.close();
        console.log('[DB] SQLite connection closed');
    }
    _db    = null;
    dbType = null;
}


// ==========================================
// QUERY HELPERS
// ==========================================

export const queries = {

    // ------------------------------------------
    // USER QUERIES
    // ------------------------------------------

    async getUserByToken(token, deviceId = null) {
        const sql = `
            SELECT id, username, email, device_id, grinder_preference, method_preference, water_hardness, created_at
            FROM users
            WHERE token = $1
            ${deviceId ? 'AND device_id = $2' : ''}
        `;
        return q('get', sql, deviceId ? [token, deviceId] : [token]);
    },

    async createUser(username, token, deviceId = null, deviceInfo = null) {
        if (dbType === 'postgresql') {
            const result = await q('get',
                `INSERT INTO users (username, token, device_id, device_info, grinder_preference, method_preference, last_login_at)
                 VALUES ($1, $2, $3, $4, 'fellow_gen2', 'v60', CURRENT_TIMESTAMP)
                 RETURNING id`,
                [username, token, deviceId, deviceInfo]
            );
            return result.id;
        } else {
            const result = await q('run',
                `INSERT INTO users (username, token, device_id, device_info, grinder_preference, method_preference, last_login_at)
                 VALUES ($1, $2, $3, $4, 'fellow_gen2', 'v60', CURRENT_TIMESTAMP)`,
                [username, token, deviceId, deviceInfo]
            );
            return result.lastID;
        }
    },

    async bindDevice(userId, deviceId, deviceInfo) {
        return q('run',
            `UPDATE users SET device_id = $1, device_info = $2, last_login_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [deviceId, deviceInfo, userId]
        );
    },

    async updateLastLogin(userId) {
        return q('run', `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`, [userId]);
    },

    // NOTE: Not currently called by any route, but kept for future use.
    async deviceExists(deviceId) {
        const result = await q('get', `SELECT id FROM users WHERE device_id = $1`, [deviceId]);
        return !!result;
    },

    async getUserCount() {
        const result = await q('get', `SELECT COUNT(*) as count FROM users`);
        return result.count;
    },

    async usernameExists(username) {
        const result = await q('get', `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
        return !!result;
    },

    // ------------------------------------------
    // PREFERENCE QUERIES
    // ------------------------------------------

    async getGrinderPreference(userId) {
        const result = await q('get', `SELECT grinder_preference FROM users WHERE id = $1`, [userId]);
        return result?.grinder_preference || 'fellow_gen2';
    },

    async updateGrinderPreference(userId, grinder) {
        if (!VALID_GRINDERS.includes(grinder)) throw new Error(`Invalid grinder: ${grinder}`);
        return q('run', `UPDATE users SET grinder_preference = $1 WHERE id = $2`, [grinder, userId]);
    },

    async getMethodPreference(userId) {
        const result = await q('get', `SELECT method_preference FROM users WHERE id = $1`, [userId]);
        return result?.method_preference || 'v60';
    },

    async updateMethodPreference(userId, method) {
        if (!VALID_METHODS.includes(method)) throw new Error(`Invalid method: ${method}`);
        return q('run', `UPDATE users SET method_preference = $1 WHERE id = $2`, [method, userId]);
    },

    async getWaterHardness(userId) {
        const result = await q('get', `SELECT water_hardness FROM users WHERE id = $1`, [userId]);
        return result?.water_hardness ?? null;
    },

    async updateWaterHardness(userId, waterHardness) {
        return q('run', `UPDATE users SET water_hardness = $1 WHERE id = $2`, [waterHardness, userId]);
    },

    // ------------------------------------------
    // COFFEE QUERIES
    // ------------------------------------------

    async getUserCoffees(userId) {
        return q('all',
            `SELECT id, coffee_uid, data, method, created_at FROM coffees WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId]
        );
    },

    async saveCoffee(userId, coffeeUid, data, method = 'v60') {
        if (dbType === 'postgresql') {
            const result = await q('get',
                `INSERT INTO coffees (user_id, coffee_uid, data, method)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT(user_id, coffee_uid)
                 DO UPDATE SET data = EXCLUDED.data, method = EXCLUDED.method, created_at = CURRENT_TIMESTAMP
                 RETURNING id`,
                [userId, coffeeUid, data, method]
            );
            return result.id;
        } else {
            const result = await q('run',
                `INSERT INTO coffees (user_id, coffee_uid, data, method)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT(user_id, coffee_uid)
                 DO UPDATE SET data = excluded.data, method = excluded.method, created_at = CURRENT_TIMESTAMP`,
                [userId, coffeeUid, data, method]
            );
            return result.lastID;
        }
    },

    async replaceUserCoffees(userId, keepCoffeeUids = []) {
        if (!Array.isArray(keepCoffeeUids) || keepCoffeeUids.length === 0) {
            return q('run', `DELETE FROM coffees WHERE user_id = $1`, [userId]);
        }
        if (dbType === 'postgresql') {
            return q('run',
                `DELETE FROM coffees WHERE user_id = $1 AND coffee_uid <> ALL($2::text[])`,
                [userId, keepCoffeeUids]
            );
        } else {
            const conn         = getDatabase();
            const placeholders = keepCoffeeUids.map(() => '?').join(', ');
            return conn.run(
                `DELETE FROM coffees WHERE user_id = ? AND coffee_uid NOT IN (${placeholders})`,
                [userId, ...keepCoffeeUids]
            );
        }
    },

    async deleteUserCoffees(userId) {
        return q('run', `DELETE FROM coffees WHERE user_id = $1`, [userId]);
    },

    // ------------------------------------------
    // REGISTRATION QUERIES
    // ------------------------------------------

    async getRegistrationByToken(token) {
        return q('get', `SELECT * FROM registrations WHERE token = $1`, [token]);
    },

    async markRegistrationUsed(token) {
        if (dbType === 'postgresql') {
            return q('run', `UPDATE registrations SET used = true WHERE token = $1`, [token]);
        } else {
            return q('run', `UPDATE registrations SET used = 1 WHERE token = $1`, [token]);
        }
    },

    // ---- Email & Magic Link Recovery ----

    async setUserEmail(userId, email) {
        return q('run', 'UPDATE users SET email = $1 WHERE id = $2', [email.toLowerCase().trim(), userId]);
    },

    async getUserByEmail(email) {
        return q('get', 'SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    },

    async createMagicLinkToken(userId, token, expiresAt) {
        return q('run', 'INSERT INTO magic_link_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, token, expiresAt]);
    },

    async getMagicLinkToken(token) {
        const timeCheck = dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
        return q('get',
            "SELECT mlt.*, u.token as user_token FROM magic_link_tokens mlt JOIN users u ON u.id = mlt.user_id WHERE mlt.token = $1 AND mlt.used = false AND mlt.expires_at > " + timeCheck,
            [token]
        );
    },

    async markMagicLinkUsed(token) {
        return q('run', 'UPDATE magic_link_tokens SET used = true WHERE token = $1', [token]);
    },
    async getRecentMagicLinkToken(userId, seconds) {
        const cutoff = new Date(Date.now() - seconds * 1000).toISOString();
        return q('get', 'SELECT id FROM magic_link_tokens WHERE user_id = $1 AND created_at > $2 ORDER BY created_at DESC LIMIT 1', [userId, cutoff]);
    },

    async getSuccessfulScansToday(userId) {
        const row = await q('get',
            "SELECT success_count FROM ai_scan_usage_daily WHERE user_id = $1 AND usage_date = " + (dbType === 'sqlite' ? "date('now')" : 'CURRENT_DATE'),
            [userId]
        );
        return row?.success_count || 0;
    },

    async incrementSuccessfulScansToday(userId) {
        if (dbType === 'postgresql') {
            await q('run',
                `INSERT INTO ai_scan_usage_daily (user_id, usage_date, success_count, updated_at)
                 VALUES ($1, CURRENT_DATE, 1, CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, usage_date)
                 DO UPDATE SET
                   success_count = ai_scan_usage_daily.success_count + 1,
                   updated_at = CURRENT_TIMESTAMP`,
                [userId]
            );
            return;
        }

        await q('run',
            `INSERT INTO ai_scan_usage_daily (user_id, usage_date, success_count, updated_at)
             VALUES ($1, date('now'), 1, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, usage_date)
             DO UPDATE SET
               success_count = success_count + 1,
               updated_at = CURRENT_TIMESTAMP`,
            [userId]
        );
    },

    async rebindDevice(userId, deviceId, deviceInfo) {
        return q('run',
            'UPDATE users SET device_id = $1, device_info = $2, last_login_at = CURRENT_TIMESTAMP WHERE id = $3',
            [deviceId, deviceInfo, userId]
        );
    },

    async isEmailWhitelisted(email) {
        const result = await q('get', `SELECT id FROM whitelist WHERE email = $1`, [email]);
        return !!result;
    },

    async getRegistrationByEmail(email) {
        return q('get', `SELECT token, used FROM registrations WHERE email = $1`, [email]);
    },

    async registrationTokenExists(token) {
        const result = await q('get', `SELECT id FROM registrations WHERE token = $1`, [token]);
        return !!result;
    },

    async createRegistration(email, token) {
        return q('run', `INSERT INTO registrations (email, token) VALUES ($1, $2)`, [email, token]);
    },

    // ------------------------------------------
    // ADMIN QUERIES
    // ------------------------------------------

    async getWhitelistWithStatus() {
        const conn = getDatabase();
        return conn.all(`
            SELECT
                w.id,
                w.email,
                w.name,
                w.website,
                w.note,
                w.added_at,
                r.token,
                CASE
                    WHEN u.id IS NOT NULL THEN 'registered'
                    WHEN r.token IS NOT NULL THEN 'sent'
                    ELSE 'invited'
                END AS status
            FROM whitelist w
            LEFT JOIN registrations r ON r.email = w.email
            LEFT JOIN users u ON u.token = r.token AND u.device_id IS NOT NULL
            ORDER BY w.added_at DESC
        `);
    },

    async addToWhitelist(email, name, website, note) {
        const normalizedEmail = email.toLowerCase().trim();
        if (dbType === 'postgresql') {
            const result = await q('get',
                `INSERT INTO whitelist (email, name, website, note)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (email) DO NOTHING
                 RETURNING id`,
                [normalizedEmail, name, website, note]
            );
            return result?.id ?? null;
        } else {
            const existing = await q('get', `SELECT id FROM whitelist WHERE email = $1`, [normalizedEmail]);
            if (existing) return null;
            const result = await q('run',
                `INSERT INTO whitelist (email, name, website, note) VALUES ($1, $2, $3, $4)`,
                [normalizedEmail, name, website, note]
            );
            return result.lastID;
        }
    },

    async updateWhitelistEntry(id, updates) {
        const conn = getDatabase();
        if (dbType === 'postgresql') {
            const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
            const values     = [...Object.values(updates), id];
            await conn.run(`UPDATE whitelist SET ${setClauses} WHERE id = $${values.length}`, values);
        } else {
            const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            const values     = [...Object.values(updates), id];
            await conn.run(`UPDATE whitelist SET ${setClauses} WHERE id = ?`, values);
        }
    },

    async removeFromWhitelist(id) {
        return q('run', `DELETE FROM whitelist WHERE id = $1`, [id]);
    }
};

// ==========================================
// EXPORTS
// ==========================================

export { VALID_GRINDERS, VALID_METHODS };

export default {
    initDatabase,
    getDatabase,
    getDatabaseType,
    closeDatabase,
    beginTransaction,
    commit,
    rollback,
    queries,
    VALID_GRINDERS,
    VALID_METHODS
};
