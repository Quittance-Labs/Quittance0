const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const { copyableText, invalidText } = require('./fixtures/clipboard-feedback.fixture');

const { code } = transformSync(
  fs.readFileSync(require.resolve('../lib/clipboard-feedback.ts'), 'utf8'),
  { loader: 'ts', format: 'cjs' }
);

function loadHelper(globals = {}) {
  const context = { module: { exports: {} }, ...globals };
  vm.runInNewContext(code, context);
  return context.module.exports.copyWithFeedback;
}

test('copies fixture text exactly and preserves the clipboard receiver', async () => {
  const written = [];
  const clipboard = {
    async writeText(text) {
      assert.equal(this, clipboard);
      written.push(text);
    },
  };
  const copy = loadHelper({ navigator: { clipboard } });
  for (const text of copyableText) assert.equal(await copy(text), true);
  assert.deepEqual(written, copyableText);
});

test('rejects non-string input without writing', async () => {
  let calls = 0;
  const copy = loadHelper({ navigator: { clipboard: { writeText() { calls++; } } } });
  for (const text of invalidText) assert.equal(await copy(text), false);
  assert.equal(calls, 0);
});

test('returns false when the browser or clipboard API is unavailable', async () => {
  for (const globals of [{}, { navigator: {} }, { navigator: { clipboard: null } },
    { navigator: { clipboard: {} } }, { navigator: { clipboard: { writeText: true } } }]) {
    assert.equal(await loadHelper(globals)('payment link'), false);
  }
});

test('returns false for permission rejection and synchronous clipboard errors', async () => {
  for (const writeText of [
    async () => { throw new Error('Permission denied'); },
    () => { throw new Error('Clipboard unavailable'); },
  ]) {
    assert.equal(await loadHelper({ navigator: { clipboard: { writeText } } })('link'), false);
  }
});

test('returns false if accessing the clipboard throws', async () => {
  const navigator = { get clipboard() { throw new Error('Access denied'); } };
  assert.equal(await loadHelper({ navigator })('link'), false);
});

test('reports success only after the clipboard write completes', async () => {
  let finishWrite;
  const write = new Promise((resolve) => { finishWrite = resolve; });
  const copy = loadHelper({ navigator: { clipboard: { writeText: () => write } } });
  let settled = false;
  const result = copy('link').then((success) => { settled = true; return success; });
  await Promise.resolve();
  assert.equal(settled, false);
  finishWrite();
  assert.equal(await result, true);
});
