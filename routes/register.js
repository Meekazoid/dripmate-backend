// ==========================================
// REGISTER ENDPOINT
// Whitelist check -> generate token -> send email
// POST /api/auth/register
// ==========================================

import express from 'express';
import { randomBytes } from 'crypto';
import { queries } from '../db/database.js';
import { buildTokenEmail } from '../utils/emailTemplate.js';

const router = express.Router();

// ==========================================
// HELPERS
// ==========================================

/**
 * Generate a cryptographically random beta access token in the format BREW-XXXXXX.
 * Uses an unambiguous character set (no 0/O, 1/I) to avoid user confusion.
 *
 * @returns {string} e.g. "BREW-A3KZ7Q"
 */
function generateToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let token = 'BREW-';
    for (let i = 0; i < 6; i++) {
        token += chars[randomBytes(1)[0] % chars.length];
    }
    return token;
}

/**
 * Generate a unique token that does not collide with any existing registration.
 * Retries up to 10 times before giving up (collision probability is negligible in practice).
 *
 * @returns {Promise<string>} A unique BREW-XXXXXX token
 * @throws {Error} If a unique token cannot be found after 10 attempts
 */
async function generateUniqueToken() {
    for (let attempts = 0; attempts < 10; attempts++) {
        const token = generateToken();
        const taken = await queries.registrationTokenExists(token);
        if (!taken) return token;
    }
    throw new Error('Failed to generate a unique token after 10 attempts');
}

/**
 * Send the beta access token email via the Resend API.
 * Uses AbortController to enforce a 10-second timeout so a hung
 * Resend request never blocks the HTTP response indefinitely.
 *
 * @param {string} email - Recipient address
 * @param {string} token - The BREW-XXXXXX token to include
 */
async function sendTokenMail(email, token) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://dripmate.app';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from:    'dripmate <hello@dripmate.app>',
                to:      email,
                subject: 'Your dripmate access token',
                html:    buildTokenEmail(email, token, frontendUrl)
            })
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Resend API error (${response.status}): ${body}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}

// ==========================================
// POST /api/auth/register
// ==========================================

router.post('/', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
        // Reject anyone not on the beta whitelist
        const whitelisted = await queries.isEmailWhitelisted(normalizedEmail);
        if (!whitelisted) {
            return res.status(403).json({ success: false, error: 'not_whitelisted' });
        }

        // If a registration already exists, re-send the same token (idempotent)
        const existing = await queries.getRegistrationByEmail(normalizedEmail);
        if (existing) {
            await sendTokenMail(normalizedEmail, existing.token);

            // Ensure users.email is set if user already activated their token
            const existingUser = await queries.getUserByEmail(normalizedEmail).catch(() => null);
            if (!existingUser) {
                // User may exist by token - sync email if missing
                const userByToken = await queries.getUserByToken(existing.token).catch(() => null);
                if (userByToken && !userByToken.email) {
                    await queries.setUserEmail(userByToken.id, normalizedEmail).catch(() => {});
                    console.log(`[OK] Email synced for existing user ${userByToken.username}`);
                }
            }

            console.log(`[OK] Token re-sent: ${normalizedEmail}`);
            return res.json({ success: true, resent: true });
        }

        // Generate a fresh unique token, store it, then send
        const token = await generateUniqueToken();
        await queries.createRegistration(normalizedEmail, token);
        await sendTokenMail(normalizedEmail, token);

        console.log(`[OK] Token generated & sent: ${normalizedEmail} -> ${token}`);
        res.json({ success: true, resent: false });

    } catch (err) {
        console.error('[ERROR] /auth/register:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
