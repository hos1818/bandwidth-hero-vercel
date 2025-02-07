/**
 * Copies headers from a source object to a target object, excluding specified headers and optionally transforming values.
 * @param {Object} source - The source object containing headers (e.g., a request or response object).
 * @param {Object} target - The target object to copy headers to (e.g., a response object).
 * @param {string[]} [additionalExcludedHeaders=[]] - Additional headers to exclude from copying.
 * @param {Function} [transformFunction=null] - Optional transformation function for header values. Receives (key, value).
 */
function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    const DEFAULT_EXCLUDED_HEADERS = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding', ':status', ':method', ':path',
    ];
    const PSEUDO_HEADERS = [':status', ':method', ':path', ':scheme', ':authority'];

    // Validate additionalExcludedHeaders
    if (!Array.isArray(additionalExcludedHeaders) || 
        !additionalExcludedHeaders.every(header => typeof header === 'string')) {
        throw new Error('Invalid "additionalExcludedHeaders": must be an array of strings.');
    }

    // Validate transformFunction
    if (transformFunction !== null && typeof transformFunction !== 'function') {
        throw new Error('Invalid "transformFunction": must be a function or null.');
    }

    // Merge and normalize excluded headers.
    const excludedHeaders = new Set([
        ...DEFAULT_EXCLUDED_HEADERS,
        ...additionalExcludedHeaders.map(header => header.toLowerCase()),
    ]);

    // Validate source and target objects.
    if (!source || typeof source.headers !== 'object' || source.headers === null || Object.keys(source.headers).length === 0) {
        throw new Error('Invalid source object: missing or invalid "headers" property.');
    }
    if (!target || typeof target.setHeader !== 'function') {
        throw new Error('Invalid target object: missing "setHeader" method.');
    }

    // Dry-run validation for target.setHeader
    try {
        target.setHeader('test-header', 'test-value');
        target.removeHeader('test-header'); // Clean up after validation.
    } catch (error) {
        throw new Error('Invalid target object: "setHeader" method failed during validation.');
    }

    // Iterate and copy headers
    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();

        // Skip excluded headers or pseudo-headers
        if (excludedHeaders.has(normalizedKey) || PSEUDO_HEADERS.includes(normalizedKey)) {
            continue;
        }

        let transformedValue = value;
        if (transformFunction) {
            try {
                transformedValue = transformFunction(key, value);
                if (transformedValue === null) continue; // Skip if transformation returns null.
            } catch (error) {
                console.warn({ message: `Error transforming header '${key}'`, error: error.message });
                if (process.env.STRICT_TRANSFORM === 'true') {
                    throw error; // Stop processing if strict mode is enabled.
                }
                continue;
            }
        }

        // Handle duplicate headers
        if (Array.isArray(transformedValue)) {
            transformedValue.forEach(v => {
                try {
                    target.setHeader(key, v);
                } catch (error) {
                    console.error({ message: `Error setting header '${key}'`, error: error.message });
                }
            });
        } else {
            try {
                target.setHeader(key, transformedValue);
            } catch (error) {
                console.error({ message: `Error setting header '${key}'`, error: error.message });
            }
        }
    }
}

export default copyHeaders;
