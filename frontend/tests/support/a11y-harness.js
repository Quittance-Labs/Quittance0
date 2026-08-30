/**
 * Rendering harness for the accessibility audit (issue #289).
 *
 * The repository's tests are plain `node --test`, with no bundler and no
 * jsdom in the loop. An axe audit needs both: axe inspects a real DOM, and the
 * pages it has to inspect are `.tsx` that Node cannot load.
 *
 * So this module does three things, once per process:
 *
 *  1. bundles the real pages and components with esbuild, aliasing away the
 *     handful of modules that need a Next.js runtime or the Stellar SDK
 *     (`tests/support/stubs/`), so what is audited is the shipped source and
 *     not a copy of it;
 *  2. installs a jsdom document as the global DOM, so `react-dom/client` can
 *     mount into it and effects — including the focus management this issue is
 *     about — actually run;
 *  3. runs axe-core inside that document.
 *
 * One caveat is worth stating plainly: jsdom performs no layout and resolves no
 * stylesheet, so axe's `color-contrast` rule cannot return a verdict here and
 * reports "incomplete" instead. Contrast is covered separately in
 * `a11y-core-pages.test.js`, which recomputes WCAG ratios from the declared
 * token pairs in `tailwind.config.js`.
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const STUBS = path.join('tests', 'support', 'stubs');

/**
 * Modules replaced during bundling.
 *
 * Everything here either requires a Next.js server runtime that does not exist
 * in a bare document, or is a side effect with no markup — never a component
 * whose accessibility is under audit.
 */
const ALIASES = {
  'next/link': `./${path.join(STUBS, 'next-link.jsx')}`,
  'next/image': `./${path.join(STUBS, 'next-image.jsx')}`,
  'next/navigation': `./${path.join(STUBS, 'next-navigation.js')}`,
  sonner: `./${path.join(STUBS, 'sonner.js')}`,
  'motion/react': `./${path.join(STUBS, 'motion.jsx')}`,
  '@/lib/stellar': `./${path.join(STUBS, 'stellar.js')}`,
  '@/lib/payment-monitor': `./${path.join(STUBS, 'payment-monitor.js')}`,
  // Only the socket is replaced — `lib/api.ts` itself stays under audit.
  axios: `./${path.join(STUBS, 'axios.js')}`,
};

/** Everything the audit renders, re-exported from one entry point. */
const ENTRY_SOURCE = `
export { setResponse, resetResponses } from 'axios';
export { useWalletStore } from '@/lib/store';
export { default as HomePage } from '@/app/page';
export { default as DashboardPage } from '@/app/dashboard/page';
export { default as PayPage } from '@/app/pay/[id]/page';
export { default as InvoiceDetailPage } from '@/app/invoice/[id]/page';
export { default as InvoiceForm } from '@/components/InvoiceForm';
export { default as InvoiceCard } from '@/components/InvoiceCard';
export { default as PaymentStatus } from '@/components/PaymentStatus';
export { default as PaymentReceipt } from '@/components/PaymentReceipt';
export { default as PaymentResultPanel } from '@/components/PaymentResultPanel';
export { default as PaymentButton } from '@/components/PaymentButton';
export { default as QRCodeDisplay } from '@/components/QRCodeDisplay';
export { default as WalletConnect } from '@/components/WalletConnect';
export { default as UserProfile } from '@/components/UserProfile';
`;

let cachedBundle = null;

