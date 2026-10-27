# Three.js 本地随附模块

固定版本 **0.186.1**。来源为官方 npm `three` 包：
https://registry.npmjs.org/three/-/three-0.186.1.tgz

下载后先核对 npm SHA-512 SRI，再从归档读取且仅保存 `three.module.js`、`three.core.js`、`OrbitControls.js` 和 MIT `LICENSE`。`manifest.json` 记录上游完整包 SRI 和各文件原始/本地 SHA-256。

唯一改动是 `OrbitControls.js` 的包名导入 `from 'three'` 改为本地相对路径 `from './three.module.js'`，以免要求 import map 或运行时 npm。Three.js 核心文件未修改。

没有外部 CDN、远程纹理或字体请求。游戏需要浏览器 WebGL2；缺失时可用二维切层操作棋局。

官方文档：
- https://threejs.org/manual/pages/installation.html
- https://threejs.org/docs/pages/OrbitControls.html
- https://threejs.org/manual/pages/rendering-on-demand.html
