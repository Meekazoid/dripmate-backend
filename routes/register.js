// ==========================================
// REGISTER ENDPOINT
// Whitelist check → generate token → send mail
// ==========================================

import express from 'express';
import { randomBytes } from 'crypto';
import { getDatabase, getDatabaseType } from '../db/database.js';

const router = express.Router();

// ── Generate token: BREW-XXXXXX ──────────────────
function generateToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let token = 'BREW-';
    for (let i = 0; i < 6; i++) {
        token += chars[randomBytes(1)[0] % chars.length];
    }
    return token;
}

function getEmailTemplate(email, token) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0;padding:0;background:#f4efe7;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#1a1a1a;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe7;padding:40px 16px;">
                <tr>
                    <td align="center">
                        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

                            <tr>
                                <td style="padding-bottom:20px;text-align:center;">
                                    <p style="margin:0 0 8px;font-size:1.35rem;letter-spacing:0.08em;color:#2a2a2a;font-weight:600;">drip·mate</p>
                                    <p style="margin:0;font-size:0.75rem;letter-spacing:0.24em;text-transform:uppercase;color:#8b6f47;">beta invitation</p>
                                </td>
                            </tr>

                            <tr>
                                <td style="background:#fff;border:1px solid #e8dfd2;border-radius:20px;padding:34px 28px;box-shadow:0 8px 30px rgba(93,72,43,0.08);">
                                    <h1 style="margin:0 0 14px;font-size:1.7rem;font-weight:600;color:#1f1f1f;">Welcome to drip·mate ☕</h1>
                                    <p style="margin:0 0 22px;font-size:1rem;line-height:1.7;color:#4b4b4b;">
                                        We're so glad you're here. Your early access invite is ready, and this personal token will unlock your beta signup:
                                    </p>

                                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                                        <tr>
                                            <td style="background:#fbf8f3;border:1px solid #d8c5ab;border-radius:12px;padding:20px;text-align:center;">
                                                <p style="margin:0 0 8px;font-size:0.68rem;letter-spacing:0.2em;text-transform:uppercase;color:#9f8f79;">Your invite token</p>
                                                <p style="margin:0;font-size:2rem;font-family:'Courier New',Courier,monospace;letter-spacing:0.12em;color:#8b6f47;font-weight:700;">${token}</p>
                                            </td>
                                        </tr>
                                    </table>

                                    <p style="margin:0 0 14px;font-size:0.92rem;line-height:1.75;color:#555;">
                                        Open drip·mate and enter your token. It can be used once and is linked to your device for secure access.
                                    </p>

                                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                                        <tr>
                                            <td align="center">
                                                <a href="https://dripmate.app" style="display:inline-block;background:#8b6f47;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;letter-spacing:0.04em;">Start registration</a>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <tr>
                                <td style="padding-top:18px;text-align:center;">
                                    <p style="margin:0;font-size:0.74rem;line-height:1.7;color:#938674;">
                                        This email was sent to ${email}.<br>
                                        You received it because you were invited to the drip·mate beta.
                                    </p>
                                </td>
                            </tr>

                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;
}

// ── Send mail with Resend ───────────────────────
async function sendTokenMail(email, token) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'drip·mate <hello@dripmate.app>',
            to: email,
            subject: 'Your drip·mate beta access token ☕',
            html: getEmailTemplate(email, token)
        })
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend error: ${err}`);
    }
}


// ── POST /api/auth/register ─────────────────────────
router.post('/', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
        const db = getDatabase();
        const dbt = getDatabaseType();

        const whitelisted = dbt === 'postgresql'
            ? await db.get('SELECT id FROM whitelist WHERE email = $1', [normalizedEmail])
            : await db.get('SELECT id FROM whitelist WHERE email = ?', [normalizedEmail]);

        if (!whitelisted) {
            return res.status(403).json({ success: false, error: 'not_whitelisted' });
        }

        const existing = dbt === 'postgresql'
            ? await db.get('SELECT token, used FROM registrations WHERE email = $1', [normalizedEmail])
            : await db.get('SELECT token, used FROM registrations WHERE email = ?', [normalizedEmail]);

        if (existing) {
            await sendTokenMail(normalizedEmail, existing.token);
            console.log(`📧 Token re-sent: ${normalizedEmail}`);
            return res.json({ success: true, resent: true });
        }

        let token;
        let attempts = 0;
        do {
            token = generateToken();
            const conflict = dbt === 'postgresql'
                ? await db.get('SELECT id FROM registrations WHERE token = $1', [token])
                : await db.get('SELECT id FROM registrations WHERE token = ?', [token]);
            if (!conflict) break;
            attempts++;
        } while (attempts < 10);

        if (dbt === 'postgresql') {
            await db.run('INSERT INTO registrations (email, token) VALUES ($1, $2)', [normalizedEmail, token]);
        } else {
            await db.run('INSERT INTO registrations (email, token) VALUES (?, ?)', [normalizedEmail, token]);
        }

        await sendTokenMail(normalizedEmail, token);
        console.log(`✅ Token generated & sent: ${normalizedEmail} → ${token}`);

        res.json({ success: true, resent: false });
    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
