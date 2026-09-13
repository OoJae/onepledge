// SPDX-License-Identifier: Apache-2.0
// Creates (or loads) the CLI wallet for a network and prints its address for the faucet.
// The mnemonic lives in .secrets/<network>.mnemonic (mode 0600, git-ignored) and is never printed.

import { selectNetwork } from './config.js';
import { deriveKeys, loadOrCreateMnemonic, unshieldedAddress, walletSeed } from './wallet.js';

const network = selectNetwork();
const { created } = loadOrCreateMnemonic(network);
const keys = await deriveKeys(await walletSeed(network), network);

console.log(created ? `Created a new ${network.name} wallet.` : `Loaded the existing ${network.name} wallet.`);
console.log(`Unshielded address (fund this from the faucet): ${unshieldedAddress(keys)}`);
