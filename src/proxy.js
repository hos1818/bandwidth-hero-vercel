const axios = require('axios');
const { pick } = require('lodash');
const zlib = require('node:zlib');
const lzma = require('lzma-native');
const { ZstdCodec } = require('zstd-codec');
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');
const http2 = require('node:http2');
const https = require('node:https');
const { URL } = require('node:url');
const Bottleneck = require('bottleneck');
const cloudscraper = require('cloudscraper');

// Constants and configuration
const CONSTANTS = {
  SSL: {
    OP_NO_TLSv1: https.constants?.SSL_OP_NO_TLSv1 ?? 0x04000000,
    OP_NO_TLSv1_1: https.constants?.SSL_OP_NO_TLSv1_1 ?? 0x10000000
  },
  LIMITS: {
    MAX_REDIRECTS: 5,
    MAX_RETRIES: 3,
    REQUEST_TIMEOUT: 10000,
    CACHE_SIZE: 100,
    MAX_RESPONSE_SIZE: 50 * 1024 * 1024 // 50MB
  },
  HEADERS: {
    DEFAULT_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    SECURITY: {
      CSP: "default-src 'self'; img-src *; media-src *; script-src 'none'; object-src 'none';",
      HSTS: 'max-age=63072000; includeSubDomains; preload'
    }
  }
};

// LRU Cache implementation with size limits and auto-cleanup
class LRUCache {
  constructor(maxSize = CONSTANTS.LIMITS.CACHE_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  set(key, value, ttl = 300000) { // 5 minutes TTL default
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    const item = {
      value,
      timestamp: Date.now(),
      ttl
    };
    
    this.cache.set(key, item);
    
    // Schedule cleanup
    setTimeout(() => {
      this.cache.delete(key);
    }, ttl);
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  clear() {
    this.cache.clear();
  }
}

// Create a memory-efficient request limiter
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 2000,
  highWater: 1000,
  strategy: Bottleneck.strategy.LEAK,
  reservoir: 100,
  reservoirRefreshInterval: 60 * 1000,
  reservoirRefreshAmount: 100
});

// Initialize cache
const requestCache = new LRUCache();

// Compression utilities with memory limits
const compressionUtils = {
  async compress(data, method, maxSize = CONSTANTS.LIMITS.MAX_RESPONSE_SIZE) {
    if (Buffer.byteLength(data) > maxSize) {
      throw new Error('Response too large for compression');
    }

    const methods = {
      br: () => zlib.brotliCompressSync(data, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(data)
        }
      }),
      gzip: () => zlib.gzipSync(data, { level: 6 }),
      deflate: () => zlib.deflateSync(data, { level: 6 })
    };

    return methods[method] ? methods[method]() : data;
  },

  async decompress(data, encoding) {
    if (!data || !Buffer.isBuffer(data)) {
      throw new Error('Invalid input for decompression');
    }

    const decompressors = {
      br: () => zlib.brotliDecompressSync(data),
      gzip: () => zlib.gunzipSync(data),
      deflate: () => zlib.inflateSync(data),
      lzma: () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('LZMA decompression timeout'));
        }, 5000);
        
        lzma.decompress(data, (result, error) => {
          clearTimeout(timeout);
          error ? reject(error) : resolve(result);
        });
      }),
      zstd: () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Zstd decompression timeout'));
        }, 5000);

        ZstdCodec.run(zstd => {
          try {
            const simple = new zstd.Simple();
            const result = simple.decompress(data);
            clearTimeout(timeout);
            resolve(result);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      })
    };

    if (!decompressors[encoding]) {
      return data;
    }

    try {
      return await decompressors[encoding]();
    } catch (error) {
      console.error(`Decompression error (${encoding}):`, error);
      throw error;
    }
  }
};

// Enhanced HTTP/2 client with proper resource management
class Http2Client {
  constructor(url) {
    this.url = url;
    this.client = null;
    this.connecting = false;
    this.closeTimeout = null;
  }

  async connect() {
    if (this.client) return;
    
    if (this.connecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.connect();
    }

    this.connecting = true;
    
    try {
      this.client = http2.connect(this.url);
      
      this.client.on('error', (err) => {
        console.error('HTTP/2 client error:', err);
        this.destroy();
      });

      this.client.on('goaway', () => {
        this.scheduleClose();
      });

    } finally {
      this.connecting = false;
    }
  }

