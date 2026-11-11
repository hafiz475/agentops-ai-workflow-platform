import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { WorkflowNode } from '@agentops/contracts';
import { renderStructuredValue } from './tool-values.js';

type HttpNode = Extract<WorkflowNode, { type: 'HTTP_REQUEST' }>;
type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export class HttpToolBlockedError extends Error {}
export class HttpToolTransientError extends Error {}

const blockedNames = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'host.docker.internal',
  'gateway.docker.internal',
  'postgres',
  'redis',
  'ai-service',
  'api',
  'worker',
  'web',
]);

const ipv4Number = (address: string): number =>
  address.split('.').reduce((result, part) => (result << 8) + Number(part), 0) >>> 0;
const inV4Range = (address: string, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
};

export const isBlockedAddress = (rawAddress: string): boolean => {
  const address = rawAddress.toLowerCase().split('%')[0] ?? rawAddress.toLowerCase();
  if (address.startsWith('::ffff:')) return isBlockedAddress(address.slice(7));
  if (isIP(address) === 4)
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => inV4Range(address, String(base), Number(bits)));
  if (isIP(address) === 6)
    return (
      address === '::' ||
      address === '::1' ||
      address.startsWith('fc') ||
      address.startsWith('fd') ||
      /^fe[89ab]/.test(address) ||
      address.startsWith('ff')
    );
  return true;
};

const validateTarget = async (url: URL, lookup: Lookup): Promise<void> => {
  if (!['http:', 'https:'].includes(url.protocol))
    throw new HttpToolBlockedError('Only HTTP and HTTPS destinations are allowed.');
  if (url.username || url.password)
    throw new HttpToolBlockedError('Destination URLs cannot contain credentials.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    blockedNames.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    (!hostname.includes('.') && isIP(hostname) === 0)
  )
    throw new HttpToolBlockedError('Destination is private or internal.');
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname))
      throw new HttpToolBlockedError('Destination resolves to a private or internal address.');
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new HttpToolTransientError('Destination DNS resolution failed.');
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address)))
    throw new HttpToolBlockedError('Destination resolves to a private or internal address.');
};

const safeResponseHeaders = (headers: Headers): Record<string, string> => {
  const allowed = ['content-type', 'content-length', 'etag', 'last-modified', 'cache-control'];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
};

const readLimitedBody = async (response: Response, limit: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error(`HTTP response exceeds the ${limit} byte limit.`);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`HTTP response exceeds the ${limit} byte limit.`);
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export interface HttpToolContext {
  projectId: string;
  runId: string;
  nodeId: string;
  input: Record<string, unknown>;
  secrets: Record<string, Record<string, string>>;
  lookup?: Lookup;
  fetch?: typeof globalThis.fetch;
}

export const executeHttpRequest = async (
  node: HttpNode,
  context: HttpToolContext,
): Promise<Record<string, unknown>> => {
  const lookup: Lookup =
    context.lookup ?? (async (hostname) => dnsLookup(hostname, { all: true, verbatim: true }));
  const request = context.fetch ?? globalThis.fetch;
  const safeToRetry =
    node.config.method === 'GET' ||
    (node.config.retry_non_idempotent && Boolean(node.config.idempotency_key_header));
  const headers = new Headers();
  for (const [name, configured] of Object.entries(node.config.headers)) {
    if (typeof configured === 'string')
      headers.set(name, String(renderStructuredValue(configured, context.input)));
    else {
      const secret = context.secrets[context.projectId]?.[configured.secret_ref];
      if (!secret)
        throw new Error(
          `Secret reference ${configured.secret_ref} is unavailable in this project.`,
        );
      headers.set(name, secret);
    }
  }
  if (node.config.idempotency_key_header)
    headers.set(node.config.idempotency_key_header, `${context.runId}:${context.nodeId}`);
  let url = new URL(node.config.url);
  for (const [key, value] of Object.entries(node.config.query ?? {}))
    url.searchParams.set(key, String(renderStructuredValue(value, context.input)));
  const renderedBody =
    node.config.body === undefined
      ? undefined
      : renderStructuredValue(node.config.body, context.input);
  if (renderedBody !== undefined && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), node.config.timeout_ms);
  const started = Date.now();
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await validateTarget(url, lookup);
      let response: Response;
      try {
        response = await request(url, {
          method: node.config.method,
          headers,
          ...(renderedBody === undefined ? {} : { body: JSON.stringify(renderedBody) }),
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch {
        const message = controller.signal.aborted
          ? 'HTTP request timed out.'
          : 'HTTP request failed due to a temporary network error.';
        if (safeToRetry) throw new HttpToolTransientError(message);
        throw new Error(message);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) throw new Error('HTTP redirect limit exceeded.');
        const location = response.headers.get('location');
        if (!location) throw new Error('HTTP redirect did not provide a destination.');
        const nextUrl = new URL(location, url);
        if (nextUrl.origin !== url.origin)
          throw new HttpToolBlockedError('Cross-origin HTTP redirects are not allowed.');
        url = nextUrl;
        continue;
      }
      const bytes = await readLimitedBody(response, node.config.max_response_bytes);
      const text = new TextDecoder().decode(bytes);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      let body: unknown = text;
      if (contentType.includes('application/json') && text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error('HTTP response declared JSON but could not be parsed.');
        }
      }
      if (!response.ok) {
        const transient = [429, 502, 503, 504].includes(response.status);
        if (transient && safeToRetry)
          throw new HttpToolTransientError(`HTTP ${response.status} temporary failure.`);
        throw new Error(`HTTP request failed with status ${response.status}.`);
      }
      return {
        status: response.status,
        headers: safeResponseHeaders(response.headers),
        body,
        text: typeof body === 'string' ? body : JSON.stringify(body),
        latency_ms: Date.now() - started,
      };
    }
    throw new Error('HTTP redirect limit exceeded.');
  } finally {
    clearTimeout(timer);
  }
};

export const parseToolSecrets = (raw: string): Record<string, Record<string, string>> => {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('TOOL_SECRETS_JSON must be a project-to-secret object.');
  for (const secrets of Object.values(parsed)) {
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets))
      throw new Error('TOOL_SECRETS_JSON project entries must be objects.');
    if (Object.values(secrets).some((value) => typeof value !== 'string'))
      throw new Error('TOOL_SECRETS_JSON secret values must be strings.');
  }
  return parsed as Record<string, Record<string, string>>;
};
