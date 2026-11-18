/**
 * @file Fetch client for the micro frontend.
 * Adds the optional Bearer credential, bounds nothing locally (the backend owns
 * limits), decodes text/binary bodies and returns transport metadata for display.
 */
import { buildRequestUrl, decodeResponseBody } from './lib.js';

/** Executes one user-defined HTTP request and returns its full response view. */
export async function performRequest({
  baseUrl,
  path,
  method = 'GET',
  headers = {},
  body = '',
  token = '',
  attachAuth = true,
  signal,
}) {
  const finalHeaders = { ...headers };
  const upperMethod = method.toUpperCase();
  const hasBody = body !== '' && !['GET', 'HEAD'].includes(upperMethod);
  const hasContentType = Object.keys(finalHeaders).some((name) => name.toLowerCase() === 'content-type');
  if (hasBody && !hasContentType) finalHeaders['Content-Type'] = 'application/json';
  const hasAuthorization = Object.keys(finalHeaders).some((name) => name.toLowerCase() === 'authorization');
  if (attachAuth && token && !hasAuthorization) finalHeaders.Authorization = `Bearer ${token}`;

  const url = buildRequestUrl(baseUrl, path);
  const started = performance.now();
  const response = await fetch(url, {
    method: upperMethod,
    headers: finalHeaders,
    body: hasBody ? body : undefined,
    signal,
    redirect: 'follow',
  });
  const buffer = await response.arrayBuffer();
  const elapsed = performance.now() - started;
  const contentType = response.headers.get('content-type') ?? '';
  const decoded = decodeResponseBody(buffer, contentType);

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    contentType,
    bytes: buffer.byteLength,
    elapsed,
    url: response.url || url,
    redirected: response.redirected,
    text: decoded.text,
    binary: decoded.binary,
    binaryPreview: decoded.preview,
  };
}

/** Fetches and parses a public JSON endpoint used by the dashboard. */
export async function getJson(baseUrl, path, signal) {
  const result = await performRequest({ baseUrl, path, signal, attachAuth: false });
  if (!result.ok) {
    throw new Error(`HTTP ${result.status} for ${path}`);
  }
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`Invalid JSON response for ${path}`);
  }
}
