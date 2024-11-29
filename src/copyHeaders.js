// Utility function to copy headers from a source object to a target.
function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Default excluded headers.
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding', ':status', ':method', ':path',
    ];
    const excludedHeaders = new Set([
        ...defaultExcludedHeaders,
        ...additionalExcludedHeaders.map(header => header.toLowerCase()),
    ]);

    // Validate inputs.
    if (!source || typeof source.headers !== 'object') {
        throw new Error('Invalid source object: missing "headers" property.');
    }
    if (!target || typeof target.setHeader !== 'function') {
        throw new Error('Invalid target object: missing "setHeader" method.');
    }

    // Process headers.
    Object.entries(source.headers).forEach(([key, value]) => {
        const normalizedKey = key.toLowerCase();

        // Skip excluded headers or pseudo-headers.
        if (excludedHeaders.has(normalizedKey) || normalizedKey.startsWith(':')) {
            return;
        }
        
        // Apply transformation function if provided.
        let transformedValue = value;
        if (transformFunction) {
            try {
                transformedValue = transformFunction(key, value);
                if (transformedValue === null) {
                    return; // Skip if transformation returns null.
                }
            } catch (error) {
                console.error(`Failed to transform header '${key}': ${error.message}`);
                return;
            }
        }

        try {
            target.setHeader(key, transformedValue);
        } catch (error) {
            console.error(`Failed to set header '${key}': ${error.message}`);
        }
    });
}

export default copyHeaders;
