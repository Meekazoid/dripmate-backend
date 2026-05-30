// ==========================================
// ADMIN ROUTES — Whitelist Management
// ==========================================

import express from 'express';
import crypto from 'crypto';
import { queries } from '../db/database.js';

const router = express.Router();

// ==========================================
// SESSION TOKEN STORE
// ==========================================

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const sessions = new Map(); // token → expiresAt

function createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
}

function isValidSession(token) {
    if (!token) return false;
    const expiresAt = sessions.get(token);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
        sessions.delete(token);
        return false;
    }
    return true;
}

// ==========================================
// ADMIN AUTH MIDDLEWARE
// ==========================================

function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (isValidSession(token)) return next();

    // Fallback: direct password header for backwards compatibility
    const pw = req.headers['x-admin-password'];
    if (pw && pw === process.env.ADMIN_PASSWORD) return next();

    return res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ==========================================
// POST /api/admin/login
// ==========================================

router.post('/login', (req, res) => {
    const { password } = req.body;
    if (!password || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const token = createSession();
    res.json({ success: true, token });
});

// ==========================================
// GET /api/admin/whitelist
// List all whitelist entries with their registration + activation status.
// ==========================================

router.get('/whitelist', adminAuth, async (req, res) => {
    try {
        const entries = await queries.getWhitelistWithStatus();
        res.json({ success: true, entries });
    } catch (err) {
        console.error('[ERROR] GET /admin/whitelist:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ==========================================
// POST /api/admin/whitelist
// Add a new email to the beta whitelist.
// ==========================================

router.post('/whitelist', adminAuth, async (req, res) => {
    const { email, name = '', website = '', note = '' } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    try {
        const id = await queries.addToWhitelist(email, name, website, note);

        if (id === null) {
            return res.status(409).json({ success: false, error: 'Email is already on the whitelist' });
        }

        console.log(`[OK] Whitelist: added ${email}`);
        res.json({ success: true, id });

    } catch (err) {
        console.error('[ERROR] POST /admin/whitelist:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ==========================================
// PATCH /api/admin/whitelist/:id
// Update name, website, or note for a whitelist entry.
// ==========================================

router.patch('/whitelist/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const allowed = ['name', 'website', 'note'];
    const updates = {};

    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    try {
        await queries.updateWhitelistEntry(id, updates);
        res.json({ success: true });
    } catch (err) {
        console.error('[ERROR] PATCH /admin/whitelist/:id:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ==========================================
// DELETE /api/admin/whitelist/:id
// Remove an entry from the whitelist.
// ==========================================

router.delete('/whitelist/:id', adminAuth, async (req, res) => {
    const { id } = req.params;

    try {
        await queries.removeFromWhitelist(id);
        console.log(`[OK] Whitelist: removed entry ${id}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[ERROR] DELETE /admin/whitelist/:id:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
