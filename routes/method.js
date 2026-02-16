// ==========================================
// METHOD PREFERENCE ENDPOINTS (V5.2 — NEW)
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries, VALID_METHODS } from '../db/database.js';

const router = express.Router();

/**
 * Get Method Preference
 * GET /
 */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const method = await queries.getMethodPreference(req.user.id);

        res.json({ 
            success: true, 
            method: method 
        });

    } catch (error) {
        console.error('Get method error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
});

/**
 * Update Method Preference
 * POST /
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

        console.log(`☕ Method updated: ${req.user.username} → ${method}`);

        res.json({ 
            success: true,
            method: method
        });

    } catch (error) {
        console.error('Update method error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
});

export default router;
