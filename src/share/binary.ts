import { Deflate, Inflate } from 'fflate';

/** Longest link text (the base64url code after `#p=` / `#s=`) that is written or accepted. */
export const MAX_LINK_CODE_CHARS = 64 * 1024;
/** Longest decompressed plan JSON in a link. */
export const MAX_PLAN_LINK_JSON = 64 * 1024;
/** Longest plan JSON as a file or stored copy (a maximal plan is about 250 KB indented). */
export const MAX_PLAN_JSON_BYTES = 1024 * 1024;
/** Longest site JSON as a file, stored copy or decompressed link (a maximal site is about 1.1 MB indented). */
export const MAX_SITE_JSON_BYTES = 2 * 1024 * 1024;
/** Kept so imports do not churn; use the specific limit above. */
export const MAX_PAYLOAD_BYTES = MAX_LINK_CODE_CHARS;

export type Bytes = Uint8Array<ArrayBuffer>;

/** Thrown for any malformed, oversize or otherwise unacceptable plan input. */
export class PlanFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanFormatError';
  }
}

/** A plan or site that cannot be written as a link the app could open again; offer the JSON file instead. */
export class LinkTooLargeError extends PlanFormatError {
  constructor() {
    super('This is too large for a link. Download JSON instead.');
  }
}

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
  if (text.length > MAX_LINK_CODE_CHARS) throw new PlanFormatError('Plan link is too long.');
  if (!BASE64URL_RE.test(text) || text.length % 4 === 1) {
    throw new PlanFormatError('Plan link is damaged (invalid characters).');
  }
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new PlanFormatError('Plan link is damaged (invalid base64).');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hasNativeStreams(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function readAll(readable: ReadableStream<Uint8Array>, limit: number): Promise<Bytes> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new PlanFormatError('Plan data is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function throughStream(
  stream: CompressionStream | DecompressionStream,
  input: Bytes,
  limit: number,
): Promise<Bytes> {
  const writer = stream.writable.getWriter();
  // Errors surface on the readable side; swallow them here to avoid unhandled rejections.
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  return readAll(stream.readable, limit);
}

export interface CompressOptions {
  /** Force the fflate implementation (used by tests and browsers without CompressionStream). */
  fallback?: boolean;
}

export async function deflateRaw(input: Bytes, opts: CompressOptions = {}): Promise<Bytes> {
  if (!opts.fallback && hasNativeStreams()) {
    return throughStream(new CompressionStream('deflate-raw'), input, Number.MAX_SAFE_INTEGER);
  }
  const chunks: Uint8Array[] = [];
  const deflate = new Deflate({ level: 9 });
  deflate.ondata = (chunk) => chunks.push(chunk);
  deflate.push(input, true);
  return concat(chunks);
}

/** Inflates raw deflate data, rejecting output larger than `limit` bytes (zip bombs). */
export async function inflateRaw(
  input: Bytes,
  opts: CompressOptions & { limit?: number } = {},
): Promise<Bytes> {
  const limit = opts.limit ?? MAX_PLAN_LINK_JSON;
  if (!opts.fallback && hasNativeStreams()) {
    try {
      return await throughStream(new DecompressionStream('deflate-raw'), input, limit);
    } catch (err) {
      if (err instanceof PlanFormatError) throw err;
      throw new PlanFormatError('Plan link is damaged (cannot decompress).');
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  const inflate = new Inflate();
  inflate.ondata = (chunk, final) => {
    total += chunk.length;
    if (total > limit) throw new PlanFormatError('Plan data is too large.');
    chunks.push(chunk);
    if (final) finished = true;
  };
  try {
    // Feed small slices so a single push can never allocate a huge output buffer.
    const step = 1024;
    for (let i = 0; i < input.length || i === 0; i += step) {
      const end = Math.min(input.length, i + step);
      inflate.push(input.subarray(i, end), end >= input.length);
      if (end >= input.length) break;
    }
  } catch (err) {
    if (err instanceof PlanFormatError) throw err;
    throw new PlanFormatError('Plan link is damaged (cannot decompress).');
  }
  if (!finished) throw new PlanFormatError('Plan link is damaged (truncated data).');
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Bytes {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
