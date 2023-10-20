function copyHeaders(source, target) {
  // A list of headers you might want to avoid copying. Adjust as needed.
  const excludedHeaders = ['host', 'connection'];

  for (const [key, value] of Object.entries(source.headers)) {
    if (excludedHeaders.includes(key.toLowerCase())) {
      continue; // Skip this header
    }

    try {
      target.setHeader(key, value);
    } catch (e) {
      console.error(`Error setting header '${key}': ${e.message}`);
    }
  }
}

module.exports = copyHeaders;
