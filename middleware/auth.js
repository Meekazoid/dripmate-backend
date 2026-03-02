// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

import { queries } from '../db/database.js';

/**
 * Extract authentication credentials from request headers.
 * Prefers the standard Authorization / X-Device-ID headers.
 * Falls back to body/query params for legacy clients.
 *
 * @param {import('express').Request} req
 * @returns {{ token: string|null, deviceId: string|null }}
 */
export function extractAuthCredentials(req) {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        token = req.body?.token || req.query?.token || null;
    }

    const deviceId =
        req.headers['x-device-id'] ||
        req.body?.deviceId         ||
        req.query?.deviceId        ||
        null;

    return { token, deviceId };
}

/**
 * Express middleware — validates token + device binding for all protected routes.
 *
 * On success:
 *   - Attaches the authenticated user to req.user
 *   - Updates last_login_at (fire-and-forget, never blocks the request)
 *   - Calls next()
 *
 * On failure:
 *   - Returns 400 (missing credentials), 401 (bad token), or 403 (wrong device)
 *
 * Note on device binding: if the user has no device_id yet (edge case — account
 * created via a path that didn't bind immediately), it is bound here. This is an
 * intentional side-effect: the middleware is the single authoritative place where
 * device binding is enforced, so it is also the right place to complete it.
 */
export async function authenticateUser(req, res, next) {
    try {
        const { token, deviceId } = extractAuthCredentials(req);

        if (!token) {
            return res.status(400).json({ success: false, error: 'Token required' });
        }

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        const user = await queries.getUserByToken(token);

        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        // Enforce device binding
        if (user.device_id) {
            if (user.device_id !== deviceId) {
                return res.status(403).json({
                    success: false,
                    error: 'This token is already bound to another device'
                });
            }
        } else {
            // Edge case: user exists but has no device bound yet — bind now
            await queries.bindDevice(user.id, deviceId, getDeviceInfo(req));
            console.log(`[OK] Device bound: user ${user.username} -> device ${deviceId.substring(0, 8)}...`);
        }

        // Update last_login_at on every authenticated request.
        // Fire-and-forget: a failure here must never block the actual request.
        queries.updateLastLogin(user.id).catch(err =>
            console.error('[WARN] updateLastLogin failed (non-fatal):', err.message)
        );

        req.user = user;
        next();

    } catch (error) {
        console.error('[ERROR] authenticateUser middleware:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
}

/**
 * Build a compact device-info JSON string from the request User-Agent.
 * Stored once at device-binding time for admin visibility.
 *
 * @param {import('express').Request} req
 * @returns {string} JSON-encoded device info
 */
export function getDeviceInfo(req) {
    const userAgent = (req.headers['user-agent'] || 'unknown').substring(0, 200);
    const platform  = userAgent.includes('Mobile') ? 'mobile' : 'desktop';
    const os        =
        userAgent.includes('Mac')     ? 'macOS'   :
        userAgent.includes('Windows') ? 'Windows' :
        userAgent.includes('Linux')   ? 'Linux'   :
        userAgent.includes('Android') ? 'Android' :
        userAgent.includes('iPhone')  ? 'iOS'     : 'unknown';

    return JSON.stringify({ platform, os, userAgent });
}
