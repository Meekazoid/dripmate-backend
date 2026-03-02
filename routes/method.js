// ==========================================
// METHOD PREFERENCE ENDPOINTS (V5.2)
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries, VALID_METHODS } from '../db/database.js';

const router = express.Router();

/**
 * Get Method Preference
 * GET /api/user/method
 */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const method = await queries.getMethodPreference(req.user.id);
        res.json({ success: true, method });
    } catch (error) {
        console.error('[ERROR] GET /user/method:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

/**
 * Update Method Preference
 * POST /api/user/method
 */
router.post('/', authenticateUser, async (req, res) => {
    try {
        const { method } = req.body;

        if (!method || !VALID_METHODS.includes(method)) {
            return res.status(400).json({
                success: false,
                error: `Valid method required. Options: ${VALID_METHODS.join(', ')}`
            });
        }

        await queries.updateMethodPreference(req.user.id, method);
        console.log(`[OK] Method updated: ${req.user.username} -> ${method}`);
        res.json({ success: true, method });

    } catch (error) {
        console.error('[ERROR] POST /user/method:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
