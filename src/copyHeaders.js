function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding', ':status', ':method', ':path',
    ];

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

    // Copy headers.
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
