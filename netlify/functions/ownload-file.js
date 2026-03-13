const https = require('https');
const http = require('http');

function fetchBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);

    lib.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.instagram.com/',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

exports.handler = async (event) => {
  const { url, filename = 'vaultgrab_video.mp4' } = event.queryStringParameters || {};
  if (!url) return { statusCode: 400, body: 'URL required' };

  try {
    const buffer = await fetchBuffer(decodeURIComponent(url));
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: 'Download error: ' + e.message };
  }
};
