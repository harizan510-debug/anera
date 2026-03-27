import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import { claudeMessage, scrapeUrl } from './apiHelper';
import type { WardrobeItem, BoundingBox } from './types';

export interface RawDetection {
  category: WardrobeItem['category'];
  categoryConfidence: number;
  subcategory: string;
  subcategoryConfidence: number;
  color: string;
  colorConfidence: number;
  brand: string;
  brandConfidence: number;
  pattern: string;
  fit: string;
  tags: string[];
  boundingBox: BoundingBox;
}

export async function analyzeClothingImage(base64Image: string, mimeType: string = 'image/jpeg'): Promise<Partial<WardrobeItem>> {
  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64Image.split(',')[1] || base64Image,
          },
        },
        {
          type: 'text',
          text: `Analyze this clothing item image. Return ONLY a JSON object with these fields:
{
  "category": one of "top"|"bottom"|"footwear"|"outerwear"|"jewellery"|"bag"|"dress",
  "subcategory": specific item type (e.g. "blazer", "jeans", "sneakers", "dress"),
  "color": primary color as single word,
  "pattern": "plain"|"striped"|"checked"|"floral"|"printed"|"other",
  "fit": "slim"|"regular"|"oversized"|"fitted"|"relaxed",
  "tags": array of 2-4 style descriptors like ["casual","minimal","classic"]
}
Return only the JSON, no explanation.`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { category: 'top', subcategory: 'top', color: 'unknown', pattern: 'plain', fit: 'regular', tags: [] };
  }
}

const VALID_CATS = new Set(['top','bottom','footwear','outerwear','jewellery','bag','dress']);
function safeCategory(v: string): WardrobeItem['category'] {
  return VALID_CATS.has(v) ? v as WardrobeItem['category'] : 'top';
}
function safeBB(bb: unknown): BoundingBox {
  if (!bb || typeof bb !== 'object') return { x: 0, y: 0, width: 1, height: 1 };
  const o = bb as Record<string, unknown>;
  const x = Math.max(0, Math.min(0.9, Number(o.x) || 0));
  const y = Math.max(0, Math.min(0.9, Number(o.y) || 0));
  const w = Math.max(0.05, Math.min(1 - x, Number(o.width) || 1));
  const h = Math.max(0.05, Math.min(1 - y, Number(o.height) || 1));
  return { x, y, width: w, height: h };
}

export async function detectClothingItems(
  base64Image: string,
  mimeType: string = 'image/jpeg',
): Promise<RawDetection[]> {
  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64Image.split(',')[1] || base64Image,
          },
        },
        {
          type: 'text',
          text: `Detect ALL distinct clothing items visible in this image. Include layered items (e.g. blazer over shirt = 2 separate items).

Return ONLY a JSON array — one element per item:
[
  {
    "category": "top"|"bottom"|"footwear"|"outerwear"|"jewellery"|"bag"|"dress",
    "categoryConfidence": 0.0-1.0,
    "subcategory": "specific name e.g. blazer, straight-leg jeans, white sneakers",
    "subcategoryConfidence": 0.0-1.0,
    "color": "primary color as one or two words",
    "colorConfidence": 0.0-1.0,
    "brand": "brand name if logo/label visible, otherwise empty string",
    "brandConfidence": 0.0-1.0,
    "pattern": "plain"|"striped"|"checked"|"floral"|"printed"|"other",
    "fit": "slim"|"regular"|"oversized"|"fitted"|"relaxed",
    "tags": ["tag1","tag2"],
    "boundingBox": { "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 }
  }
]

boundingBox: normalised 0-1 coordinates. x,y = top-left corner of the item. width,height = item dimensions.
confidence: 0 = guessing, 1 = certain. For brand, only give high confidence if you can clearly see a logo or label.
Return only the JSON array, no explanation.`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(clean);
    const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((raw: unknown) => {
      const r = raw as Record<string, unknown>;
      return {
        category: safeCategory(String(r.category ?? 'top')),
        categoryConfidence: Math.min(1, Math.max(0, Number(r.categoryConfidence) || 0.7)),
        subcategory: String(r.subcategory || 'item'),
        subcategoryConfidence: Math.min(1, Math.max(0, Number(r.subcategoryConfidence) || 0.7)),
        color: String(r.color || 'unknown'),
        colorConfidence: Math.min(1, Math.max(0, Number(r.colorConfidence) || 0.7)),
        brand: String(r.brand || ''),
        brandConfidence: Math.min(1, Math.max(0, Number(r.brandConfidence) || 0.4)),
        pattern: String(r.pattern || 'plain'),
        fit: String(r.fit || 'regular'),
        tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
        boundingBox: safeBB(r.boundingBox),
      } satisfies RawDetection;
    });
  } catch {
    return [{
      category: 'top', categoryConfidence: 0.5,
      subcategory: 'item', subcategoryConfidence: 0.5,
      color: 'unknown', colorConfidence: 0.5,
      brand: '', brandConfidence: 0.3,
      pattern: 'plain', fit: 'regular', tags: [],
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    }];
  }
}

