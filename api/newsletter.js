// /api/newsletter.js
// Stores newsletter subscriber emails in Upstash KV.
// POST { email } → 200 subscribed | 409 already subscribed | 400 invalid

const KV_URL   = 'https://patient-dragon-155704.upstash.io';
const KV_TOKEN = 'gQAAAAAAAmA4AAIgcDIxZjgwYWU3ODEzOTM0NjdmYjlmZTNjZDE1MzExMjEwZQ';

async function kv(cmd, ...args) {
  const res = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json();
  return json.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let email = '';
  try {
    email = (req.body?.email || '').toLowerCase().trim();
  } catch (e) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  // Basic validation
  if (!email || !email.includes('@') || !email.includes('.') || email.length > 200) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // Key: newsletter:{email} → timestamp (SADD-style dedup via SET NX)
    const key    = `newsletter:${email}`;
    const result = await kv('SET', key, Date.now().toString(), 'NX');

    if (result === null) {
      // NX means nothing was set — key already existed
      return res.status(409).json({ message: 'Already subscribed' });
    }

    // Also push to a sorted set so we can list subscribers easily
    await kv('ZADD', 'newsletter:all', Date.now().toString(), email);

    return res.status(200).json({ message: 'Subscribed successfully' });
  } catch (err) {
    console.error('Newsletter KV error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
