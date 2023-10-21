function copyHeaders(source, target, additionalExcludedHeaders = [], transformFunction = null) {
    // Validate the provided objects to avoid runtime errors.
    if (!source || !source.headers || !target) {
        throw new Error('Invalid source or target objects provided');
    }

    // Default headers to exclude, can be extended via function parameters.
    const defaultExcludedHeaders = ['host', 'connection', 'authorization', 'cookie', 'set-cookie', 'content-length', 'transfer-encoding'];
    const excludedHeaders = [...new Set(defaultExcludedHeaders.concat(additionalExcludedHeaders))]; // Combine and deduplicate arrays.

    // Iterate through the source headers.
    for (const [key, value] of Object.entries(source.headers)) {
        const headerKeyLower = key.toLowerCase();

        // Skip excluded headers.
        if (excludedHeaders.includes(headerKeyLower)) {
            continue;
        }

        // Check if there's a transform function and apply it.
        let transformedValue = value;
        if (transformFunction && typeof transformFunction === 'function') {
            try {
                const result = transformFunction(key, value);

                // If the transformation result is null, remove the header.
                if (result === null) {
                    // Here, you might want to log the header's removal or perform another action.
                    continue; // Skip to the next header.
                }

                transformedValue = result; // Could be a new value, or an array of values, or the same value.
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
