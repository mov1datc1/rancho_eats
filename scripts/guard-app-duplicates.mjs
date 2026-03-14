import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

const checks = [
  'const [menuDraftOptions, setMenuDraftOptions]',
  'const [menuOptionsEnabled, setMenuOptionsEnabled]',
  'const [menuOptionsNotice, setMenuOptionsNotice]',
  'const fileToDataUrl = (file: File)'
];

let hasError = false;
for (const token of checks) {
  const count = source.split(token).length - 1;
  if (count > 1) {
    hasError = true;
    console.error(`Duplicate declaration detected (${count}): ${token}`);
  }
}

if (hasError) {
  console.error('\nFix duplicated state declarations in src/App.tsx before building.');
  process.exit(1);
}

console.log('guard-app-duplicates: OK');
