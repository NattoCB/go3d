const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('unavailable Web Workers produce a clear browser-engine error', async () => {
  const document = {
    currentScript: { src: 'https://example.test/static/web-bridge.js' },
    getElementById: () => null,
    createElement: () => ({}),
    querySelector: () => null,
  };
  const window = { fetch: async () => { throw new Error('unexpected network'); }, addEventListener() {} };
  const context = { window, document, location: { search: '?web=1' }, URLSearchParams, URL,
    Worker: class { constructor() { throw new Error('blocked'); } }, setTimeout, clearTimeout, Response };
  vm.runInNewContext(fs.readFileSync('static/web-bridge.js', 'utf8'), context);
  await assert.rejects(window.fetch('/api/state'), /浏览器棋局引擎/);
});

test('a timed-out request terminates the worker and rejects later requests', async () => {
  let deadline, worker;
  const document = {
    currentScript: { src: 'https://example.test/static/web-bridge.js' },
    getElementById: () => null,
    createElement: () => ({}),
    querySelector: () => null,
  };
  const window = { fetch: async () => { throw new Error('unexpected network'); }, addEventListener() {} };
  const context = { window, document, location: { search: '?web=1' }, URLSearchParams, URL, Response,
    Worker: class {
      constructor() { worker = this; }
      addEventListener() {}
      postMessage() {}
      terminate() { this.terminated = true; }
    },
    setTimeout(fn) { deadline = fn; return 1; }, clearTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('static/web-bridge.js', 'utf8'), context);
  const request = window.fetch('/api/action', { body: '{}' });
  deadline();
  await assert.rejects(request, /响应超时/);
  assert.equal(worker.terminated, true);
  await assert.rejects(window.fetch('/api/state'), /响应超时/);
});
