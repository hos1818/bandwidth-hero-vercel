function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects.
    if (!source?.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Combine default and additional headers to exclude, normalized to lowercase for consistency.
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie', 
        'content-length', 'transfer-encoding', ':status'
    ];
    const excludedHeaders = new Set(defaultExcludedHeaders.concat(additionalExcludedHeaders.map(header => header.toLowerCase())));

    // Helper function to handle transformations and validations
    const transformHeader = (key, value) => {
        try {
            return transformFunction ? transformFunction(key, value) : value;
        } catch (error) {
            console.error(`Error transforming header '${key}': ${error.message}`);
            return null;  // Skip header if transformation fails
        }
    };

    // Copy headers with transformations and exclusions.
    for (const [key, value] of Object.entries(source.headers)) {
        const normalizedKey = key.toLowerCase();

        // Skip headers that are excluded
        if (excludedHeaders.has(normalizedKey)) continue;

        // Transform header if needed
        const finalValue = transformHeader(normalizedKey, value);
        if (finalValue === null) continue;  // Skip if transformation returned null

        // Set the header in the target, handling array and string values
        try {
            target.set(normalizedKey, Array.isArray(finalValue) ? finalValue.join(', ') : finalValue);
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

export default copyHeaders;
