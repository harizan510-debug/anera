/**
 * Generate product images for wardrobe basics using Replicate Flux-schnell.
 * Usage: node scripts/generate-basics.mjs
 *
 * Images are saved to public/basics/ as WebP files.
 * Cost: ~$0.003/image × 31 = ~$0.09 total
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'basics');
const API_KEY = process.env.REPLICATE_API_KEY;
if (!API_KEY) { console.error('Set REPLICATE_API_KEY env var'); process.exit(1); }

// Each item: [filename, prompt]
const ITEMS = [
  // Tops
  ['white-classic-tee',       'A plain white crew neck t-shirt, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, clean minimal style'],
  ['white-sweater',           'A white knit pullover sweater, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, soft cosy texture'],
  ['black-turtleneck',        'A black turtleneck sweater, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, sleek fitted style'],
  ['grey-crewneck',           'A heather grey crewneck sweatshirt, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin'],
  ['navy-striped-tee',        'A navy blue and white horizontal striped t-shirt, Breton style, flat lay product photography on pure white background, studio lighting, isolated garment, no person'],
  ['white-button-down',       'A crisp white button-down dress shirt with collar, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin'],
  ['beige-linen-shirt',       'A beige linen button-up shirt, relaxed fit, flat lay product photography on pure white background, studio lighting, isolated garment, no person, natural texture'],

  // Bottoms
  ['lightblue-wideleg-jeans', 'Light blue wide-leg denim jeans, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin'],
  ['black-skinny-jeans',      'Black skinny jeans, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, slim fit'],
  ['darkblue-straight-jeans', 'Dark indigo blue straight-leg jeans, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin'],
  ['black-tailored-trousers', 'Black tailored dress trousers, slim fit, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, formal style'],
  ['beige-chinos',            'Beige khaki chino trousers, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, smart casual'],
  ['black-midi-skirt',        'A black midi pencil skirt, knee length, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, elegant'],

  // Footwear
  ['white-sneakers',          'A pair of clean white minimalist leather sneakers, product photography on pure white background, studio lighting, isolated shoes, no person, side angle view'],
  ['black-ankle-boots',       'A pair of black leather ankle boots, low heel, product photography on pure white background, studio lighting, isolated shoes, no person, side angle view'],
  ['tan-loafers',             'A pair of tan brown leather loafers, product photography on pure white background, studio lighting, isolated shoes, no person, classic style, side angle'],
  ['nude-heels',              'A pair of nude beige pointed-toe stiletto heels, product photography on pure white background, studio lighting, isolated shoes, no person, elegant'],
  ['black-ballet-flats',      'A pair of black leather ballet flats, product photography on pure white background, studio lighting, isolated shoes, no person, minimal classic style'],

  // Outerwear
  ['black-leather-jacket',    'A black leather biker jacket, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, edgy style'],
  ['camel-trench-coat',       'A camel tan trench coat with belt, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, classic double-breasted'],
  ['navy-blazer',             'A navy blue single-breasted blazer, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, tailored smart'],
  ['grey-wool-coat',          'A grey wool overcoat, long, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, winter classic'],

  // Dresses
  ['black-midi-dress',        'A black midi dress, fitted bodice with A-line skirt, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, elegant'],
  ['white-shirt-dress',       'A white cotton shirt dress with collar and buttons, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, casual chic'],
  ['beige-slip-dress',        'A beige satin slip dress with thin straps, midi length, flat lay product photography on pure white background, studio lighting, isolated garment, no person, no mannequin, minimal'],

  // Bags
  ['black-tote-bag',          'A black leather tote bag, product photography on pure white background, studio lighting, isolated accessory, no person, structured shape, front view'],
  ['tan-leather-tote',        'A tan brown leather tote bag, product photography on pure white background, studio lighting, isolated accessory, no person, classic structured, front view'],
  ['black-crossbody-bag',     'A small black leather crossbody bag with gold chain strap, product photography on pure white background, studio lighting, isolated accessory, no person'],

  // Jewellery
  ['gold-hoop-earrings',      'A pair of medium gold hoop earrings, product photography on pure white background, studio lighting, isolated jewellery, no person, close-up, shiny metallic'],
  ['silver-chain-necklace',   'A delicate silver chain necklace, product photography on pure white background, studio lighting, isolated jewellery, no person, minimal elegant'],
  ['gold-stud-earrings',      'A pair of small round gold stud earrings, product photography on pure white background, studio lighting, isolated jewellery, no person, close-up, minimal'],
];

const RETRY_DELAYS = [2000, 5000, 10000];

async function replicateRequest(body) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',  // Sync mode — waits for result
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return await res.json();

    if (res.status === 429 && attempt < 3) {
      const delay = RETRY_DELAYS[attempt] || 10000;
      console.warn(`  ⏳ Rate limited, retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    const err = await res.text();
    throw new Error(`Replicate API error ${res.status}: ${err}`);
  }
  throw new Error('Failed after retries');
}

async function pollPrediction(id) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Prediction ${data.status}: ${data.error || 'unknown'}`);
    }
  }
  throw new Error('Prediction timed out');
}

async function downloadImage(url, filepath) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buf);
  return buf.length;
}

async function generateImage(name, prompt) {
  const outPath = path.join(OUT_DIR, `${name}.webp`);

  // Skip if already generated
  if (fs.existsSync(outPath)) {
    console.log(`  ✅ ${name}.webp already exists, skipping`);
    return;
  }

  console.log(`  🎨 Generating: ${name}`);

  // Use flux-schnell (fast + cheap) via official model endpoint
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({
      input: {
        prompt: prompt,
        num_outputs: 1,
        aspect_ratio: '3:4',
        output_format: 'webp',
        output_quality: 90,
        go_fast: true,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate ${res.status}: ${err}`);
  }
  const prediction = await res.json();

  // If sync mode returned the result directly
  let result = prediction;
  if (prediction.status !== 'succeeded') {
    console.log(`    Polling prediction ${prediction.id}...`);
    result = await pollPrediction(prediction.id);
  }

  const imageUrl = result.output?.[0] || result.output;
  if (!imageUrl) throw new Error(`No output for ${name}`);

  const size = await downloadImage(imageUrl, outPath);
  console.log(`  ✅ ${name}.webp (${(size / 1024).toFixed(1)}KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`\n🚀 Generating ${ITEMS.length} product images via Replicate Flux-schnell\n`);
  console.log(`   Output: ${OUT_DIR}\n`);

  let success = 0, failed = 0;

  for (const [name, prompt] of ITEMS) {
    try {
      await generateImage(name, prompt);
      success++;
      // Wait 12s between requests (rate limit: 6/min with burst 1)
      await new Promise(r => setTimeout(r, 12000));
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
      // Wait 15s after error
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`\n📊 Done: ${success} generated, ${failed} failed\n`);

  if (failed > 0) {
    console.log('💡 Re-run the script to retry failed images (existing ones are skipped)\n');
  }
}

main().catch(console.error);
