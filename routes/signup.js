// ==========================================
// SIGNUP ENDPOINT — Self-service onboarding with beta cap + waitlist
// POST /api/auth/signup
// ==========================================

import express from 'express';
import { queries, withTransaction } from '../db/database.js';
import { generateUniqueToken, sendTokenMail, issueOrResendToken } from '../utils/inviteHelper.js';
import { buildWaitlistEmail } from '../utils/emailTemplate.js';
import { stripHTML, truncateString } from '../utils/sanitize.js';

const router = express.Router();

/**
 * Send the waitlist confirmation email via the Resend API.
 * Mirrors sendTokenMail's AbortController + 10-second timeout pattern.
 */
async function sendWaitlistMail(email) {
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
                subject: "You're on the dripmate waitlist",
                html:    buildWaitlistEmail(email)
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
// POST /api/auth/signup
// ==========================================

router.post('/', async (req, res) => {
    const { email, name: rawName = '' } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Sanitize optional name: strip HTML/entities, remove control characters, cap at 100 chars
    const name = truncateString(
        stripHTML(typeof rawName === 'string' ? rawName : '')
            .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
            .trim(),
        100
    );

    try {
        // Already whitelisted → issue or idempotently re-send token (same behaviour as /register)
        const whitelisted = await queries.isEmailWhitelisted(normalizedEmail);
        if (whitelisted) {
            const { resent } = await issueOrResendToken(normalizedEmail);
            console.log(`[OK] /signup: token ${resent ? 're-sent' : 'sent'} to whitelisted: ${normalizedEmail}`);
            return res.json({ status: 'invited', resent });
        }

        const cap = parseInt(process.env.BETA_INVITE_CAP) || 200;

        // Try to atomically claim a spot under the cap.
        // Count and insert happen inside a single transaction; the re-check guards against
        // concurrent overshoot when two requests race through the whitelist check above.
        let tokenForEmail = null;
        let claimedSpot   = false;

        try {
            await withTransaction(async (tx) => {
                const row   = await tx.get(`SELECT COUNT(*) as count FROM whitelist`);
                const count = parseInt(row.count);

                if (count >= cap) {
                    // Signal cap-reached without clobbering the outer catch
                    throw Object.assign(new Error('CAP_REACHED'), { capReached: true });
                }

                await tx.run(
                    `INSERT INTO whitelist (email, name, website, note, invite_source)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [normalizedEmail, name, '', '', 'self_signup']
                );

                tokenForEmail = await generateUniqueToken();
                await tx.run(
                    `INSERT INTO registrations (email, token) VALUES ($1, $2)`,
                    [normalizedEmail, tokenForEmail]
                );

                claimedSpot = true;
            });
        } catch (err) {
            if (!err.capReached) throw err;
        }

        if (claimedSpot) {
            // Email is sent after the transaction commits so a mail failure doesn't roll back the DB
            await sendTokenMail(normalizedEmail, tokenForEmail);
            console.log(`[OK] /signup: spot claimed, token sent: ${normalizedEmail} -> ${tokenForEmail}`);
            return res.json({ status: 'invited', resent: false });
        }

        // Cap reached — handle waitlist
        const existing = await queries.getWaitlistEmail(normalizedEmail);
        if (existing) {
            console.log(`[OK] /signup: already on waitlist: ${normalizedEmail}`);
            return res.json({ status: 'already_waitlisted' });
        }

        await queries.addToWaitlist(normalizedEmail, '', name);
        await sendWaitlistMail(normalizedEmail);
        console.log(`[OK] /signup: added to waitlist: ${normalizedEmail}`);
        return res.json({ status: 'waitlisted' });

    } catch (err) {
        console.error('[ERROR] /auth/signup:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
