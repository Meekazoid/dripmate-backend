// ==========================================
// Integration tests for POST /api/analyze-coffee error handling
//
// Tests all differentiated error paths introduced in v5.4 (T-8):
// - Anthropic HTTP errors: 401, 429, 529, 400, generic
// - Network failures: fetch failed, ECONNRESET, etc.
// - Timeout: AbortError
// - Missing image data (400)
// - Daily scan limit (403)
// ==========================================

import { jest } from '@jest/globals';

// --- Mock authenticateUser middleware (bypass auth for unit tests) ---
jest.unstable_mockModule('../middleware/auth.js', () => ({
    authenticateUser: (req, _res, next) => {
        req.user = { id: 1, username: 'testuser' };
        next();
    }
}));

// --- Mock database queries ---
jest.unstable_mockModule('../db/database.js', () => ({
    queries: {
        getSuccessfulScansToday: jest.fn().mockResolvedValue(0),
        incrementSuccessfulScansToday: jest.fn().mockResolvedValue(),
    }
}));

// We'll control fetch per-test
const originalFetch = global.fetch;
afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

// Dynamic imports after mocks are registered
const { default: express } = await import('express');
const { default: analyzeRouter } = await import('../routes/analyze.js');
const { queries } = await import('../db/database.js');

// Minimal Express app for testing
function buildApp() {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/analyze-coffee', analyzeRouter);
    return app;
}

// Helper: make a POST request to the analyze endpoint
async function postAnalyze(app, body = {}) {
    const { default: http } = await import('http');
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
            const port = server.address().port;
            const postData = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/api/analyze-coffee',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    server.close();
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });
            req.on('error', (err) => { server.close(); reject(err); });
            req.write(postData);
            req.end();
        });
    });
}

const VALID_BODY = { imageData: 'dGVzdA==', mediaType: 'image/jpeg' };

describe('POST /api/analyze-coffee — Error Handling', () => {

    beforeEach(() => {
        process.env.ANTHROPIC_API_KEY = 'test-key-for-mocking';
        queries.getSuccessfulScansToday.mockResolvedValue(0);
    });

    // ------------------------------------------
    // Input validation
    // ------------------------------------------

    test('400 — missing imageData', async () => {
        const app = buildApp();
        const { status, body } = await postAnalyze(app, {});
        expect(status).toBe(400);
        expect(body.error).toMatch(/image data required/i);
    });

    // ------------------------------------------
    // Daily scan limit
    // ------------------------------------------

    test('403 — daily scan limit reached', async () => {
        queries.getSuccessfulScansToday.mockResolvedValue(5);
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(403);
        expect(body.errorCode).toBe('DAILY_SCAN_LIMIT_REACHED');
    });

    // ------------------------------------------
    // Anthropic HTTP error responses
    // ------------------------------------------

    test('503 + AI_AUTH_ERROR — Anthropic returns 401', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'Invalid API key' } })
        });
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(503);
        expect(body.errorCode).toBe('AI_AUTH_ERROR');
    });

    test('429 + AI_RATE_LIMIT — Anthropic returns 429', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 429,
            json: async () => ({ error: { message: 'Rate limit exceeded' } })
        });
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(429);
        expect(body.errorCode).toBe('AI_RATE_LIMIT');
    });

    test('503 + AI_OVERLOADED — Anthropic returns 529', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 529,
            json: async () => ({ error: { message: 'Overloaded' } })
        });
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(503);
        expect(body.errorCode).toBe('AI_OVERLOADED');
    });

    test('422 + AI_BAD_REQUEST — Anthropic returns 400', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ error: { message: 'Image too large' } })
        });
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(422);
        expect(body.errorCode).toBe('AI_BAD_REQUEST');
    });

    test('502 + AI_UPSTREAM_ERROR — Anthropic returns unexpected status', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: { message: 'Service unavailable' } })
        });
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(502);
        expect(body.errorCode).toBe('AI_UPSTREAM_ERROR');
    });

    // ------------------------------------------
    // Network / transport failures (outer catch)
    // ------------------------------------------

    test('502 + AI_UPSTREAM_ERROR — fetch throws "fetch failed"', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(502);
        expect(body.errorCode).toBe('AI_UPSTREAM_ERROR');
    });

    test('502 + AI_UPSTREAM_ERROR — fetch throws ECONNRESET', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('read ECONNRESET'));
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(502);
        expect(body.errorCode).toBe('AI_UPSTREAM_ERROR');
    });

    test('502 + AI_UPSTREAM_ERROR — fetch throws ENOTFOUND', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.anthropic.com'));
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(502);
        expect(body.errorCode).toBe('AI_UPSTREAM_ERROR');
    });

    // ------------------------------------------
    // Timeout
    // ------------------------------------------

    test('504 + AI_TIMEOUT — fetch throws AbortError', async () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        global.fetch = jest.fn().mockRejectedValue(abortError);
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(504);
        expect(body.errorCode).toBe('AI_TIMEOUT');
    });

    test('504 + AI_TIMEOUT — fetch throws with "timed out" message', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('request timed out'));
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(504);
        expect(body.errorCode).toBe('AI_TIMEOUT');
    });

    // ------------------------------------------
    // Fallback: unexpected internal error
    // ------------------------------------------

    test('500 + AI_INTERNAL_ERROR — unexpected error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('something completely unexpected'));
        const app = buildApp();
        const { status, body } = await postAnalyze(app, VALID_BODY);
        expect(status).toBe(500);
        expect(body.errorCode).toBe('AI_INTERNAL_ERROR');
    });
});
