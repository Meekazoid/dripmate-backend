// ==========================================
// COFFEE DATA ENDPOINTS
// ==========================================

import express from 'express';
import crypto from 'crypto';
import { authenticateUser } from '../middleware/auth.js';
import { queries, withTransaction, getDatabaseType } from '../db/database.js';
import { sanitizeCoffeeData } from '../utils/sanitize.js';

const router = express.Router();

const MAX_HISTORY_ENTRIES = 30;
const FEEDBACK_KEYS = ['bitterness', 'sweetness', 'acidity', 'body'];
const FEEDBACK_VALUES = ['low', 'balanced', 'high'];

function stableCoffeeUid(coffee) {
    if (coffee && (typeof coffee.id === 'string' || typeof coffee.id === 'number')) {
        return String(coffee.id).trim();
    }

    const fallback = JSON.stringify({
        name: coffee?.name,
        origin: coffee?.origin,
        roaster: coffee?.roaster,
        roastery: coffee?.roastery,
        addedDate: coffee?.addedDate
    });

    return crypto.createHash('sha1').update(fallback).digest('hex');
}

function isValidISODate(value) {
    if (typeof value !== 'string' || value.length > 50) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
}

function normalizeFeedback(feedback) {
    if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) {
        return feedback;
    }

    const normalized = {};

    for (const [key, value] of Object.entries(feedback)) {
        if (FEEDBACK_KEYS.includes(key) && typeof value === 'string') {
            const normalizedValue = value.toLowerCase().trim();
            if (FEEDBACK_VALUES.includes(normalizedValue)) {
                normalized[key] = normalizedValue;
            }
            continue;
        }

        // Keep unknown feedback keys for backwards compatibility.
        normalized[key] = value;
    }

    return normalized;
}

function normalizeFeedbackHistory(history) {
    if (!Array.isArray(history)) return history;

    return history.slice(-MAX_HISTORY_ENTRIES).map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

        const normalizedEntry = {};

        if (isValidISODate(entry.timestamp)) {
            normalizedEntry.timestamp = new Date(entry.timestamp).toISOString();
        } else {
            return null;
        }

        if (typeof entry.previousGrind === 'string') {
            normalizedEntry.previousGrind = entry.previousGrind.slice(0, 100);
        }
        if (typeof entry.newGrind === 'string') {
            normalizedEntry.newGrind = entry.newGrind.slice(0, 100);
        }
        if (typeof entry.previousTemp === 'string') {
            normalizedEntry.previousTemp = entry.previousTemp.slice(0, 50);
        }
        if (typeof entry.newTemp === 'string') {
            normalizedEntry.newTemp = entry.newTemp.slice(0, 50);
        }
        if (typeof entry.grindOffsetDelta === 'number' && Number.isFinite(entry.grindOffsetDelta)) {
            normalizedEntry.grindOffsetDelta = entry.grindOffsetDelta;
        }
        // customTempApplied can be a string (e.g. '93-94C') or boolean
        if (typeof entry.customTempApplied === 'string') {
            normalizedEntry.customTempApplied = entry.customTempApplied.slice(0, 50);
        } else if (typeof entry.customTempApplied === 'boolean') {
            normalizedEntry.customTempApplied = entry.customTempApplied;
        }
        if (typeof entry.resetToInitial === 'boolean') {
            normalizedEntry.resetToInitial = entry.resetToInitial;
        }
        // manualAdjust: 'grind' | 'temp'
        if (entry.manualAdjust === 'grind' || entry.manualAdjust === 'temp') {
            normalizedEntry.manualAdjust = entry.manualAdjust;
        }
        // brewStart entries
        if (entry.brewStart === true) {
            normalizedEntry.brewStart = true;
            if (typeof entry.brewLabel === 'string') {
                normalizedEntry.brewLabel = entry.brewLabel.slice(0, 200);
            }
        }

        return normalizedEntry;
    }).filter(Boolean);
}

router.get('/', authenticateUser, async (req, res) => {
    try {
        const coffees = await queries.getUserCoffees(req.user.id);

        const parsed = coffees.map(c => ({
            id: c.coffee_uid || c.id,
            ...JSON.parse(c.data),
            savedAt: c.created_at
        }));

        res.json({
            success: true,
            coffees: parsed
        });

    } catch (error) {
        console.error('Get coffees error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

router.post('/', authenticateUser, async (req, res) => {
    try {
        const { coffees } = req.body;

        const saved = await withTransaction(async (tx) => {
            const keepCoffeeUids = [];

            if (coffees && coffees.length > 0) {
                for (const coffee of coffees) {
                    const preNormalized = {
                        ...coffee,
                        feedback: normalizeFeedback(coffee?.feedback),
                        feedbackHistory: normalizeFeedbackHistory(coffee?.feedbackHistory)
                    };

                    const uid = stableCoffeeUid(preNormalized);
                    keepCoffeeUids.push(uid);

                    // Sanitize each coffee object before storing
                    const sanitized = sanitizeCoffeeData(preNormalized);

                    // Upsert via the transaction's connection
                    if (getDatabaseType() === 'postgresql') {
                        await tx.get(
                            `INSERT INTO coffees (user_id, coffee_uid, data, method)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT(user_id, coffee_uid)
                             DO UPDATE SET data = EXCLUDED.data, method = EXCLUDED.method, created_at = CURRENT_TIMESTAMP
                             RETURNING id`,
                            [req.user.id, uid, JSON.stringify(sanitized), sanitized.method || 'v60']
                        );
                    } else {
                        await tx.run(
                            `INSERT INTO coffees (user_id, coffee_uid, data, method)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT(user_id, coffee_uid)
                             DO UPDATE SET data = excluded.data, method = excluded.method, created_at = CURRENT_TIMESTAMP`,
                            [req.user.id, uid, JSON.stringify(sanitized), sanitized.method || 'v60']
                        );
                    }
                }
            }

            // Remove coffees that are no longer part of this payload
            if (keepCoffeeUids.length === 0) {
                await tx.run(`DELETE FROM coffees WHERE user_id = $1`, [req.user.id]);
            } else if (getDatabaseType() === 'postgresql') {
                await tx.run(
                    `DELETE FROM coffees WHERE user_id = $1 AND coffee_uid <> ALL($2::text[])`,
                    [req.user.id, keepCoffeeUids]
                );
            } else {
                // SQLite: use temp table to avoid the 999-variable placeholder limit.
                // Safe within withTransaction — SQLite serializes all TX access.
                const BATCH = 500;
                await tx.run(`CREATE TEMP TABLE IF NOT EXISTS _keep_uids (uid TEXT)`);
                await tx.run(`DELETE FROM _keep_uids`);
                for (let i = 0; i < keepCoffeeUids.length; i += BATCH) {
                    const batch = keepCoffeeUids.slice(i, i + BATCH);
                    await tx.run(
                        `INSERT INTO _keep_uids (uid) VALUES ${batch.map(() => '(?)').join(',')}`,
                        batch
                    );
                }
                await tx.run(
                    `DELETE FROM coffees WHERE user_id = ? AND coffee_uid NOT IN (SELECT uid FROM _keep_uids)`,
                    [req.user.id]
                );
                await tx.run(`DROP TABLE IF EXISTS _keep_uids`);
            }

            return coffees?.length || 0;
        });

        res.json({ success: true, saved });

    } catch (error) {
        console.error('Save coffees error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

export default router;

