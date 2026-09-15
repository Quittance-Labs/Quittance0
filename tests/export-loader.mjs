import { readFile } from 'node:fs/promises';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'date-fns') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export function format() { return "formatted date"; }',
    };
  }

  if (specifier === './quittance-proof' || specifier === './quittance-proof.js') {
    return nextResolve(new URL('../frontend/lib/quittance-proof.ts', import.meta.url).href, context);
  }

  if (specifier === './explorer-tx-link' || specifier === './explorer-tx-link.js') {
    return nextResolve(new URL('../frontend/lib/explorer-tx-link.ts', import.meta.url).href, context);
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    return {
      format: 'module-typescript',
      shortCircuit: true,
      source: await readFile(new URL(url), 'utf8'),
    };
  }

  return nextLoad(url, context);
}
