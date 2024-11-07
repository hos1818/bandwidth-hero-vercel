function copyHeaders(source, target, options = {}) {
    const {
        additionalExcludedHeaders = [],
        transformFunction = null,
        overwriteExisting = true, // New option to control whether to overwrite existing headers.
        mergeArrays = true // New option to merge array values instead of overwriting.
    } = options;

    // Validate source and target.
    if (!source?.headers || !target?.setHeader) {
        throw new Error('Invalid source or target objects provided');
    }

    // Default headers to exclude, extended by any additional headers.
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie', 
        'content-length', 'transfer-encoding'
    ];
    const excludedHeaders = new Set(
        [...defaultExcludedHeaders, ...additionalExcludedHeaders].map(header => header.toLowerCase())
    );

    // Iterate through the source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const headerKeyLower = key.toLowerCase();

        // Skip headers that are in the excluded list.
        if (excludedHeaders.has(headerKeyLower)) continue;

        // Apply transformation if a valid function is provided.
        let transformedValue = value;
        if (typeof transformFunction === 'function') {
            try {
                const result = transformFunction(key, value);

                // Skip if the result is explicitly null.
                if (result === null) continue;

                // Use the transformed value if valid, otherwise keep the original.
                transformedValue = result !== undefined ? result : value;
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip the header if transformation fails.
            }
        }

        // Ensure the header value is either a string or an array.
        const finalValue = Array.isArray(transformedValue) ? transformedValue : [transformedValue];

        // Set or merge the header in the target.
        try {
            const existingValue = target.getHeader(key);
            
            // Check if the header already exists in the target and merge if necessary.
            if (existingValue && !overwriteExisting) {
                if (Array.isArray(existingValue) && mergeArrays) {
                    finalValue.unshift(...existingValue);
                } else {
                    finalValue.unshift(existingValue);
                }
            }

            // Set the header(s) in the target.
            target.removeHeader(key); // Ensure header is reset before setting.
            finalValue.forEach(val => target.setHeader(key, val));
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

module.exports = copyHeaders;
