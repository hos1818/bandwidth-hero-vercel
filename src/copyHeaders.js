function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects to avoid runtime errors.
    if (!source?.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Default headers to exclude, extended by additional headers passed as arguments.
    const defaultExcludedHeaders = ['host', 'connection', 'authorization', 'cookie', 'set-cookie', 'content-length', 'transfer-encoding'];
    const excludedHeaders = new Set([...defaultExcludedHeaders, ...additionalExcludedHeaders].map(header => header.toLowerCase())); // Ensure case-insensitive comparison.

    // Iterate through source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const headerKeyLower = key.toLowerCase();

        // Skip headers that are in the excluded set.
        if (excludedHeaders.has(headerKeyLower)) {
            continue;
        }

        // Apply transformation if a valid function is provided.
        let transformedValue = value; // Default to original value.
        if (typeof transformFunction === 'function') {
            try {
                const transformationResult = transformFunction(key, value);

                // Skip setting this header if the transformation result is explicitly null.
                if (transformationResult === null) {
                    continue;
                }

                // Apply transformation if a new value is returned, otherwise use the original.
                transformedValue = transformationResult !== undefined ? transformationResult : value;
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip to the next header if transformation fails.
            }
        }

        // Set the header in the target response, handling cases where the value is an array.
        try {
            if (Array.isArray(transformedValue)) {
                transformedValue.forEach(val => target.setHeader(key, val));
            } else {
                target.setHeader(key, transformedValue);
            }
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

module.exports = copyHeaders;
