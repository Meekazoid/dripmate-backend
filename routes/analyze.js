// ==========================================
// ANTHROPIC API PROXY (PROTECTED)
// POST /api/analyze-coffee
//
// Note: the AI rate limiter (10 req/hour) is applied at mount time in server.js.
// Do NOT add a second limiter here.
// ==========================================

import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { sanitizeCoffeeData } from '../utils/sanitize.js';
import { buildCoffeeDefaults, extractCoffeeJsonFromAnthropicResponse } from '../utils/analyzeResponse.js';
import { queries } from '../db/database.js';

const router = express.Router();

router.post('/', authenticateUser, async (req, res) => {
    try {
        const { imageData, mediaType } = req.body;

        console.log(`[OK] Analysis started for user: ${req.user.username}`);

        if (!imageData) {
            return res.status(400).json({
                success: false,
                error: 'Image data required'
            });
        }

        // Per-user quota: max 5 successful scans per day (UTC)
        const successfulScansToday = await queries.getSuccessfulScansToday(req.user.id);
        console.log(`[DB] Successful scans today: user_id=${req.user.id}, count=${successfulScansToday}`);
        if (successfulScansToday >= 5) {
            return res.status(403).json({
                success: false,
                error: "You've reached your daily limit of 5 successful scans. Please try again tomorrow after the daily reset.",
                errorCode: 'DAILY_SCAN_LIMIT_REACHED'
            });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            console.error('[ERROR] Analyze: Missing ANTHROPIC_API_KEY');
            return res.status(503).json({
                success: false,
                error: 'AI analysis is temporarily unavailable. Please try again later.'
            });
        }

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
                            text: `Look at this image. If it is NOT a coffee bag, coffee package, or coffee-related label, respond with exactly: NOT_COFFEE

If it IS a coffee bag or coffee package, analyze it and extract the following information as JSON:
{
  "name": "coffee name or farm name",
  "origin": "country and region",
  "process": "processing method (washed, natural, honey, etc)",
  "cultivar": "variety/cultivar",
  "altitude": "altitude in masl",
  "roastery": "roaster name",
  "tastingNotes": "tasting notes"
}

Only return valid JSON or NOT_COFFEE, no other text.`
                        }
                    ]
                }]
            })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const providerError = data?.error?.message || 'AI provider request failed';
            const status = response.status;

            // 401 — API key invalid or revoked
            if (status === 401) {
                console.error(`[ERROR] Analyze: Anthropic API key invalid (401): ${providerError}`);
                return res.status(503).json({
                    success: false,
                    error: 'AI analysis is temporarily unavailable. Please try again later.',
                    errorCode: 'AI_AUTH_ERROR'
                });
            }

            // 429 — Anthropic rate limit hit
            if (status === 429) {
                console.warn(`[WARN] Analyze: Anthropic API rate limit (429): ${providerError}`);
                return res.status(429).json({
                    success: false,
                    error: 'AI analysis is busy. Please try again in a minute.',
                    errorCode: 'AI_RATE_LIMIT'
                });
            }

            // 529 — Anthropic overloaded
            if (status === 529) {
                console.warn(`[WARN] Analyze: Anthropic API overloaded (529): ${providerError}`);
                return res.status(503).json({
                    success: false,
                    error: 'AI service is temporarily overloaded. Please try again later.',
                    errorCode: 'AI_OVERLOADED'
                });
            }

            // 400 — Bad request (e.g. image too large, invalid media type)
            if (status === 400) {
                console.error(`[ERROR] Analyze: Anthropic API bad request (400): ${providerError}`);
                return res.status(422).json({
                    success: false,
                    error: 'Could not process this image. Please try a different photo or reduce the image size.',
                    errorCode: 'AI_BAD_REQUEST'
                });
            }

            // All other errors — generic upstream failure
            console.error(`[ERROR] Analyze: Anthropic API error (${status}): ${providerError}`);
            return res.status(502).json({
                success: false,
                error: 'Analysis provider is unavailable. Please try again.',
                errorCode: 'AI_UPSTREAM_ERROR'
            });
        }

        // Check for NOT_COFFEE response before trying to parse JSON
        const rawText = data?.content
            ?.filter(item => item?.type === 'text' && typeof item?.text === 'string')
            ?.map(item => item.text)
            ?.join('\n')
            ?.trim() || '';

        if (rawText.toUpperCase().includes('NOT_COFFEE')) {
            console.log(`[OK] Not a coffee image for user: ${req.user.username}`);
            return res.status(422).json({
                success: false,
                error: "This doesn't appear to be a coffee bag. Please take a photo of a coffee package or label."
            });
        }

        const coffeeData = extractCoffeeJsonFromAnthropicResponse(data);

        // Validate that we got meaningful coffee data (not just defaults)
        const name   = (coffeeData?.name   || '').toLowerCase().trim();
        const origin = (coffeeData?.origin || '').toLowerCase().trim();
        const isGeneric = (!name   || name   === 'unknown' || name   === 'n/a' || name   === 'none') &&
                          (!origin || origin === 'unknown' || origin === 'n/a' || origin === 'none');

        if (isGeneric) {
            console.log(`[OK] Could not extract coffee info for user: ${req.user.username}`);
            return res.status(422).json({
                success: false,
                error: 'Could not recognize coffee details from this image. Try a clearer photo of the label.'
            });
        }

        // Apply defaults then sanitize before returning
        const withDefaults = buildCoffeeDefaults(coffeeData);
        const sanitized    = sanitizeCoffeeData(withDefaults);

        await queries.incrementSuccessfulScansToday(req.user.id);
        try {
            const successfulScansAfterIncrement = await queries.getSuccessfulScansToday(req.user.id);
            console.log(`[DB] Successful scans updated: user_id=${req.user.id}, count=${successfulScansAfterIncrement}`);
        } catch (logReadError) {
            console.warn(`[DB] Post-increment scan count read failed: user_id=${req.user.id}, error=${logReadError.message}`);
        }

        res.json({
            success: true,
            data: sanitized
        });

    } catch (error) {
        // Distinguish network/timeout errors from unexpected crashes
        if (error.name === 'AbortError' || error.message?.includes('abort')) {
            console.error('[ERROR] /analyze-coffee: Request timed out');
            return res.status(504).json({
                success: false,
                error: 'AI analysis timed out. Please try again.',
                errorCode: 'AI_TIMEOUT'
            });
        }

        console.error('[ERROR] /analyze-coffee:', error.message);
        res.status(500).json({
            success: false,
            error: 'Analysis failed. Please try again.'
        });
    }
});

export default router;
