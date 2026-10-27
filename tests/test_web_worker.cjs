const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('worker serializes concurrent requests without sharing their input', async () => {
  const outputs = [];
  let request, active = false;
  const runtime = {
    FS: { writeFile() {} },
    globals: { set(_key, value) { request = JSON.parse(value); } },
    async runPythonAsync(code) {
      if (code.startsWith('import json')) return;
      if (active) throw new Error('overlapping Python calls');
      active = true;
      await new Promise(resolve => setTimeout(resolve, 20));
      active = false;
      return JSON.stringify([200, { path: request.path }]);
    },
  };
  const self = { location: { href: 'https://example.test/static/web-worker.js' }, postMessage(message) { outputs.push(message); } };
  vm.runInNewContext(fs.readFileSync('static/web-worker.js', 'utf8'), {
    self, URL, importScripts() {}, loadPyodide: async () => runtime,
    fetch: async () => ({ ok: true, text: async () => '' }), JSON,
  });
  self.onmessage({ data: { id: 1, path: '/api/action', body: {} } });
  self.onmessage({ data: { id: 2, path: '/api/import', body: {} } });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(outputs.map(message => [message.id, message.status, message.payload?.path]), [
    [1, 200, '/api/action'], [2, 200, '/api/import'],
  ]);
});
