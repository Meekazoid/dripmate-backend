// ==========================================
// BREW PARTIAL UPDATE ENDPOINT
// PATCH /api/brews/:id – Card Editor inline edits
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries } from '../db/database.js';
import { stripHTML, truncateString } from '../utils/sanitize.js';

const router = express.Router();

/**
 * Partial Update a Coffee (Brew)
 * PATCH /:id
 * 
 * Accepts partial updates for coffee_name, origin, roastery.
 * Sanitizes input, applies to the matching coffee in the user's array,
 * and saves the full array back (reuses existing transaction-safe storage).
 * 
 * Returns the updated coffee object on success.
 */
router.patch('/:id', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const updates = req.body;

        // Only allow specific fields to be patched
        const allowedFields = ['coffee_name', 'origin', 'roastery'];
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

        // Load user's coffees
        const userCoffees = await queries.getUserCoffees(userId);

        if (!userCoffees || userCoffees.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'No coffees found for user' 
            });
        }

        // Parse all coffees and find the target by id, savedAt, or array index
        let coffeeIndex = -1;
        const parsedCoffees = userCoffees.map((row, idx) => {
            const data = typeof row.data === 'string'
                ? JSON.parse(row.data)
                : row.data;

            // Preserve the database row id
            const coffeeWithId = { ...data, id: row.id, savedAt: row.created_at };

            if (
                String(row.id) === String(id) ||
                String(data.savedAt) === String(id) ||
                String(idx) === String(id)
            ) {
                coffeeIndex = idx;
            }
            return coffeeWithId;
        });

        if (coffeeIndex === -1) {
            return res.status(404).json({ 
                success: false,
                error: 'Coffee not found' 
            });
        }

        // Apply updates (map coffee_name → name for internal model)
        const coffee = parsedCoffees[coffeeIndex];
        if (sanitizedUpdates.coffee_name !== undefined) {
            coffee.name = sanitizedUpdates.coffee_name;
        }
        if (sanitizedUpdates.origin !== undefined) {
            coffee.origin = sanitizedUpdates.origin;
        }
        if (sanitizedUpdates.roastery !== undefined) {
            coffee.roastery = sanitizedUpdates.roastery;
        }

        // Save via full-array rewrite (reuses existing transaction-safe saveCoffees logic)
        // Delete all + re-insert to stay consistent with POST /api/coffees
        const { beginTransaction, commit, rollback } = await import('../db/database.js');

        await beginTransaction();
        try {
            await queries.deleteUserCoffees(userId);
            for (const c of parsedCoffees) {
                // Strip runtime-only fields before saving
                const { id: _id, savedAt: _savedAt, ...dataToSave } = c;
                await queries.saveCoffee(userId, JSON.stringify(dataToSave));
            }
            await commit();
        } catch (txError) {
            await rollback();
            throw txError;
        }

        res.json({
            success: true,
            coffee: coffee
        });

        console.log(`✏️ PATCH /api/brews/${id} – updated: ${Object.keys(sanitizedUpdates).join(', ')} (user: ${req.user.username})`);

    } catch (error) {
        console.error('❌ PATCH /api/brews/:id error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error' 
        });
    }
});

export default router;
