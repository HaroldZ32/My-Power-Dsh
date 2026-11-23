#!/bin/sh
# Run the CLI against byte-level and ratio controls from the checkout under test.
set -eu
saved=evidence/baseline/T0.2/20261123T054215Z
history=evidence/cellwork/diag-mount/2026-10-27T02-01Z/registration/request-header-record.json
scratch=$(mktemp -d "$PWD/.qa-v2-t02-controls-XXXXXX")
node --input-type=module - "$scratch" <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.argv[2];
const before = Buffer.from('{"type":"request/header","seq":1,"time":0,"data":{"header":{"tools":[{"name":"fixture","description":"');
const after = Buffer.from('","parameters":{}}]}}}');
writeFileSync(join(directory, 'invalid.json'), Buffer.concat([before, Buffer.from([0xff]), after]));
writeFileSync(join(directory, 'valid.json'), Buffer.concat([before, Buffer.from('\uFFFD'), after]));
JS
run() {
  label=$1
  input=$2
  ratio=$3
  expected=$4
  status=0
  node scripts/baseline/tool-surface.ts "$input" "$history" "$ratio" > "$scratch/$label.out.json" || status=$?
  printf '%s exit %s\n' "$label" "$status"
  test "$status" -eq "$expected"
}
run malformed "$scratch/invalid.json" 4 3
run replacement "$scratch/valid.json" 4 0
run overflow "$saved/member-request-header.json" 1e-320 3
run fractional "$scratch/valid.json" 0.5 0
run mixed "$scratch/valid.json" 1e-305 3
node --input-type=module - "$scratch" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.argv[2];
const read = label => JSON.parse(readFileSync(join(directory, `${label}.out.json`), 'utf8'));
const malformed = read('malformed');
assert.equal(malformed.status, 'UNMEASURED');
assert.equal(malformed.fresh.reason, 'invalid UTF-8');
assert.equal(malformed.historical.toolCount, 117);
assert.equal(malformed.comparison, null);
const replacement = read('replacement');
assert.equal(replacement.status, 'MEASURED');
assert.equal(replacement.fresh.toolCount, 1);
assert.equal(replacement.fresh.schemaBytes, 56);
const fractional = read('fractional');
assert.equal(fractional.status, 'MEASURED');
assert.equal(fractional.fresh.estTokens, 112);
assert.equal(fractional.historical.estTokens, 186378);
for (const [label, rejected] of [['overflow', ['fresh', 'historical']], ['mixed', ['historical']]]) {
  const value = read(label);
  assert.equal(value.status, 'UNMEASURED');
  assert.equal(value.comparison, null);
  for (const side of rejected) {
    assert.equal(value[side].status, 'UNMEASURED');
    assert.match(value[side].reason, /token estimate exceeds the finite numeric range/);
    assert.equal(Object.hasOwn(value[side], 'estTokens'), false);
  }
}
assert(Number.isFinite(read('mixed').fresh.estTokens));
console.log('PASS: strict UTF-8 and finite, per-capture token estimates.');
JS
