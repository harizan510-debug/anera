/**
 * Dual-mode API helpers: try server-side /api/ routes first (Vercel),
 * fall back to direct client-side SDK calls (local dev with VITE_ keys).
 */
import Anthropic from '@anthropic-ai/sdk';

// ── Claude Messages ──────────────────────────────────────────────────────────

interface ClaudeParams {
  model: string;
  max_tokens: number;
  messages: Anthropic.MessageParam[];
  system?: string;
}

/**
 * Send a Claude message. Tries the server-side proxy first (/api/claude),
 * falls back to the Anthropic SDK using VITE_ANTHROPIC_API_KEY for local dev.
 */
export async function claudeMessage(params: ClaudeParams): Promise<Anthropic.Message> {
  // Try server-side proxy first (Vercel deployment)
  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) return await res.json();
    // If 404, server route doesn't exist (local dev) — fall through to SDK
    if (res.status !== 404) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      // Anthropic API returns { error: { type, message } }
      const nested = err.error as Record<string, string> | undefined;
      const msg = (typeof nested === 'object' && nested?.message) || (typeof err.error === 'string' && err.error) || `Server API error ${res.status}`;
      throw new Error(String(msg));
    }
  } catch (e) {
    // Only fall through to client SDK for network errors / 404
    if (e instanceof Error && e.message !== 'Failed to fetch') {
      throw e;
    }
  }

  // Fallback: direct client-side SDK call (local dev with VITE_ keys)
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key available (server route unavailable, VITE_ANTHROPIC_API_KEY not set)');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return client.messages.create(params);
}

/**
 * Check whether an API key is available (either server-side or client-side).
 * Use this instead of `!!import.meta.env.VITE_ANTHROPIC_API_KEY` for feature flags.
 */
export function hasClaudeKey(): boolean {
  // On Vercel, VITE_ keys won't be set but server routes exist.
  // We return true optimistically — the actual call will fail gracefully if no key.
  // For local dev, check the VITE_ key.
  return !!import.meta.env.VITE_ANTHROPIC_API_KEY || !!import.meta.env.PROD;
}

// ── Replicate ────────────────────────────────────────────────────────────────

interface ReplicateCreateParams {
  version: string;
  input: Record<string, unknown>;
}

/**
 * Create a Replicate prediction. Tries /api/replicate first, falls back to direct API.
 */
export async function replicateCreate(params: ReplicateCreateParams): Promise<Record<string, unknown>> {
  return replicateRequest({ action: 'create', ...params });
}

/**
 * Poll a Replicate prediction via server proxy.
 */
export async function replicatePoll(url: string): Promise<Record<string, unknown>> {
  return replicateRequest({ action: 'poll', url });
}

/**
 * Send a request to the Replicate server proxy with automatic retry on 429 (rate limit).
 */
async function replicateRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 5000, 10000]; // exponential backoff

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('/api/replicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) return await res.json();

    // Rate limited — wait and retry
    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 10000;
        console.warn(`[Replicate] Rate limited (429), retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error('Replicate rate limited (429) — too many requests, try again in a minute');
    }

    // Parse error details
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    const detail = (err.detail as string) || (err.error as string) || `Replicate API error ${res.status}`;

    if (res.status === 402) {
      throw new Error('Replicate credits exhausted — add credits at replicate.com/account/billing');
    }

    throw new Error(detail);
  }

  throw new Error('Replicate request failed after retries');
}

/**
 * Check whether Replicate is available.
 * In production (Vercel), the server proxy handles the key.
 * In dev, we assume the server proxy is available if running via `vercel dev`.
 */
export function hasReplicateKey(): boolean {
  return !!import.meta.env.PROD || !!import.meta.env.VITE_REPLICATE_ENABLED;
}

// ── URL Scraper ─────────────────────────────────────────────────────────────

export interface ScrapeResult {
  text: string;
  structuredData?: string;
  imageUrl?: string;
  error?: string;
}

/**
 * Scrape a product URL for text content. Tries the server-side /api/scrape proxy.
 * Returns empty text if unavailable (e.g. local dev without server routes).
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (res.ok) return await res.json();
  } catch { /* fall through */ }
  return { text: '' };
}