export async function generateOutfitRecommendations(
  wardrobe: WardrobeItem[],
  occasion: string,
  weather: string,
  styleNotes?: string
): Promise<{ outfits: Array<{ items: string[]; note: string }> }> {
  const wardrobeSummary = wardrobe.map(i =>
    `ID:${i.id} - ${i.color} ${i.subcategory} (${i.category}), fit:${i.fit}, worn:${i.wearCount}x`
  ).join('\n');

  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are a personal stylist. Generate 3 outfit recommendations from this wardrobe.

Wardrobe:
${wardrobeSummary}

Occasion: ${occasion}
Weather: ${weather}
${styleNotes ? `Style notes: ${styleNotes}` : ''}

Return ONLY a JSON object:
{
  "outfits": [
    {
      "items": ["item_id1", "item_id2", "item_id3"],
      "note": "Short style tip for this outfit"
    }
  ]
}

Rules:
- Each outfit needs 2-4 items, including 1 top, 1 bottom (or dress), 1 footwear at minimum
- Match the occasion and weather
- Use item IDs from the wardrobe list above
- Keep notes concise (under 15 words)
Return only JSON, no explanation.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { outfits: [] };
  }
}

export async function chatWithAnera(
  userMessage: string,
  wardrobe: WardrobeItem[],
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const wardrobeSummary = wardrobe.length > 0
    ? wardrobe.map(i => `- ${i.color} ${i.subcategory} (${i.category}), ${i.fit} fit, worn ${i.wearCount}x`).join('\n')
    : 'No wardrobe items yet.';

  const messages: MessageParam[] = [
    ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: userMessage },
  ];

  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `You are Anera, a warm and stylish personal AI stylist. You help users style their wardrobe, plan outfits for occasions, and make purchase decisions.

The user's wardrobe contains:
${wardrobeSummary}

Be concise, friendly, and specific. Reference their actual wardrobe items when making suggestions. Use fashion terminology naturally but accessibly.`,
    messages,
  });

  return response.content[0].type === 'text' ? response.content[0].text : "I'm here to help — what would you like to style today?";
}

export interface PurchaseAnalysis {
  cost_per_wear: number;
  estimated_wears: number;
  plastic_percentage: number;
  plastic_impact: 'plastic-free' | 'low' | 'medium' | 'high';
  impact_colour: 'green' | 'yellow' | 'orange' | 'red';
  estimated_lifetime_years: number;
  future_value_if_invested: number;
  recommendation: 'no brainer' | 'why not' | 'maybe consider if you need it';
  reasoning: string;
}

