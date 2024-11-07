function copyHeaders(source, target, options = {}) {
    const {
        additionalExcludedHeaders = [],
        transformFunction = null,
        overwriteExisting = true, // Option to control header overwrite.
        mergeArrays = true // Option to merge array values instead of overwriting.
    } = options;

    // Validate source and target.
    if (!source?.headers || typeof target?.setHeader !== 'function') {
        throw new Error('Invalid source or target objects provided');
    }

    // Define headers to exclude.
    const excludedHeaders = new Set([
        'host', 'connection', 'authorization', 'cookie', 'set-cookie', 
        'content-length', 'transfer-encoding',
        ...additionalExcludedHeaders.map(header => header.toLowerCase())
    ]);

    // Iterate through headers, copying and transforming as needed.
    for (const [key, value] of Object.entries(source.headers)) {
        const lowerKey = key.toLowerCase();
        if (excludedHeaders.has(lowerKey)) continue; // Skip excluded headers.

        let transformedValue = value;
        
        // Transform header value if transformFunction is provided.
        if (typeof transformFunction === 'function') {
            try {
                const result = transformFunction(key, value);
                if (result === null) continue; // Skip null results.
                transformedValue = result !== undefined ? result : value;
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip header on transform error.
            }
        }

        // Determine final value format as array.
        const finalValue = Array.isArray(transformedValue) ? transformedValue : [transformedValue];

        // Handle header merging if the header already exists.
        const existingValue = target.getHeader(key);
        if (existingValue && !overwriteExisting) {
            const mergedValue = mergeArrays && Array.isArray(existingValue)
                ? [...existingValue, ...finalValue]
                : [existingValue, ...finalValue];
            
            target.setHeader(key, mergedValue);
        } else {
            // Set new header value.
            target.setHeader(key, finalValue.length > 1 ? finalValue : finalValue[0]);
        }
    }
}

module.exports = copyHeaders;
