// SPDX-License-Identifier: Apache-2.0
// Stages the compiled circuit artifacts where FetchZkConfigProvider looks for them.
//
// The provider fetches ${origin}/keys/<circuit>.prover, /keys/<circuit>.verifier and
// /zkir/<circuit>.bzkir. These are ~25 MB and already tracked under contract/src/managed/registry,
// so they are copied into public/ at build time rather than committed a second time.
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const managed = path.resolve(here, '..', '..', 'contract', 'src', 'managed', 'registry');
const publicDir = path.resolve(here, '..', 'public');

const copyDir = async (name: string) => {
  const from = path.join(managed, name);
  const to = path.join(publicDir, name);
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  const files = await readdir(to);
  let bytes = 0;
  for (const f of files) bytes += (await stat(path.join(to, f))).size;
  console.log(`${name}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
};

await copyDir('keys');
await copyDir('zkir');
