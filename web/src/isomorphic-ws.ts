// SPDX-License-Identifier: Apache-2.0
// Browser stand-in for isomorphic-ws: the indexer client imports a named `WebSocket` export.
export const WebSocket = globalThis.WebSocket;
export default globalThis.WebSocket;
