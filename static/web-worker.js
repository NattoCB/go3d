/* Run the original Python game engine in an isolated browser worker. */
const runtimeURL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let runtime;

const ready = (async () => {
  importScripts(`${runtimeURL}pyodide.js`);
  runtime = await loadPyodide({ indexURL: runtimeURL });
  for (const name of ['engine.py', 'ai.py', 'session.py', 'web_api.py']) {
    const response = await fetch(new URL(`../${name}`, self.location.href));
    if (!response.ok) throw new Error(`无法加载游戏文件 ${name} (${response.status})`);
    runtime.FS.writeFile(name, await response.text(), { encoding: 'utf8' });
  }
  await runtime.runPythonAsync('import json\nfrom web_api import BrowserAPI\n_browser_game = BrowserAPI()');
})();

async function handleRequest({ id, path, body }) {
  try {
    await ready;
    runtime.globals.set('_web_request', JSON.stringify({ path, body }));
    const result = await runtime.runPythonAsync('_request = json.loads(_web_request)\njson.dumps(_browser_game.dispatch(_request["path"], _request["body"]), ensure_ascii=False)');
    const [status, payload] = JSON.parse(result);
    self.postMessage({ id, status, payload });
  } catch (error) {
    self.postMessage({ id, failure: `浏览器棋局引擎加载或运行失败：${error.message || error}。请检查网络后刷新重试。` });
  }
}

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handleRequest(data), () => handleRequest(data));
};
