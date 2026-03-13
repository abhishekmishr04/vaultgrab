const axios = require('axios');

exports.handler = async (event) => {
  const { url, filename = 'grabify_video.mp4' } = event.queryStringParameters || {};
  if (!url) return { statusCode: 400, body: 'URL required' };

  try {
    const response = await axios.get(decodeURIComponent(url), {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.instagram.com/'
      }
    });

    const body = Buffer.from(response.data).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
      },
      body,
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: 'Download error: ' + e.message };
  }
};
