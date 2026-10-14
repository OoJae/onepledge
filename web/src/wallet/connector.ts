// SPDX-License-Identifier: Apache-2.0
// Discovery and connection for Midnight DApp Connector v4 wallets (Lace, 1AM).
//
// v4 is a breaking change from v3: there is no window.midnight.mnLace and no enable(). Each extension
// injects under a fresh UUID key on every page load, so wallets are found by scanning window.midnight
// and matching the stable reverse-DNS id. enable()/isEnabled() are replaced by connect(networkId).
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import semver from 'semver';

export const EXPECTED_NETWORK = 'preprod';
const SUPPORTED_API = '4.x';

/** Wallets we can name. Anything else still works; it is just listed by its own `name`. */
const KNOWN = {
  'io.lace.wallet': { label: 'Lace', proves: false },
  'com.midnight.1am': { label: '1AM', proves: true },
} as const;

export type WalletChoice = {
  readonly api: InitialAPI;
  readonly rdns: string;
  readonly label: string;
  /** True when the wallet proves in-browser, so no local proof server is needed. */
  readonly provesInBrowser: boolean;
  readonly compatible: boolean;
};

export type ConnectorError = Error & { type: 'DAppConnectorAPIError'; code: string; reason: string };

/** Connector errors are plain objects with a `type` tag, not Error subclasses: instanceof will not work. */
export const isConnectorError = (e: unknown): e is ConnectorError =>
  typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'DAppConnectorAPIError';

export const describeError = (e: unknown): string => {
  if (isConnectorError(e)) {
    switch (e.code) {
      case 'Rejected':
        return 'You declined the connection in your wallet.';
      case 'PermissionRejected':
        return 'Your wallet is refusing this site for the rest of the session. Reload the page to ask again.';
      case 'Disconnected':
        return 'The wallet disconnected. Unlock it and try again.';
      case 'InvalidRequest':
        return `The wallet rejected the request: ${e.reason}`;
      default:
        return e.reason || 'The wallet reported an internal error.';
    }
  }
  return e instanceof Error ? e.message : 'Unknown error.';
};

export const listWallets = (): WalletChoice[] => {
  const injected = typeof window === 'undefined' ? undefined : window.midnight;
  if (!injected) return [];
  return Object.values(injected)
    .filter((api): api is InitialAPI => typeof api?.connect === 'function' && typeof api.rdns === 'string')
    .map((api) => {
      const known = KNOWN[api.rdns as keyof typeof KNOWN];
      return {
        api,
        rdns: api.rdns,
        // `name` is wallet-controlled text: render it, never inject it as markup.
        label: known?.label ?? api.name ?? api.rdns,
        provesInBrowser: known?.proves ?? false,
        compatible: semver.validRange(SUPPORTED_API) !== null && semver.satisfies(semver.coerce(api.apiVersion) ?? '0.0.0', SUPPORTED_API),
      };
    });
};

/**
 * Waits for an extension to inject. Extensions arrive slightly after DOMContentLoaded, and a fresh
 * install usually needs a reload. Call this on mount, never inside the click handler: awaiting anything
 * before connect() spends the page's transient user activation and the wallet's pop-up is suppressed.
 */
export const waitForWallets = async (timeoutMs = 3_000, stepMs = 150): Promise<WalletChoice[]> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = listWallets();
    if (found.length > 0 || Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

export type Connection = {
  readonly api: ConnectedAPI;
  readonly choice: WalletChoice;
  readonly networkId: string;
};

/**
 * Must be called synchronously from a user gesture. `connect()` is only a hint about the network: the
 * wallet is free to stay where it is, so the answer from getConnectionStatus() is the authoritative one.
 */
export const connect = async (choice: WalletChoice): Promise<Connection> => {
  const api = await choice.api.connect(EXPECTED_NETWORK);
  const status = await api.getConnectionStatus();
  if (status.status !== 'connected') {
    throw new Error('The wallet reported itself as disconnected. Unlock it and try again.');
  }
  if (status.networkId !== EXPECTED_NETWORK) {
    throw new Error(
      `${choice.label} is on "${status.networkId}". OnePledge is deployed on Preprod: switch the network in your wallet, then reload.`,
    );
  }
  // Align the SDK with the wallet before any provider is constructed.
  setNetworkId(status.networkId);
  return { api, choice, networkId: status.networkId };
};
