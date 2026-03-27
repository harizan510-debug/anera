import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import { claudeMessage } from './apiHelper';
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
   Synthetic = plastic: polyester, nylon, acrylic, elastane, spandex, polyamide, microfibre.
   plastic_percentage: 0–100
   plastic_impact: 0% → "plastic-free", 1–30% → "low", 31–70% → "medium", 71–100% → "high"
   impact_colour: "green" | "yellow" | "orange" | "red"
   If fabric unknown, infer from item type (activewear ~70%, denim ~2%, knitwear ~20–80%).

3. OPPORTUNITY COST
   7% annual return assumption.
   Lifetime: high quality 3–5 yrs, medium 2–3, low 1–2. Infer from price + materials.
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
    const lifetime = price > 150 ? 4 : price > 60 ? 2.5 : 1.5;
    const fv = Math.round(price * Math.pow(1.07, lifetime) * 100) / 100;
    return {
      cost_per_wear: cpw,
      estimated_wears: ew,
      plastic_percentage: 25,
      plastic_impact: 'low',
      impact_colour: 'yellow',
      estimated_lifetime_years: lifetime,
      future_value_if_invested: fv,
      recommendation: cpw < 8 ? 'no brainer' : cpw < 25 ? 'why not' : 'maybe consider if you need it',
      reasoning: `At ${currency}${cpw.toFixed(2)} per wear over ~${ew} wears, this piece ${cpw < 8 ? 'is a solid investment for your wardrobe' : cpw < 25 ? 'could be a great addition if you love the style' : 'is worth weighing up carefully before buying'}. Fabric assumed ~25% synthetic. If invested instead, ${currency}${price} could grow to approximately ${currency}${fv} over ${lifetime} years.`,
    };
  }
}

// ── Auto-detect fabric from an uploaded image ────────────────────────────────
export interface FabricDetection {
  fabric: string;      // e.g. "80% cotton, 20% polyester"
  itemName: string;    // e.g. "white linen shirt"
  source: 'label' | 'inferred'; // whether a visible care label was read
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
  const response = await claudeMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Based on this product URL, infer the most likely fabric composition and item type.

URL: ${url}

Consider:
- Brand name (Zara → often synthetic blends; COS/Arket → natural fibres; Uniqlo → quality basics; Shein → high synthetic)
- Keywords in the URL slug (linen, cotton, silk, wool, cashmere, polyester, knit, denim, jersey, satin, velvet)
- Price signals if present in URL

Return ONLY JSON (no markdown):
{
  "fabric": "e.g. 78% viscose, 22% polyester",
  "itemName": "inferred item name",
  "source": "inferred"
}`,
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
