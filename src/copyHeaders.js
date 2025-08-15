/**
 * Copies headers from a source object to a target object, excluding specified headers and optionally transforming values.
 * @param {Object} source - The source object containing headers.
 * @param {Object} target - The target object to copy headers to.
 * @param {string[]} [additionalExcludedHeaders=[]] - Extra headers to exclude.
 * @param {Function} [transformFunction=null] - Optional transformation function for header values. Receives (key, value).
 */
function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    const DEFAULT_EXCLUDED_HEADERS = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding',
        ':status', ':method', ':path', ':scheme', ':authority'
    ];

    // Validate inputs
    if (!Array.isArray(additionalExcludedHeaders) || !additionalExcludedHeaders.every(h => typeof h === 'string')) {
        throw new Error('"additionalExcludedHeaders" must be an array of strings.');
    }
    if (transformFunction !== null && typeof transformFunction !== 'function') {
        throw new Error('"transformFunction" must be a function or null.');
    }
    if (!source?.headers || typeof source.headers !== 'object') {
        throw new Error('Invalid source: must have a "headers" object.');
    }
    if (typeof target?.setHeader !== 'function') {
        throw new Error('Invalid target: must have a "setHeader" method.');
    }

    // Prepare exclusion set (all lowercase for case-insensitive match)
    const excludedHeaders = new Set([
        ...DEFAULT_EXCLUDED_HEADERS,
        ...additionalExcludedHeaders.map(h => h.toLowerCase())
    ]);

    for (const key in source.headers) {
        if (!Object.prototype.hasOwnProperty.call(source.headers, key)) continue;

        const lowerKey = key.toLowerCase();
        if (excludedHeaders.has(lowerKey)) continue;

        let value = source.headers[key];

        if (transformFunction) {
            try {
                value = transformFunction(key, value);
                if (value === null) continue;
            } catch (err) {
                console.warn(`Error transforming header '${key}': ${err.message}`);
                if (process.env.STRICT_TRANSFORM === 'true') throw err;
                continue;
            }
        }

        // Ensure correct type
        if (Array.isArray(value)) {
            value = value.map(v => String(v));
        } else if (value !== undefined) {
            value = String(value);
        }

        try {
            target.setHeader(key, value);
        } catch (err) {
            console.error(`Error setting header '${key}': ${err.message}`);
        }
    }
}

export default copyHeaders;
