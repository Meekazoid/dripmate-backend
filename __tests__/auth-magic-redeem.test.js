import { jest } from '@jest/globals';
import { resolveMagicToBearerToken } from '../routes/auth.js';
import { queries } from '../db/database.js';
import { buildTokenEmail } from '../utils/emailTemplate.js';

describe('magic parameter compatibility', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('prefers one-time magic link tokens and marks them as used', async () => {
        jest.spyOn(queries, 'getMagicLinkToken').mockResolvedValue({ user_id: 12, user_token: 'bearer-abc' });
        const markUsed = jest.spyOn(queries, 'markMagicLinkUsed').mockResolvedValue({});
        jest.spyOn(queries, 'getUserByToken').mockResolvedValue(null);
        jest.spyOn(queries, 'getRegistrationByToken').mockResolvedValue(null);

        const token = await resolveMagicToBearerToken('magic-123');

        expect(token).toBe('bearer-abc');
        expect(markUsed).toHaveBeenCalledWith('magic-123');
    });

    test('accepts existing bearer token in magic param for compatibility', async () => {
        jest.spyOn(queries, 'getMagicLinkToken').mockResolvedValue(null);
        jest.spyOn(queries, 'getUserByToken').mockResolvedValue({ username: 'mia', token: 'bearer-existing' });
        jest.spyOn(queries, 'getRegistrationByToken').mockResolvedValue(null);

        const token = await resolveMagicToBearerToken('BREW-ABC123');

        expect(token).toBe('bearer-existing');
    });

    test('accepts registration token in magic param for compatibility', async () => {
        jest.spyOn(queries, 'getMagicLinkToken').mockResolvedValue(null);
        jest.spyOn(queries, 'getUserByToken').mockResolvedValue(null);
        jest.spyOn(queries, 'getRegistrationByToken').mockResolvedValue({ email: 'test@example.com', token: 'BREW-Z9X7Y2' });

        const token = await resolveMagicToBearerToken('BREW-Z9X7Y2');

        expect(token).toBe('BREW-Z9X7Y2');
    });

    test('registration email CTA keeps using magic param', () => {
        const html = buildTokenEmail('test@example.com', 'BREW-W9ZD63', 'https://dripmate.app');
        expect(html).toContain('https://dripmate.app/?magic=BREW-W9ZD63');
        expect(html).not.toContain('https://dripmate.app/?token=BREW-W9ZD63');
    });
});
