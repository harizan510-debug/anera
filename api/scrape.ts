// Vercel serverless function — fetches a product URL and returns text content
// Used to extract fabric, price, and item details from retail websites
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

  // Basic validation
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Try multiple fetch strategies to handle anti-bot redirects
    let html = '';

    // Strategy 1: Standard fetch with redirect follow
    const strategies = [
      // Standard browser-like request
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow' as RequestRedirect,
      },
      // Simpler request (some sites block complex headers)
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html',
        },
        redirect: 'follow' as RequestRedirect,
      },
    ];

    for (const opts of strategies) {
      try {
        const response = await fetch(url, {
          ...opts,
          signal: AbortSignal.timeout(10000),
        });

        // Handle manual redirect if needed
        if (response.status >= 300 && response.status < 400) {
          const redirectUrl = response.headers.get('location');
          if (redirectUrl) {
            const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).href;
            const redirectResponse = await fetch(fullUrl, {
              ...opts,
              signal: AbortSignal.timeout(8000),
            });
            if (redirectResponse.ok) {
              html = await redirectResponse.text();
              break;
            }
          }
          continue;
        }

        if (response.ok) {
          html = await response.text();
          break;
        }
      } catch { /* try next strategy */ }
    }

    if (!html) {
      return res.status(200).json({ text: '', error: 'Could not fetch page (blocked or timeout)' });
    }

    // Extract JSON-LD structured data BEFORE stripping HTML
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    let structuredData = '';
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        const jsonContent = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
        try {
          const parsed = JSON.parse(jsonContent);
          // Look for Product schema (direct or in @graph)
          if (parsed['@type'] === 'Product' ||
              (Array.isArray(parsed['@graph']) && parsed['@graph'].some((item: Record<string, string>) => item['@type'] === 'Product'))) {
            structuredData = jsonContent;
            break;
          }
        } catch { /* not valid JSON, skip */ }
      }
    }

    // Also extract meta tags for price/product info (many sites use Open Graph or meta tags)
    const metaPriceMatch = html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i);
    const metaCurrencyMatch = html.match(/<meta[^>]*property=["']product:price:currency["'][^>]*content=["']([^"']+)["']/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);

    let metaInfo = '';
    if (metaPriceMatch || ogTitleMatch) {
      const parts: string[] = [];
      if (ogTitleMatch) parts.push(`Product: ${ogTitleMatch[1]}`);
      if (metaPriceMatch) parts.push(`Price: ${metaPriceMatch[1]}`);
      if (metaCurrencyMatch) parts.push(`Currency: ${metaCurrencyMatch[1]}`);
      if (ogImageMatch) parts.push(`Image: ${ogImageMatch[1]}`);
      metaInfo = parts.join(' | ');
    }

    // Extract useful text from HTML — strip scripts, styles, and tags
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract product image URL from multiple sources (in priority order)
    let imageUrl = '';

    // 1. Try JSON-LD structured data first (most reliable)
    if (structuredData) {
      try {
        const parsed = JSON.parse(structuredData);
        const product = parsed['@type'] === 'Product'
          ? parsed
          : (Array.isArray(parsed['@graph']) ? parsed['@graph'].find((i: Record<string, string>) => i['@type'] === 'Product') : null);
        if (product) {
          const img = product.image;
          if (typeof img === 'string') imageUrl = img;
          else if (Array.isArray(img) && img.length > 0) imageUrl = typeof img[0] === 'string' ? img[0] : (img[0] as Record<string, string>).url || '';
          else if (img && typeof img === 'object') imageUrl = (img as Record<string, string>).url || '';
        }
      } catch { /* ignore */ }
    }

    // 2. Try og:image meta tag
    if (!imageUrl && ogImageMatch) {
      imageUrl = ogImageMatch[1];
    }

    // 3. Try twitter:image meta tag
    if (!imageUrl) {
      const twitterImageMatch = html.match(/<meta[^>]*(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
      if (twitterImageMatch) imageUrl = twitterImageMatch[1];
    }

    // 4. Try first large product image from HTML
    if (!imageUrl) {
      const imgMatches = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*/gi);
      if (imgMatches) {
        for (const imgTag of imgMatches) {
          const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
          if (srcMatch) {
            const src = srcMatch[1];
            // Look for product-like image URLs (skip icons, logos, SVGs, tracking pixels)
            if (src.match(/\.(jpg|jpeg|png|webp)/i) &&
                !src.match(/(icon|logo|sprite|pixel|tracking|1x1|badge|flag)/i) &&
                (src.includes('product') || src.includes('media') || src.includes('image') || src.includes('photo') || src.length > 60)) {
              imageUrl = src;
              break;
            }
          }
        }
      }
    }

    // Make relative URLs absolute
    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        imageUrl = new URL(imageUrl, url).href;
      } catch { /* keep as-is */ }
    }

    // Prepend meta info to text for better extraction
    if (metaInfo) {
      text = `META TAGS: ${metaInfo}\n\n${text}`;
    }

    // Truncate to keep within reasonable token limits
    const maxTextLen = 3000;
    const maxStructuredLen = 2000;
    if (text.length > maxTextLen) text = text.slice(0, maxTextLen) + '…';
    if (structuredData.length > maxStructuredLen) structuredData = structuredData.slice(0, maxStructuredLen) + '…';

    return res.status(200).json({ text, structuredData: structuredData || undefined, imageUrl: imageUrl || undefined });
  } catch (err) {
    return res.status(200).json({ text: '', error: String(err) });
  }
}
