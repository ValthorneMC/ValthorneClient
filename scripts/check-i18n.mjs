#!/usr/bin/env node
/**
 * i18n guard rail:
 *   1. Every locale must expose exactly the same keys as the reference locale.
 *   2. No Spanish-looking literal may live outside the catalogs.
 *
 * Run with `pnpm i18n:check`. Exits non-zero on the first category that fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const localesDir = join(root, 'src/i18n/locales');
const srcDir = join(root, 'src');
const REFERENCE_LOCALE = 'en';

const errors = [];

// --- 1. Key parity -----------------------------------------------------------

function flatten(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function readCatalog(locale) {
  const dir = join(localesDir, locale);
  const catalog = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    catalog[file] = new Set(flatten(JSON.parse(readFileSync(join(dir, file), 'utf8'))));
  }
  return catalog;
}

const locales = readdirSync(localesDir).filter((entry) =>
  statSync(join(localesDir, entry)).isDirectory(),
);

if (!locales.includes(REFERENCE_LOCALE)) {
  errors.push(`Missing reference locale "${REFERENCE_LOCALE}" in ${relative(root, localesDir)}`);
}

const reference = readCatalog(REFERENCE_LOCALE);

for (const locale of locales.filter((entry) => entry !== REFERENCE_LOCALE)) {
  const catalog = readCatalog(locale);

  for (const namespace of Object.keys(reference)) {
    if (!catalog[namespace]) {
      errors.push(`${locale}: missing namespace ${namespace}`);
      continue;
    }
    for (const key of reference[namespace]) {
      if (!catalog[namespace].has(key)) {
        errors.push(`${locale}/${namespace}: missing key "${key}"`);
      }
    }
    for (const key of catalog[namespace]) {
      if (!reference[namespace].has(key)) {
        errors.push(`${locale}/${namespace}: unexpected key "${key}" (not in ${REFERENCE_LOCALE})`);
      }
    }
  }

  for (const namespace of Object.keys(catalog)) {
    if (!reference[namespace]) {
      errors.push(`${locale}: namespace ${namespace} has no ${REFERENCE_LOCALE} counterpart`);
    }
  }
}

// --- 2. Hardcoded Spanish ----------------------------------------------------

const SPANISH_CHARS = /[áéíóúñÁÉÍÓÚÑ¿¡]/;
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.startsWith(localesDir)) continue;
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      yield path;
    }
  }
}

for (const path of walk(srcDir)) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!SPANISH_CHARS.test(line)) return;
    // The language picker legitimately spells its own name
    if (path.endsWith(join('src', 'i18n', 'config.ts'))) return;
    errors.push(
      `${relative(root, path)}:${index + 1}: hardcoded Spanish text - move it to src/i18n/locales`,
    );
  });
}

// --- Report ------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`i18n check failed (${errors.length} issue(s)):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`i18n check passed: ${locales.join(', ')} in sync, no hardcoded Spanish.`);
