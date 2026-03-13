const axios = require('axios');

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

async function tryRapidAPI(url) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('No key');
  const res = await axios.get(
    'https://instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com/get-info-rapidapi',
    {
      params: { url },
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com'
      },
      timeout: 10000
    }
  );
  return res.data;
}

async function tryPublicEndpoint(shortcode) {
  const res = await axios.get(
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
        'Referer': 'https://www.instagram.com/',
        'X-IG-App-ID': '936619743392459',
      }
    }
  );
  return res.data;
}

async function tryScrape(url) {
  const res = await axios.get(url, {
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const html = res.data;
  const videos = [];
  const jsonMatch = html.match(/"video_url":"([^"]+)"/g);
  if (jsonMatch) {
    jsonMatch.forEach(m => {
      const v = m.replace('"video_url":"', '').replace('"', '').replace(/\\u0026/g, '&');
      if (!videos.includes(v)) videos.push(v);
    });
  }
  let thumbnail = null;
  const t = html.match(/"thumbnail_src":"([^"]+)"/);
  if (t) thumbnail = t[1].replace(/\\u0026/g, '&');
  return { videos, thumbnail };
}

function parseIGJson(data) {
  const result = { videos: [], thumbnail: null, type: 'Video' };
  const media = data?.graphql?.shortcode_media || data?.items?.[0] || data?.media || data;
  if (!media) return result;
  const t = media.__typename || media.media_type;
  if (t === 'GraphVideo' || t === 2 || media.video_url) {
    if (media.video_url) result.videos.push({ url: media.video_url, quality: 'HD', label: 'Original Video', type: 'MP4' });
    result.thumbnail = media.thumbnail_src || media.display_url || media.image_versions2?.candidates?.[0]?.url;
    result.type = 'Reel / Video';
  }
  if (t === 'GraphSidecar' || t === 8) {
    const edges = media.edge_sidecar_to_children?.edges || media.carousel_media || [];
    edges.forEach((e, i) => {
      const node = e.node || e;
      if (node.video_url || node.__typename === 'GraphVideo' || node.media_type === 2) {
        result.videos.push({ url: node.video_url, quality: 'HD', label: `Video ${i + 1}`, type: 'MP4' });
      }
    });
    result.thumbnail = media.display_url;
    result.type = 'Carousel';
  }
  return result;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let url;
  try { url = JSON.parse(event.body).url; } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) }; }
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL is required' }) };

  const cleanUrl = url.split('?')[0].replace(/\/$/, '') + '/';
  const shortcode = extractShortcode(cleanUrl);
  if (!shortcode) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid Instagram URL. Please use a post, reel or story link.' }) };

  // Strategy 1: RapidAPI
  if (process.env.RAPIDAPI_KEY) {
    try {
      const data = await tryRapidAPI(cleanUrl);
      if (data?.video) {
        return { statusCode: 200, headers, body: JSON.stringify({ videos: [{ url: data.video, quality: 'HD', label: 'Video', type: 'MP4' }], thumbnail: data.thumbnail || data.image, type: data.type || 'Video' }) };
      }
    } catch (e) { console.log('RapidAPI failed:', e.message); }
  }

  // Strategy 2: Public endpoint
  try {
    const data = await tryPublicEndpoint(shortcode);
    const result = parseIGJson(data);
    if (result.videos.length > 0) return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) { console.log('Public endpoint failed:', e.message); }

  // Strategy 3: Scrape
  try {
    const scraped = await tryScrape(cleanUrl);
    if (scraped.videos.length > 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          videos: scraped.videos.map((v, i) => ({ url: v, quality: 'HD', label: `Video ${i + 1}`, type: 'MP4' })),
          thumbnail: scraped.thumbnail,
          type: 'Video'
        })
      };
    }
  } catch (e) { console.log('Scrape failed:', e.message); }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Could not extract video. The post may be private or deleted. Add a RapidAPI key in Netlify environment variables for best results.' }) };
};
