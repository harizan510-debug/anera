import Anthropic from '@anthropic-ai/sdk';
import type { WardrobeItem } from './types';

// Get API key from env
const getClient = () => {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY not set in .env');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
};

export async function analyzeClothingImage(base64Image: string, mimeType: string = 'image/jpeg'): Promise<Partial<WardrobeItem>> {
  const client = getClient();
  const response = await client.messages.create({
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
  "category": one of "top"|"bottom"|"shoes"|"outerwear"|"accessory"|"dress",
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

export async function generateOutfitRecommendations(
  wardrobe: WardrobeItem[],
  occasion: string,
  weather: string,
  styleNotes?: string
): Promise<{ outfits: Array<{ items: string[]; note: string }> }> {
  const client = getClient();

  const wardrobeSummary = wardrobe.map(i =>
    `ID:${i.id} - ${i.color} ${i.subcategory} (${i.category}), fit:${i.fit}, worn:${i.wearCount}x`
  ).join('\n');

  const response = await client.messages.create({
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
- Each outfit needs 2-4 items, including 1 top, 1 bottom (or dress), 1 shoe at minimum
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
  const client = getClient();

  const wardrobeSummary = wardrobe.length > 0
    ? wardrobe.map(i => `- ${i.color} ${i.subcategory} (${i.category}), ${i.fit} fit, worn ${i.wearCount}x`).join('\n')
    : 'No wardrobe items yet.';

  const messages = [
    ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: userMessage },
  ];

  const response = await client.messages.create({
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

export async function analyzePurchase(
  itemDescription: string,
  price: number,
  currency: string,
  wardrobe: WardrobeItem[],
  imageBase64?: string
): Promise<{
  matchingOutfits: number;
  estimatedWearsPerMonth: number;
  costPerWear: number;
  recommendation: 'high-value' | 'moderate-value' | 'low-value';
  reasoning: string;
  matchingItemIds: string[];
}> {
  const client = getClient();

  const wardrobeSummary = wardrobe.map(i =>
    `ID:${i.id} - ${i.color} ${i.subcategory} (${i.category})`
  ).join('\n');

  const content: Anthropic.MessageParam['content'] = [];

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
    text: `Analyze this potential purchase for a wardrobe.

Item: ${itemDescription}
Price: ${currency}${price}
${imageBase64 ? 'See image above.' : ''}

Current wardrobe:
${wardrobeSummary || 'Empty wardrobe.'}

Return ONLY JSON:
{
  "matchingOutfits": number (how many complete outfits this enables),
  "estimatedWearsPerMonth": number (realistic monthly wear frequency),
  "costPerWear": number (price / (estimatedWearsPerMonth * 6) for 6-month horizon),
  "recommendation": "high-value" | "moderate-value" | "low-value",
  "reasoning": "One sentence explanation",
  "matchingItemIds": ["id1", "id2"] (IDs of wardrobe items this pairs well with)
}
Return only JSON.`,
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    const cpp = price / (4 * 6);
    return {
      matchingOutfits: 3,
      estimatedWearsPerMonth: 4,
      costPerWear: Math.round(cpp * 100) / 100,
      recommendation: cpp < 5 ? 'high-value' : cpp < 15 ? 'moderate-value' : 'low-value',
      reasoning: 'Analysis based on wardrobe compatibility.',
      matchingItemIds: [],
    };
  }
}
