// Utility function to copy headers from a source object to a target, with options for exclusions and transformations
function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects.
    if (!source?.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Default headers to exclude, including common restricted headers.
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding', ':status', ':method', ':path'
    ];
    const excludedHeaders = new Set(
        defaultExcludedHeaders.concat(additionalExcludedHeaders).map(header => header.toLowerCase())
    );

    // Iterate through source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();

        // Skip if the header is in the exclusion list or is a pseudo-header.
        if (excludedHeaders.has(normalizedKey) || normalizedKey.startsWith(':')) continue;

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

        // Set the header in the target response.
        try {
            target.setHeader(key, transformedValue);
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

export default copyHeaders;
