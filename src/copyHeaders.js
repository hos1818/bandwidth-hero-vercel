function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects.
    if (!source?.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Set default headers to exclude and normalize them to lowercase.
    const defaultExcludedHeaders = ['host', 'connection', 'authorization', 'cookie', 'set-cookie', 'content-length', 'transfer-encoding', 'status'];
    const excludedHeaders = new Set(defaultExcludedHeaders.concat(additionalExcludedHeaders).map(header => header.toLowerCase()));

    // Iterate through source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();

        // Skip if the header is in the exclusion list.
        if (excludedHeaders.has(normalizedKey)) continue;

        // Apply transformation function if provided.
        let transformedValue = value;
        if (transformFunction) {
            try {
                transformedValue = transformFunction(key, value);
                if (transformedValue === null) continue; // Skip setting this header if explicitly null.
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip this header if transformation fails.
            }
        }

        // Set the header in the target response, handling arrays.
        try {
            if (Array.isArray(transformedValue)) {
                target.setHeader(key, transformedValue);
            } else {
                target.setHeader(key, transformedValue);
            }
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

export default copyHeaders;
