function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects to avoid runtime errors.
    if (!source || !source.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Default headers to exclude, can be extended via function parameters.
    const defaultExcludedHeaders = ['host', 'connection', 'authorization', 'cookie', 'set-cookie', 'content-length', 'transfer-encoding'];
    // Combine, deduplicate arrays, and create a Set for efficient exclusion checking.
    const excludedHeaders = new Set(defaultExcludedHeaders.concat(additionalExcludedHeaders).map(header => header.toLowerCase())); // Ensure lower case for case-insensitive comparison.
    
    // Iterate through the source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const headerKeyLower = key.toLowerCase();

        // Skip excluded headers using the Set's efficient lookup.
        if (excludedHeaders.has(headerKeyLower)) {
            continue;
        }

        // Initialize transformedValue with the original value in case there's no transformation needed.
        let transformedValue = value;

        // Check if there's a transform function, apply it, and handle its response appropriately.
        if (transformFunction && typeof transformFunction === 'function') {
            try {
                const transformationResult = transformFunction(key, value);

                // If the transformation result is null, remove the header.
                if (transformationResult !== undefined) {
                    // If the transformation result is explicitly null, skip setting this header.
                    if (transformationResult === null) {
                        continue; // Skip to the next header without logging an error.
                    }

                    // Apply the transformation result to the header.
                    transformedValue = transformationResult;
                }
                // If transformationResult is undefined, it means no change to the header value.
            } catch (error) {
                console.error(`Error transforming header '${key}': ${error.message}`);
                continue; // Skip this header if an error occurs during transformation.
            }
        }


        // Set the header, supporting multiple headers with the same name.
        try {
            if (Array.isArray(transformedValue)) {
                transformedValue.forEach(val => target.setHeader(key, val));
            } else {
                target.setHeader(key, transformedValue);
            }
        } catch (e) {
            console.error(`Error setting header '${key}': ${e.message}`);
        }
    }
}

module.exports = copyHeaders;
