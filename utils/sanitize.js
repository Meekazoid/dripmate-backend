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
 * @returns {string} - Validated process or default 'washed'
 */
export function validateProcess(process) {
    const validProcesses = [
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
    
    if (!process || typeof process !== 'string') return 'washed';
    
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
    
    return 'washed';
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

    // Keep unknown/legacy fields for backward compatibility.
    const sanitized = { ...coffeeData };

    const FEEDBACK_KEYS = ['bitterness', 'sweetness', 'acidity', 'body'];
    const FEEDBACK_VALUES = ['low', 'balanced', 'high'];
    const MAX_HISTORY_ENTRIES = 30;
    
    // Field-level constraints from requirements
    // These text fields are user-provided and need HTML stripping + truncation
    const stringFields = {
        name: 200,
        origin: 200,
        cultivar: 200,
        roaster: 200,
        roastery: 200,     // ← NEW: Rösterei field for card editor
        tastingNotes: 500
    };
    
    // Sanitize string fields with HTML stripping and truncation
    for (const [field, maxLength] of Object.entries(stringFields)) {
        const value = coffeeData[field];
        if (value !== undefined && value !== null) {
            const stripped = stripHTML(String(value));
            sanitized[field] = truncateString(stripped, maxLength);
        }
    }
    
    // Sanitize process field with validation
    if (coffeeData.process !== undefined) {
        sanitized.process = validateProcess(coffeeData.process);
    }
    
    // Sanitize altitude field
    if (coffeeData.altitude !== undefined) {
        sanitized.altitude = cleanAltitude(coffeeData.altitude);
    }

    // Validate feedback (known keys + low|balanced|high values), tolerate unknown keys.
    if (coffeeData.feedback !== undefined) {
        const feedback = coffeeData.feedback;
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

                // Keep unknown/legacy feedback keys as-is to avoid breaking older clients.
                nextFeedback[key] = value;
            }

            sanitized.feedback = nextFeedback;
        }
    }

    // Validate feedback history with type/format guards and hard server-side cap.
    if (coffeeData.feedbackHistory !== undefined) {
        if (Array.isArray(coffeeData.feedbackHistory)) {
            const sanitizedHistory = coffeeData.feedbackHistory
                .slice(-MAX_HISTORY_ENTRIES)
                .map((entry) => {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

                    const sanitizedEntry = {};

                    const date = new Date(entry.timestamp);
                    if (!entry.timestamp || Number.isNaN(date.getTime())) return null;
                    sanitizedEntry.timestamp = date.toISOString();

                    if (typeof entry.previousGrind === 'string') {
                        sanitizedEntry.previousGrind = truncateString(stripHTML(entry.previousGrind), 100);
                    }
                    if (typeof entry.newGrind === 'string') {
                        sanitizedEntry.newGrind = truncateString(stripHTML(entry.newGrind), 100);
                    }
                    if (typeof entry.previousTemp === 'string') {
                        sanitizedEntry.previousTemp = truncateString(stripHTML(entry.previousTemp), 50);
                    }
                    if (typeof entry.newTemp === 'string') {
                        sanitizedEntry.newTemp = truncateString(stripHTML(entry.newTemp), 50);
                    }
                    if (typeof entry.grindOffsetDelta === 'number' && Number.isFinite(entry.grindOffsetDelta)) {
                        sanitizedEntry.grindOffsetDelta = entry.grindOffsetDelta;
                    }
                    if (typeof entry.customTempApplied === 'boolean') {
                        sanitizedEntry.customTempApplied = entry.customTempApplied;
                    }
                    if (typeof entry.resetToInitial === 'boolean') {
                        sanitizedEntry.resetToInitial = entry.resetToInitial;
                    }

                    return sanitizedEntry;
                })
                .filter(Boolean);

            sanitized.feedbackHistory = sanitizedHistory;
        }
    }
    
    // Preserve fields that don't need sanitization (dates, IDs, metadata)
    const nonStringFields = [
        'addedDate',       // ISO date string when coffee was added
        'id',              // Database ID
        'savedAt',         // Backend timestamp
        'createdAt',       // Backend timestamp
        'updatedAt',       // Backend timestamp
        'roastDate',       // User-set roast date (YYYY-MM-DD)
        'favorite',        // Boolean flag
        'favoritedAt',     // ISO date string
        'deleted',         // Boolean flag (soft delete / compost)
        'deletedAt',       // ISO date string
        'grindOffset',     // Integer: grinder-neutral adjustment
        'customTemp',      // String: user-adjusted temperature
        'customAmount',    // Number: user-adjusted coffee amount (grams)
        'initialGrind',    // String: initial grind setting (for reset)
        'initialTemp',     // String: initial temperature (for reset)
        // feedback / feedbackHistory handled with dedicated validation above
    ];
    
    for (const field of nonStringFields) {
        if (coffeeData[field] !== undefined) {
            sanitized[field] = coffeeData[field];
        }
    }
    
    return sanitized;
}
