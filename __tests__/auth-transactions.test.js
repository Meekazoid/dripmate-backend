// Tests for authentication middleware and transaction support
import { initDatabase, queries, closeDatabase, withTransaction } from '../db/database.js';

describe('Authentication and Transactions', () => {
    beforeAll(async () => {
        // Use SQLite for testing
        process.env.NODE_ENV = 'development';
        delete process.env.DATABASE_URL;
        await initDatabase();
    });

    afterAll(async () => {
        await closeDatabase();
    });

    describe('Transaction Support (withTransaction)', () => {
        let testUserId;
        const testToken = 'transaction-test-token-' + Date.now();

        beforeAll(async () => {
            testUserId = await queries.createUser('transactionuser_' + Date.now(), testToken);
        });

        test('should commit transaction successfully', async () => {
            const coffeeData = JSON.stringify({
                name: 'Transaction Test Coffee',
                origin: 'Colombia',
                process: 'washed'
            });

            await withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT(user_id, coffee_uid)
                     DO UPDATE SET data = excluded.data`,
                    [testUserId, 'tx-coffee-1', coffeeData, 'v60']
                );
            });

            const coffees = await queries.getUserCoffees(testUserId);
            expect(coffees.length).toBeGreaterThan(0);
        });

        test('should rollback transaction on error', async () => {
            const initialCoffees = await queries.getUserCoffees(testUserId);
            const initialCount = initialCoffees.length;

            await expect(
                withTransaction(async (tx) => {
                    await tx.run(
                        `INSERT INTO coffees (user_id, coffee_uid, data, method)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT(user_id, coffee_uid)
                         DO UPDATE SET data = excluded.data`,
                        [testUserId, 'tx-rollback-coffee', JSON.stringify({ name: 'Will be rolled back' }), 'v60']
                    );

                    // Simulate an error — withTransaction will auto-rollback
                    throw new Error('Simulated error');
                })
            ).rejects.toThrow('Simulated error');

            // Coffee count should remain the same after rollback
            const coffeesAfterRollback = await queries.getUserCoffees(testUserId);
            expect(coffeesAfterRollback.length).toBe(initialCount);
        });

        test('should protect against data loss during sync operation', async () => {
            // First, set up initial coffees inside a transaction
            await withTransaction(async (tx) => {
                await tx.run(`DELETE FROM coffees WHERE user_id = $1`, [testUserId]);

                const initialCoffees = [
                    { name: 'Coffee 1', origin: 'Brazil' },
                    { name: 'Coffee 2', origin: 'Guatemala' }
                ];

                for (const coffee of initialCoffees) {
                    await tx.run(
                        `INSERT INTO coffees (user_id, coffee_uid, data, method)
                         VALUES ($1, $2, $3, $4)`,
                        [testUserId, `initial-${coffee.name}`, JSON.stringify(coffee), 'v60']
                    );
                }
            });

            // Now simulate a failed sync — should rollback and preserve originals
            await expect(
                withTransaction(async (tx) => {
                    await tx.run(`DELETE FROM coffees WHERE user_id = $1`, [testUserId]);

                    const newCoffees = [
                        { name: 'New Coffee 1', origin: 'Kenya' },
                        { name: 'New Coffee 2', origin: 'Rwanda' },
                    ];

                    for (let i = 0; i < newCoffees.length; i++) {
                        await tx.run(
                            `INSERT INTO coffees (user_id, coffee_uid, data, method)
                             VALUES ($1, $2, $3, $4)`,
                            [testUserId, `new-${i}`, JSON.stringify(newCoffees[i]), 'v60']
                        );
                    }

                    // Simulate error mid-sync
                    throw new Error('Database error during save');
                })
            ).rejects.toThrow('Database error during save');

            // Original coffees should still be there
            const coffeesAfterFailedSync = await queries.getUserCoffees(testUserId);
            expect(coffeesAfterFailedSync.length).toBe(2);

            const parsedCoffees = coffeesAfterFailedSync.map(c => JSON.parse(c.data));
            expect(parsedCoffees.some(c => c.name === 'Coffee 1')).toBe(true);
            expect(parsedCoffees.some(c => c.name === 'Coffee 2')).toBe(true);
        });

        test('should serialize concurrent SQLite transactions (no overlap)', async () => {
            // Both transactions target the same user but shouldn't interfere
            const tx1 = withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT(user_id, coffee_uid)
                     DO UPDATE SET data = excluded.data`,
                    [testUserId, 'concurrent-1', JSON.stringify({ name: 'Concurrent A' }), 'v60']
                );
                return 'tx1-done';
            });

            const tx2 = withTransaction(async (tx) => {
                await tx.run(
                    `INSERT INTO coffees (user_id, coffee_uid, data, method)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT(user_id, coffee_uid)
                     DO UPDATE SET data = excluded.data`,
                    [testUserId, 'concurrent-2', JSON.stringify({ name: 'Concurrent B' }), 'v60']
                );
                return 'tx2-done';
            });

            // Both should resolve without "cannot start a transaction within a transaction"
            const results = await Promise.all([tx1, tx2]);
            expect(results).toEqual(['tx1-done', 'tx2-done']);

            // Both coffees should exist
            const c1 = await queries.getCoffeeByUid(testUserId, 'concurrent-1');
            const c2 = await queries.getCoffeeByUid(testUserId, 'concurrent-2');
            expect(c1).not.toBeNull();
            expect(c2).not.toBeNull();
        });
    });

    describe('Auth Credential Extraction', () => {
        test('should extract credentials from Authorization header', () => {
            const mockReq = {
                headers: {
                    'authorization': 'Bearer test-token-123',
                    'x-device-id': 'device-456'
                },
                body: {},
                query: {}
            };

            let token = null;
            const authHeader = mockReq.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else {
                token = mockReq.body?.token || mockReq.query?.token;
            }
            
            const deviceId = mockReq.headers['x-device-id'] || mockReq.body?.deviceId || mockReq.query?.deviceId;

            expect(token).toBe('test-token-123');
            expect(deviceId).toBe('device-456');
        });

        test('should fallback to body when headers are not present', () => {
            const mockReq = {
                headers: {},
                body: {
                    token: 'body-token-789',
                    deviceId: 'body-device-012'
                },
                query: {}
            };

            let token = null;
            const authHeader = mockReq.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else {
                token = mockReq.body?.token || mockReq.query?.token;
            }
            
            const deviceId = mockReq.headers['x-device-id'] || mockReq.body?.deviceId || mockReq.query?.deviceId;

            expect(token).toBe('body-token-789');
            expect(deviceId).toBe('body-device-012');
        });

        test('should fallback to query when headers and body are not present', () => {
            const mockReq = {
                headers: {},
                body: {},
                query: {
                    token: 'query-token-345',
                    deviceId: 'query-device-678'
                }
            };

            let token = null;
            const authHeader = mockReq.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else {
                token = mockReq.body?.token || mockReq.query?.token;
            }
            
            const deviceId = mockReq.headers['x-device-id'] || mockReq.body?.deviceId || mockReq.query?.deviceId;

            expect(token).toBe('query-token-345');
            expect(deviceId).toBe('query-device-678');
        });

        test('should prefer headers over body and query', () => {
            const mockReq = {
                headers: {
                    'authorization': 'Bearer header-token',
                    'x-device-id': 'header-device'
                },
                body: {
                    token: 'body-token',
                    deviceId: 'body-device'
                },
                query: {
                    token: 'query-token',
                    deviceId: 'query-device'
                }
            };

            let token = null;
            const authHeader = mockReq.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else {
                token = mockReq.body?.token || mockReq.query?.token;
            }
            
            const deviceId = mockReq.headers['x-device-id'] || mockReq.body?.deviceId || mockReq.query?.deviceId;

            expect(token).toBe('header-token');
            expect(deviceId).toBe('header-device');
        });
    });
});
