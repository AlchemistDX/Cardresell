export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json({
    ok: true,
    service: 'cardresell',
    time: new Date().toISOString(),
  });
}
