// Unit Tests for Sanitization Utilities
// Run with: npm test

import {
    stripHTML,
    truncateString,
    cleanAltitude,
    validateProcess,
    sanitizeCoffeeData
} from '../utils/sanitize.js';

describe('Sanitization Utilities', () => {
    describe('stripHTML', () => {
        test('should remove simple HTML tags', () => {
            expect(stripHTML('<b>Bold</b>')).toBe('Bold');
            expect(stripHTML('<script>alert("xss")</script>')).toBe('alert("xss")');
        });

        test('should remove complex HTML tags', () => {
            expect(stripHTML('<div class="test">Content</div>')).toBe('Content');
            expect(stripHTML('<a href="http://evil.com">Link</a>')).toBe('Link');
        });

        test('should handle multiple tags', () => {
            expect(stripHTML('<p>Hello <b>World</b></p>')).toBe('Hello World');
        });

        test('should handle non-string inputs', () => {
            expect(stripHTML(null)).toBe('');
            expect(stripHTML(undefined)).toBe('');
            expect(stripHTML(123)).toBe('');
        });

        test('should handle strings without HTML', () => {
            expect(stripHTML('Plain text')).toBe('Plain text');
        });

        test('should remove HTML entities', () => {
            expect(stripHTML('&lt;script&gt;')).toBe('script');
            expect(stripHTML('&amp;')).toBe('');
            expect(stripHTML('Test&nbsp;Text')).toBe('TestText');
        });

        test('should handle malformed/nested HTML tags', () => {
            // Multiple passes handle nested tags
            expect(stripHTML('<script<script>>')).toBe('>');
            expect(stripHTML('<<script>>alert(1)<</script>>')).toBe('>alert(1)>');
            // Verify actual dangerous content is removed
            expect(stripHTML('<b>Normal <script>evil</script> text</b>')).toBe('Normal evil text');
        });
    });

    describe('truncateString', () => {
        test('should truncate long strings', () => {
            const longString = 'a'.repeat(300);
            expect(truncateString(longString, 200)).toBe('a'.repeat(200));
        });

        test('should not truncate short strings', () => {
            expect(truncateString('Short', 200)).toBe('Short');
        });

        test('should handle exact length strings', () => {
            const exactString = 'a'.repeat(200);
            expect(truncateString(exactString, 200)).toBe(exactString);
        });
    });

    describe('cleanAltitude', () => {
        test('should keep numeric altitude', () => {
            expect(cleanAltitude('1500')).toBe('1500');
        });

        test('should remove units from altitude', () => {
            expect(cleanAltitude('1500 masl')).toBe('1500');
        });

        test('should handle altitude ranges', () => {
            expect(cleanAltitude('1500-1800')).toBe('1500-1800');
        });

        test('should strip HTML from altitude', () => {
            expect(cleanAltitude('<b>1500</b> masl')).toBe('1500');
        });
    });

    describe('validateProcess', () => {
        test('should validate known processes', () => {
            expect(validateProcess('washed')).toBe('washed');
            expect(validateProcess('natural')).toBe('natural');
            expect(validateProcess('honey')).toBe('honey');
            expect(validateProcess('anaerobic natural')).toBe('anaerobic natural');
        });

        test('should validate unknown as a valid process', () => {
            expect(validateProcess('unknown')).toBe('unknown');
        });

        test('should be case-insensitive', () => {
            expect(validateProcess('WASHED')).toBe('washed');
            expect(validateProcess('Natural')).toBe('natural');
            expect(validateProcess('HoNeY')).toBe('honey');
            expect(validateProcess('UNKNOWN')).toBe('unknown');
        });

        test('should handle processes with extra words', () => {
            expect(validateProcess('honey process')).toBe('honey');
            expect(validateProcess('washed method')).toBe('washed');
        });

        test('should remove HTML from process', () => {
            expect(validateProcess('<b>washed</b>')).toBe('washed');
            expect(validateProcess('<script>natural</script>')).toBe('natural');
        });

        test('should default to "unknown" for invalid processes', () => {
            expect(validateProcess('invalid')).toBe('unknown');
            expect(validateProcess('some random text')).toBe('unknown');
            expect(validateProcess('')).toBe('unknown');
        });

        test('should handle non-string inputs', () => {
            expect(validateProcess(null)).toBe('unknown');
            expect(validateProcess(undefined)).toBe('unknown');
            expect(validateProcess(123)).toBe('unknown');
        });
    });

    describe('sanitizeCoffeeData', () => {
        test('should sanitize all string fields', () => {
            const input = {
                name: '<script>Evil Coffee</script>',
                origin: '<b>Ethiopia</b>',
                cultivar: '<div>Heirloom</div>',
                roaster: '<a href="evil.com">Roaster</a>',
                tastingNotes: '<p>Fruity and sweet</p>',
                process: 'washed',
                altitude: '1500'
            };

            const result = sanitizeCoffeeData(input);

            expect(result.name).toBe('Evil Coffee');
            expect(result.origin).toBe('Ethiopia');
            expect(result.cultivar).toBe('Heirloom');
            expect(result.roaster).toBe('Roaster');
            expect(result.tastingNotes).toBe('Fruity and sweet');
        });

        test('should truncate long strings', () => {
            const input = {
                name: 'a'.repeat(300),
                origin: 'b'.repeat(300),
                cultivar: 'c'.repeat(300),
                roaster: 'd'.repeat(300),
                tastingNotes: 'e'.repeat(600)
            };

            const result = sanitizeCoffeeData(input);

            expect(result.name.length).toBe(200);
            expect(result.origin.length).toBe(200);
            expect(result.cultivar.length).toBe(200);
            expect(result.roaster.length).toBe(200);
            expect(result.tastingNotes.length).toBe(500);
        });

        test('should validate and clean process field', () => {
            const input = { process: '<b>natural</b>' };
            const result = sanitizeCoffeeData(input);
            expect(result.process).toBe('natural');
        });

        test('should clean altitude field', () => {
            const input = { altitude: '<b>1500</b> masl' };
            const result = sanitizeCoffeeData(input);
            expect(result.altitude).toBe('1500');
        });

        test('should validate feedback keys and values while keeping unknown keys', () => {
            const input = {
                feedback: {
                    bitterness: 'HIGH',
                    sweetness: 'balanced',
                    acidity: 'low',
                    body: 'invalid',
                    legacyKey: 'keep-me'
                }
            };

            const result = sanitizeCoffeeData(input);

            expect(result.feedback).toEqual({
                bitterness: 'high',
                sweetness: 'balanced',
                acidity: 'low',
                legacyKey: 'keep-me'
            });
        });

        test('should cap feedbackHistory to 30 and validate entry types', () => {
            const entries = Array.from({ length: 35 }, (_, i) => ({
                timestamp: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
                previousGrind: `old-${i}`,
                newGrind: `new-${i}`,
                previousTemp: '92',
                newTemp: '93',
                grindOffsetDelta: 0.5,
                customTempApplied: i % 2 === 0,
                resetToInitial: i % 3 === 0,
            }));
            entries.push({ timestamp: 'not-a-date', previousGrind: 'x' });

            const result = sanitizeCoffeeData({ feedbackHistory: entries });

            expect(Array.isArray(result.feedbackHistory)).toBe(true);
            expect(result.feedbackHistory.length).toBe(29);
            expect(result.feedbackHistory[0].previousGrind).toBe('old-6');
            expect(result.feedbackHistory[result.feedbackHistory.length - 1].newGrind).toBe('new-34');
        });
    });
});
