import { readFileSync, writeFileSync } from 'node:fs';

const appPath = new URL('../src/App.tsx', import.meta.url);
const source = readFileSync(appPath, 'utf8');
const lines = source.split('\n');

const stateTokens = new Set([
  'const [menuDraftOptions, setMenuDraftOptions] = useState<MenuDraftOption[]>([{ label: \'\', price: \'\', imageUrl: \'\' }]);',
  'const [menuOptionsEnabled, setMenuOptionsEnabled] = useState(true);',
  'const [menuOptionsNotice, setMenuOptionsNotice] = useState(\'\');'
]);

const seenStateLines = new Set();
let seenFileToDataUrl = false;
let skippingFileToDataUrlBlock = false;
let removed = 0;
const output = [];

for (const line of lines) {
  if (skippingFileToDataUrlBlock) {
    removed += 1;
    if (/^\s*\}\);\s*$/.test(line)) {
      skippingFileToDataUrlBlock = false;
    }
    continue;
  }

  const trimmed = line.trim();

  if (stateTokens.has(trimmed)) {
    if (seenStateLines.has(trimmed)) {
      removed += 1;
      continue;
    }

    seenStateLines.add(trimmed);
    output.push(line);
    continue;
  }

  if (trimmed === 'const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {') {
    if (seenFileToDataUrl) {
      removed += 1;
      skippingFileToDataUrlBlock = true;
      continue;
    }

    seenFileToDataUrl = true;
    output.push(line);
    continue;
  }

  output.push(line);
}

if (removed === 0) {
  console.log('fix-app-duplicates: no duplicated declarations found');
  process.exit(0);
}

writeFileSync(appPath, `${output.join('\n')}\n`, 'utf8');
console.log(`fix-app-duplicates: removed ${removed} duplicated line(s) from src/App.tsx`);
