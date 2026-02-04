// ==========================================
// BREWBUDDY DATABASE MODULE V2
// Mit Device-Binding Support
// ==========================================

import pg from 'pg';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

let db = null;
let dbType = null;

/**
 * Initialize database connection
 */
export async function initDatabase() {
    const isProduction = process.env.NODE_ENV === 'production';
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    
    if (isProduction && hasDatabaseUrl) {
        console.log('📊 Initializing PostgreSQL database...');
        dbType = 'postgresql';
        
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        
        try {
            await pool.query('SELECT NOW()');
            console.log('✅ PostgreSQL connection successful');
        } catch (err) {
            console.error('❌ PostgreSQL connection failed:', err.message);
            throw err;
        }
        
        db = {
            pool,
            async exec(sql) {
                const statements = sql.split(';').filter(s => s.trim());
                for (const statement of statements) {
                    if (statement.trim()) {
                        await pool.query(statement);
                    }
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
                return { 
                    lastID: result.rows[0]?.id, 
                    changes: result.rowCount 
                };
            }
        };
        
        await createPostgreSQLTables();
        console.log('✅ PostgreSQL database initialized');
        
    } else {
        console.log('📊 Initializing SQLite database...');
        dbType = 'sqlite';
        
        const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'brewbuddy.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        await createSQLiteTables();
        console.log('✅ SQLite database initialized:', dbPath);
    }
    
    return { db, dbType };
}

/**
 * Create PostgreSQL tables with device binding
 */
async function createPostgreSQLTables() {
    // Schritt 1: Tabellen erstellen
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            token TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS coffees (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
    
    // Schritt 2: Spalten hinzufügen (falls nicht vorhanden)
    try {
        await db.pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS device_id TEXT,
            ADD COLUMN IF NOT EXISTS device_info TEXT,
            ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
        `);
    } catch (err) {
        // Spalten existieren schon, das ist OK
        console.log('Note: device columns may already exist');
    }
    
    // Schritt 3: Indices erstellen (NACH den Spalten!)
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_coffees_user_id ON coffees(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
        CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
        CREATE INDEX IF NOT EXISTS idx_coffees_user_created ON coffees(user_id, created_at DESC);
    `);
}

/**
 * Create SQLite tables with device binding
 */
async function createSQLiteTables() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            token TEXT NOT NULL UNIQUE,
            device_id TEXT UNIQUE,
            device_info TEXT,
            last_login_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS coffees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_coffees_user_id ON coffees(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
        CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
        CREATE INDEX IF NOT EXISTS idx_coffees_user_created ON coffees(user_id, created_at DESC);
    `);
}

export function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

export function getDatabaseType() {
    return dbType;
}

export async function closeDatabase() {
    if (db && dbType === 'postgresql') {
        await db.pool.end();
        console.log('✅ PostgreSQL connection closed');
    } else if (db && dbType === 'sqlite') {
        await db.close();
        console.log('✅ SQLite connection closed');
    }
    db = null;
    dbType = null;
}

/**
 * Query helpers mit Device-Binding
 */
export const queries = {
    /**
     * Get user by token (prüft auch device_id)
     */
    async getUserByToken(token, deviceId = null) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            if (deviceId) {
                // Prüfe token UND device_id
                return db.get(
                    'SELECT id, username, device_id, created_at FROM users WHERE token = $1 AND device_id = $2', 
                    [token, deviceId]
                );
            } else {
                // Nur token prüfen (Legacy-Support)
                return db.get(
                    'SELECT id, username, device_id, created_at FROM users WHERE token = $1', 
                    [token]
                );
            }
        } else {
            if (deviceId) {
                return db.get(
                    'SELECT id, username, device_id, created_at FROM users WHERE token = ? AND device_id = ?', 
                    [token, deviceId]
                );
            } else {
                return db.get(
                    'SELECT id, username, device_id, created_at FROM users WHERE token = ?', 
                    [token]
                );
            }
        }
    },
    
    /**
     * Create new user mit device binding
     */
    async createUser(username, token, deviceId, deviceInfo) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            const result = await db.get(
                `INSERT INTO users (username, token, device_id, device_info, last_login_at) 
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
                 RETURNING id`,
                [username, token, deviceId, deviceInfo]
            );
            return result.id;
        } else {
            const result = await db.run(
                `INSERT INTO users (username, token, device_id, device_info, last_login_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [username, token, deviceId, deviceInfo]
            );
            return result.lastID;
        }
    },
    
    /**
     * Update last login time
     */
    async updateLastLogin(userId) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            await db.run(
                'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
                [userId]
            );
        } else {
            await db.run(
                'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
                [userId]
            );
        }
    },
    
    /**
     * Check if device is already registered
     */
    async deviceExists(deviceId) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            const result = await db.get(
                'SELECT id FROM users WHERE device_id = $1',
                [deviceId]
            );
            return !!result;
        } else {
            const result = await db.get(
                'SELECT id FROM users WHERE device_id = ?',
                [deviceId]
            );
            return !!result;
        }
    },
    
    /**
     * Bind device to user
     */
    async bindDevice(userId, deviceId, deviceInfo) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            await db.run(
                'UPDATE users SET device_id = $1, device_info = $2, last_login_at = CURRENT_TIMESTAMP WHERE id = $3',
                [deviceId, deviceInfo, userId]
            );
        } else {
            await db.run(
                'UPDATE users SET device_id = ?, device_info = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
                [deviceId, deviceInfo, userId]
            );
        }
    },
    
    async getUserCount() {
        const db = getDatabase();
        const result = await db.get('SELECT COUNT(*) as count FROM users');
        return result.count;
    },
    
    async usernameExists(username) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            const result = await db.get(
                'SELECT id FROM users WHERE LOWER(username) = LOWER($1)', 
                [username]
            );
            return !!result;
        } else {
            const result = await db.get(
                'SELECT id FROM users WHERE LOWER(username) = LOWER(?)', 
                [username]
            );
            return !!result;
        }
    },
    
    async getUserCoffees(userId) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            return db.all(
                'SELECT id, data, created_at FROM coffees WHERE user_id = $1 ORDER BY created_at DESC',
                [userId]
            );
        } else {
            return db.all(
                'SELECT id, data, created_at FROM coffees WHERE user_id = ? ORDER BY created_at DESC',
                [userId]
            );
        }
    },
    
    async saveCoffee(userId, data) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            const result = await db.get(
                'INSERT INTO coffees (user_id, data) VALUES ($1, $2) RETURNING id',
                [userId, data]
            );
            return result.id;
        } else {
            const result = await db.run(
                'INSERT INTO coffees (user_id, data) VALUES (?, ?)',
                [userId, data]
            );
            return result.lastID;
        }
    },
    
    async deleteUserCoffees(userId) {
        const db = getDatabase();
        if (dbType === 'postgresql') {
            await db.run('DELETE FROM coffees WHERE user_id = $1', [userId]);
        } else {
            await db.run('DELETE FROM coffees WHERE user_id = ?', [userId]);
        }
    }
};

export default {
    initDatabase,
    getDatabase,
    getDatabaseType,
    closeDatabase,
    queries
};
