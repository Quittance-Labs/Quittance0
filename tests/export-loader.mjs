import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  try {
    return await nextLoad(url, context);
  } catch (err) {
    if (url.endsWith('.ts')) {
      try {
        const { transform } = await import('../frontend/node_modules/sucrase/dist/index.js');
        const filePath = fileURLToPath(url);
        const raw = fs.readFileSync(filePath, 'utf8');
        const { code } = transform(raw, { transforms: ['typescript'] });
        return {
          format: 'module',
          shortCircuit: true,
          source: code,
        };
      } catch {
        throw err;
      }
    }
    throw err;
  }
}
