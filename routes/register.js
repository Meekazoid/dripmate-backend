// ==========================================
// REGISTER ENDPOINT
// Whitelist check -> generate token -> send email
// POST /api/auth/register
// ==========================================

import express from 'express';
import { queries } from '../db/database.js';
import { issueOrResendToken } from '../utils/inviteHelper.js';

const router = express.Router();

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

        const { resent } = await issueOrResendToken(normalizedEmail);
        console.log(`[OK] Token ${resent ? 're-sent' : 'generated & sent'}: ${normalizedEmail}`);
        res.json({ success: true, resent });

    } catch (err) {
        console.error('[ERROR] /auth/register:', err.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
