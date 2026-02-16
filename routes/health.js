// ==========================================
// HEALTH CHECK (V5.2)
// ==========================================

import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        app: 'dripmate',
        version: '5.2.0-grinder-variants',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

export default router;
