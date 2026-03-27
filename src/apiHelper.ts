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
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, string>).error || `Server API error ${res.status}`);
    }
  } catch (e) {
    // Network error or explicit throw — only fall through for 404/network issues
    if (e instanceof Error && !e.message.includes('Server API error')) {
      // Network error or 404 — fall through to client SDK
    } else {
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
  // Try server-side proxy
  try {
    const res = await fetch('/api/replicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', ...params }),
    });
    if (res.ok) return await res.json();
    if (res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, string>).error || `Server API error ${res.status}`);
    }
  } catch (e) {
    if (e instanceof Error && !e.message.includes('Server API error')) {
      // fall through
    } else {
      throw e;
    }
  }

  // Fallback: direct client-side call
  const apiKey = import.meta.env.VITE_REPLICATE_API_KEY;
  if (!apiKey) throw new Error('No Replicate key available (server route unavailable, VITE_REPLICATE_API_KEY not set)');

  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: params.version, input: params.input }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Replicate create prediction failed (${res.status}): ${errText}`);
  }
  return res.json();
}

/**
 * Poll a Replicate prediction. Tries /api/replicate first, falls back to direct API.
 */
export async function replicatePoll(url: string): Promise<Record<string, unknown>> {
  // Try server-side proxy
  try {
    const res = await fetch('/api/replicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'poll', url }),
    });
    if (res.ok) return await res.json();
    if (res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, string>).error || `Server API error ${res.status}`);
    }
  } catch (e) {
    if (e instanceof Error && !e.message.includes('Server API error')) {
      // fall through
    } else {
      throw e;
    }
  }

  // Fallback: direct client-side call
  const apiKey = import.meta.env.VITE_REPLICATE_API_KEY;
  if (!apiKey) throw new Error('No Replicate key available');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Replicate poll failed (${res.status})`);
  return res.json();
}

/**
 * Check whether a Replicate key is available (either server-side or client-side).
 */
export function hasReplicateKey(): boolean {
  return !!import.meta.env.VITE_REPLICATE_API_KEY || !!import.meta.env.PROD;
}
