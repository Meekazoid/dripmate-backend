// ==========================================
// BREWBUDDY BACKEND SERVER V3
// Mit manuellem Token-System
// ==========================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { initDatabase, getDatabase, queries } from './db/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ENVIRONMENT VALIDATION
// ==========================================

function validateEnvironment() {
    const required = ['ANTHROPIC_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        process.exit(1);
    }
    
    console.log('✅ Environment variables loaded');
}

validateEnvironment();

// ==========================================
// RATE LIMITING
// ==========================================

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { 
        success: false, 
        error: 'Too many requests, please try again later.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { 
        success: false, 
        error: 'AI analysis limit reached. Please try again in an hour.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// CORS CONFIGURATION
// ==========================================

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

if (process.env.NODE_ENV === 'development') {
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
            console.warn(`⚠️  CORS blocked request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use('/api/', apiLimiter);

console.log('🔒 CORS enabled for origins:', allowedOrigins);
console.log('🛡️ Rate limiting: 100 req/15min (general), 10 req/hour (AI)');

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

await initDatabase();
const db = getDatabase();

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================

/**
 * Validate Token with Device-Binding
 * GET /api/auth/validate?token=xxx&deviceId=xxx
 */
app.get('/api/auth/validate', async (req, res) => {
    try {
        const { token, deviceId } = req.query;

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

        // Hole User mit Token
        const user = await queries.getUserByToken(token);

        if (!user) {
            return res.status(401).json({ 
                success: false,
                valid: false,
                error: 'Invalid token' 
            });
        }

        // Device-Binding Check
        if (user.device_id) {
            // Device bereits gebunden
            if (user.device_id !== deviceId) {
                return res.status(403).json({
                    success: false,
                    valid: false,
                    error: 'This token is already bound to another device'
                });
            }
        } else {
            // Erstes Gerät - binde es jetzt
            await queries.bindDevice(user.id, deviceId, getDeviceInfo(req));
            console.log(`🔗 Device bound: User ${user.username} → Device ${deviceId.substring(0, 8)}...`);
        }

        // Update last login
        await queries.updateLastLogin(user.id);

        res.json({
            success: true,
            valid: true,
            user: {
                id: user.id,
                username: user.username,
                deviceId: user.device_id || deviceId,
                createdAt: user.created_at
            }
        });

    } catch (error) {
        console.error('Validate error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
});

/**
 * Helper: Get Device Info
 */
function getDeviceInfo(req) {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const platform = userAgent.includes('Mobile') ? 'mobile' : 'desktop';
    const os = userAgent.includes('Mac') ? 'macOS' : 
               userAgent.includes('Windows') ? 'Windows' :
               userAgent.includes('Linux') ? 'Linux' : 
               userAgent.includes('Android') ? 'Android' :
               userAgent.includes('iPhone') ? 'iOS' : 'unknown';
    
    return JSON.stringify({
        platform,
        os,
        userAgent: userAgent.substring(0, 100)
    });
}

// ==========================================
// COFFEE DATA ENDPOINTS
// ==========================================

app.get('/api/coffees', async (req, res) => {
    try {
        const { token, deviceId } = req.query;

        if (!token || !deviceId) {
            return res.status(401).json({ 
                success: false,
                error: 'Token and Device ID required' 
            });
        }

        const user = await queries.getUserByToken(token);
        if (!user) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid token' 
            });
        }

        // Device check
        if (user.device_id && user.device_id !== deviceId) {
            return res.status(403).json({
                success: false,
                error: 'Device mismatch'
            });
        }

        await queries.updateLastLogin(user.id);

        const coffees = await queries.getUserCoffees(user.id);

        const parsed = coffees.map(c => ({
            id: c.id,
            ...JSON.parse(c.data),
            savedAt: c.created_at
        }));

        res.json({ 
            success: true, 
            coffees: parsed 
        });

    } catch (error) {
        console.error('Get coffees error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
});

app.post('/api/coffees', async (req, res) => {
    try {
        const { token, deviceId, coffees } = req.body;

        if (!token || !deviceId) {
            return res.status(401).json({ 
                success: false,
                error: 'Token and Device ID required' 
            });
        }

        const user = await queries.getUserByToken(token);
        if (!user) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid token' 
            });
        }

        // Device check
        if (user.device_id && user.device_id !== deviceId) {
            return res.status(403).json({
                success: false,
                error: 'Device mismatch'
            });
        }

        await queries.deleteUserCoffees(user.id);

        if (coffees && coffees.length > 0) {
            for (const coffee of coffees) {
                await queries.saveCoffee(user.id, JSON.stringify(coffee));
            }
        }

        res.json({ 
            success: true,
            saved: coffees?.length || 0
        });

    } catch (error) {
        console.error('Save coffees error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
});

// ==========================================
// ANTHROPIC API PROXY (PROTECTED)
// ==========================================

app.post('/api/analyze-coffee', aiLimiter, async (req, res) => {
    try {
        const { imageData, mediaType, token, deviceId } = req.body;

        // Token und Device-ID prüfen
        if (!token || !deviceId) {
            return res.status(401).json({ 
                success: false,
                error: 'Authentication required. Please enter your access code in Settings.' 
            });
        }

        // User validieren
        const user = await queries.getUserByToken(token);
        if (!user) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid access code. Please check your code in Settings.' 
            });
        }

        // Device-Binding prüfen
        if (user.device_id) {
            if (user.device_id !== deviceId) {
                return res.status(403).json({
                    success: false,
                    error: 'This access code is already used on another device.'
                });
            }
        } else {
            // Erstes Gerät - binde es
            await queries.bindDevice(user.id, deviceId, getDeviceInfo(req));
        }

        // Image-Daten prüfen
        if (!imageData) {
            return res.status(400).json({ 
                success: false,
                error: 'Image data required' 
            });
        }

        // AI-Analyse durchführen
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': process.env.ANTHROPIC_API_KEY
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType || 'image/jpeg',
                                data: imageData
                            }
                        },
                        {
                            type: 'text',
                            text: `Analyze this coffee bag and extract the following information as JSON:
{
  "name": "coffee name or farm name",
  "origin": "country and region",
  "process": "processing method (washed, natural, honey, etc)",
  "cultivar": "variety/cultivar",
  "altitude": "altitude in masl",
  "roaster": "roaster name",
  "tastingNotes": "tasting notes"
}

Only return valid JSON, no other text.`
                        }
                    ]
                }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'API error');
        }

        const text = data.content[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            throw new Error('Could not parse coffee data');
        }

        const coffeeData = JSON.parse(jsonMatch[0]);

        res.json({
            success: true,
            data: {
                name: coffeeData.name || 'Unknown',
                origin: coffeeData.origin || 'Unknown',
                process: coffeeData.process || 'washed',
                cultivar: coffeeData.cultivar || 'Unknown',
                altitude: coffeeData.altitude || '1500',
                roaster: coffeeData.roaster || 'Unknown',
                tastingNotes: coffeeData.tastingNotes || 'No notes',
                addedDate: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Analyze error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Analysis failed. Please try again.'
        });
    }
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok',
        app: 'brewbuddy',
        version: '3.0.0-manual-token',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ==========================================
// ERROR HANDLING
// ==========================================

app.use((req, res) => {
    res.status(404).json({ 
        success: false,
        error: 'Endpoint not found' 
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).json({ 
        success: false,
        error: 'Internal server error' 
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`🚀 BrewBuddy API v3.0 running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 CORS enabled for: ${allowedOrigins.join(', ')}`);
    console.log(`🛡️ Rate limiting active`);
    console.log(`🔐 Manual Token System: ENABLED`);
});
