/**
 * Copies headers from a source object to a target object with various configuration options
 * and memory leak prevention.
 * @param {Object} source - Source object containing headers
 * @param {Object} target - Target object with setHeader method
 * @param {Object} [options={}] - Configuration options
 * @returns {void}
 * @throws {Error} If invalid source or target objects are provided
 */
function copyHeaders(source, target, options = {}) {
    // Early validation of source and target to prevent unnecessary object creation
    if (!source?.headers || typeof target?.setHeader !== 'function') {
        throw new TypeError('Invalid source or target objects provided');
    }

    // Destructure options with default values
    const {
        additionalExcludedHeaders = [],
        transformFunction = null,
        overwriteExisting = true,
        mergeArrays = true,
        selectiveOverwrite = Object.create(null), // Use null prototype for better performance
        debug = false
    } = options;

    // Create excluded headers set with null prototype to avoid prototype pollution
    const excludedHeaders = new Set([
        'host', 'connection', 'authorization', 'cookie', 'set-cookie',
        'content-length', 'transfer-encoding',
        ...additionalExcludedHeaders
    ].map(header => header.toLowerCase()));

    // Optimize debug logging
    const logDebug = debug ? 
        (msg) => console.debug(`[HeaderCopy] ${msg}`) : 
        () => {};

    // Pre-validate transform function
    if (transformFunction !== null && typeof transformFunction !== 'function') {
        throw new TypeError('transformFunction must be a function or null');
    }

    // Use a WeakMap for caching transformed values if transform function is provided
    const transformCache = transformFunction ? new WeakMap() : null;

    try {
        // Get headers once to avoid multiple property access
        const sourceHeaders = source.headers;
        
        // Process headers in batches to prevent call stack issues with large header sets
        const headerEntries = Object.entries(sourceHeaders);
        const BATCH_SIZE = 100;
        
        for (let i = 0; i < headerEntries.length; i += BATCH_SIZE) {
            const batch = headerEntries.slice(i, i + BATCH_SIZE);
            
            for (const [key, value] of batch) {
                const headerKeyLower = key.toLowerCase();
                
                // Skip excluded headers
                if (excludedHeaders.has(headerKeyLower)) {
                    logDebug(`Skipping excluded header: ${key}`);
                    continue;
                }

                try {
                    // Transform value if needed, using cache when possible
                    let transformedValue = value;
                    if (transformFunction) {
                        const cached = transformCache.get(value);
                        if (cached !== undefined) {
                            transformedValue = cached;
                        } else {
                            transformedValue = transformFunction(key, value);
                            transformCache.set(value, transformedValue);
                        }
                        
                        if (transformedValue === null) {
                            logDebug(`Skipping header '${key}' due to transform result`);
                            continue;
                        }
                    }

                    // Normalize to array and filter out undefined/null values
                    const finalValues = (Array.isArray(transformedValue) ? transformedValue : [transformedValue])
                        .filter(val => val != null);

                    if (finalValues.length === 0) {
                        logDebug(`Skipping header '${key}' due to empty values`);
                        continue;
                    }

                    // Handle existing headers
                    if (!overwriteExisting || selectiveOverwrite[key] === 'merge') {
                        const existingValue = target.getHeader(key);
                        if (existingValue != null) {
                            if (mergeArrays) {
                                const existingArray = Array.isArray(existingValue) ? existingValue : [existingValue];
                                finalValues.unshift(...existingArray);
                            } else {
                                logDebug(`Skipping header '${key}' due to existing value`);
                                continue;
                            }
                        }
                    }

                    // Set headers efficiently
                    logDebug(`Setting header '${key}' with ${finalValues.length} values`);
                    target.removeHeader(key);
                    
                    // Optimize for single vs multiple values
                    if (finalValues.length === 1) {
                        target.setHeader(key, finalValues[0]);
                    } else {
                        target.setHeader(key, finalValues);
                    }

                } catch (error) {
                    console.error(`Error processing header '${key}':`, error);
                    // Continue with next header instead of breaking the entire process
                }
            }
        }
    } catch (error) {
        console.error('Fatal error in copyHeaders:', error);
        throw error;
    } finally {
        // Clean up references
        if (transformCache) {
            transformCache.clear();
        }
    }
}

// Use strict mode and freeze the exported function to prevent modifications
Object.freeze(copyHeaders);
module.exports = copyHeaders;