  scheduleClose() {
    if (this.closeTimeout) clearTimeout(this.closeTimeout);
    
    this.closeTimeout = setTimeout(() => {
      this.destroy();
    }, 5000);
  }

  destroy() {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  async request(headers, timeout = CONSTANTS.LIMITS.REQUEST_TIMEOUT) {
    await this.connect();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('HTTP/2 request timeout'));
      }, timeout);

      const req = this.client.request(headers);
      const chunks = [];
      let size = 0;

      req.on('response', (headers) => {
        if (headers[':status'] >= 400) {
          clearTimeout(timer);
          reject(new Error(`HTTP/2 error: ${headers[':status']}`));
        }
      });

      req.on('data', chunk => {
        size += chunk.length;
        if (size > CONSTANTS.LIMITS.MAX_RESPONSE_SIZE) {
          clearTimeout(timer);
          req.destroy(new Error('Response too large'));
          reject(new Error('Response size exceeded limit'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      req.end();
    });
  }
}

// Proxy implementation
async function proxy(req, res) {
  let http2Client = null;
  
  try {
    const config = {
      url: new URL(req.params.url),
      method: 'get',
      headers: {
        ...pick(req.headers, ['cookie', 'referer']),
        'user-agent': CONSTANTS.HEADERS.DEFAULT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'DNT': '1',
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        'Connection': 'keep-alive'
      },
      timeout: CONSTANTS.LIMITS.REQUEST_TIMEOUT,
      maxRedirects: CONSTANTS.LIMITS.MAX_REDIRECTS,
      responseType: 'arraybuffer',
      validateStatus: status => status < 500,
      maxContentLength: CONSTANTS.LIMITS.MAX_RESPONSE_SIZE,
      maxBodyLength: CONSTANTS.LIMITS.MAX_RESPONSE_SIZE
    };

    // Check cache first
    const cachedResponse = requestCache.get(config.url.href);
    if (cachedResponse) {
      return sendResponse(res, cachedResponse.data, cachedResponse.headers);
    }

    let response;
    if (config.url.protocol === 'http2:') {
      http2Client = new Http2Client(config.url.origin);
      response = await http2Client.request({
        ':method': 'GET',
        ':path': config.url.pathname,
        ...pick(config.headers, ['cookie', 'dnt', 'referer', 'user-agent'])
      });
    } else {
      response = await limiter.schedule(() => axios(config));
    }

    const { headers, data } = response;
    let decompressedData = await compressionUtils.decompress(
      data, 
      headers['content-encoding']
    );

    // Cache successful responses
    requestCache.set(config.url.href, {
      data: decompressedData,
      headers
    });

    await sendResponse(res, decompressedData, headers);

  } catch (error) {
    console.error('Proxy error:', error);
    await redirect(req, res);
  } finally {
    if (http2Client) {
      http2Client.destroy();
    }
  }
}

// Helper function to send response
async function sendResponse(res, data, headers) {
  if (!data) {
    throw new Error('No data to send');
  }

  // Security headers
  res.setHeader('Content-Security-Policy', CONSTANTS.HEADERS.SECURITY.CSP);
  res.setHeader('Strict-Transport-Security', CONSTANTS.HEADERS.SECURITY.HSTS);
  
  // Copy and sanitize headers
  copyHeaders(headers, res, {
    additionalExcludedHeaders: ['x-custom-header'],
    transformFunction: (key, value) => key === 'x-transform-header' ? value.toUpperCase() : value,
    overwriteExisting: false,
    mergeArrays: true
  });

  try {
    // Determine compression method
    const acceptEncoding = res.req.headers['accept-encoding'] || '';
    let compressedData = data;
    
    if (shouldCompress(res.req, data)) {
      if (acceptEncoding.includes('br')) {
        compressedData = await compressionUtils.compress(data, 'br');
        res.setHeader('Content-Encoding', 'br');
      } else if (acceptEncoding.includes('gzip')) {
        compressedData = await compressionUtils.compress(data, 'gzip');
        res.setHeader('Content-Encoding', 'gzip');
      } else if (acceptEncoding.includes('deflate')) {
        compressedData = await compressionUtils.compress(data, 'deflate');
        res.setHeader('Content-Encoding', 'deflate');
      }
    }

    res.end(compressedData);
    
  } catch (error) {
    console.error('Error sending response:', error);
    throw error;
  }
}

// Clean up resources periodically
setInterval(() => {
  requestCache.clear();
  if (global.gc) global.gc();
}, 3600000); // Every hour

module.exports = proxy;
