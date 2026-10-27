# 三维围棋 · 3D Go

一个在三维格点上扩展围棋规则的本地小游戏。Three.js 立体棋盘可以旋转、缩放，也提供二维切层以便查看空间关系和精确落子。支持本地双人和入门启发式电脑对手。

## 在线游玩

访问 [三维围棋网页版](https://nattocb.github.io/go3d/)。首次打开时会从 jsDelivr 下载固定版本的 Pyodide 浏览器 Python 运行时，需要联网并等待加载；棋局在浏览器内运行，不上传棋谱。刷新页面会清空棋局，继续之前可使用“保存棋局”下载 JSON，之后通过“读取棋局”恢复。各浏览器标签页的棋局相互独立。

## 本地运行

需要 Python 3.10 或更新版本和支持 WebGL 的现代浏览器。在本目录运行：

```sh
python3 app.py
```

macOS 也可以双击 `开始游戏.command`。程序自动选择空闲端口并打开浏览器；在终端按 Ctrl+C 停止。本地运行时 Three.js 已随项目附带，无需安装第三方依赖或连接 CDN。若 WebGL 不可用，可使用二维切层视图。

## 棋盘和规则

- 三维坐标 `(x, y, z)` 从 0 开始；默认 5³ 格点，也可选择 3³ 或 7³。只有沿单个轴相差 1 的格点相邻；内部点最多有 6 个邻点。
- 同色棋子沿任意轴相连成棋块，共享不同空点作为气。先提无气敌子，再检查自杀；采用位置超级劫，停着不受此限制。
- 双方连续停着后进入面积计分。死子需要玩家手动标记确认，也可以继续对局。白方贴目可调整；没有声称经验证的三维公平贴目。
- 拖动旋转、滚轮缩放；选择层和调整层距可减少遮挡。二维切层支持键盘操作。提供教学局面、提示、悔棋、存档与载入。

服务只监听本机。棋局保存在内存中，关闭前可下载 JSON 存档；同一服务的多个标签页共享棋局。电脑对手使用简单启发式，并非强棋 AI。

## 验证与打包

```sh
python3 -m unittest discover -s tests -v
node --test tests/test_viewmodel.mjs tests/test_web_bridge.cjs tests/test_web_worker.cjs
python3 build.py
```

打包使用 Python 标准库，生成 `artifacts/go3d.zip`。Three.js 及 OrbitControls 的版本和许可证见 [static/vendor/README.md](static/vendor/README.md)。

## License

项目采用 [MIT](LICENSE)；随附的 Three.js 保留其 [MIT 许可证](static/vendor/LICENSE)。
