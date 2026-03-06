// ==========================================
// AUTHENTICATION ENDPOINTS (V5.3)
// ==========================================

import express    from 'express';
import crypto     from 'crypto';
import { Resend } from 'resend';
import { extractAuthCredentials, getDeviceInfo } from '../middleware/auth.js';
import { queries } from '../db/database.js';

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

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

        await queries.updateLastLogin(user.id);

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
            console.log([INFO] Magic link rate limited for user ${user.username});
            return res.json({ success: true, message: 'If that email is registered, a link has been sent.' });
        }

        await queries.createMagicLinkToken(user.id, magicToken, expiresAt);

        const appUrl  = process.env.FRONTEND_URL || 'https://dripmate.app';
        const link    = `${appUrl}/?token=${user.token}&magic=${magicToken}`;

        await resend.emails.send({
            from:    'dripmate <hello@dripmate.app>',
            to:      email,
            subject: 'dripmate · Dein Login-Link',
            html: `
                <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #fdf8f2; color: #1a1008;">
                    <p style="font-size: 22px; font-style: italic; color: #8b6f47; margin: 0 0 24px;">drip·mate</p>
                    <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">Dein Login-Link</h2>
                    <p style="font-size: 14px; color: #7a6050; margin: 0 0 28px; line-height: 1.6;">
                        Klick auf den Button um dich einzuloggen und deine Kaffees wiederherzustellen.<br>
                        Der Link ist <strong>15 Minuten</strong> gültig.
                    </p>
                    <a href="${link}" style="display: inline-block; background: #8b6f47; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">
                        Jetzt einloggen →
                    </a>
                    <p style="font-size: 12px; color: #b0a090; margin-top: 32px;">
                        Falls du diesen Link nicht angefordert hast, ignoriere diese E-Mail einfach.
                    </p>
                </div>
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

        if (!record) {
            return res.status(401).json({ success: false, error: 'Link invalid or expired' });
        }

        await queries.markMagicLinkUsed(magic);

        console.log(`[OK] Magic link redeemed for user_id ${record.user_id}`);
        res.json({ success: true, token: record.user_token });

    } catch (error) {
        console.error('[ERROR] /auth/magic-link/redeem:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;