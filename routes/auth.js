// ==========================================
// AUTHENTICATION ENDPOINTS (V5.3)
// ==========================================

import express    from 'express';
import crypto     from 'crypto';
import { Resend } from 'resend';
import { extractAuthCredentials, getDeviceInfo } from '../middleware/auth.js';
import { queries } from '../db/database.js';

const router = express.Router();
function getResendClient() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;
    return new Resend(apiKey);
}

/**
 * Validate Token
 * GET /api/auth/validate
 *
 * First login:  creates user account from registration token.
 * Return login: validates token. If device changed (browser reset),
 *               rebinds the device automatically so recovery works.
 */
router.get('/validate', async (req, res) => {
    try {
        const { token, deviceId } = extractAuthCredentials(req);

        if (!token)    return res.status(400).json({ success: false, error: 'Token required' });
        if (!deviceId) return res.status(400).json({ success: false, error: 'Device ID required' });

        let user = await queries.getUserByToken(token);

        // First-time login — create account from registration
        if (!user) {
            const registration = await queries.getRegistrationByToken(token);
            if (!registration) {
                return res.status(401).json({ success: false, valid: false, error: 'Invalid token' });
            }

            const base     = registration.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
            const suffix   = Date.now().toString().slice(-4);
            const username = (base || 'user') + '_' + suffix;

            await queries.createUser(username, token, deviceId, getDeviceInfo(req));
            await queries.markRegistrationUsed(token);

            // Store email on user record for magic link recovery
            const newUser = await queries.getUserByToken(token);
            if (newUser && registration.email) {
                await queries.setUserEmail(newUser.id, registration.email).catch(() => {});
            }

            console.log(`[OK] New user created: ${username} (${registration.email})`);
            user = await queries.getUserByToken(token);
        }

        // Device changed (e.g. browser reset) — rebind silently
        // This enables recovery via code re-entry after clearing browser data
        if (user.device_id && user.device_id !== deviceId) {
            await queries.rebindDevice(user.id, deviceId, getDeviceInfo(req));
            console.log(`[OK] Device rebound for user ${user.username} (browser reset recovery)`);
        } else if (!user.device_id) {
            await queries.bindDevice(user.id, deviceId, getDeviceInfo(req));
            console.log(`[OK] Device bound: user ${user.username} -> device ${deviceId.substring(0, 8)}...`);
        }

        // Do not block login validation on this non-critical write.
        // On production Postgres (especially free/shared tiers), a synchronous
        // UPDATE here can add visible startup latency in the app before coffees load.
        queries.updateLastLogin(user.id).catch(err =>
            console.error('[WARN] updateLastLogin failed (non-fatal):', err.message)
        );

        res.json({
            success: true,
            valid:   true,
            user: {
                id:                user.id,
                username:          user.username,
                email:             user.email || null,
                deviceId:          deviceId,
                grinderPreference: user.grinder_preference || 'fellow_gen2',
                methodPreference:  user.method_preference  || 'v60',
                waterHardness:     user.water_hardness     || null,
                createdAt:         user.created_at
            }
        });

    } catch (error) {
        console.error('[ERROR] /auth/validate:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

/**
 * Save Email
 * POST /api/auth/email
 * Body: { email }
 * Header: Authorization: Bearer <token>
 */
router.post('/email', async (req, res) => {
    try {
        const { token } = extractAuthCredentials(req);
        if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const user = await queries.getUserByToken(token);
        if (!user)  return res.status(401).json({ success: false, error: 'Invalid token' });

        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, error: 'Valid email required' });
        }

        await queries.setUserEmail(user.id, email);
        console.log(`[OK] Email saved for user ${user.username}: ${email}`);

        res.json({ success: true, email: email.toLowerCase().trim() });

    } catch (error) {
        console.error('[ERROR] /auth/email:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

/**
 * Request Magic Link
 * POST /api/auth/magic-link
 * Body: { email }
 *
 * Sends a one-time login link to the registered email.
 * Link valid for 15 minutes.
 */
router.post('/magic-link', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });

        const user = await queries.getUserByEmail(email);

        // Always respond success to avoid email enumeration
        if (!user) {
            console.log(`[INFO] Magic link requested for unknown email: ${email}`);
            return res.json({ success: true, message: 'If that email is registered, a link has been sent.' });
        }

        const magicToken = crypto.randomBytes(32).toString('hex');
        const expiresAt  = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        // Rate limit: max 1 mail per 60 seconds
        const recentToken = await queries.getRecentMagicLinkToken(user.id, 60);
        if (recentToken) {
            console.log('[INFO] Magic link rate limited for user ' + user.username);
            return res.json({ success: true, message: 'If that email is registered, a link has been sent.' });
        }

        await queries.createMagicLinkToken(user.id, magicToken, expiresAt);

        const appUrl  = process.env.FRONTEND_URL || 'https://dripmate.app';
        const link    = `${appUrl}/?magic=${encodeURIComponent(magicToken)}`;

        const resend = getResendClient();
        if (!resend) {
            console.error('[ERROR] RESEND_API_KEY missing for /auth/magic-link');
            return res.status(503).json({ success: false, error: 'Email service temporarily unavailable' });
        }

        await resend.emails.send({
            from:    'dripmate <hello@dripmate.app>',
            to:      email,
            subject: 'Your dripmate login link',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="margin:0;padding:0;background:#f5f5f0;font-family:'Helvetica Neue',Arial,sans-serif;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:48px 20px;">
                        <tr>
                            <td align="center">
                                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

                                    <tr>
                                        <td style="padding-bottom:24px;text-align:left;">
                                            <p style="margin:0 0 3px;font-size:1.3rem;font-weight:200;letter-spacing:0.32em;color:#000000;line-height:1;">
                                                drip&middot;mate
                                            </p>
                                            <p style="margin:0;font-size:0.58rem;font-weight:300;letter-spacing:0.22em;text-transform:uppercase;color:#8b6f47;opacity:0.8;">
                                                Precision meets Ritual.
                                            </p>
                                        </td>
                                    </tr>

                                    <tr>
                                        <td style="background:#ffffff;border:1px solid #e0e0e0;border-radius:20px;padding:36px 32px;">
                                            <p style="margin:0 0 6px;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.2em;color:#bbbbbb;font-weight:400;">
                                                Secure Login
                                            </p>

                                            <p style="margin:0 0 6px;font-size:1.05rem;font-weight:400;color:#1a1a1a;line-height:1.4;">
                                                Your login link is ready.
                                            </p>
                                            <p style="margin:0 0 8px;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.2em;color:#bbbbbb;font-weight:400;">
                                                One-time access · 15 minutes
                                            </p>

                                            <p style="margin:0 0 24px;font-size:0.88rem;color:#555555;line-height:1.75;font-weight:300;">
                                                Click the button below to securely sign in and restore your coffees.
                                                For your security, this link can only be used once and expires after 15 minutes.
                                            </p>

                                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                                                <tr>
                                                    <td align="center">
                                                        <a href="${link}"
                                                           style="display:inline-block;background:#8b6f47;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:10px;font-size:0.9rem;font-weight:600;letter-spacing:0.04em;">
                                                            Sign in to drip&middot;mate
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>

                                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                                                <tr>
                                                    <td style="border-top:1px solid #eeeeee;"></td>
                                                </tr>
                                            </table>

                                            <p style="margin:0 0 20px;font-size:0.8rem;color:#999999;line-height:1.7;font-weight:300;">
                                                If you did not request this email, you can safely ignore it.
                                            </p>

                                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                                                <tr>
                                                    <td style="border-top:1px solid #eeeeee;"></td>
                                                </tr>
                                            </table>

                                            <p style="margin:0;font-size:0.88rem;color:#555555;font-weight:300;">
                                                Happy Brewing! &#x2615;
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `
        });

        console.log(`[OK] Magic link sent to ${email} for user ${user.username}`);
        res.json({ success: true, message: 'If that email is registered, a link has been sent.' });

    } catch (error) {
        console.error('[ERROR] /auth/magic-link:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

/**
 * Redeem Magic Link Token
 * GET /api/auth/magic-link/redeem?magic=<token>
 *
 * Validates the magic token and returns the user's bearer token.
 * One-time use, expires after 15 minutes.
 */
router.get('/magic-link/redeem', async (req, res) => {
    try {
        const { magic } = req.query;
        if (!magic) return res.status(400).json({ success: false, error: 'Magic token required' });

        const record = await queries.getMagicLinkToken(magic);

        // Recovery flow: one-time token with 15 min TTL
        if (record) {
            await queries.markMagicLinkUsed(magic);
            console.log(`[OK] Magic link redeemed for user_id ${record.user_id}`);
            return res.json({ success: true, token: record.user_token });
        }

        return res.status(401).json({ success: false, error: 'Link invalid or expired' });

    } catch (error) {
        console.error('[ERROR] /auth/magic-link/redeem:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
