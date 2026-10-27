/* Only the GitHub Pages entry opts into the browser-local game backend. */
(() => {
  if (new URLSearchParams(location.search).get('web') !== '1') return;
  const subtitle = document.getElementById('turn-subtitle');
  if (subtitle) subtitle.textContent = '首次加载浏览器棋局引擎，请稍候…';
  const note = document.createElement('p');
  note.className = 'score-note';
  note.textContent = '网页版刷新会清空棋局，请先保存棋局。';
  document.querySelector('.file-actions')?.after(note);
  const originalFetch = window.fetch.bind(window);
  const endpoints = new Set(['/api/state', '/api/action', '/api/export', '/api/import']);
  let worker;
  let workerFailure = null;
  try { worker = new Worker(new URL('./web-worker.js', document.currentScript.src)); }
  catch { workerFailure = '无法启动浏览器棋局引擎，请确认浏览器支持 Web Worker 后刷新重试。'; }
  const pending = new Map();
  let nextId = 0;

  function failAll(message) {
    workerFailure = message;
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error(message)); }
    pending.clear();
  }
  worker?.addEventListener('error', () => failAll('无法启动浏览器棋局引擎，请检查网络后刷新重试。'));
  worker?.addEventListener('message', ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    clearTimeout(item.timeout);
    if (data.failure) item.reject(new Error(data.failure));
    else item.resolve(new Response(JSON.stringify(data.payload), { status: data.status, headers: { 'Content-Type': 'application/json' } }));
  });
  window.fetch = (input, options = {}) => {
    if (typeof input !== 'string' || !endpoints.has(input)) return originalFetch(input, options);
    if (workerFailure) return Promise.reject(new Error(workerFailure));
    let body = null;
    try { if (options.body) body = JSON.parse(options.body); }
    catch { return Promise.reject(new Error('请求数据格式无效。')); }
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        worker.terminate();
        failAll('浏览器棋局引擎响应超时，已停止运行。请刷新页面并重新读取已保存的棋局。');
      }, 120000);
      pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ id, path: input, body });
    });
  };
  window.addEventListener('pagehide', event => { if (!event.persisted) worker?.terminate(); });
})();
