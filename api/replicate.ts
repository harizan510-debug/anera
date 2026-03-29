// Vercel serverless function — proxies Replicate API calls (create prediction + poll)
// Env var: REPLICATE_API_KEY (no VITE_ prefix = server-only)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'REPLICATE_API_KEY not configured — set it in Vercel Environment Variables (without VITE_ prefix)' });

  const { action } = req.body;

  try {
    if (action === 'create') {
      const { version, input } = req.body;
      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version, input }),
      });
      const data = await response.json();
      if (!response.ok) return res.status(response.status).json(data);
      return res.status(200).json(data);

    } else if (action === 'poll') {
      const { url } = req.body;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await response.json();
      if (!response.ok) return res.status(response.status).json(data);
      return res.status(200).json(data);

    } else {
      return res.status(400).json({ error: 'Invalid action. Use "create" or "poll".' });
    }
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
