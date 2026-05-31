// ==========================================
// INVITE HELPER — shared token generation & email sending
// Used by routes/register.js and routes/signup.js
// ==========================================

import { randomBytes } from 'crypto';
import { queries } from '../db/database.js';
import { buildTokenEmail } from './emailTemplate.js';

/**
 * Generate a cryptographically random BREW-XXXXXX token.
 * Uses an unambiguous character set (no 0/O, 1/I) to avoid user confusion.
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
 * Retries up to 10 times before giving up (collision probability is negligible).
 *
 * @returns {Promise<string>} A unique BREW-XXXXXX token
 * @throws {Error} If a unique token cannot be found after 10 attempts
 */
export async function generateUniqueToken() {
    for (let attempts = 0; attempts < 10; attempts++) {
        const token = generateToken();
        const taken = await queries.registrationTokenExists(token);
        if (!taken) return token;
    }
    throw new Error('Failed to generate a unique token after 10 attempts');
}

/**
 * Send the beta access token email via the Resend API.
 * Uses AbortController to enforce a 10-second timeout.
 *
 * @param {string} email - Recipient address
 * @param {string} token - The BREW-XXXXXX token to include
 */
export async function sendTokenMail(email, token) {
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

/**
 * Idempotently issue or re-send a BREW token for an already-whitelisted email.
 * Creates a new registration if none exists; re-sends the existing token otherwise.
 *
 * @param {string} email - Normalized (lowercased) email address
 * @returns {Promise<{ resent: boolean }>}
 */
export async function issueOrResendToken(email) {
    const existing = await queries.getRegistrationByEmail(email);
    if (existing) {
        await sendTokenMail(email, existing.token);
        return { resent: true };
    }

    const token = await generateUniqueToken();
    await queries.createRegistration(email, token);
    await sendTokenMail(email, token);
    return { resent: false };
}
