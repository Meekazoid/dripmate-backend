// ==========================================
// SANITIZATION UTILITIES
// ==========================================
//
// SECURITY NOTE: This module provides basic regex-based sanitization for
// defense-in-depth. It is NOT a complete XSS prevention solution.
//
// Known limitations of regex-based HTML stripping:
// - May not catch all malformed HTML edge cases
// - Does not handle JavaScript in attributes (e.g., onclick, onerror)
// - Does not decode all possible HTML entity encodings
//
// Defense-in-depth strategy:
// 1. This backend sanitization provides a first layer of defense
// 2. Frontend MUST also sanitize user-facing output (e.g., using DOMPurify)
// 3. Database stores sanitized data to prevent persistence of malicious content
//
// This approach meets the requirements for no external dependencies while
// acknowledging that complete XSS prevention requires multiple layers.
// ==========================================

/**
 * Strip HTML tags from a string
 * Note: This is a basic regex-based approach for defense-in-depth.
 * It removes HTML tags but does not handle all XSS vectors.
 * Frontend should also implement proper sanitization (e.g., DOMPurify).
 * @param {string} str - Input string
 * @returns {string} - String with HTML tags removed
 */
export function stripHTML(str) {
    if (typeof str !== 'string') return '';
    
    let result = str;
    let previous = '';
    
    // Run multiple passes to handle nested/malformed tags like <script<script>>
    while (result !== previous) {
        previous = result;
        result = result
            .replace(/<[^>]*>/g, '')        // Remove HTML tags
            .replace(/&[^;]+;/g, '');       // Remove HTML entities
    }
    
    return result;
}

/**
 * Truncate a string to a maximum length
 * @param {string} str - Input string
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated string
 */
export function truncateString(str, maxLength) {
    if (typeof str !== 'string') return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength);
}

/**
 * Validate and clean altitude field
 * @param {string|number} altitude - Altitude value
 * @returns {string} - Cleaned altitude string
 */
export function cleanAltitude(altitude) {
    if (!altitude) return '';
    const str = String(altitude);
    // Strip HTML first
    const cleaned = stripHTML(str);
    // Keep only digits, hyphens, and spaces (remove units like "masl", "m", etc.)
    const result = cleaned.replace(/[^0-9\-\s]/g, '');
    return truncateString(result.trim(), 50);
}

/**
 * Validate process method against known values
 * @param {string} process - Process method
 * @returns {string} - Validated process or default 'unknown'
 */
export function validateProcess(process) {
    const validProcesses = [
        'unknown',
        'washed',
        'natural',
        'honey',
        'anaerobic',
        'wet hulled',
        'semi-washed',
        'pulped natural',
        'carbonic maceration',
        'anaerobic natural',
        'anaerobic washed',
        'yeast inoculated natural',
        'nitro washed',
        'extended fermentation'
    ];
    
    if (!process || typeof process !== 'string') return 'unknown';
    
    const cleaned = stripHTML(process).toLowerCase().trim();
    
    // Check if the cleaned process is in the valid list
    if (validProcesses.includes(cleaned)) {
        return cleaned;
    }
    
    // Check for partial matches (e.g., "honey process" -> "honey")
    for (const valid of validProcesses) {
        if (cleaned.includes(valid)) {
            return valid;
        }
    }
    
    return 'unknown';
}

/**
 * Sanitize a complete coffee data object
 * @param {Object} coffeeData - Raw coffee data
 * @returns {Object} - Sanitized coffee data
 */
