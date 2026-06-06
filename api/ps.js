export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const endpoint = req.query.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const TOKEN = 'PXUwtDI-FzjMA9nRKnPNJxwaCGSugwA_mpjCE4hM_kzO5GHT3IU';
  const url = `https://api.pandascore.co${endpoint}&token=${TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 min en Vercel
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
