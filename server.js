// ==========================================
// DRIPMATE BACKEND SERVER V5.3 - Magic Link Recovery
// + Grinder Variants + Method Preference
// + Water Hardness + Card Editor PATCH
// ==========================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { initDatabase, queries as dbQueries } from './db/database.js';
import authRoutes from './routes/auth.js';
import grinderRoutes from './routes/grinder.js';
import methodRoutes from './routes/method.js';
import waterHardnessRoutes from './routes/waterHardness.js';
import coffeeRoutes from './routes/coffees.js';
import analyzeRoutes from './routes/analyze.js';
import healthRoutes from './routes/health.js';
import brewsRoutes from './routes/brews.js';
import adminRouter from './routes/admin.js';
import registerRoute from './routes/register.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Only trust Railway's proxy in production — locally this would skew rate limiting
if (IS_PRODUCTION) {
    app.set('trust proxy', 1);
}

// ==========================================
// ENVIRONMENT VALIDATION
// ==========================================

function validateEnvironment() {
    const required = [
        'ANTHROPIC_API_KEY',
        'RESEND_API_KEY',
    ];

    const requiredInProduction = [
        'DATABASE_URL',
        'ALLOWED_ORIGINS',
        'FRONTEND_URL',
    ];

    const missing = required.filter(key => !process.env[key]);

    if (IS_PRODUCTION) {
        const missingProd = requiredInProduction.filter(key => !process.env[key]);
        missing.push(...missingProd);
    }

    if (missing.length > 0) {
        console.error('[ERROR] Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        process.exit(1);
    }

    console.log('[OK] Environment variables validated');
}

validateEnvironment();

// ==========================================
// RATE LIMITING
// ==========================================

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'AI analysis limit reached. Please try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// CORS CONFIGURATION
// ==========================================

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

if (IS_PRODUCTION && allowedOrigins.length === 0) {
    console.warn('[WARN] ALLOWED_ORIGINS is not set in production — CORS will block all requests!');
}

if (!IS_PRODUCTION) {
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('http://localhost:5173');
    allowedOrigins.push('http://127.0.0.1:5173');
}

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[WARN] CORS blocked request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Admin-Password']
}));

app.use(express.json({ limit: '10mb' }));
app.use('/api/', apiLimiter);

console.log('[OK] CORS enabled for origins:', allowedOrigins);
console.log('[OK] Rate limiting: 100 req/15min (general), 10 req/hour (AI analyze)');

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

try {
    await initDatabase();
    // Housekeeping: remove expired/used magic link tokens on every startup
    try {
        await dbQueries.cleanupExpiredMagicTokens();
        console.log('[OK] Expired magic link tokens cleaned up');
    } catch (cleanupErr) {
        console.warn('[WARN] Magic token cleanup failed (non-fatal):', cleanupErr.message);
    }
} catch (err) {
    console.error('[ERROR] Database initialization failed:', err.message);
    process.exit(1);
}

// ==========================================
// ROUTE MOUNTING
// ==========================================

app.use('/api/auth', authRoutes);
app.use('/api/auth/register', registerRoute);
app.use('/api/user/grinder', grinderRoutes);
app.use('/api/user/method', methodRoutes);
app.use('/api/user/water-hardness', waterHardnessRoutes);
app.use('/api/coffees', coffeeRoutes);
app.use('/api/brews', brewsRoutes);
app.use('/api/analyze-coffee', aiLimiter, analyzeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/admin', adminRouter);

// ==========================================
// ERROR HANDLING
// ==========================================

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('[ERROR] Unhandled server error:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`[OK] Dripmate API v5.3 running on port ${PORT}`);
    console.log(`[OK] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[OK] CORS enabled for: ${allowedOrigins.join(', ') || '(none)'}`);
    console.log(`[OK] Rate limiting active (general + AI)`);
    console.log(`[OK] Grinder Variants: ENABLED (8 grinders)`);
    console.log(`[OK] Brew Method: ENABLED (v60/chemex/aeropress)`);
    console.log(`[OK] Water Hardness: ENABLED`);
    console.log(`[OK] Card Editor PATCH: ENABLED`);
    console.log(`[OK] Trust proxy: ${IS_PRODUCTION ? 'ON (production)' : 'OFF (local)'}`);
});