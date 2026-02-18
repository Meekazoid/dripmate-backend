// ==========================================
// COFFEE DATA ENDPOINTS
// ==========================================

import express from 'express';
import crypto from 'crypto';
import { authenticateUser } from '../middleware/auth.js';
import { queries, beginTransaction, commit, rollback } from '../db/database.js';
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
        if (typeof entry.customTempApplied === 'boolean') {
            normalizedEntry.customTempApplied = entry.customTempApplied;
        }
        if (typeof entry.resetToInitial === 'boolean') {
            normalizedEntry.resetToInitial = entry.resetToInitial;
        }

        return normalizedEntry;
    }).filter(Boolean);
}

router.get('/', authenticateUser, async (req, res) => {
    try {
        await queries.updateLastLogin(req.user.id);

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

        // Start transaction to ensure atomic upsert+cleanup operation
        await beginTransaction();

        try {
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
                    await queries.saveCoffee(req.user.id, uid, JSON.stringify(sanitized));
                }
            }

            // Remove coffees that are no longer part of this payload.
            await queries.replaceUserCoffees(req.user.id, keepCoffeeUids);

            // Commit transaction if all operations succeeded
            await commit();

            res.json({
                success: true,
                saved: coffees?.length || 0
            });

        } catch (txError) {
            // Rollback transaction if any operation failed
            await rollback();
            throw txError;
        }

    } catch (error) {
        console.error('Save coffees error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

export default router;
