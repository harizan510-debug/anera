/**
 * Classify a single cropped clothing item using Claude Vision.
 * Much more accurate than classifying all items in a full photo at once.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { WardrobeItem } from '../types';

export interface ClassificationResult {
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
}

const VALID_CATS = new Set(['top', 'bottom', 'footwear', 'outerwear', 'jewellery', 'bag', 'dress']);

function safeCategory(v: string): WardrobeItem['category'] {
  return VALID_CATS.has(v) ? (v as WardrobeItem['category']) : 'top';
}

function getClient() {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY not set in .env');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/**
 * Classify a single cropped clothing item image.
 * @param croppedBase64 - base64 data URI or raw base64 of the cropped image
 * @param hint - optional label from Grounding DINO (e.g. "jacket") to help classification
 */
export async function classifyClothingItem(
  croppedBase64: string,
  hint?: string,
): Promise<ClassificationResult> {
  const client = getClient();

  const imageData = croppedBase64.includes(',')
    ? croppedBase64.split(',')[1]
    : croppedBase64;

  const hintText = hint ? `\nHint from object detector: this item was detected as "${hint}". Use this as a starting point but override if clearly wrong.` : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageData,
            },
          },
          {
            type: 'text',
            text: `Analyze this single clothing item image. Return ONLY a JSON object.${hintText}

{
  "category": one of "top"|"bottom"|"footwear"|"outerwear"|"jewellery"|"bag"|"dress",
  "categoryConfidence": 0.0-1.0,
  "subcategory": "specific type e.g. blazer, straight-leg jeans, sneakers, midi dress",
  "subcategoryConfidence": 0.0-1.0,
  "color": "primary color as one or two words",
  "colorConfidence": 0.0-1.0,
  "brand": "brand name if logo/label visible, otherwise empty string",
  "brandConfidence": 0.0-1.0,
  "pattern": "plain"|"striped"|"checked"|"floral"|"printed"|"other",
  "fit": "slim"|"regular"|"oversized"|"fitted"|"relaxed",
  "tags": ["tag1","tag2","tag3"] — 2-4 style descriptors like "casual","minimal","classic","sporty"
}

Confidence guidelines:
- 0.95+ = absolutely certain
- 0.85-0.94 = very confident
- 0.70-0.84 = fairly sure
- 0.50-0.69 = uncertain, might be wrong
- <0.50 = guessing

For brand, only give confidence > 0.7 if you can clearly see a logo or label.
Return only the JSON, no explanation.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;
    return {
      category: safeCategory(String(parsed.category ?? 'top')),
      categoryConfidence: clamp(Number(parsed.categoryConfidence) || 0.7),
      subcategory: String(parsed.subcategory || hint || 'item'),
      subcategoryConfidence: clamp(Number(parsed.subcategoryConfidence) || 0.7),
      color: String(parsed.color || 'unknown'),
      colorConfidence: clamp(Number(parsed.colorConfidence) || 0.7),
      brand: String(parsed.brand || ''),
      brandConfidence: clamp(Number(parsed.brandConfidence) || 0.4),
      pattern: String(parsed.pattern || 'plain'),
      fit: String(parsed.fit || 'regular'),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    };
  } catch {
    // Fallback if Claude returns non-JSON
    return {
      category: hint ? inferCategoryFromHint(hint) : 'top',
      categoryConfidence: 0.5,
      subcategory: hint || 'item',
      subcategoryConfidence: 0.5,
      color: 'unknown',
      colorConfidence: 0.5,
      brand: '',
      brandConfidence: 0.3,
      pattern: 'plain',
      fit: 'regular',
      tags: [],
    };
  }
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Best-effort category inference from a DINO label */
function inferCategoryFromHint(hint: string): WardrobeItem['category'] {
  const h = hint.toLowerCase();
  if (/shoe|sneaker|boot|heel|flat|sandal|loafer/i.test(h)) return 'footwear';
  if (/pants|jeans|trouser|short|skirt/i.test(h)) return 'bottom';
  if (/jacket|coat|blazer|cardigan|hoodie|sweater/i.test(h)) return 'outerwear';
  if (/dress/i.test(h)) return 'dress';
  if (/bag|tote|purse|backpack/i.test(h)) return 'bag';
  if (/necklace|bracelet|ring|earring|jewel/i.test(h)) return 'jewellery';
  return 'top';
}
