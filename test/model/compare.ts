import assert from 'node:assert/strict';

import { compare } from './model.js';

const rows = await compare();
assert.deepEqual(rows.map(row => row.completed), [1, 1, 10, 10]);
console.log('Deterministic model only: no RPC, real funds, Nano/NOMS cryptography, or throughput measurement.');
console.table(rows);
