const axios = require('axios');

exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;
  if (!url) return { statusCode: 400, body: 'URL required' };
  try {
    const response = await axios.get(decodeURIComponent(url), {
      responseType: 'arraybuffer', timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' }
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': response.headers['content-type'] || 'image/jpeg', 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(response.data).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: 'Image proxy error' };
  }
};
