// ==========================================
// APP FEEDBACK ROUTE
// POST /api/app-feedback — authenticated beta-tester feedback
// ==========================================

import express from 'express';
import { queries } from '../db/database.js';
import { authenticateUser } from '../middleware/auth.js';
import { stripHTML, truncateString } from '../utils/sanitize.js';

const router = express.Router();

const VALID_CATEGORIES = ['bug', 'wish', 'praise'];
const VALID_PLATFORMS  = ['ios_pwa', 'android_app', 'pwa', 'web', 'other'];

// POST /api/app-feedback
router.post('/', authenticateUser, async (req, res) => {
    try {
        const {
            category,
            message,
            grinderText,
            methodText,
            grinderUnsupported,
            methodUnsupported,
            appVersion,
            platform,
        } = req.body;

        // message is required
        const cleanMessage = typeof message === 'string'
            ? truncateString(stripHTML(message).trim(), 5000)
            : '';
        if (!cleanMessage) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }

        // category: only known values or null
        const cleanCategory = VALID_CATEGORIES.includes(category) ? category : null;

        // optional text fields: strip HTML, trim, cap, empty → null
        const cleanGrinderText = typeof grinderText === 'string'
            ? (truncateString(stripHTML(grinderText).trim(), 200) || null)
            : null;
        const cleanMethodText = typeof methodText === 'string'
            ? (truncateString(stripHTML(methodText).trim(), 200) || null)
            : null;

        // booleans → 0/1
        const cleanGrinderUnsupported = grinderUnsupported ? 1 : 0;
        const cleanMethodUnsupported  = methodUnsupported  ? 1 : 0;

        // platform: only known values, else 'other'
        const cleanPlatform = VALID_PLATFORMS.includes(platform) ? platform : 'other';

        // appVersion: cap at 40 chars
        const cleanAppVersion = typeof appVersion === 'string'
            ? (truncateString(stripHTML(appVersion).trim(), 40) || null)
            : null;

        // userId always from authenticated token — ignore any client-supplied value
        const id = await queries.createAppFeedback({
            userId:             req.user.id,
            category:           cleanCategory,
            message:            cleanMessage,
            grinderText:        cleanGrinderText,
            methodText:         cleanMethodText,
            grinderUnsupported: cleanGrinderUnsupported,
            methodUnsupported:  cleanMethodUnsupported,
            appVersion:         cleanAppVersion,
            platform:           cleanPlatform,
        });

        console.log(`[OK] App feedback #${id} from user ${req.user.id} (${cleanCategory || 'no-category'})`);
        res.status(201).json({ success: true, id });

    } catch (err) {
        console.error('[ERROR] POST /api/app-feedback:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
