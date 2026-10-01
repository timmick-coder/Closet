// Vercel Serverless Function — Push-Abo verwalten
// GET                              → { key }  (öffentlicher VAPID-Schlüssel für pushManager.subscribe)
// POST { action: 'subscribe',   subscription } → Abo speichern
// POST { action: 'unsubscribe', subscription } → Abo löschen
// POST { action: 'test',        subscription } → Test-Benachrichtigung an dieses (gespeicherte) Abo

const { SUBS_KEY, isAllowedEndpoint, subId, redis, sendPush } = require('./_push-lib');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: 'Push ist auf dem Server noch nicht eingerichtet' });
    return res.status(200).json({ key: key });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !isAllowedEndpoint(sub.endpoint)) {
      return res.status(400).json({ error: 'Ungültiges Abo' });
    }
    const id = subId(sub.endpoint);

    if (body.action === 'subscribe') {
      await redis(['HSET', SUBS_KEY, id, JSON.stringify({ endpoint: sub.endpoint, createdAt: Date.now() })]);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'unsubscribe') {
      await redis(['HDEL', SUBS_KEY, id]);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'test') {
      // Nur an Abos senden, die wirklich gespeichert sind
      const stored = await redis(['HGET', SUBS_KEY, id]);
      if (!stored) return res.status(404).json({ error: 'Abo nicht gefunden – bitte "Outfit des Tages" aus- und wieder einschalten' });
      const status = await sendPush(JSON.parse(stored));
      if (status === 404 || status === 410) await redis(['HDEL', SUBS_KEY, id]);
      return res.status(status >= 200 && status < 300 ? 200 : 502).json({ ok: status >= 200 && status < 300, pushStatus: status });
    }
    return res.status(400).json({ error: 'Unbekannte Aktion' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
