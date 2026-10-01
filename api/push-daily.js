// Vercel Serverless Function — täglicher Versand "Outfit des Tages"
// Wird von Vercel Cron aufgerufen (siehe vercel.json). Vercel schickt dabei
// automatisch "Authorization: Bearer <CRON_SECRET>". Manuell testbar mit ?key=<CRON_SECRET>.

const { SUBS_KEY, redis, sendPush } = require('./_push-lib');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const keyParam = (req.query && req.query.key) || '';
  if (!secret || (auth !== 'Bearer ' + secret && keyParam !== secret)) {
    return res.status(401).json({ error: 'Nicht erlaubt' });
  }

  try {
    const flat = (await redis(['HGETALL', SUBS_KEY])) || [];
    let sent = 0, removed = 0, failed = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const id = flat[i];
      let sub;
      try { sub = JSON.parse(flat[i + 1]); } catch (e) { continue; }
      try {
        const status = await sendPush(sub);
        if (status >= 200 && status < 300) sent++;
        else if (status === 404 || status === 410) { await redis(['HDEL', SUBS_KEY, id]); removed++; }
        else failed++;
      } catch (e) { failed++; }
    }
    return res.status(200).json({ ok: true, sent: sent, removed: removed, failed: failed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
