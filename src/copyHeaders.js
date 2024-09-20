function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects to avoid runtime errors.
    if (!source || typeof source.headers !== 'object' || !target) {
        throw new TypeError('Invalid source or target objects provided');
    }

    // Validate the transform function.
    if (transformFunction && typeof transformFunction !== 'function') {
        throw new TypeError('transformFunction must be a function');
    }

    // Default headers to exclude, can be extended via function parameters.
    const defaultExcludedHeaders = ['host', 'connection', 'authorization', 'cookie', 'set-cookie', 'content-length', 'transfer-encoding'];
    // Combine, deduplicate arrays, and create a Set for efficient exclusion checking.
    const excludedHeaders = new Set([...defaultExcludedHeaders, ...additionalExcludedHeaders].map(header => header.toLowerCase()));

    // Convert source headers to an array of [key, value] pairs.
    const sourceHeaders = Object.entries(source.headers).map(([key, value]) => [key.toLowerCase(), value]);

    // Iterate through the source headers.
    for (const [headerKey, originalValue] of sourceHeaders) {
        // Skip excluded headers using the Set's efficient lookup.
        if (excludedHeaders.has(headerKey)) {
            continue;
        }

        // Apply transformation if a transform function is provided.
        let transformedValue = originalValue;
        if (transformFunction) {
            try {
                const transformationResult = transformFunction(headerKey, originalValue);

                // Skip header if transformation result is null, and handle undefined.
                if (transformationResult === undefined) {
                    transformedValue = originalValue; // No change to header value.
                } else if (transformationResult === null) {
                    continue; // Skip setting this header.
                } else {
                    transformedValue = transformationResult;
                }
            } catch (error) {
                console.error(`Error transforming header '${headerKey}': ${error.message}`);
                continue; // Skip this header if an error occurs during transformation.
            }
        }

        // Set the header, supporting multiple headers with the same name.
        try {
            if (Array.isArray(transformedValue)) {
                transformedValue.forEach(val => target.setHeader(headerKey, val));
            } else {
                target.setHeader(headerKey, transformedValue);
            }
        } catch (error) {
            console.error(`Error setting header '${headerKey}': ${error.message}`);
        }
    }
}

module.exports = copyHeaders;
