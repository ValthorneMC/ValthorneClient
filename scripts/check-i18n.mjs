import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const localesDir = new URL('../src/i18n/locales/', import.meta.url);
const languages = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === 'object' ? flatten(child, path) : [[path, child]];
  });
}

const catalog = new Map();
for (const language of languages) {
  const dir = new URL(`${language}/`, localesDir);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const entries = flatten(JSON.parse(readFileSync(join(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'), file), 'utf8')));
    catalog.set(`${language}/${file}`, new Map(entries));
  }
}

const namespaces = new Set([...catalog.keys()].map((id) => id.split('/')[1]));
const problems = [];

for (const namespace of namespaces) {
  const keys = new Set(languages.flatMap((language) => [...(catalog.get(`${language}/${namespace}`)?.keys() ?? [])]));
  for (const language of languages) {
    const messages = catalog.get(`${language}/${namespace}`);
    if (!messages) {
      problems.push(`${language}/${namespace}: file is missing`);
      continue;
    }
    for (const key of keys) {
      if (!messages.has(key)) problems.push(`${language}/${namespace}: missing "${key}"`);
      else if (typeof messages.get(key) !== 'string' || messages.get(key).trim() === '') problems.push(`${language}/${namespace}: empty "${key}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`i18n ok: ${namespaces.size} namespaces, ${languages.length} languages`);
