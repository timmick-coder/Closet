// Vercel Serverless Function — Remove.bg API Proxy
// Sendet Bild als echtes multipart/form-data (wie vom Remove.bg API erwartet)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.REMOVEBG_API_KEY;
  if (!key) {
    console.error('[removebg] REMOVEBG_API_KEY ist nicht gesetzt in Vercel Environment Variables');
    return res.status(200).json({ skipped: true, reason: 'no_key' });
  }

  const { base64, mimeType } = req.body;
  if (!base64) {
    return res.status(400).json({ error: 'base64 fehlt im Request' });
  }

  try {
    // Base64 → Buffer → Blob (echtes multipart/form-data)
    const imageBuffer = Buffer.from(base64, 'base64');
    const blob = new Blob([imageBuffer], { type: mimeType || 'image/jpeg' });

    const formData = new FormData();
    formData.append('image_file', blob, 'image.jpg');
    formData.append('size', 'auto');

    console.log('[removebg] Sende Anfrage an Remove.bg, Größe:', imageBuffer.length, 'bytes');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': key },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[removebg] API Fehler:', response.status, errText);
      return res.status(200).json({ skipped: true, reason: 'api_error', status: response.status });
    }

    const buffer = await response.arrayBuffer();
    const resultBase64 = Buffer.from(buffer).toString('base64');
    console.log('[removebg] Erfolg! Ergebnis:', buffer.byteLength, 'bytes');
    return res.status(200).json({ base64: resultBase64, mimeType: 'image/png' });

  } catch (err) {
    console.error('[removebg] Fehler:', err.message);
    return res.status(200).json({ skipped: true, reason: 'exception', error: err.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
