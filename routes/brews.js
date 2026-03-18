// ==========================================
// BREW PARTIAL UPDATE ENDPOINT
// PATCH /api/brews/:id  — Card Editor inline edits
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries } from '../db/database.js';
import { sanitizeCoffeeData } from '../utils/sanitize.js';

const router = express.Router();

/**
 * Partial update a coffee card.
 *
 * V5.4: Rewrote from O(n) full-rewrite (load all → delete all → re-insert all)
 * to O(1) direct update via getCoffeeByUid + updateCoffeeByUid.
 * No transaction needed — it's a single atomic UPDATE statement.
 */
router.patch('/:id', authenticateUser, async (req, res) => {
    try {
        const { id }  = req.params;
        const userId  = req.user.id;
        const updates = req.body;

        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        // 1. Load only the target coffee — O(1) instead of loading all coffees
        const row = await queries.getCoffeeByUid(userId, id);

        if (!row) {
            return res.status(404).json({
                success: false,
                error: 'Coffee not found'
            });
        }

        // 2. Parse existing data and merge with updates
        const existing = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        const merged = { ...existing, ...updates };

        // 3. Sanitize the merged object
        const finalCoffeeData = sanitizeCoffeeData(merged);

        // 4. Direct single-row update — O(1) instead of delete-all + re-insert-all
        const method = updates.method || row.method || 'v60';
        await queries.updateCoffeeByUid(userId, id, JSON.stringify(finalCoffeeData), method);

        console.log(`[OK] PATCH /api/brews/${id} updated successfully (user: ${req.user.username})`);

        res.json({
            success: true,
            coffee: finalCoffeeData
        });

    } catch (error) {
        console.error('[ERROR] PATCH /api/brews/:id:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

export default router;
