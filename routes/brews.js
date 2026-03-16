// ==========================================
// BREW PARTIAL UPDATE ENDPOINT
// PATCH /api/brews/:id  — Card Editor inline edits
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { queries, beginTransaction, commit, rollback } from '../db/database.js';
import { sanitizeCoffeeData } from '../utils/sanitize.js'; // <-- GEÄNDERT: Wir nutzen jetzt unseren zentralen Türsteher

const router = express.Router();

/**
 * Partial update a coffee card.
 * Merges incoming updates with the existing coffee object and sanitizes it
 * against the canonical schema before saving.
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

        // 1. Hole den bestehenden Kaffee
        const existingCoffee = parsedCoffees[coffeeIndex];

        // 2. Mische bestehende Daten mit den neuen Updates aus dem Editor
        const mergedCoffee = { ...existingCoffee, ...updates };

        // 3. Systemfelder temporär abtrennen, damit sie nicht versehentlich wegsanitisiert werden
        const { _uid, _method, ...dataToSanitize } = mergedCoffee;
        
        // 4. Jage das komplett gemergte Objekt durch unseren strikten Türsteher
        const finalCoffeeData = sanitizeCoffeeData(dataToSanitize);

        // 5. Systemfelder für den Speichervorgang wieder anheften
        parsedCoffees[coffeeIndex] = { ...finalCoffeeData, _uid, _method };

        // Atomically rewrite the full coffee array
        await beginTransaction();
        try {
            await queries.deleteUserCoffees(userId);

            for (const c of parsedCoffees) {
                // Systemfelder vor dem Speichern wieder entfernen
                const { _uid, _method, ...dataToSave } = c;
                await queries.saveCoffee(userId, _uid, JSON.stringify(dataToSave), _method || 'v60');
            }

            await commit();
        } catch (txError) {
            await rollback();
            throw txError;
        }

        console.log(`[OK] PATCH /api/brews/${id} updated successfully (user: ${req.user.username})`);

        // Sende dem Frontend exakt das saubere, gespeicherte Objekt zurück
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
