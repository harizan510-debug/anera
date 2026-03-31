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
    // ── Step 0: Try AJAX/API endpoints FIRST for known bot-protected sites ──
    // These bypass PerimeterX/Cloudflare and are much faster than timing out
    // on direct fetches. Vercel free tier has a 10s function timeout.
    let earlyImage = '';
    let earlyText = '';
    let earlyStructured = '';

    const ajaxResult = await tryAjaxEndpoints(parsedUrl, url);
    if (ajaxResult.imageUrl) earlyImage = ajaxResult.imageUrl;
    if (ajaxResult.html) {
      // Extract text
      const t = ajaxResult.html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (t.length > 100) earlyText = t.slice(0, 3000);
      // Extract JSON-LD
      const jm = ajaxResult.html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jm) {
        for (const m of jm) {
          const jc = m.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
          try { const p = JSON.parse(jc); if (findProduct(p)) { earlyStructured = jc; break; } } catch { /* skip */ }
        }
      }
    }

    // If AJAX gave us an image, we can skip slow direct fetches for bot-protected sites
    // and just get text from Microlink
    if (earlyImage || ajaxResult.productPrice) {
      // Try Microlink for text/description if we don't have good text
      let text = earlyText;
      let structuredData = earlyStructured;
      if (!text || text.length < 200) {
        try {
          const mlRes = await fetch(
            `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (mlRes.ok) {
            const mlData = await mlRes.json() as Record<string, unknown>;
            if (mlData.status === 'success' && mlData.data) {
              const d = mlData.data as Record<string, unknown>;
              const parts: string[] = [];
              if (d.title) parts.push(`Product: ${d.title}`);
              if (d.description) parts.push(`Description: ${d.description}`);
              if (d.author) parts.push(`Brand: ${d.author}`);
              if (parts.length > 0) text = `META TAGS: ${parts.join(' | ')}${text ? '\n\n' + text : ''}`;
            }
          }
        } catch { /* continue with what we have */ }
      }
      // Truncate and return early
      if (text.length > 3000) text = text.slice(0, 3000) + '\u2026';
      if (structuredData.length > 2000) structuredData = structuredData.slice(0, 2000) + '\u2026';
      return res.status(200).json({
        text,
        structuredData: structuredData || undefined,
        imageUrl: earlyImage || undefined,
        // Pass through structured product data from AJAX/Shopify
        productName: ajaxResult.productName || undefined,
        productPrice: ajaxResult.productPrice || undefined,
        productCurrency: ajaxResult.productCurrency || undefined,
      });
    }

    // ── Fetch strategies (for sites without AJAX workaround) ────────────────
    let bestHtml = '';
    const allHtmlChunks: string[] = [];

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
          signal: AbortSignal.timeout(5000),
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
            signal: AbortSignal.timeout(5000),
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

    // 5. LAST RESORT: Use Microlink.io API (free tier, has headless browser)
    if (!imageUrl || (!text && !structuredData)) {
      try {
        const mlRes = await fetch(
          `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(12000) }
        );
        if (mlRes.ok) {
          const mlData = await mlRes.json() as Record<string, unknown>;
          if (mlData.status === 'success' && mlData.data) {
            const d = mlData.data as Record<string, unknown>;
            if (!imageUrl) {
              const mlImg = d.image as Record<string, string> | undefined;
              if (mlImg?.url) imageUrl = mlImg.url;
            }
            if (!text && !structuredData) {
              const parts: string[] = [];
              if (d.title) parts.push(`Product: ${d.title}`);
              if (d.description) parts.push(`Description: ${d.description}`);
              if (d.author) parts.push(`Brand: ${d.author}`);
              if (d.publisher) parts.push(`Publisher: ${d.publisher}`);
              if (parts.length > 0) {
                text = `META TAGS: ${parts.join(' | ')}`;
              }
            }
          }
        }
      } catch { /* microlink unavailable */ }
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

    // ── Extract structured product data from JSON-LD / meta tags ─────────
    // This is the fallback when AJAX/Shopify handlers fail
    let productName: string | undefined;
    let productPrice: number | undefined;
    let productCurrency: string | undefined;

    // Try JSON-LD first (most reliable)
    if (structuredData) {
      try {
        const parsed = JSON.parse(structuredData);
        const product = findProduct(parsed);
        if (product) {
          if (product.name && typeof product.name === 'string') productName = product.name;
          // Extract price from offers
          const offers = product.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer) {
            const p = parseFloat(String(offer.price || ''));
            if (p > 0) productPrice = p;
            if (offer.priceCurrency) productCurrency = String(offer.priceCurrency);
          }
        }
      } catch { /* JSON-LD parse failed */ }
    }

    // Fall back to meta tags
    if (!productName && ogTitleMatch) productName = ogTitleMatch[1];
    if (!productPrice && metaPriceMatch) {
      const p = parseFloat(metaPriceMatch[1]);
      if (p > 0) productPrice = p;
    }
    if (!productCurrency && metaCurrencyMatch) productCurrency = metaCurrencyMatch[1];

    // Truncate
    const maxTextLen = 3000;
    const maxStructuredLen = 2000;
    if (text.length > maxTextLen) text = text.slice(0, maxTextLen) + '\u2026';
    if (structuredData.length > maxStructuredLen) structuredData = structuredData.slice(0, maxStructuredLen) + '\u2026';

    return res.status(200).json({
      text,
      structuredData: structuredData || undefined,
      imageUrl: imageUrl || undefined,
      productName: productName || undefined,
      productPrice: productPrice || undefined,
      productCurrency: productCurrency || undefined,
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

/**
 * Try site-specific AJAX/API endpoints that bypass anti-bot protections.
 * These are the same endpoints the site's own JavaScript uses.
 */
interface AjaxResult {
  imageUrl?: string;
  html?: string;
  productName?: string;
  productPrice?: number;
  productCurrency?: string;
}

async function tryAjaxEndpoints(parsedUrl: URL, originalUrl: string): Promise<AjaxResult> {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname;

  // Ralph Lauren (Salesforce Commerce Cloud / Demandware)
  // AJAX endpoint bypasses PerimeterX bot protection
  if (host.includes('ralphlauren')) {
    // Extract product ID from URL: /en/slug-PRODUCTID.html or /en/slug.html?cgid=...
    // Formats: /en/product-name-394189.html or /en/product-name-3616857218191.html
    const pidMatch = path.match(/[-/](\d{4,})(?:\.html|$)/);
    if (pidMatch) {
      const pid = pidMatch[1];
      // Determine the site ID from the domain
      const siteMap: Record<string, string> = {
        'co.uk': 'RalphLauren_GB',
        'com': 'RalphLauren_US',
        'fr': 'RalphLauren_FR',
        'de': 'RalphLauren_DE',
        'it': 'RalphLauren_IT',
        'es': 'RalphLauren_ES',
      };
      const domainSuffix = host.replace(/^.*?ralphlauren\./, '');
      const siteId = siteMap[domainSuffix] || 'RalphLauren_GB';

      try {
        const ajaxUrl = `https://${host}/on/demandware.store/Sites-${siteId}-Site/default/Product-Variation?pid=${pid}&format=ajax`;
        const ajaxRes = await fetch(ajaxUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (ajaxRes.ok) {
          const ajaxHtml = await ajaxRes.text();
          // Extract the main product image (alternate10 is the hero shot)
          const imgMatch = ajaxHtml.match(/https:\/\/dtcralphlauren\.scene7\.com\/is\/image\/PoloGSI\/s7-[^"'\s)]*alternate10[^"'\s)]*/i);
          const imageUrl = imgMatch ? imgMatch[0] : undefined;
          return { imageUrl, html: ajaxHtml };
        }
      } catch { /* AJAX failed */ }
    }
  }

  // ── Shopify stores ──────────────────────────────────────────────────────
  // Shopify has a public .json product API that works on ANY Shopify store.
  // Pattern: /products/slug → /products/slug.json
  // This bypasses all bot protection and returns full structured data.
  {
    const shopifyMatch = path.match(/\/products\/([^/?#]+)/);
    if (shopifyMatch) {
      const productSlug = shopifyMatch[1].replace(/\.json$/, '');
      const jsonUrl = `https://${host}/products/${productSlug}.json`;
      try {
        const sjRes = await fetch(jsonUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (sjRes.ok) {
          const sjData = await sjRes.json() as { product?: ShopifyProduct };
          if (sjData.product) {
            const p = sjData.product;
            // Pick variant from URL ?variant= param, or first variant
            const variantParam = parsedUrl.searchParams.get('variant');
            const variant = variantParam
              ? p.variants?.find((v: ShopifyVariant) => String(v.id) === variantParam) || p.variants?.[0]
              : p.variants?.[0];

            const imageUrl = p.image?.src || p.images?.[0]?.src || undefined;

            // Build synthetic HTML so the Claude prompt can parse it
            const currency = parsedUrl.searchParams.get('currency') || 'GBP';
            const currencySymbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;
            // Shopify returns price as a string — some stores use cents (e.g. "14500")
            // while others use decimal (e.g. "145.00"). Normalise to decimal format.
            let priceVal = variant?.price || '0';
            const priceNum = parseFloat(priceVal);
            if (priceNum > 0 && !priceVal.includes('.') && priceNum > 999) {
              // Likely in cents/pence — convert to major currency unit
              priceVal = (priceNum / 100).toFixed(2);
            }
            const bodyText = (p.body_html || '')
              .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
              .replace(/\s+/g, ' ').trim();

            const syntheticHtml = [
              `<title>${p.title || ''}</title>`,
              `<meta property="og:title" content="${p.title || ''}" />`,
              `<meta property="product:price:amount" content="${priceVal}" />`,
              `<meta property="product:price:currency" content="${currency}" />`,
              imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : '',
              `<script type="application/ld+json">${JSON.stringify({
                '@type': 'Product',
                name: p.title,
                description: bodyText.slice(0, 500),
                brand: { '@type': 'Brand', name: p.vendor || '' },
                image: imageUrl || '',
                offers: {
                  '@type': 'Offer',
                  price: priceVal,
                  priceCurrency: currency,
                },
              })}</script>`,
              `<div class="product-description">`,
              `<h1>${p.title}</h1>`,
              `<p>Brand: ${p.vendor || 'Unknown'}</p>`,
              `<p>Price: ${currencySymbol}${priceVal}</p>`,
              `<p>Type: ${p.product_type || ''}</p>`,
              `<p>Tags: ${(p.tags || []).join(', ')}</p>`,
              `<p>${bodyText}</p>`,
              `</div>`,
            ].join('\n');

            return {
              imageUrl,
              html: syntheticHtml,
              productName: p.title || undefined,
              productPrice: parseFloat(priceVal) || undefined,
              productCurrency: currency,
            };
          }
        }
      } catch { /* Shopify JSON failed — fall through to normal scraping */ }
    }
  }

  // Generic Demandware/SFCC sites (many fashion brands use this platform)
  // Pattern: hostname + /on/demandware.store/Sites-XXX-Site/default/Product-Variation?pid=XXX
  // We'd need to know the site ID, so skip for now

  void originalUrl; // suppress unused param warning
  return {};
}

// ── Shopify types ───────────────────────────────────────────────────────────
interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  sku: string;
}
interface ShopifyProduct {
  title: string;
  vendor: string;
  product_type: string;
  body_html: string;
  tags: string[];
  image?: { src: string };
  images?: { src: string }[];
  variants?: ShopifyVariant[];
}
