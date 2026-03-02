// ==========================================
// ADMIN ROUTES — Whitelist Management
// ==========================================

import express from 'express';
import { queries } from '../db/database.js';

const router = express.Router();

// ==========================================
// ADMIN AUTH MIDDLEWARE
// ==========================================

/**
 * Simple password-based admin guard.
 * Reads the ADMIN_PASSWORD env var and compares it against the X-Admin-Password header.
 * All admin routes are internal-use only — no user-facing access.
 */
function adminAuth(req, res, next) {
    const pw = req.headers['x-admin-password'];
    if (!pw || pw !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

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
