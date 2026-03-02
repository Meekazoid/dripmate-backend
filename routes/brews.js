// ==========================================
// BREW PARTIAL UPDATE ENDPOINT
// PATCH /api/brews/:id  — Card Editor inline edits
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries, beginTransaction, commit, rollback } from '../db/database.js';
import { stripHTML, truncateString } from '../utils/sanitize.js';

const router = express.Router();

/**
 * Partial update a coffee card (name, origin, roastery).
 *
 * Loads the user's full coffee array, finds the target by its coffee_uid (the
 * stable ID stored in the DB row), applies the sanitized field updates, then
 * rewrites the entire array atomically inside a transaction.
 *
 * Returns the updated coffee object on success.
 */
router.patch('/:id', authenticateUser, async (req, res) => {
    try {
        const { id }  = req.params;
        const userId  = req.user.id;
        const updates = req.body;

        // Only allow specific fields to be patched
        const allowedFields    = ['coffee_name', 'origin', 'roastery'];
        const sanitizedUpdates = {};

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                const value = String(updates[field]).trim();
                sanitizedUpdates[field] = truncateString(stripHTML(value), 200);
            }
        }

        if (Object.keys(sanitizedUpdates).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        // Load all of the user's coffees from the DB
        const userCoffees = await queries.getUserCoffees(userId);

        if (!userCoffees || userCoffees.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No coffees found for user'
            });
        }

        // Parse rows and locate the target coffee by its stable coffee_uid
        let coffeeIndex = -1;
        const parsedCoffees = userCoffees.map((row, idx) => {
            const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

            // Attach the stable uid and timestamp so we can re-save correctly
            const entry = { ...data, _uid: row.coffee_uid, _method: row.method };

            if (String(row.coffee_uid) === String(id) || String(idx) === String(id)) {
                coffeeIndex = idx;
            }

            return entry;
        });

        if (coffeeIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Coffee not found'
            });
        }

        // Apply the sanitized field updates
        // coffee_name maps to the internal `name` field in the stored data model
        const coffee = parsedCoffees[coffeeIndex];

        if (sanitizedUpdates.coffee_name !== undefined) coffee.name     = sanitizedUpdates.coffee_name;
        if (sanitizedUpdates.origin      !== undefined) coffee.origin   = sanitizedUpdates.origin;
        if (sanitizedUpdates.roastery    !== undefined) coffee.roastery = sanitizedUpdates.roastery;

        // Atomically rewrite the full coffee array
        await beginTransaction();
        try {
            await queries.deleteUserCoffees(userId);

            for (const c of parsedCoffees) {
                // Strip the runtime-only tracking fields before saving back to DB
                const { _uid, _method, ...dataToSave } = c;
                await queries.saveCoffee(userId, _uid, JSON.stringify(dataToSave), _method || 'v60');
            }

            await commit();
        } catch (txError) {
            await rollback();
            throw txError;
        }

        console.log(`[OK] PATCH /api/brews/${id} updated: ${Object.keys(sanitizedUpdates).join(', ')} (user: ${req.user.username})`);

        // Return the updated coffee without the internal tracking fields
        const { _uid: _, _method: __, ...responseData } = coffee;
        res.json({
            success: true,
            coffee: responseData
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
