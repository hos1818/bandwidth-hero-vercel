function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    if (!source?.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie', 
        'content-length', 'transfer-encoding'
    ];
    const excludedHeaders = new Set(
        defaultExcludedHeaders.concat(additionalExcludedHeaders.map(header => header.toLowerCase()))
    );

    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();
        
        if (excludedHeaders.has(normalizedKey)) continue;

        let finalValue = value;
        if (transformFunction) {
            try {
                finalValue = transformFunction(key, value);
                if (finalValue === null) continue;
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue;
            }
        }

        try {
            target.setHeader(normalizedKey, finalValue);
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

// Example transformFunction implementation
function transformHeader(key, value) {
    const sensitiveHeaders = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);
    const redundantHeaders = new Set(['content-length', 'transfer-encoding']);
    const customPrefix = 'custom-';  // Prefix for custom headers

    // Standardize header key to lowercase
    const normalizedKey = key.toLowerCase();

    // Remove sensitive headers for security
    if (sensitiveHeaders.has(normalizedKey)) return null;

    // Remove redundant headers for downstream compatibility
    if (redundantHeaders.has(normalizedKey)) return null;

    // Prefix custom headers (e.g., headers starting with "x-")
    let transformedKey = normalizedKey.startsWith('x-') ? `${customPrefix}${normalizedKey}` : normalizedKey;

    // Normalize header value
    let transformedValue;
    if (typeof value === 'string') {
        transformedValue = value.trim();  // Remove extra spaces
    } else if (Array.isArray(value)) {
        transformedValue = value.map(v => String(v).trim());  // Normalize array values to strings
    } else {
        transformedValue = String(value);  // Convert other types to strings
    }

    // Return transformed key-value pair
    return [transformedKey, transformedValue];
}