export async function analyzePurchase(
  itemDescription: string,
  price: number,
  currency: string,
  wardrobe: WardrobeItem[],
  imageBase64?: string,
  estimatedWears?: number,
  fabricComposition?: string,
): Promise<PurchaseAnalysis> {
  const wardrobeSummary = wardrobe.length > 0
    ? wardrobe.map(i => `- ${i.color} ${i.subcategory} (${i.category})`).join('\n')
    : 'Empty wardrobe.';

  const content: MessageParam['content'] = [];

  if (imageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: imageBase64.split(',')[1] || imageBase64,
      },
    });
  }

  content.push({
    type: 'text',
    text: `You are an AI personal stylist and shopping decision assistant. Evaluate whether a user should purchase a clothing item based on financial value, plastic impact, and expected usage. Tone: supportive, aspirational, non-judgmental.

ITEM DETAILS:
- Description: ${itemDescription}
- Price: ${currency}${price}
${estimatedWears ? `- Estimated wears: ${estimatedWears}` : '- Estimated wears: not provided — infer from item type and price'}
${fabricComposition ? `- Fabric composition: ${fabricComposition}` : '- Fabric composition: not provided — infer from item type and price'}
${imageBase64 ? '- Product image: provided above' : ''}

USER WARDROBE (for compatibility context):
${wardrobeSummary}

INSTRUCTIONS:

1. COST PER WEAR
   cost_per_wear = price ÷ estimated_wears
   If wears not provided, infer: daily staples ~80–120/yr, smart-casual ~30–50, occasional ~10–20, special <10.

2. PLASTIC IMPACT
   Synthetic = plastic. ALL of these are synthetic fibres: polyester, nylon, polyamide, acrylic, elastane, spandex, microfibre, microfiber, lycra, lurex, modacrylic, polypropylene, polyurethane, aramid, olefin.
   IMPORTANT: Polyamide IS nylon — it is 100% synthetic/plastic.
   Natural fibres (NOT synthetic): cotton, linen, silk, wool, cashmere, hemp, jute, ramie, bamboo (viscose from bamboo is semi-synthetic).
   Semi-synthetic (count as ~30% synthetic): viscose, rayon, modal, lyocell, tencel, cupro, acetate.
   plastic_percentage: 0–100 (sum of all synthetic fibre percentages in the composition)
   plastic_impact: 0% → "plastic-free", 1–30% → "low", 31–70% → "medium", 71–100% → "high"
   impact_colour: "green" | "yellow" | "orange" | "red"
   If fabric unknown, infer from item type: jeans/denim ~2%, cotton shirts ~0-5%, activewear ~70-90%, knitwear ~20-60%.
   CRITICAL: If the user says "100% cotton" the plastic_percentage MUST be 0. Do NOT invent synthetic content.

3. OPPORTUNITY COST
   7% annual return assumption.
   Lifetime estimates by item type — PRICE IS A MAJOR FACTOR (higher price = quality = lasts longer):
   - Jeans/denim: 3–8 years (budget 3, mid 5–6, premium 7–8)
   - Coats/jackets/blazers: 3–10 years (budget 3, mid 5–7, premium 8–10)
   - Leather goods: 7–20+ years (quality leather is vintage — it only gets better with age)
   - Blouses/shirts: 2.5–6 years (budget 2.5, mid 3.5–4.5, premium 5–6)
   - Knitwear/sweaters: 2.5–7 years (budget 2.5, mid 4–5, premium 6–7)
   - Dresses: 2.5–7 years (budget 2.5, mid 3.5–5, premium 6–7)
   - Trousers/skirts: 3–5 years
   - T-shirts/basics: 1.5–4 years
   - Shoes/boots: 2–8 years (budget 2, mid 4–5, premium 6–8)
   - Sneakers: 2–4 years
   - Bags: 3–10+ years (budget 3, premium 8–10+)
   - Scarves/hats/belts: 3–6 years
   - Activewear: 1.5–3 years
   IMPORTANT: Price strongly correlates with quality and longevity. A £200 coat should have 7+ year lifetime, not 3.
   Never give less than 3 years for jeans, coats, or good-quality blouses.
   future_value_if_invested = price × (1.07 ^ estimated_lifetime_years), rounded to 2 dp.

4. RECOMMENDATION — use EXACTLY one of these strings:
   "no brainer" | "why not" | "maybe consider if you need it"
   Daily: good <£8/wear, mid £8–20, high >£20.
   Occasional: good <£25, mid £25–60, high >£60.
   Luxury: allow higher if durable + versatile.
   Boost for: low plastic, high wardrobe versatility.
   Reduce for: high plastic, <10 total wears.

5. REASONING — 2–3 warm sentences. Mention key factors + any assumptions. Include investment insight naturally.

Return ONLY valid JSON (no markdown, no extra text):
{
  "cost_per_wear": number,
  "estimated_wears": number,
  "plastic_percentage": number,
  "plastic_impact": "plastic-free" | "low" | "medium" | "high",
  "impact_colour": "green" | "yellow" | "orange" | "red",
  "estimated_lifetime_years": number,
  "future_value_if_invested": number,
  "recommendation": "no brainer" | "why not" | "maybe consider if you need it",
  "reasoning": "string"
}`,
  });

  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    const ew = estimatedWears ?? (price > 100 ? 40 : 20);
    const cpw = Math.round((price / ew) * 100) / 100;
    // Smarter lifetime: infer from item description — price is a major factor
    const desc = itemDescription.toLowerCase();
    let lifetime: number;
    if (/jeans|denim/.test(desc)) lifetime = price > 150 ? 8 : price > 80 ? 6 : price > 40 ? 4 : 3;
    else if (/coat|jacket|blazer|parka|trench/.test(desc)) lifetime = price > 300 ? 10 : price > 150 ? 7 : price > 70 ? 5 : 3;
    else if (/leather/.test(desc)) lifetime = price > 300 ? 20 : price > 150 ? 15 : price > 80 ? 10 : 7;
    else if (/blouse|shirt/.test(desc)) lifetime = price > 150 ? 6 : price > 80 ? 4.5 : price > 40 ? 3.5 : 2.5;
    else if (/sweater|cardigan|knit|jumper/.test(desc)) lifetime = price > 150 ? 7 : price > 80 ? 5 : price > 40 ? 3.5 : 2.5;
    else if (/dress/.test(desc)) lifetime = price > 200 ? 7 : price > 100 ? 5 : price > 50 ? 3.5 : 2.5;
    else if (/boot|shoe/.test(desc)) lifetime = price > 200 ? 8 : price > 100 ? 5 : price > 50 ? 3.5 : 2;
    else if (/sneaker|trainer/.test(desc)) lifetime = price > 150 ? 4 : price > 80 ? 3 : 2;
    else if (/bag|tote|purse|backpack/.test(desc)) lifetime = price > 200 ? 10 : price > 80 ? 6 : 3;
    else if (/t-shirt|tee|tank|vest/.test(desc)) lifetime = price > 60 ? 4 : price > 30 ? 2.5 : 1.5;
    else lifetime = price > 200 ? 7 : price > 100 ? 5 : price > 50 ? 3.5 : 2.5;
    const fv = Math.round(price * Math.pow(1.07, lifetime) * 100) / 100;
    // Smarter plastic %: check fabric if provided
    let plastic = 20;
    if (fabricComposition) {
      const fl = fabricComposition.toLowerCase();
      const synthetics = ['polyester','nylon','polyamide','acrylic','elastane','spandex','microfibre','lycra','lurex','modacrylic'];
      let synPct = 0;
      for (const fib of synthetics) {
        const m = fl.match(new RegExp(`(\\d+)\\s*%\\s*${fib}`));
        if (m) synPct += parseInt(m[1]);
      }
      plastic = synPct > 0 ? synPct : (synthetics.some(s => fl.includes(s)) ? 50 : 0);
    }
    const plasticImpact: PurchaseAnalysis['plastic_impact'] =
      plastic <= 0 ? 'plastic-free' : plastic <= 30 ? 'low' : plastic <= 70 ? 'medium' : 'high';
    const impactColour: PurchaseAnalysis['impact_colour'] =
      plastic <= 0 ? 'green' : plastic <= 30 ? 'yellow' : plastic <= 70 ? 'orange' : 'red';
    return {
      cost_per_wear: cpw,
      estimated_wears: ew,
      plastic_percentage: plastic,
      plastic_impact: plasticImpact,
      impact_colour: impactColour,
      estimated_lifetime_years: lifetime,
      future_value_if_invested: fv,
      recommendation: cpw < 8 ? 'no brainer' : cpw < 25 ? 'why not' : 'maybe consider if you need it',
      reasoning: `At ${currency}${cpw.toFixed(2)} per wear over ~${ew} wears, this piece ${cpw < 8 ? 'is a solid investment for your wardrobe' : cpw < 25 ? 'could be a great addition if you love the style' : 'is worth weighing up carefully before buying'}. Fabric estimated ~${plastic}% synthetic. If invested instead, ${currency}${price} could grow to approximately ${currency}${fv} over ${lifetime} years.`,
    };
  }
}

