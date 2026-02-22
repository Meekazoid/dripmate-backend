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
                                    <img src="https://dripmate.app/logo_dunkel_light.svg" alt="drip·mate logo" width="56" height="56" style="display:block;margin:0 auto 12px;">
                                    <p style="margin:0;font-size:0.75rem;letter-spacing:0.28em;text-transform:uppercase;color:#8b6f47;">drip·mate beta invitation</p>
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
                                        Open drip·mate and enter your token during registration. It can be used once and is linked to your device for secure access.
                                    </p>

                                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                                        <tr>
                                            <td align="center">
                                                <a href="https://dripmate.app/register.html" style="display:inline-block;background:#8b6f47;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;letter-spacing:0.04em;">Start registration</a>
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

function getRegisterPageHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>drip·mate — Beta Registration</title>
    <style>
        :root {
            --bg: #f4efe7;
            --card: #ffffff;
            --text: #1f1f1f;
            --muted: #6f665b;
            --brand: #8b6f47;
            --line: #e5d8c7;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: radial-gradient(circle at top right, #f9f3ea 0%, var(--bg) 45%, #efe6da 100%);
            color: var(--text);
            display: grid;
            place-items: center;
            padding: 22px;
        }
        .card {
            width: 100%;
            max-width: 560px;
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 22px;
            padding: 32px;
            box-shadow: 0 22px 50px rgba(67, 45, 18, 0.12);
        }
        .brand {
            text-align: center;
            margin-bottom: 24px;
        }
        .brand img {
            width: 62px;
            height: 62px;
            margin-bottom: 10px;
        }
        .tag {
            margin: 0;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.24em;
            color: var(--brand);
        }
        h1 {
            margin: 0 0 10px;
            font-size: clamp(1.7rem, 2.8vw, 2.1rem);
            line-height: 1.2;
        }
        .lead {
            margin: 0 0 24px;
            color: var(--muted);
            line-height: 1.7;
        }
        form {
            display: grid;
            gap: 12px;
        }
        input {
            width: 100%;
            border: 1px solid #d8c8b2;
            border-radius: 12px;
            padding: 14px;
            font-size: 1rem;
            outline: none;
            transition: border-color .2s, box-shadow .2s;
        }
        input:focus {
            border-color: var(--brand);
            box-shadow: 0 0 0 4px rgba(139, 111, 71, 0.15);
        }
        button {
            border: none;
            background: var(--brand);
            color: #fff;
            border-radius: 12px;
            padding: 14px;
            font-size: 0.96rem;
            font-weight: 600;
            letter-spacing: .02em;
            cursor: pointer;
        }
        .message {
            margin-top: 14px;
            font-size: .95rem;
            line-height: 1.6;
            color: #534835;
            min-height: 1.5em;
        }
    </style>
</head>
<body>
    <main class="card">
        <div class="brand">
            <img src="https://dripmate.app/logo_dunkel_light.svg" alt="drip·mate logo">
            <p class="tag">Beta registration</p>
        </div>

        <h1>Welcome to drip·mate</h1>
        <p class="lead">We're excited to have you here. Enter your invite email address and we'll send your personal access token right away.</p>

        <form id="registerForm">
            <input id="email" type="email" required placeholder="you@example.com" autocomplete="email">
            <button type="submit">Send my access token</button>
        </form>
        <p id="message" class="message"></p>
    </main>

    <script>
        const form = document.getElementById('registerForm');
        const message = document.getElementById('message');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            message.textContent = 'Sending your invitation...';

            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: document.getElementById('email').value.trim() })
                });

                const payload = await response.json();

                if (!response.ok) {
                    if (payload.error === 'not_whitelisted') {
                        message.textContent = 'This email is not on the invite list yet. Please contact the drip·mate team.';
                        return;
                    }
                    message.textContent = payload.error || 'Something went wrong. Please try again.';
                    return;
                }

                message.textContent = payload.resent
                    ? 'Your existing token was re-sent. Please check your inbox.'
                    : 'Your token is on the way. Please check your inbox in a moment.';
            } catch (error) {
                message.textContent = 'Connection issue. Please try again in a moment.';
            }
        });
    </script>
</body>
</html>`;
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

router.get('/', (req, res) => {
    res.type('html').send(getRegisterPageHtml());
});

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
