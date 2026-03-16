import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const lines = source.split('\n');

const statePairsToWatch = [
  ['menuDraftOptions', 'setMenuDraftOptions'],
  ['menuOptionsEnabled', 'setMenuOptionsEnabled'],
  ['menuOptionsNotice', 'setMenuOptionsNotice']
];

const stateMatches = new Map(
  statePairsToWatch.map(([state, setter]) => [`${state}:${setter}`, []])
);

const stateRegex = /const\s*\[(?<state>[A-Za-z_$][\w$]*),\s*(?<setter>[A-Za-z_$][\w$]*)\]\s*=\s*useState/;
const fileToDataUrlRegex = /const\s+fileToDataUrl\s*=\s*\(file:\s*File\)\s*=>/;
const fileToDataUrlLines = [];

lines.forEach((line, index) => {
  const lineNumber = index + 1;
  const stateMatch = line.match(stateRegex);
  if (stateMatch?.groups?.state && stateMatch?.groups?.setter) {
    const key = `${stateMatch.groups.state}:${stateMatch.groups.setter}`;
    if (stateMatches.has(key)) {
      stateMatches.get(key).push(lineNumber);
    }
  }

  if (fileToDataUrlRegex.test(line)) {
    fileToDataUrlLines.push(lineNumber);
  }
});

let hasError = false;
for (const [[state, setter], linesFound] of statePairsToWatch.map((pair) => [pair, stateMatches.get(`${pair[0]}:${pair[1]}`)])) {
  if ((linesFound?.length ?? 0) > 1) {
    hasError = true;
    console.error(`Duplicate declaration detected (${linesFound.length}) at lines [${linesFound.join(', ')}]: const [${state}, ${setter}]`);
  }
}

if (fileToDataUrlLines.length > 1) {
  hasError = true;
  console.error(`Duplicate declaration detected (${fileToDataUrlLines.length}) at lines [${fileToDataUrlLines.join(', ')}]: const fileToDataUrl = (file: File)`);
}

if (hasError) {
  console.error('\nFix duplicated state declarations in src/App.tsx before building.');
  process.exit(1);
}

console.log('guard-app-duplicates: OK');
