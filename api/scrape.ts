// Vercel serverless function — fetches a product URL and returns text content
// Used to extract fabric, price, and item details from retail websites
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // ── Fetch strategies ────────────────────────────────────────────────────
    // We collect the BEST full-content HTML plus any partial HTML that may
    // contain meta tags (og:image, JSON-LD) even if the page body is a
    // cookie/GDPR wall.

    let bestHtml = '';          // Best HTML with real product content
    const allHtmlChunks: string[] = []; // ALL HTML we received, for meta extraction

    const gdprCookies = [
      'notice_gdpr_prefs=0,1,2:1a8b7b603bbe638a',
      'notice_preferences=2:',
      'cmapi_cookie_privacy=permit 1,2,3',
      'eupubconsent-v2=CPzQZYAPzQZYAAGABCENB-CgAAAAAH_AAAYgAAAA',
      'OptanonAlertBoxClosed=2024-01-01T00:00:00.000Z',
      'OptanonConsent=isGpcEnabled=0&datestamp=2024-01-01T00:00:00.000Z&version=202301.1.0&isIABGlobal=false&groups=C0001:1,C0002:1,C0003:1,C0004:1',
      'cookie_consent=accepted',
      'cookieconsent_status=allow',
      'CookieConsent=true',
    ].join('; ');

    const strategies = [
      // Strategy 1: Browser-like with GDPR cookies
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          'Cookie': gdprCookies,
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
      },
      // Strategy 2: Browser without Sec-Fetch headers
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Accept-Encoding': 'identity',
          'Cookie': gdprCookies,
        },
      },
      // Strategy 3: Googlebot
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html',
        },
      },
    ];

    for (const opts of strategies) {
      if (bestHtml) break; // Already have good content

      try {
        // First try with manual redirect to capture cookies
        const response = await fetch(url, {
          headers: opts.headers,
          redirect: 'manual' as RequestRedirect,
          signal: AbortSignal.timeout(10000),
        });

        if (response.status >= 300 && response.status < 400) {
          const redirectUrl = response.headers.get('location');
          const setCookies = response.headers.getSetCookie?.() || [];
          const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

          // Try following the redirect with merged cookies
          const targets = redirectUrl
            ? [
                redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).href,
                url, // Also retry original URL with new cookies
              ]
            : [url];

          for (const target of targets) {
            if (bestHtml) break;
            try {
              const mergedHeaders = { ...opts.headers } as Record<string, string>;
              if (cookieStr) {
                mergedHeaders['Cookie'] = mergedHeaders['Cookie']
                  ? `${mergedHeaders['Cookie']}; ${cookieStr}`
                  : cookieStr;
              }
              const r = await fetch(target, {
                headers: mergedHeaders,
                redirect: 'follow',
                signal: AbortSignal.timeout(8000),
              });
              if (r.ok) {
                const h = await r.text();
                if (h.length > 200) allHtmlChunks.push(h);
                if (h.length > 1000 && hasProductContent(h)) {
                  bestHtml = h;
                }
              }
            } catch { /* continue */ }
          }
          continue;
        }

        if (response.ok) {
          const h = await response.text();
          if (h.length > 200) allHtmlChunks.push(h);
          if (h.length > 1000 && hasProductContent(h)) {
            bestHtml = h;
          }
        }
      } catch { /* try next strategy */ }

      // Also try with automatic redirect follow (simpler path)
      if (!bestHtml) {
        try {
          const response = await fetch(url, {
            headers: opts.headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            const h = await response.text();
            if (h.length > 200) allHtmlChunks.push(h);
            if (h.length > 1000 && hasProductContent(h)) {
              bestHtml = h;
            }
          }
        } catch { /* continue */ }
      }
    }

    // Use bestHtml for text extraction, but search ALL chunks for meta/image data
    const htmlForText = bestHtml;
    // Combine all HTML chunks (deduplicated by taking the longest) for meta extraction
    const htmlForMeta = allHtmlChunks.length > 0
      ? allHtmlChunks.reduce((a, b) => a.length >= b.length ? a : b, '')
      : '';

    // ── Extract structured data & meta tags from ALL fetched HTML ──────────
    let structuredData = '';
    let imageUrl = '';

    // Search every chunk for JSON-LD and meta tags (cookie walls often still have them!)
    for (const chunk of allHtmlChunks) {
      // JSON-LD
      if (!structuredData) {
        const jsonLdMatches = chunk.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        if (jsonLdMatches) {
          for (const match of jsonLdMatches) {
            const jsonContent = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
            try {
              const parsed = JSON.parse(jsonContent);
              if (parsed['@type'] === 'Product' || parsed['@type'] === 'ProductGroup' ||
                  (Array.isArray(parsed['@graph']) && parsed['@graph'].some((item: Record<string, string>) =>
                    item['@type'] === 'Product' || item['@type'] === 'ProductGroup'))) {
                structuredData = jsonContent;
                break;
              }
            } catch { /* not valid JSON */ }
          }
        }
      }

      // og:image (try both attribute orders: property then content, and content then property)
      if (!imageUrl) {
        const ogImg = chunk.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
          || chunk.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
        if (ogImg) imageUrl = ogImg[1];
      }
    }

    // Extract more meta tags from the best meta HTML
    const ogTitleMatch = htmlForMeta.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || htmlForMeta.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const metaPriceMatch = htmlForMeta.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i)
      || htmlForMeta.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i);
    const metaCurrencyMatch = htmlForMeta.match(/<meta[^>]*property=["']product:price:currency["'][^>]*content=["']([^"']+)["']/i)
      || htmlForMeta.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']product:price:currency["']/i);

    let metaInfo = '';
    if (metaPriceMatch || ogTitleMatch) {
      const parts: string[] = [];
      if (ogTitleMatch) parts.push(`Product: ${ogTitleMatch[1]}`);
      if (metaPriceMatch) parts.push(`Price: ${metaPriceMatch[1]}`);
      if (metaCurrencyMatch) parts.push(`Currency: ${metaCurrencyMatch[1]}`);
      if (imageUrl) parts.push(`Image: ${imageUrl}`);
      metaInfo = parts.join(' | ');
    }

    // ── Extract text from best HTML ──────────────────────────────────────────
    let text = '';
    if (htmlForText) {
      text = htmlForText
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
    }

    // ── Extract product image URL (priority order) ──────────────────────────

    // 1. Try JSON-LD structured data first (most reliable)
    if (structuredData) {
      try {
        const parsed = JSON.parse(structuredData);
        const product = findProduct(parsed);
        if (product) {
          const img = product.image;
          const extracted = extractImageFromField(img);
          if (extracted) imageUrl = extracted;
        }
      } catch { /* ignore */ }
    }

    // 2. og:image was already extracted above from all chunks

    // 3. Try twitter:image from all chunks
    if (!imageUrl) {
      for (const chunk of allHtmlChunks) {
        const twitterMatch = chunk.match(/<meta[^>]*(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
          || chunk.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']twitter:image["']/i);
        if (twitterMatch) { imageUrl = twitterMatch[1]; break; }
      }
    }

    // 4. Try product images from <img> tags in best HTML
    if (!imageUrl && htmlForText) {
      imageUrl = findProductImage(htmlForText) || '';
    }
    // Also try in any chunk if still nothing
    if (!imageUrl) {
      for (const chunk of allHtmlChunks) {
        const found = findProductImage(chunk);
        if (found) { imageUrl = found; break; }
      }
    }

    // 5. FALLBACK: construct from known e-commerce URL patterns
    if (!imageUrl) {
      imageUrl = guessImageFromUrl(parsedUrl) || '';
    }

    // Make relative URLs absolute
    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        imageUrl = new URL(imageUrl, url).href;
      } catch { /* keep as-is */ }
    }

    // Prepend meta info to text
    if (metaInfo) {
      text = `META TAGS: ${metaInfo}\n\n${text}`;
    }

    if (!text && !imageUrl && !structuredData) {
      return res.status(200).json({ text: '', error: 'Could not fetch page (blocked or timeout)' });
    }

    // Truncate
    const maxTextLen = 3000;
    const maxStructuredLen = 2000;
    if (text.length > maxTextLen) text = text.slice(0, maxTextLen) + '\u2026';
    if (structuredData.length > maxStructuredLen) structuredData = structuredData.slice(0, maxStructuredLen) + '\u2026';

    return res.status(200).json({
      text,
      structuredData: structuredData || undefined,
      imageUrl: imageUrl || undefined,
    });
  } catch (err) {
    return res.status(200).json({ text: '', error: String(err) });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if HTML has real product content (not just a cookie wall) */
function hasProductContent(html: string): boolean {
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (textContent.length < 200) return false;
  const productTerms = (textContent.match(/add to (?:bag|cart|basket)|price|fabric|composition|material|size guide|product/gi) || []).length;
  return productTerms >= 1;
}

/** Find a Product or ProductGroup node in JSON-LD data */
function findProduct(parsed: Record<string, unknown>): Record<string, unknown> | null {
  if (parsed['@type'] === 'Product' || parsed['@type'] === 'ProductGroup') return parsed;
  if (Array.isArray(parsed['@graph'])) {
    const found = (parsed['@graph'] as Record<string, unknown>[]).find(
      i => i['@type'] === 'Product' || i['@type'] === 'ProductGroup'
    );
    if (found) return found;
  }
  return null;
}

/** Extract image URL from a JSON-LD image field (string, array, or object) */
function extractImageFromField(img: unknown): string | null {
  if (typeof img === 'string' && img.length > 5) return img;
  if (Array.isArray(img) && img.length > 0) {
    const first = img[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return (first as Record<string, string>).url || (first as Record<string, string>).contentUrl || null;
  }
  if (img && typeof img === 'object') return (img as Record<string, string>).url || (img as Record<string, string>).contentUrl || null;
  return null;
}

/** Find first product-like image in HTML */
function findProductImage(html: string): string | null {
  const imgMatches = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*/gi);
  if (!imgMatches) return null;
  for (const imgTag of imgMatches) {
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
      const src = srcMatch[1];
      if (src.match(/\.(jpg|jpeg|png|webp)/i) &&
          !src.match(/(icon|logo|sprite|pixel|tracking|1x1|badge|flag|spacer)/i) &&
          (src.includes('product') || src.includes('media') || src.includes('image') ||
           src.includes('photo') || src.includes('scene7') || src.includes('cdn') || src.length > 60)) {
        return src;
      }
    }
  }
  return null;
}

/** Last-resort: construct image URL from known e-commerce URL patterns */
function guessImageFromUrl(parsedUrl: URL): string | null {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname;

  // H&M
  if (host.includes('hm.com')) {
    const hmMatch = path.match(/(\d{10})\d{3}\.html/);
    if (hmMatch) {
      return `https://lp2.hm.com/hmgoepprod?set=source[/model/2024/${hmMatch[1]}001.jpg],origin[dam],type[DESCRIPTIVESTILLLIFE]&call=url[file:/product/main]`;
    }
  }

  // ASOS
  if (host.includes('asos.com')) {
    const asosMatch = path.match(/\/prd\/(\d+)/);
    if (asosMatch) {
      return `https://images.asos-media.com/products/asos/${asosMatch[1]}-1-1.jpg`;
    }
  }

  return null;
}
