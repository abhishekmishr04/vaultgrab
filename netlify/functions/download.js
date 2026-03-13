const https = require('https');
const http = require('http');

function extractShortcode(url) {
  const patterns = [
    /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reels\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/stories\/[^/]+\/([0-9]+)/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    };
    const req = lib.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${urlObj.hostname}${res.headers.location}`;
        return makeRequest(next, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ data, status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Strategy 1: Cobalt.tools (FREE, no signup, no API key)
async function tryCobalt(url) {
  const body = JSON.stringify({ url });
  const res = await makeRequest('https://api.cobalt.tools/', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  const data = JSON.parse(res.data);
  if (data.url) {
    return { videos: [{ url: data.url, quality: 'HD', label: 'Original Video', type: 'MP4' }], thumbnail: null, type: 'Video' };
  }
  if (data.picker && Array.isArray(data.picker)) {
    const videos = data.picker
      .filter(item => item.url)
      .map((item, i) => ({ url: item.url, quality: 'HD', label: `Video ${i + 1}`, type: 'MP4' }));
    if (videos.length > 0) return { videos, thumbnail: null, type: 'Carousel' };
  }
  throw new Error('No video from Cobalt');
}

// Strategy 2: Instagram public JSON endpoint
async function tryPublicEndpoint(shortcode) {
  const url = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
  const res = await makeRequest(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'application/json',
      'Referer': 'https://www.instagram.com/',
      'X-IG-App-ID': '936619743392459',
    }
  });
  return JSON.parse(res.data);
}

function parseIGJson(data) {
  const result = { videos: [], thumbnail: null, type: 'Video' };
  try {
    const media = data?.graphql?.shortcode_media || data?.items?.[0] || data?.media || data;
    if (!media) return result;
    const t = media.__typename || media.media_type;
    if (t === 'GraphVideo' || t === 2 || media.video_url) {
      if (media.video_url) result.videos.push({ url: media.video_url, quality: 'HD', label: 'Original Video', type: 'MP4' });
      result.thumbnail = media.thumbnail_src || media.display_url;
      result.type = 'Reel';
    }
    if (t === 'GraphSidecar' || t === 8) {
      const edges = media.edge_sidecar_to_children?.edges || media.carousel_media || [];
      edges.forEach((e, i) => {
        const node = e.node || e;
        if (node.video_url) result.videos.push({ url: node.video_url, quality: 'HD', label: `Video ${i + 1}`, type: 'MP4' });
      });
      result.thumbnail = media.display_url;
      result.type = 'Carousel';
    }
  } catch (e) { console.log('Parse error:', e.message); }
  return result;
}

// Strategy 3: HTML scrape
async function tryScrape(url) {
  const res = await makeRequest(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const html = res.data;
  const videos = [];
  const matches = html.match(/"video_url":"([^"]+)"/g) || [];
  matches.forEach(m => {
    const v = m.replace('"video_url":"', '').replace('"', '').replace(/\\u0026/g, '&');
    if (v && !videos.includes(v)) videos.push(v);
  });
  let thumbnail = null;
  const t = html.match(/"thumbnail_src":"([^"]+)"/);
  if (t) thumbnail = t[1].replace(/\\u0026/g, '&');
  return { videos, thumbnail };
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let url;
  try { url = JSON.parse(event.body).url; }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  if (!url) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'URL is required' }) };

  const cleanUrl = url.split('?')[0].replace(/\/$/, '') + '/';
  const shortcode = extractShortcode(cleanUrl);
  if (!shortcode) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid Instagram URL.' }) };

  // Strategy 1: Cobalt.tools — completely free, no key needed
  try {
    const result = await tryCobalt(cleanUrl);
    if (result.videos.length > 0) return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };
  } catch (e) { console.log('Cobalt failed:', e.message); }

  // Strategy 2: Instagram public endpoint
  try {
    const data = await tryPublicEndpoint(shortcode);
    const result = parseIGJson(data);
    if (result.videos.length > 0) return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };
  } catch (e) { console.log('Public endpoint failed:', e.message); }

  // Strategy 3: HTML scrape
  try {
    const scraped = await tryScrape(cleanUrl);
    if (scraped.videos.length > 0) {
      return {
        statusCode: 200, headers: HEADERS,
        body: JSON.stringify({
          videos: scraped.videos.map((v, i) => ({ url: v, quality: 'HD', label: `Video ${i + 1}`, type: 'MP4' })),
          thumbnail: scraped.thumbnail,
          type: 'Video'
        })
      };
    }
  } catch (e) { console.log('Scrape failed:', e.message); }

  return {
    statusCode: 404, headers: HEADERS,
    body: JSON.stringify({ error: 'Could not extract video. Make sure the post is public and try again.' })
  };
};
