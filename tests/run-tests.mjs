// node tests/run-tests.mjs → kod wyjścia 0 (wszystko zielone) lub 1.
import { runAll } from './test-engine.mjs';

const results = runAll();
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`\x1b[32m✓\x1b[0m ${r.name}`);
  } else {
    failed++;
    console.log(`\x1b[31m✗ ${r.name}\x1b[0m\n  ${r.error.split('\n').join('\n  ')}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} testów zaliczonych`);
process.exit(failed ? 1 : 0);
