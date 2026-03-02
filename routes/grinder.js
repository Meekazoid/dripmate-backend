// ==========================================
// GRINDER PREFERENCE ENDPOINTS (V5.2)
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries, VALID_GRINDERS } from '../db/database.js';

const router = express.Router();

/**
 * Get Grinder Preference
 * GET /api/user/grinder
 */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const grinder = await queries.getGrinderPreference(req.user.id);
        res.json({ success: true, grinder });
    } catch (error) {
        console.error('[ERROR] GET /user/grinder:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

/**
 * Update Grinder Preference
 * POST /api/user/grinder
 */
router.post('/', authenticateUser, async (req, res) => {
    try {
        const { grinder } = req.body;

        if (!grinder || !VALID_GRINDERS.includes(grinder)) {
            return res.status(400).json({
                success: false,
                error: `Valid grinder required. Options: ${VALID_GRINDERS.join(', ')}`
            });
        }

        await queries.updateGrinderPreference(req.user.id, grinder);
        console.log(`[OK] Grinder updated: ${req.user.username} -> ${grinder}`);
        res.json({ success: true, grinder });

    } catch (error) {
        console.error('[ERROR] POST /user/grinder:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
