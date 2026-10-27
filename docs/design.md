# 三维围棋 / Three.js 设计

新增独立 go3d 项目，保留原 go4d 文件与正在运行的服务。Python 3.10+ 标准库保存规则、AI、存档和本地 HTTP；Three.js 0.186.1 与 OrbitControls 随包本地附带，无 npm 运行时安装、外部 CDN、远程账号或上传。

棋盘为有限格点 {0,…,n−1}³，坐标 (x,y,z)，x 最快平铺，index=(z*n+y)*n+x。仅单轴相差 1 相邻，无对角线或环绕；内部 6 邻点，角点 3 邻点。同色连通块共享不同空点构成的气。先提敌组，再禁自杀；位置超级劫，停着豁免。默认 5³=125 点，可选 3³=27 与 7³=343 点，黑先，白贴0.5可调-50..50。两次停着终局，面积分与四维版一致但在三维图中计算；死子整块手动确认，允许续弈。AI为入门启发式电脑执白。

真实 Three.js 空间中用水平 xy 格点层堆叠 z。保留立体深度、球形黑白子、精简连接线；拖动旋转、滚轮/双指缩放、右键平移，点击落子与拖动分离。可显示全部层或单层（其他层淡化、不可误点）；层距滑块展开空间，带缓动。鼠标/切片焦点高亮棋块、全部气和跨层邻点。二维切层工具承担遮挡时的精确落子和键盘可达性。

动效：落子缩放回弹、提子缩小淡出/轻粒子、上一手呼吸标记、镜头复位插值。遵循 prefers-reduced-motion；后台暂停动画。实例化棋子/点、合并网格线、DPR封顶、避免每帧重建对象与棋盘；空闲按需渲染，阻尼或过渡继续请求帧。不为装饰持续空转。可选自动旋转仅由玩家开启。

接口与 go4d 状态同形，但所有坐标只有3整数，存档格式 go3d-session-v1 / engine go3d。GET /api/state->{revision,mode,game}，POST /api/action->{action,revision,...}，动作 move/pass/undo/new/demo/resign/hint/dead/resume；GET /api/export，POST /api/import->{revision,data}。监听127.0.0.1，校验Origin、Host、Content-Type、长度(2,000,000 bytes)、版本；3000操作限额预留完整人机应手。

场景接口：static/scene.js export BoardScene。constructor(host,{onHover(point|null),onSelect(point),onStats(stats),onError(message)})；setGame(game,{animate=true}={})；setLayer(null|integer)；setSpacing(float)；setInspection(point|null,{neighbors:Set<index>,stones:Set<index>,liberties:Set<index>,hintIndex=-1}={})；resetView()；setAutoRotate(bool)；setEnabled(bool)；getDiagnostics()；dispose()。空间横轴x、深度y、竖直z，点投影由场景负责，控制器不重复Three逻辑。

控制器 static/app.js + view-model.mjs 保存显示状态、请求、SVG切层与表单；scene.js管理GPU与鼠标。renderer创建失败时显示清晰信息且切层落子仍可用。index.html/style.css由控制器作者负责。vendor/由主代理负责，scene作者只引用 ./vendor/three.module.js 与 ./vendor/OrbitControls.js。

验收：三轴规则回归、跨层提子、劫/自杀/计分/存档/边界；HTTP真请求；真实浏览器用3D射线点位落子、拖动不误落、层距/切层/复位/提示/保存/终局；桌面窄屏截图、控制台无错、7³场景draw-call与连续交互帧时间测量，并如实说明测试环境与性能限制。
