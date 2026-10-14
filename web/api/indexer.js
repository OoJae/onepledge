// SPDX-License-Identifier: Apache-2.0
// Proxies read-only GraphQL to the Midnight Preprod indexer.
//
// indexer.preprod.midnight.network was decommissioned on 2026-10-09 (HTTP 410); Blockfrost serves the
// Preprod indexer now and every request needs a project token. Vite inlines any VITE_ variable into the
// client bundle, so the token is read here instead and never reaches the browser. Same-origin also means
// the page's `connect-src 'self'` already covers this: no CSP entry for a third-party host.
//
// Reads only. The body is forwarded verbatim and nothing is cached.

const UPSTREAM = 'https://midnight-preprod.blockfrost.io/api/v0';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ errors: [{ message: 'Use POST for GraphQL queries.' }] });
  }

  const token = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (!token) {
    return response.status(503).json({
      errors: [{ message: 'The indexer proxy is not configured: BLOCKFROST_PROJECT_ID is unset.' }],
    });
  }

  const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});

  try {
    const upstream = await fetch(`${UPSTREAM}?project_id=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    return response.send(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return response.status(502).json({ errors: [{ message: `Indexer unreachable: ${reason}` }] });
  }
}
