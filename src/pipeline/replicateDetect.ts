/**
 * Grounding DINO object detection via Replicate API.
 * Detects clothing items in an image and returns bounding boxes.
 */

export interface GroundingDINOBox {
  bbox: [number, number, number, number]; // x1, y1, x2, y2 in pixels
  label: string;
  confidence: number;
}

const REPLICATE_MODEL_VERSION =
  'efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa';

const TEXT_PROMPT =
  'clothing . shirt . pants . shoes . jacket . dress . bag . hat . accessory . skirt . coat . sweater . jeans . boots . sneakers . blazer . cardigan . hoodie . shorts . sandals . heels . flats . necklace . bracelet . ring . earring . scarf . belt';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 40; // 60 seconds max

function getReplicateKey(): string {
  const key = import.meta.env.VITE_REPLICATE_API_KEY;
  if (!key) throw new Error('VITE_REPLICATE_API_KEY not set');
  return key;
}

/**
 * Create a prediction on Replicate and poll until it completes.
 */
export async function detectWithGroundingDINO(
  base64Image: string,
): Promise<GroundingDINOBox[]> {
  const apiKey = getReplicateKey();

  // Ensure we have a proper data URI
  const dataUri = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  // Step 1: Create prediction
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input: {
        image: dataUri,
        text_prompt: TEXT_PROMPT,
        box_threshold: 0.25,
        text_threshold: 0.2,
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Replicate create prediction failed (${createRes.status}): ${errText}`);
  }

  const prediction = await createRes.json();
  const pollUrl: string = prediction.urls?.get;
  if (!pollUrl) throw new Error('Replicate response missing poll URL');

  // Step 2: Poll for completion
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      throw new Error(`Replicate poll failed (${pollRes.status})`);
    }

    const result = await pollRes.json();

    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`Replicate prediction ${result.status}: ${result.error || 'unknown error'}`);
    }

    if (result.status === 'succeeded') {
      return parseGroundingDINOOutput(result.output);
    }
  }

  throw new Error('Replicate prediction timed out');
}

/**
 * Parse Grounding DINO output — handle multiple possible formats.
 */
function parseGroundingDINOOutput(output: unknown): GroundingDINOBox[] {
  if (!output) return [];

  // Format A: { detections: [[x1,y1,x2,y2], ...], labels: [...], scores: [...] }
  if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;

    // Check for detections/labels/scores format
    if (obj.detections && Array.isArray(obj.detections)) {
      const detections = obj.detections as number[][];
      const labels = (obj.labels as string[]) || [];
      const scores = (obj.scores as number[]) || [];
      return detections.map((bbox, i) => ({
        bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] as [number, number, number, number],
        label: labels[i] || 'clothing',
        confidence: scores[i] ?? 0.5,
      }));
    }

    // Check for results array
    if (obj.results && Array.isArray(obj.results)) {
      return (obj.results as Record<string, unknown>[]).map(r => ({
        bbox: (r.box || r.bbox || [0, 0, 100, 100]) as [number, number, number, number],
        label: String(r.label || r.class || 'clothing'),
        confidence: Number(r.score || r.confidence || 0.5),
      }));
    }
  }

  // Format B: output is a string (URL to JSON or the annotated image)
  // In this case we can't parse detections — return empty
  if (typeof output === 'string') {
    console.warn('Grounding DINO returned string output (likely annotated image URL). Cannot parse detections.');
    return [];
  }

  // Format C: direct array of detection objects
  if (Array.isArray(output)) {
    // Could be array of objects with bbox/label/score
    if (output.length > 0 && typeof output[0] === 'object') {
      return (output as Record<string, unknown>[]).map(r => ({
        bbox: (r.box || r.bbox || [0, 0, 100, 100]) as [number, number, number, number],
        label: String(r.label || r.class || 'clothing'),
        confidence: Number(r.score || r.confidence || 0.5),
      }));
    }
  }

  console.warn('Unrecognized Grounding DINO output format:', output);
  return [];
}
