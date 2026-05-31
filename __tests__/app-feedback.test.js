// Tests for App Feedback — createAppFeedback query + submit route
// Runs against SQLite dev path (no DATABASE_URL needed)

import { initDatabase, queries, closeDatabase, getDatabaseType } from '../db/database.js';

describe('App Feedback', () => {
    let testUserId;
    const testToken  = 'af-test-token-' + Date.now();
    const testDevice = 'af-device-' + Date.now();

    beforeAll(async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.DATABASE_URL;
        await initDatabase();
        testUserId = await queries.createUser('af_user_' + Date.now(), testToken, testDevice, null);
    });

    afterAll(async () => {
        await closeDatabase();
    });

    describe('createAppFeedback', () => {
        test('inserts a basic feedback row and returns an id', async () => {
            const id = await queries.createAppFeedback({
                userId:             testUserId,
                category:           'bug',
                message:            'Something is broken',
                grinderText:        null,
                methodText:         null,
                grinderUnsupported: 0,
                methodUnsupported:  0,
                appVersion:         '5.3',
                platform:           'pwa',
            });
            expect(id).toBeDefined();
            expect(id).toBeGreaterThan(0);
        });

        test('accepts null category (no category selected)', async () => {
            const id = await queries.createAppFeedback({
                userId:             testUserId,
                category:           null,
                message:            'General feedback',
                grinderText:        null,
                methodText:         null,
                grinderUnsupported: 0,
                methodUnsupported:  0,
                appVersion:         null,
                platform:           'web',
            });
            expect(id).toBeGreaterThan(0);
        });

        test('stores grinder wish correctly', async () => {
            await queries.createAppFeedback({
                userId:             testUserId,
                category:           'wish',
                message:            'Please add Niche Zero',
                grinderText:        'Niche Zero',
                methodText:         null,
                grinderUnsupported: 1,
                methodUnsupported:  0,
                appVersion:         '5.3',
                platform:           'ios_pwa',
            });
            // Verify it appears in rankings
            const { grinders } = await queries.getAppFeedbackEquipmentRanking();
            const niche = grinders.find(g => g.name === 'niche zero');
            expect(niche).toBeDefined();
            expect(parseInt(niche.count)).toBeGreaterThanOrEqual(1);
        });
    });

    describe('listAppFeedback', () => {
        test('returns items ordered by created_at DESC', async () => {
            const items = await queries.listAppFeedback({ limit: 10 });
            expect(Array.isArray(items)).toBe(true);
            expect(items.length).toBeGreaterThan(0);
        });

        test('filters by category', async () => {
            const bugs = await queries.listAppFeedback({ category: 'bug' });
            expect(bugs.every(i => i.category === 'bug')).toBe(true);
        });

        test('filters by status', async () => {
            const newItems = await queries.listAppFeedback({ status: 'new' });
            expect(newItems.every(i => i.status === 'new')).toBe(true);
        });
    });

    describe('updateAppFeedbackStatus', () => {
        test('updates status from new to seen', async () => {
            const id = await queries.createAppFeedback({
                userId: testUserId, category: 'praise', message: 'Love it!',
                grinderText: null, methodText: null, grinderUnsupported: 0,
                methodUnsupported: 0, appVersion: null, platform: 'web',
            });

            await queries.updateAppFeedbackStatus(id, 'seen');

            const items = await queries.listAppFeedback({ status: 'seen' });
            const updated = items.find(i => i.id === id);
            expect(updated).toBeDefined();
            expect(updated.status).toBe('seen');
        });
    });

    describe('getAppFeedbackEquipmentRanking', () => {
        test('returns grinders and methods arrays', async () => {
            const { grinders, methods } = await queries.getAppFeedbackEquipmentRanking();
            expect(Array.isArray(grinders)).toBe(true);
            expect(Array.isArray(methods)).toBe(true);
        });

        test('each item has name and count', async () => {
            const { grinders } = await queries.getAppFeedbackEquipmentRanking();
            if (grinders.length > 0) {
                expect(grinders[0]).toHaveProperty('name');
                expect(grinders[0]).toHaveProperty('count');
            }
        });
    });
});
