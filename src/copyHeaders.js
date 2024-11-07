function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects.
    if (!source?.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Combine default and additional headers to exclude, normalized to lowercase for consistency.
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie', 
        'content-length', 'transfer-encoding'
    ];
    const excludedHeaders = new Set(defaultExcludedHeaders.concat(additionalExcludedHeaders.map(header => header.toLowerCase())));

    // Copy headers with transformations and exclusions.
    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();
        
        // Skip headers that are excluded
        if (excludedHeaders.has(normalizedKey)) continue;

        // Transform header if a transform function is provided.
        let finalValue = value;
        if (transformFunction) {
            try {
                finalValue = transformFunction(key, value);
                // Skip setting this header if transform function returns null.
                if (finalValue === null) continue;
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip setting the header if transformation fails
            }
        }

        // Set the header in the target, directly handling both array and string values.
        try {
            target.setHeader(normalizedKey, finalValue);
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

module.exports = copyHeaders;
