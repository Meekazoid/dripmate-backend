// ==========================================
// AUTHENTICATION ENDPOINTS (V5.2)
// ==========================================

import express from 'express';
import { extractAuthCredentials, getDeviceInfo } from '../middleware/auth.js';
import { queries } from '../db/database.js';

const router = express.Router();

/**
 * Validate Token with Device-Binding
 * GET /api/auth/validate
 *
 * On first login: if the token exists in `registrations` but not in `users`,
 * a new user account is created and the token is marked as used.
 * On subsequent logins: validates device binding and updates last_login_at.
 */
router.get('/validate', async (req, res) => {
    try {
        const { token, deviceId } = extractAuthCredentials(req);

        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Token required'
            });
        }

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'Device ID required'
            });
        }

        let user = await queries.getUserByToken(token);

        // Token not yet in users — check if it exists in registrations (first-time login)
        if (!user) {
            const registration = await queries.getRegistrationByToken(token);

            if (!registration) {
                return res.status(401).json({
                    success: false,
                    valid: false,
                    error: 'Invalid token'
                });
            }

            // Derive a username from the email address (e.g. john.doe@gmail.com -> johndoe_3421)
            const base     = registration.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
            const suffix   = Date.now().toString().slice(-4);
            const username = (base || 'user') + '_' + suffix;

            // Create the user account and bind the device in one step
            await queries.createUser(username, token, deviceId, getDeviceInfo(req));

            // Mark the registration token as used so it cannot be redeemed again
            await queries.markRegistrationUsed(token);

            console.log(`[OK] New user created: ${username} (${registration.email})`);
            user = await queries.getUserByToken(token);
        }

        // Enforce device binding — a token can only be used from the device it was first validated on
        if (user.device_id) {
            if (user.device_id !== deviceId) {
                return res.status(403).json({
                    success: false,
                    valid: false,
                    error: 'This token is already bound to another device'
                });
            }
        } else {
            // First time this user is seen from a device — bind it now
            await queries.bindDevice(user.id, deviceId, getDeviceInfo(req));
            console.log(`[OK] Device bound: user ${user.username} -> device ${deviceId.substring(0, 8)}...`);
        }

        await queries.updateLastLogin(user.id);

        res.json({
            success: true,
            valid: true,
            user: {
                id:                user.id,
                username:          user.username,
                deviceId:          user.device_id || deviceId,
                grinderPreference: user.grinder_preference || 'fellow_gen2',
                methodPreference:  user.method_preference  || 'v60',
                waterHardness:     user.water_hardness     || null,
                createdAt:         user.created_at
            }
        });

    } catch (error) {
        console.error('[ERROR] /auth/validate:', error.message);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

export default router;
