/**
 * Remove white backgrounds from all basics images using Replicate rembg.
 * Converts .webp → .png with transparent backgrounds.
 */
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.REPLICATE_API_KEY;
if (!API_KEY) { console.error('Set REPLICATE_API_KEY'); process.exit(1); }

const BASICS_DIR = path.resolve('public/basics');
const REMBG_VERSION = 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';
const RETRY_DELAYS = [2000, 5000, 10000];

async function apiRequest(url, body) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      const delay = RETRY_DELAYS[attempt] || 10000;
      console.warn(`  ⏳ Rate limited, waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
}

async function pollPrediction(getUrl) {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(getUrl, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    if (data.status === 'succeeded') return data.output;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Prediction ${data.status}: ${data.error || 'unknown'}`);
    }
  }
  throw new Error('Polling timed out');
}

async function removeBackground(inputPath, outputPath) {
  // Read file and convert to base64 data URI
  const buf = fs.readFileSync(inputPath);
  const ext = path.extname(inputPath).slice(1);
  const mime = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
  const dataUri = `data:${mime};base64,${buf.toString('base64')}`;

  // Create prediction
  const prediction = await apiRequest('https://api.replicate.com/v1/predictions', {
    version: REMBG_VERSION,
    input: { image: dataUri },
  });

  const pollUrl = prediction.urls?.get;
  if (!pollUrl) throw new Error('No poll URL');

  // Poll for result
  const output = await pollPrediction(pollUrl);
  const outputUrl = typeof output === 'string' ? output : Array.isArray(output) ? output[0] : null;
  if (!outputUrl) throw new Error('No output URL');

  // Download result PNG
  const imgRes = await fetch(outputUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch: ${imgRes.status}`);
  const arrayBuf = await imgRes.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuf));

  return Buffer.from(arrayBuf).length;
}

// Main
const files = fs.readdirSync(BASICS_DIR).filter(f => f.endsWith('.webp'));
console.log(`🎨 Removing backgrounds from ${files.length} basics images\n`);

let done = 0, failed = 0;
for (const file of files) {
  const inputPath = path.join(BASICS_DIR, file);
  const outputPath = path.join(BASICS_DIR, file.replace('.webp', '.png'));

  // Skip if PNG already exists and is non-empty
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
    console.log(`  ✅ ${file.replace('.webp', '.png')} already exists, skipping`);
    done++;
    continue;
  }

  try {
    process.stdout.write(`  🔄 ${file} → .png ...`);
    const size = await removeBackground(inputPath, outputPath);
    console.log(` ✅ (${(size / 1024).toFixed(1)}KB)`);
    done++;
  } catch (err) {
    console.log(` ❌ ${err.message}`);
    failed++;
  }
}

console.log(`\n📊 Done: ${done} processed, ${failed} failed`);
