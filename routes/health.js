// ==========================================
// HEALTH CHECK (V5.3)
// ==========================================

import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        app: 'dripmate',
        version: '5.3.0-magic-link',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

export default router;