// ── Auto-detect fabric from an uploaded image ────────────────────────────────
export interface FabricDetection {
  fabric: string;      // e.g. "80% cotton, 20% polyester"
  itemName: string;    // e.g. "white linen shirt"
  source: 'label' | 'inferred'; // whether a visible care label was read
  price?: number;      // detected price from product page
  currency?: string;   // detected currency (£, $, €, etc.)
}

export async function detectFabricFromImage(base64Image: string): Promise<FabricDetection> {
  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: base64Image.split(',')[1] || base64Image,
          },
        },
        {
          type: 'text',
          text: `Analyse this clothing item image.

Task 1 — if a care label or fabric composition tag is visible, extract the EXACT fabric % from it.
Task 2 — if no label is visible, infer the most likely fabric composition from the item's visual appearance (sheen, texture, drape, weave, thickness).
Task 3 — identify the item type and colour.

Return ONLY JSON (no markdown):
{
  "fabric": "e.g. 100% cotton  or  78% viscose, 22% polyester",
  "itemName": "e.g. white linen shirt",
  "source": "label" | "inferred"
}`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { fabric: '', itemName: '', source: 'inferred' };
  }
}

// ── Auto-detect fabric from a product URL ────────────────────────────────────
export async function detectFabricFromUrl(url: string): Promise<FabricDetection> {
  // Step 1: Try to scrape the actual page content (via server-side proxy)
  let pageText = '';
  let structuredData = '';
  try {
    const scraped = await scrapeUrl(url);
    pageText = scraped.text || '';
    structuredData = scraped.structuredData || '';
  } catch { /* scraping failed — will infer from URL alone */ }

  const hasPageContent = pageText.length > 50;

  const prompt = hasPageContent
    ? `Analyze this product page content and extract the fabric composition, item name, and price.

URL: ${url}

${structuredData ? `STRUCTURED DATA (JSON-LD):\n${structuredData}\n\n` : ''}PAGE CONTENT:
${pageText}

INSTRUCTIONS:
- Extract the EXACT fabric/material composition if listed on the page (e.g. "98% cotton, 2% elastane")
- Extract the exact product name
- Extract the exact price and currency as shown on the page
- Recognise ALL synthetic fibres: polyester, nylon, polyamide, acrylic, elastane, spandex, microfibre, lycra, lurex, modacrylic
- Polyamide IS nylon — it is 100% synthetic
- If fabric not on page, infer from item type and brand
- Look for terms like "composition", "material", "fabric", "made of", "content" on the page

Return ONLY JSON (no markdown):
{
  "fabric": "exact composition e.g. 78% viscose, 22% polyester",
  "itemName": "product name from page",
  "source": "label",
  "price": 0,
  "currency": "£"
}

Use source "label" if you found the actual composition on the page, "inferred" if you had to guess.
For price: use the actual price from the page. Use 0 only if completely missing.`
    : `Based on this product URL, infer the most likely fabric composition, item type, and price.

URL: ${url}

Consider:
- Brand name (Zara → often synthetic blends; COS/Arket → natural fibres; Uniqlo → quality basics; Shein → high synthetic)
- Keywords in the URL slug (linen, cotton, silk, wool, cashmere, polyester, polyamide, nylon, knit, denim, jersey, satin, velvet)
- Price signals if present in URL
- Common price ranges for the brand and item type
- Recognise ALL synthetic fibres: polyester, nylon, polyamide, acrylic, elastane, spandex, microfibre, lycra, lurex, modacrylic

Return ONLY JSON (no markdown):
{
  "fabric": "e.g. 78% viscose, 22% polyester",
  "itemName": "inferred item name",
  "source": "inferred",
  "price": 0,
  "currency": "£"
}

For price: infer from the URL or brand's typical pricing. Use 0 if completely unknown.
For currency: use the currency most likely for the brand/region (£, $, €, ¥).`;

  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const urlText = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = urlText.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { fabric: '', itemName: '', source: 'inferred' };
  }
}

