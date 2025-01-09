/**
 * Copies headers from a source object to a target object, excluding specified headers and optionally transforming values.
 * @param {Object} source - The source object containing headers (e.g., a request or response object).
 * @param {Object} target - The target object to copy headers to (e.g., a response object).
 * @param {string[]} [additionalExcludedHeaders=[]] - Additional headers to exclude from copying.
 * @param {Function} [transformFunction=null] - Optional transformation function for header values. Receives (key, value).
 */
function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding', ':status', ':method', ':path',
    ];

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
        ...defaultExcludedHeaders,
        ...additionalExcludedHeaders.map(header => header.toLowerCase()),
    ]);

    // Validate source and target objects.
    if (!source || typeof source.headers !== 'object' || source.headers === null) {
        throw new Error('Invalid source object: missing or invalid "headers" property.');
    }
    if (!target || typeof target.setHeader !== 'function') {
        throw new Error('Invalid target object: missing "setHeader" method.');
    }

    // Iterate and copy headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();

        // Skip excluded headers or pseudo-headers.
        if (excludedHeaders.has(normalizedKey) || normalizedKey.startsWith(':')) {
            continue;
        }

        let transformedValue = value;
        if (transformFunction) {
            try {
                transformedValue = transformFunction(key, value);
                if (transformedValue === null) continue; // Skip if transformation returns null.
            } catch (error) {
                console.warn(`Error transforming header '${key}': ${error.message}`);
                continue;
            }
        }

        try {
            target.setHeader(key, transformedValue);
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

export default copyHeaders;
