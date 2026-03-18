// ==========================================
// Concurrency stress tests for withTransaction
//
// Verifies that the SQLite promise queue serializes parallel transactions
// correctly under load. Tests both successful parallel writes and
// mixed success/failure scenarios.
// ==========================================

import { initDatabase, queries, closeDatabase, withTransaction } from '../db/database.js';

describe('Transaction Concurrency Stress Tests', () => {
    let testUserId;

    beforeAll(async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.DATABASE_URL;
        await initDatabase();
        testUserId = await queries.createUser('concurrency_user_' + Date.now(), 'concurrency-token-' + Date.now());
    });

    afterAll(async () => {
        await closeDatabase();
    });

    test('10 parallel transactions should all succeed without SQLite errors', async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
            withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT(user_id, coffee_uid)
                     DO UPDATE SET data = excluded.data`,
                    [testUserId, `stress-${i}`, JSON.stringify({ name: `Stress Coffee ${i}` }), 'v60']
                );
                return i;
            })
        );

        const results = await Promise.all(promises);

        // All 10 should resolve with their index
        expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

        // All 10 coffees should exist
        const coffees = await queries.getUserCoffees(testUserId);
        const stressCoffees = coffees.filter(c => c.coffee_uid.startsWith('stress-'));
        expect(stressCoffees.length).toBe(10);
    });

    test('mixed success/failure: failures should not block subsequent transactions', async () => {
        // Clear previous test data
        await withTransaction(async (tx) => {
            await tx.run(`DELETE FROM coffees WHERE user_id = $1`, [testUserId]);
        });

        const results = await Promise.allSettled([
            // TX 1: succeeds
            withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method) VALUES ($1, $2, $3, $4)`,
                    [testUserId, 'mix-ok-1', JSON.stringify({ name: 'OK 1' }), 'v60']
                );
                return 'ok-1';
            }),
            // TX 2: fails intentionally
            withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method) VALUES ($1, $2, $3, $4)`,
                    [testUserId, 'mix-fail', JSON.stringify({ name: 'Will fail' }), 'v60']
                );
                throw new Error('Intentional failure');
            }),
            // TX 3: succeeds (should NOT be blocked by TX 2's failure)
            withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method) VALUES ($1, $2, $3, $4)`,
                    [testUserId, 'mix-ok-2', JSON.stringify({ name: 'OK 2' }), 'v60']
                );
                return 'ok-2';
            }),
        ]);

        expect(results[0].status).toBe('fulfilled');
        expect(results[0].value).toBe('ok-1');

        expect(results[1].status).toBe('rejected');
        expect(results[1].reason.message).toBe('Intentional failure');

        expect(results[2].status).toBe('fulfilled');
        expect(results[2].value).toBe('ok-2');

        // Only the two successful coffees should exist (failed TX was rolled back)
        const coffees = await queries.getUserCoffees(testUserId);
        const uids = coffees.map(c => c.coffee_uid);
        expect(uids).toContain('mix-ok-1');
        expect(uids).toContain('mix-ok-2');
        expect(uids).not.toContain('mix-fail');
    });

    test('sequential transactions after parallel batch should work', async () => {
        // After the stress above, a simple sequential TX should still work fine
        await withTransaction(async (tx) => {
            await tx.run(
                `INSERT INTO coffees (user_id, coffee_uid, data, method)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT(user_id, coffee_uid)
                 DO UPDATE SET data = excluded.data`,
                [testUserId, 'post-stress', JSON.stringify({ name: 'After Stress' }), 'v60']
            );
        });

        const coffee = await queries.getCoffeeByUid(testUserId, 'post-stress');
        expect(coffee).not.toBeNull();
        expect(JSON.parse(coffee.data).name).toBe('After Stress');
    });
});