// ── Detect wardrobe item from a product URL ──────────────────────────────────

export interface UrlItemDetection {
  category: WardrobeItem['category'];
  categoryConfidence: number;
  subcategory: string;
  subcategoryConfidence: number;
  color: string;
  colorConfidence: number;
  brand: string;
  brandConfidence: number;
  pattern: string;
  fit: string;
  tags: string[];
  imageUrl: string;
  price: number;
  currency: string;
}

export async function detectItemFromUrl(url: string): Promise<UrlItemDetection> {
  // Step 1: Scrape the page
  let pageText = '';
  let structuredData = '';
  try {
    const scraped = await scrapeUrl(url);
    pageText = scraped.text || '';
    structuredData = scraped.structuredData || '';
  } catch { /* will infer from URL alone */ }

  const hasPage = pageText.length > 50;

  const contextBlock = hasPage
    ? `${structuredData ? `STRUCTURED DATA (JSON-LD):\n${structuredData}\n\n` : ''}PAGE CONTENT:\n${pageText}`
    : '(Page content unavailable — infer from URL and brand)';

  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Analyze this product URL and extract all clothing item details for a wardrobe app.

URL: ${url}

${contextBlock}

Extract or infer ALL of the following. If the page content is available, use EXACT values from the page.
If not available, infer from the URL, brand, and item type.

Return ONLY JSON (no markdown):
{
  "category": "top"|"bottom"|"footwear"|"outerwear"|"jewellery"|"bag"|"dress",
  "categoryConfidence": 0.0-1.0,
  "subcategory": "specific type e.g. blazer, straight-leg jeans, sneakers, midi dress",
  "subcategoryConfidence": 0.0-1.0,
  "color": "primary color as one or two words",
  "colorConfidence": 0.0-1.0,
  "brand": "brand name",
  "brandConfidence": 0.0-1.0,
  "pattern": "plain"|"striped"|"checked"|"floral"|"printed"|"other",
  "fit": "slim"|"regular"|"oversized"|"fitted"|"relaxed",
  "tags": ["tag1","tag2","tag3"],
  "imageUrl": "main product image URL if found on page, otherwise empty string",
  "price": 0,
  "currency": "£"
}

For imageUrl: look for og:image meta tag content, or product image URLs in the page.
For confidence: use 0.9+ if extracted from page, 0.6-0.8 if inferred from URL/brand.`,
    }],
  });

  const detText = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = detText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;
    return {
      category: VALID_CATS.has(String(parsed.category)) ? String(parsed.category) as WardrobeItem['category'] : 'top',
      categoryConfidence: Math.min(1, Math.max(0, Number(parsed.categoryConfidence) || 0.7)),
      subcategory: String(parsed.subcategory || 'item'),
      subcategoryConfidence: Math.min(1, Math.max(0, Number(parsed.subcategoryConfidence) || 0.7)),
      color: String(parsed.color || 'unknown'),
      colorConfidence: Math.min(1, Math.max(0, Number(parsed.colorConfidence) || 0.7)),
      brand: String(parsed.brand || ''),
      brandConfidence: Math.min(1, Math.max(0, Number(parsed.brandConfidence) || 0.5)),
      pattern: String(parsed.pattern || 'plain'),
      fit: String(parsed.fit || 'regular'),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      imageUrl: String(parsed.imageUrl || ''),
      price: Number(parsed.price) || 0,
      currency: String(parsed.currency || '£'),
    };
  } catch {
    return {
      category: 'top', categoryConfidence: 0.5,
      subcategory: 'item', subcategoryConfidence: 0.5,
      color: 'unknown', colorConfidence: 0.5,
      brand: '', brandConfidence: 0.3,
      pattern: 'plain', fit: 'regular', tags: [],
      imageUrl: '', price: 0, currency: '£',
    };
  }
}
