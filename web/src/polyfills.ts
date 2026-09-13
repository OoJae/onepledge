// SPDX-License-Identifier: Apache-2.0
// Node globals some Midnight packages expect at module load. Imported first by main.tsx.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string>; browser: boolean } };
g.Buffer ??= Buffer;
g.process ??= { env: {}, browser: true };
