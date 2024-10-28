function copyHeaders(source, target, options = {}) {
    const {
        additionalExcludedHeaders = [],
        transformFunction = null,
        overwriteExisting = true,
        mergeArrays = true,
        selectiveOverwrite = {}, // New: Object specifying headers to selectively overwrite or merge.
        debug = false // New: Enable debugging logs for tracing header handling.
    } = options;

    // Validate source and target.
    if (!source?.headers || !target?.setHeader) {
        throw new Error('Invalid source or target objects provided');
    }

    // Default headers to exclude, extendable by options.
    const defaultExcludedHeaders = [
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding'
    ];
    const excludedHeaders = new Set(
        [...defaultExcludedHeaders, ...additionalExcludedHeaders].map(header => header.toLowerCase())
    );

    // Helper function for debugging output
    const logDebug = (msg) => {
        if (debug) console.debug(msg);
    };

    // Iterate through the source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const headerKeyLower = key.toLowerCase();

        // Skip headers in the excluded list.
        if (excludedHeaders.has(headerKeyLower)) continue;

        // Apply transformation if provided and valid.
        let transformedValue = value;
        if (typeof transformFunction === 'function') {
            try {
                const result = transformFunction(key, value);
                if (result === null) continue;
                transformedValue = result !== undefined ? result : value;
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip header on transformation failure.
            }
        }

        // Ensure transformedValue is array-like for consistent handling.
        const finalValues = Array.isArray(transformedValue) ? transformedValue : [transformedValue];
        const existingValue = target.getHeader(key);

        // Determine if header merging or overwriting is required.
        let valuesToSet = finalValues;
        if (existingValue && (!overwriteExisting || selectiveOverwrite[key] === 'merge')) {
            if (Array.isArray(existingValue) && mergeArrays) {
                valuesToSet = [...existingValue, ...finalValues];
            } else if (mergeArrays) {
                valuesToSet = [existingValue, ...finalValues];
            }
        }

        // Debug log for header actions
        logDebug(`Setting header '${key}': ${JSON.stringify(valuesToSet)}`);

        // Reset header before setting to prevent duplicates.
        try {
            target.removeHeader(key);
            valuesToSet.forEach(val => target.setHeader(key, val));
        } catch (error) {
            console.error(`Error setting header '${key}': ${error.message}`);
        }
    }
}

module.exports = copyHeaders;