/** Bundles the entry point once and evaluates it as CommonJS. */
function loadBundle() {
  if (cachedBundle) return cachedBundle;

  const entryPath = path.join(ROOT, 'tests', 'support', '.a11y-entry.jsx');
  fs.writeFileSync(entryPath, ENTRY_SOURCE);

  try {
    const result = esbuild.buildSync({
      entryPoints: [path.relative(ROOT, entryPath)],
      absWorkingDir: ROOT,
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      jsx: 'automatic',
      alias: ALIASES,
      // React itself is shared with the test process, so the components mount
      // into the same renderer the test drives.
      external: ['react', 'react-dom'],
      tsconfig: 'tsconfig.json',
      define: {
        'process.env.NEXT_PUBLIC_STELLAR_NETWORK': '"TESTNET"',
        'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:3001/api"',
      },
      logLevel: 'silent',
    });

    const compiled = new Module('a11y-bundle');
    compiled.filename = path.join(ROOT, 'a11y-bundle.js');
    compiled.paths = Module._nodeModulePaths(ROOT);
    compiled._compile(result.outputFiles[0].text, compiled.filename);

    cachedBundle = compiled.exports;
    return cachedBundle;
  } finally {
    fs.rmSync(entryPath, { force: true });
  }
}

/** Globals React DOM expects to find on the host. */
const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'self',
  'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Element', 'Node', 'Text',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'DocumentFragment',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'localStorage', 'sessionStorage', 'MutationObserver',
];

let installedDom = null;

/**
 * Installs a fresh jsdom document as the process's DOM.
 *
 * `self` is set alongside `window` because bundled browser code reaches for it
 * directly, and `IS_REACT_ACT_ENVIRONMENT` is what lets `act` flush effects.
 */
function installDom() {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><head><title>Quittance</title></head><body></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://quittance.test/' }
  );

  for (const name of DOM_GLOBALS) {
    if (dom.window[name] === undefined) continue;
    Object.defineProperty(globalThis, name, {
      value: dom.window[name],
      writable: true,
      configurable: true,
    });
  }

  Object.defineProperty(globalThis, 'self', {
    value: dom.window,
    writable: true,
    configurable: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  installedDom = dom;
  return dom;
}

function getDom() {
  return installedDom ?? installDom();
}

let axeInstalled = false;

/** Evaluates axe-core inside the jsdom window, once. */
function installAxe() {
  if (axeInstalled) return;
  const source = fs.readFileSync(
    path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'),
    'utf8'
  );
  getDom().window.eval(source);
  axeInstalled = true;
}

/**
 * Mounts an element into a detached container and lets its effects settle.
 *
 * Returns the container plus an `unmount`, so a page that starts a timer on
 * mount does not keep running for the rest of the suite.
 */
async function render(element) {
  const dom = getDom();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);

  /**
   * Lets promise-driven effects commit.
   *
   * The pages load through `Promise.all` of two awaited requests and then
   * dispatch, so a single microtask flush leaves them on their loading spinner
   * — which is trivially axe-clean and audits nothing. Several macrotask turns
   * are enough for the stubbed transport to settle, and far short of the pay
   * page's three-second poll.
   */
  const settle = async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
      });
    }
  };

  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await settle();

  return {
    container,
    /**
     * Re-renders into the same root, which is what makes a state *transition*
     * observable — mounting straight into the result state would run the focus
     * effect on mount and prove nothing about the transition.
     */
    async rerender(next) {
      await act(async () => {
        root.render(next);
      });
      await settle();
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * Runs axe over a container and returns its violations.
 *
 * `color-contrast` is disabled rather than silently ignored: jsdom resolves no
 * stylesheet, so the rule can only ever return "incomplete", and leaving it on
 * would suggest a coverage this environment does not have.
 */
async function runAxe(container) {
  installAxe();
  const dom = getDom();

  const results = await dom.window.axe.run(container, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false } },
  });

  return results.violations;
}

/** Formats violations into something a failing assertion can actually be read from. */
function formatViolations(violations) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => `      ${node.target.join(' ')}`)
        .join('\n');
      return `  ${violation.id} (${violation.impact}): ${violation.help}\n${targets}`;
    })
    .join('\n');
}

/** Mounts, audits and unmounts in one call. */
async function auditElement(element) {
  const { container, unmount } = await render(element);
  try {
    return await runAxe(container);
  } finally {
    unmount();
  }
}

module.exports = {
  ALIASES,
  loadBundle,
  installDom,
  getDom,
  render,
  runAxe,
  auditElement,
  formatViolations,
};
