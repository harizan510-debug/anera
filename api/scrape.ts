// Vercel serverless function — fetches a product URL and returns text content
// Used to extract fabric, price, and item details from retail websites
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

  // Basic validation
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Try multiple fetch strategies to handle anti-bot redirects and GDPR walls
    let html = '';

    // Common GDPR cookie consent values that bypass consent walls
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
        redirect: 'follow' as RequestRedirect,
      },
      // Strategy 2: Browser without Sec-Fetch headers (some sites block them)
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Accept-Encoding': 'identity',
          'Cookie': gdprCookies,
        },
        redirect: 'follow' as RequestRedirect,
      },
      // Strategy 3: Googlebot (bypasses most anti-bot and cookie walls)
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
        // Use manual redirect so we can capture Set-Cookie headers
        const response = await fetch(url, {
          ...opts,
          redirect: 'manual' as RequestRedirect,
          signal: AbortSignal.timeout(10000),
        });

        // Handle redirect: capture cookies and follow with them
        if (response.status >= 300 && response.status < 400) {
          const redirectUrl = response.headers.get('location');
          // Capture Set-Cookie from the redirect response
          const setCookies = response.headers.getSetCookie?.() || [];
          const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

          if (redirectUrl) {
            const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).href;
            // Merge captured cookies with existing ones
            const mergedHeaders = { ...opts.headers } as Record<string, string>;
            if (cookieStr) {
              mergedHeaders['Cookie'] = mergedHeaders['Cookie']
                ? `${mergedHeaders['Cookie']}; ${cookieStr}`
                : cookieStr;
            }
            const redirectResponse = await fetch(fullUrl, {
              headers: mergedHeaders,
              redirect: 'follow',
              signal: AbortSignal.timeout(8000),
            });
            if (redirectResponse.ok) {
              const redirectHtml = await redirectResponse.text();
              if (redirectHtml.length > 1000 && !isOnlyCookieWall(redirectHtml)) {
                html = redirectHtml;
                break;
              }
            }
          }

          // Also try original URL again with captured cookies (some sites set cookies then expect retry)
          if (!html && cookieStr) {
            try {
              const mergedHeaders = { ...opts.headers } as Record<string, string>;
              mergedHeaders['Cookie'] = mergedHeaders['Cookie']
                ? `${mergedHeaders['Cookie']}; ${cookieStr}`
                : cookieStr;
              const retryResponse = await fetch(url, {
                headers: mergedHeaders,
                redirect: 'follow',
                signal: AbortSignal.timeout(8000),
              });
              if (retryResponse.ok) {
                const retryHtml = await retryResponse.text();
                if (retryHtml.length > 1000 && !isOnlyCookieWall(retryHtml)) {
                  html = retryHtml;
                  break;
                }
              }
            } catch { /* continue */ }
          }
          continue;
        }

        if (response.ok) {
          const responseHtml = await response.text();
          if (responseHtml.length > 1000 && !isOnlyCookieWall(responseHtml)) {
            html = responseHtml;
            break;
          }
        }
      } catch { /* try next strategy */ }
    }

    // Extract JSON-LD structured data BEFORE stripping HTML
    let structuredData = '';
    let imageUrl = '';

    if (html) {
      const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatches) {
        for (const match of jsonLdMatches) {
          const jsonContent = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
          try {
            const parsed = JSON.parse(jsonContent);
            if (parsed['@type'] === 'Product' ||
                (Array.isArray(parsed['@graph']) && parsed['@graph'].some((item: Record<string, string>) => item['@type'] === 'Product'))) {
              structuredData = jsonContent;
              break;
            }
          } catch { /* not valid JSON, skip */ }
        }
      }
    }

    // Also extract meta tags for price/product info
    const ogTitleMatch = html ? html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) : null;
    const ogImageMatch = html ? html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) : null;
    const metaPriceMatch = html ? html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i) : null;
    const metaCurrencyMatch = html ? html.match(/<meta[^>]*property=["']product:price:currency["'][^>]*content=["']([^"']+)["']/i) : null;

    let metaInfo = '';
    if (metaPriceMatch || ogTitleMatch) {
      const parts: string[] = [];
      if (ogTitleMatch) parts.push(`Product: ${ogTitleMatch[1]}`);
      if (metaPriceMatch) parts.push(`Price: ${metaPriceMatch[1]}`);
      if (metaCurrencyMatch) parts.push(`Currency: ${metaCurrencyMatch[1]}`);
      if (ogImageMatch) parts.push(`Image: ${ogImageMatch[1]}`);
      metaInfo = parts.join(' | ');
    }

    // Extract useful text from HTML
    let text = '';
    if (html) {
      text = html
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
    if (!imageUrl && html) {
      const twitterImageMatch = html.match(/<meta[^>]*(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
      if (twitterImageMatch) imageUrl = twitterImageMatch[1];
    }

    // 4. Try first large product image from HTML
    if (!imageUrl && html) {
      const imgMatches = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*/gi);
      if (imgMatches) {
        for (const imgTag of imgMatches) {
          const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
          if (srcMatch) {
            const src = srcMatch[1];
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

    // 5. FALLBACK: If scraping failed entirely, try to construct image URL from known e-commerce patterns
    if (!imageUrl) {
      imageUrl = guessImageFromUrl(parsedUrl) || '';
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

    if (!html && !imageUrl) {
      return res.status(200).json({ text: '', error: 'Could not fetch page (blocked or timeout)' });
    }

    // Truncate to keep within reasonable token limits
    const maxTextLen = 3000;
    const maxStructuredLen = 2000;
    if (text.length > maxTextLen) text = text.slice(0, maxTextLen) + '\u2026';
    if (structuredData.length > maxStructuredLen) structuredData = structuredData.slice(0, maxStructuredLen) + '\u2026';

    return res.status(200).json({ text, structuredData: structuredData || undefined, imageUrl: imageUrl || undefined });
  } catch (err) {
    return res.status(200).json({ text: '', error: String(err) });
  }
}

/** Detect if fetched HTML is just a cookie/GDPR consent wall rather than real content */
function isOnlyCookieWall(html: string): boolean {
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // If the stripped text is very short, it's likely a redirect/consent page
  if (textContent.length < 200) return true;
  // If it contains cookie consent keywords but no product keywords, it's a consent wall
  const cookieTerms = (textContent.match(/cookie|consent|gdpr|privacy|accept all/gi) || []).length;
  const productTerms = (textContent.match(/add to (?:bag|cart|basket)|price|fabric|composition|material|size guide/gi) || []).length;
  return cookieTerms > 3 && productTerms === 0;
}

/**
 * Attempt to construct a product image URL from known e-commerce URL patterns.
 * This is a last-resort fallback when scraping is blocked.
 */
function guessImageFromUrl(parsedUrl: URL): string | null {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname;

  // Ralph Lauren — product IDs in URL like /en/relaxed-fit-striped-cotton-shirt-3616857218191.html
  // Image pattern: https://www.ralphlauren.co.uk/dw/image/v2/BFXK_PRD/on/demandware.static/-/Sites-rl-products/default/[hash]/[productId].jpg
  // Alternative: try their media CDN
  if (host.includes('ralphlauren')) {
    // Extract numeric product ID from the URL
    const idMatch = path.match(/(\d{10,})/);
    if (idMatch) {
      // Ralph Lauren uses Demandware; construct a search-friendly image URL
      // Their OG images follow this pattern on .co.uk:
      return `https://${host}/dw/image/v2/BFXK_PRD/on/demandware.static/-/Sites-rl-products/default/dw_auto/RL_Product_${idMatch[1]}.jpg`;
    }
    // Try the slug-based pattern: /en/[slug]-[id].html → often the slug alone works
    const slugMatch = path.match(/\/en\/([a-z0-9-]+?)(?:-\d+)?\.html/i);
    if (slugMatch) {
      return `https://${host}/dw/image/v2/BFXK_PRD/on/demandware.static/-/Sites-rl-products/default/dw_auto/${slugMatch[1]}.jpg`;
    }
  }

  // Zara — their images are React-rendered, but og:image usually works via Google cache
  // We'll try the Google AMP cache as a fallback
  if (host.includes('zara.com')) {
    // Zara doesn't have predictable image URLs from the product URL alone
    return null;
  }

  // H&M — product URLs contain a product ID like /en_gb/productpage.0970818001.html
  if (host.includes('hm.com') || host.includes('h&m')) {
    const hmMatch = path.match(/(\d{10})\d{3}\.html/);
    if (hmMatch) {
      return `https://lp2.hm.com/hmgoepprod?set=source[/model/2024/${hmMatch[1]}001.jpg],origin[dam],type[DESCRIPTIVESTILLLIFE]&call=url[file:/product/main]`;
    }
  }

  // ASOS — product ID in URL like /prd/12345678
  if (host.includes('asos.com')) {
    const asosMatch = path.match(/\/prd\/(\d+)/);
    if (asosMatch) {
      return `https://images.asos-media.com/products/asos/${asosMatch[1]}-1-1.jpg`;
    }
  }

  // COS — similar to H&M (owned by H&M group)
  if (host.includes('cos.com')) {
    const cosMatch = path.match(/(\d{10})\d{3}\.html/);
    if (cosMatch) {
      return `https://lp2.hm.com/hmgoepprod?set=source[/model/2024/${cosMatch[1]}001.jpg],origin[dam],type[DESCRIPTIVESTILLLIFE]&call=url[file:/product/main]`;
    }
  }

  // Generic: no known pattern
  return null;
}
