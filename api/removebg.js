// Vercel Serverless Function — Remove.bg API Proxy

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.REMOVEBG_API_KEY;
  if (!key) {
    // Kein Key → Original zurückgeben (kein Hintergrund entfernen)
    return res.status(200).json({ skipped: true });
  }

  try {
    const { base64 } = req.body;

    // Remove.bg unterstützt base64 direkt
    const formData = new URLSearchParams();
    formData.append('image_base64', base64);
    formData.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    if (!response.ok) {
      return res.status(200).json({ skipped: true });
    }

    const buffer = await response.arrayBuffer();
    const resultBase64 = Buffer.from(buffer).toString('base64');
    return res.status(200).json({ base64: resultBase64, mimeType: 'image/png' });
  } catch (err) {
    return res.status(200).json({ skipped: true });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
