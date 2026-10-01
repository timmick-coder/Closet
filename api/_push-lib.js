// Gemeinsame Helfer für Push-Benachrichtigungen ("Outfit des Tages").
// Dateien mit "_" am Anfang werden von Vercel nicht als eigene API-Route veröffentlicht.
//
// Benötigte Vercel-Umgebungsvariablen:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  – Schlüsselpaar für den Versand (Web Push / VAPID)
//   VAPID_SUBJECT (optional)            – Kontakt, z. B. "mailto:du@example.com"
//   KV_REST_API_URL + KV_REST_API_TOKEN  – Upstash Redis (über Vercel Marketplace)
//     (alternativ UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//   CRON_SECRET                          – schützt den täglichen Versand
//
// Gesendet wird ein Push OHNE Inhalt (dann ist keine Verschlüsselung nötig);
// den Text der Benachrichtigung legt der Service Worker (sw.js) fest.

const crypto = require('crypto');

const SUBS_KEY = 'stylesync:push:subs';

// Nur bekannte Push-Dienste anschreiben (verhindert Missbrauch des Endpunkts)
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/
];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function isAllowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && ALLOWED_PUSH_HOSTS.some(function(re) { return re.test(u.hostname); });
  } catch (e) { return false; }
}

function subId(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

// ── Upstash Redis über REST (kein Paket nötig) ──
async function redis(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis ist nicht eingerichtet (KV_REST_API_URL / KV_REST_API_TOKEN fehlen)');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const j = await res.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

// ── VAPID: signiertes JWT (ES256) für den Push-Dienst ──
function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error('VAPID-Schlüssel fehlen (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
  const raw = fromB64url(pub); // 0x04 || x(32) || y(32)
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)), d: priv }
  });
  return { pub: pub, key: key };
}

function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return 'https://vercel.app';
}

function vapidJwt(endpoint, key) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapidSubject()
  }));
  const data = header + '.' + claims;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: key, dsaEncoding: 'ieee-p1363' });
  return data + '.' + b64url(sig);
}

// Leeren Push senden → Statuscode des Push-Dienstes (201 = ok, 404/410 = Abo ungültig)
async function sendPush(subscription) {
  const v = vapid();
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + vapidJwt(subscription.endpoint, v.key) + ', k=' + v.pub,
      TTL: '43200',
      Urgency: 'normal',
      'Content-Length': '0'
    }
  });
  return res.status;
}

module.exports = { SUBS_KEY, isAllowedEndpoint, subId, redis, sendPush };
