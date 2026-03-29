// Vercel serverless function — proxies Replicate API calls (create prediction + poll)
// Env var: REPLICATE_API_KEY (no VITE_ prefix = server-only)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    console.error('[replicate] REPLICATE_API_KEY not set. Available env keys:', Object.keys(process.env).filter(k => k.includes('REPLICATE')));
    return res.status(500).json({ error: 'REPLICATE_API_KEY not configured — set it in Vercel Environment Variables (without VITE_ prefix)' });
  }

  // Log key prefix for debugging (safe — only first 8 chars)
  console.log(`[replicate] Using key: ${apiKey.substring(0, 8)}... (action: ${req.body?.action})`);

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
      if (!response.ok) {
        console.error(`[replicate] Create failed (${response.status}):`, JSON.stringify(data).substring(0, 500));
        return res.status(response.status).json(data);
      }
      console.log(`[replicate] Create OK — prediction id: ${(data as Record<string, string>).id}`);
      return res.status(200).json(data);

    } else if (action === 'poll') {
      const { url } = req.body;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await response.json();
      if (!response.ok) {
        console.error(`[replicate] Poll failed (${response.status}):`, JSON.stringify(data).substring(0, 500));
        return res.status(response.status).json(data);
      }
      return res.status(200).json(data);

    } else if (action === 'verify') {
      // Diagnostic: verify the key works against Replicate's API
      const response = await fetch('https://api.replicate.com/v1/account', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await response.json();
      return res.status(response.status).json({
        key_prefix: apiKey.substring(0, 8) + '...',
        replicate_status: response.status,
        account: data,
      });

    } else {
      return res.status(400).json({ error: 'Invalid action. Use "create", "poll", or "verify".' });
    }
  } catch (err) {
    console.error(`[replicate] Exception:`, err);
    return res.status(500).json({ error: String(err) });
  }
}