export function sanitizeCoffeeData(coffeeData) {
    if (!coffeeData || typeof coffeeData !== 'object') {
        return {};
    }

    // 1. Zwinge das kanonische Schema (fängt alte PWAs ab, die noch alte Namen senden)
    const data = { ...coffeeData };
    if (data.coffee_name !== undefined) { data.name = data.name || data.coffee_name; delete data.coffee_name; }
    if (data.roaster !== undefined) { data.roastery = data.roastery || data.roaster; delete data.roaster; }
    if (data.variety !== undefined) { data.cultivar = data.cultivar || data.variety; delete data.variety; }
    if (data.tasting_notes !== undefined) { data.tastingNotes = data.tastingNotes || data.tasting_notes; delete data.tasting_notes; }
    if (data.color_tag !== undefined) { data.colorTag = data.colorTag || data.color_tag; delete data.color_tag; }

    const sanitized = { ...data };

    const FEEDBACK_KEYS = ['bitterness', 'sweetness', 'acidity', 'body'];
    const FEEDBACK_VALUES = ['low', 'balanced', 'high'];
    const MAX_HISTORY_ENTRIES = 30;
    
    // Kanonische Text-Felder
    const stringFields = {
        name: 200,
        origin: 200,
        cultivar: 200,
        roastery: 200,
        tastingNotes: 500,
        colorTag: 50
    };
    
    // String-Felder desinfizieren und abschneiden
    for (const [field, maxLength] of Object.entries(stringFields)) {
        const value = data[field];
        if (value !== undefined && value !== null) {
            const stripped = stripHTML(String(value));
            sanitized[field] = truncateString(stripped, maxLength);
        }
    }
    
    // Process Methode validieren
    if (data.process !== undefined) {
        sanitized.process = validateProcess(data.process);
    }
    
    // Altitude desinfizieren
    if (data.altitude !== undefined) {
        sanitized.altitude = cleanAltitude(data.altitude);
    }

    // Feedback validieren
    if (data.feedback !== undefined) {
        const feedback = data.feedback;
        if (feedback && typeof feedback === 'object' && !Array.isArray(feedback)) {
            const nextFeedback = {};
            for (const [key, value] of Object.entries(feedback)) {
                if (FEEDBACK_KEYS.includes(key) && typeof value === 'string') {
                    const normalized = value.toLowerCase().trim();
                    if (FEEDBACK_VALUES.includes(normalized)) {
                        nextFeedback[key] = normalized;
                    }
                    continue;
                }
                nextFeedback[key] = value;
            }
            sanitized.feedback = nextFeedback;
        }
    }

    // Feedback History validieren
    if (data.feedbackHistory !== undefined) {
        if (Array.isArray(data.feedbackHistory)) {
            const sanitizedHistory = data.feedbackHistory
                .slice(-MAX_HISTORY_ENTRIES)
                .map((entry) => {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

                    const sanitizedEntry = {};

                    const date = new Date(entry.timestamp);
                    if (!entry.timestamp || Number.isNaN(date.getTime())) return null;
                    sanitizedEntry.timestamp = date.toISOString();

                    if (typeof entry.previousGrind === 'string') { sanitizedEntry.previousGrind = truncateString(stripHTML(entry.previousGrind), 100); }
                    if (typeof entry.newGrind === 'string') { sanitizedEntry.newGrind = truncateString(stripHTML(entry.newGrind), 100); }
                    if (typeof entry.previousTemp === 'string') { sanitizedEntry.previousTemp = truncateString(stripHTML(entry.previousTemp), 50); }
                    if (typeof entry.newTemp === 'string') { sanitizedEntry.newTemp = truncateString(stripHTML(entry.newTemp), 50); }
                    if (typeof entry.grindOffsetDelta === 'number' && Number.isFinite(entry.grindOffsetDelta)) { sanitizedEntry.grindOffsetDelta = entry.grindOffsetDelta; }
                    if (typeof entry.resetToInitial === 'boolean') { sanitizedEntry.resetToInitial = entry.resetToInitial; }
                    if (entry.manualAdjust === 'grind' || entry.manualAdjust === 'temp') { sanitizedEntry.manualAdjust = entry.manualAdjust; }
                    if (typeof entry.customTempApplied === 'string') {
                        sanitizedEntry.customTempApplied = truncateString(stripHTML(entry.customTempApplied), 50);
                    } else if (typeof entry.customTempApplied === 'boolean') {
                        sanitizedEntry.customTempApplied = entry.customTempApplied;
                    }
                    if (entry.brewStart === true) {
                        sanitizedEntry.brewStart = true;
                        if (typeof entry.brewLabel === 'string') { sanitizedEntry.brewLabel = truncateString(stripHTML(entry.brewLabel), 200); }
                    }

                    return sanitizedEntry;
                })
                .filter(Boolean);

            sanitized.feedbackHistory = sanitizedHistory;
        }
    }
    
    const nonStringFields = [
        'addedDate', 'id', 'savedAt', 'createdAt', 'updatedAt', 'roastDate', 
        'favorite', 'favoritedAt', 'deleted', 'deletedAt', 'grindOffset', 
        'customTemp', 'customAmount', 'initialGrind', 'initialTemp'
    ];
    
    for (const field of nonStringFields) {
        if (data[field] !== undefined) {
            sanitized[field] = data[field];
        }
    }
    
    return sanitized;
}
