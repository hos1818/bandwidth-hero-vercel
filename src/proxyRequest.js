const axios = require('axios');

// Proxy request logic
async function proxyRequest(req, res) {
  const targetUrl = req.query.url; // Extract the target URL from query parameters

    // Validate the target URL
    if (!targetUrl) {
        return res.status(400).send('URL parameter is required');
    }

    // Ensure the target URL is valid and secure
    if (!isValidUrl(targetUrl)) {
        return res.status(400).send('Invalid URL provided');
    }

    try {
        // Make a fetch request to the target URL
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                ...req.headers, // Forward all other headers
            },
            maxRedirects: 5 // Follow redirects
        });

        // Send the response back to the client
        res.set(response.headers);
        res.set('X-Proxy', 'Node.js Axios');
        res.set('Access-Control-Allow-Origin', '*'); // Allow CORS if needed
        console.log(`Fetched ${targetUrl} with status: ${response.status}`);
        return res.status(response.status).send(response.data);
    } catch (error) {
        console.error(`Error fetching ${targetUrl}:`, error);
        return res.status(500).send('Failed to fetch the requested URL');
    }
}

module.exports = proxyRequest;
