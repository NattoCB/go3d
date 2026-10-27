import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const TEAL = 0x64e6cc;
const GOLD = 0xf1c981;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Owns the 3D board, its GPU resources, picking, and finite visual transitions. */
export class BoardScene {
  constructor(host, { onHover, onSelect, onStats, onError } = {}) {
    this.host = host;
    this.callbacks = { onHover, onSelect, onStats, onError };
    this.size = 5;
    this.spacing = 1.15;
    this.layer = null;
    this.enabled = true;
    this.disposed = false;
    this.failed = false;
    this.frames = 0;
    this.frameId = 0;
    this.rendering = false;
    this.board = Array(125).fill(0);
    this.dead = new Set();
    this.placements = new Map();
    this.captured = [];
    this.captureStart = 0;
    this.lastIndex = -1;
    this.lastPulseStart = 0;
    this.lastPulseActive = false;
    this.inspectedPoint = null;
    this.hoverPoint = null;
    this.inspection = { neighbors: new Set(), stones: new Set(), liberties: new Set(), hintIndex: -1 };
    this.pointers = new Set();
    this.gesture = null;
    this.listeners = [];
    this.lastFrameTime = 0;
    this.lastStatsTime = -Infinity;
    this.width = 0;
    this.height = 0;
    this.dirtyTransforms = true;
    this.temp = new THREE.Object3D();
    this.vector = new THREE.Vector3();
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this._tick = this._tick.bind(this);

    try {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x080f1d);
      this.scene.fog = new THREE.Fog(0x080f1d, 28, 65);
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      this.camera.up.set(0, 0, 1);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.35;
      const canvas = this.renderer.domElement;
      canvas.setAttribute('aria-label', '三维棋盘，可拖动旋转、滚轮缩放；精确落子也可使用切层棋盘');
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
      this.host.appendChild(canvas);
      this._addLighting();
      this._bindPointerEvents(canvas);
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = !this.reducedMotion;
      this.controls.dampingFactor = 0.11;
      this.controls.rotateSpeed = 0.7;
      this.controls.zoomSpeed = 0.85;
      this.controls.panSpeed = 0.75;
      this.controls.autoRotateSpeed = 0.5;
      this.controls.minPolarAngle = 0.07;
      this.controls.maxPolarAngle = Math.PI * 0.84;
      this.controlChange = () => this._requestFrame();
      this.controlStart = () => {
        this.cameraTransition = null;
        this._setHover(null);
        this._requestFrame();
      };
      this.controls.addEventListener('change', this.controlChange);
      this.controls.addEventListener('start', this.controlStart);
      this._buildBoard();
      this._defaultView(true);
      this.visibilityChange = () => this._visibilityChanged();
      document.addEventListener('visibilitychange', this.visibilityChange);
      this.motionChange = () => {
        this.reducedMotion = this.motionQuery.matches;
        this.controls.enableDamping = !this.reducedMotion;
        if (this.reducedMotion) this._finishTransitions();
        this._requestFrame();
      };
      this.motionQuery.addEventListener('change', this.motionChange);
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(this.host);
      this._resize();
      this._requestFrame();
    } catch (error) {
      this._fail('无法启用 3D 图形，请使用下方切层棋盘继续对弈。', error);
    }
  }

  setGame(game, { animate = true } = {}) {
    if (this.disposed || !game) return;
    const n = game.size;
    if (![3, 5, 7].includes(n) || !Array.isArray(game.board) || game.board.length !== n ** 3 || game.board.some((color) => ![0, 1, 2].includes(color))) {
      this._notify('onError', '棋盘数据格式不正确，无法更新 3D 图形。');
      return;
    }
    const resized = n !== this.size;
    const oldBoard = this.board;
    const canAnimate = animate && !this.reducedMotion && this.hasGame && !resized;
    this.placements.clear();
    this.captured = [];
    const now = performance.now();
    if (canAnimate) {
      for (let i = 0; i < game.board.length; i++) {
        if (game.board[i] && game.board[i] !== oldBoard[i]) this.placements.set(i, now);
        if (oldBoard[i] && !game.board[i]) this.captured.push({ index: i, color: oldBoard[i] });
      }
    }
    this.board = game.board.slice();
    this.size = n;
    this.dead = new Set((game.dead || []).map((point) => this._index(point)).filter((i) => i >= 0));
    const nextLast = this._index(game.last_move);
    if (nextLast !== this.lastIndex && animate && !this.reducedMotion) {
      this.lastPulseStart = now;
      this.lastPulseActive = nextLast >= 0;
    } else if (!animate || this.reducedMotion) {
      this.lastPulseActive = false;
    }
    this.lastIndex = nextLast;
    this.captureStart = now;
    this.hasGame = true;
    if (resized) {
      if (this.layer >= n) this.layer = null;
      this.inspectedPoint = null;
      this.hoverPoint = null;
      this.inspection = { neighbors: new Set(), stones: new Set(), liberties: new Set(), hintIndex: -1 };
      if (this.renderer && !this.failed) {
        this._buildBoard();
        this._defaultView(true);
      }
    }
    this.dirtyTransforms = true;
    this._requestFrame();
  }

  setLayer(layer) {
    if (layer !== null && (!Number.isInteger(layer) || layer < 0 || layer >= this.size)) return;
    if (layer === this.layer) return;
    this.layer = layer;
    this._setHover(null);
    this.dirtyTransforms = true;
    this._requestFrame();
  }

  setSpacing(value) {
    if (!Number.isFinite(value)) return;
    const target = clamp(value, 0.5, 3);
    if (target === (this.spacingTransition?.to ?? this.spacing)) return;
    if (this.reducedMotion || this.failed) {
      this.spacing = target;
      this.spacingTransition = null;
    } else {
      this.spacingTransition = { from: this.spacing, to: target, start: performance.now(), duration: 360 };
    }
    this.dirtyTransforms = true;
    this._requestFrame();
  }

  setInspection(point, { neighbors = new Set(), stones = new Set(), liberties = new Set(), hintIndex = -1 } = {}) {
    this.inspectedPoint = this._index(point) >= 0 ? point.slice() : null;
    this.inspection = { neighbors, stones, liberties, hintIndex };
    this.dirtyTransforms = true;
    this._requestFrame();
  }

  resetView() {
    if (this.controls && !this.disposed && !this.failed) this._defaultView(this.reducedMotion);
  }

  setAutoRotate(enabled) {
    if (!this.controls || this.disposed) return;
    this.controls.autoRotate = Boolean(enabled);
    this._requestFrame();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this._setHover(null);
    if (this.renderer) this.renderer.domElement.style.cursor = this.enabled && this.hoverPoint ? 'pointer' : 'grab';
  }

  getDiagnostics() {
    const info = this.renderer?.info;
    return {
      frames: this.frames,
      drawCalls: info?.render.calls || 0,
      triangles: info?.render.triangles || 0,
      geometries: info?.memory.geometries || 0,
      textures: info?.memory.textures || 0,
      activeAnimations: this.placements.size + (this.captured.length ? 1 : 0) + Number(Boolean(this.spacingTransition)) + Number(Boolean(this.cameraTransition)) + Number(this.lastPulseActive),
      layer: this.layer,
      spacing: this.spacing,
      rendering: Boolean(this.frameId || this.rendering),
    };
  }

  /** Returns viewport coordinates for tooltips, keyboard focus, and point inspection. */
  projectPoint(point) {
    const index = this._index(point);
    if (index < 0 || !this.camera || this.disposed) return null;
    const rect = this.host.getBoundingClientRect();
    const projected = this._worldPosition(index, new THREE.Vector3()).project(this.camera);
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
      visible: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.resizeObserver?.disconnect();
    if (this.visibilityChange) document.removeEventListener('visibilitychange', this.visibilityChange);
    if (this.motionChange) this.motionQuery.removeEventListener('change', this.motionChange);
    this.listeners.forEach(([target, type, handler, options]) => target.removeEventListener(type, handler, options));
    this.listeners = [];
    if (this.controls) {
      this.controls.removeEventListener('change', this.controlChange);
      this.controls.removeEventListener('start', this.controlStart);
      this.controls.dispose();
    }
    this._disposeBoard();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }

  _index(point) {
    if (!Array.isArray(point) || point.length !== 3 || point.some((v) => !Number.isInteger(v) || v < 0 || v >= this.size)) return -1;
    return (point[2] * this.size + point[1]) * this.size + point[0];
  }

  _point(index) {
    const n = this.size;
    return [index % n, Math.floor(index / n) % n, Math.floor(index / (n * n))];
  }

  _worldPosition(index, target) {
    const n = this.size;
    const half = (n - 1) / 2;
    return target.set(index % n - half, Math.floor(index / n) % n - half, (Math.floor(index / (n * n)) - half) * this.spacing);
  }

  _addLighting() {
    this.scene.add(new THREE.HemisphereLight(0xc2ddff, 0x253245, 2));
    const key = new THREE.DirectionalLight(0xfff1d5, 4.2);
    key.position.set(-5, -6, 10);
    const rim = new THREE.DirectionalLight(0x83cbe7, 3.5);
    rim.position.set(6, 4, 5);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4);
    fill.position.set(1, -5, -1);
    this.scene.add(key, rim, fill);
  }

  _instances(geometry, material, capacity) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.boardGroup.add(mesh);
    return mesh;
  }

  _buildBoard() {
    this._disposeBoard();
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    const n = this.size;
    const capacity = n ** 3;
    const half = (n - 1) / 2;
    const stoneGeometry = new THREE.SphereGeometry(0.34, 24, 16);
    const pointGeometry = new THREE.SphereGeometry(0.055, 8, 6);
    const stoneMaterial = (color, dim = false) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.23, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12, transparent: dim, opacity: dim ? 0.19 : 1, depthWrite: !dim });
    this.stoneMeshes = [
      this._instances(stoneGeometry, stoneMaterial(0x142237), capacity),
      this._instances(stoneGeometry, stoneMaterial(0xebe8dd), capacity),
      this._instances(stoneGeometry, stoneMaterial(0x142237, true), capacity),
      this._instances(stoneGeometry, stoneMaterial(0xebe8dd, true), capacity),
    ];
    this.pointMeshes = [
      this._instances(pointGeometry, new THREE.MeshBasicMaterial({ color: 0xa9987b }), capacity),
      this._instances(pointGeometry, new THREE.MeshBasicMaterial({ color: 0x6a7484, transparent: true, opacity: 0.35, depthWrite: false }), capacity),
    ];
    this.captureMeshes = [
      this._instances(stoneGeometry, stoneMaterial(0x142237, true), capacity),
      this._instances(stoneGeometry, stoneMaterial(0xebe8dd, true), capacity),
    ];
    this.picking = new THREE.InstancedMesh(new THREE.SphereGeometry(0.275, 8, 6), new THREE.MeshBasicMaterial(), capacity);
    this.picking.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pickingIndices = [];
    const planeGeometry = new THREE.PlaneGeometry(n - 0.25, n - 0.25);
    this.planeMeshes = [
      this._instances(planeGeometry, new THREE.MeshBasicMaterial({ color: 0x182d43, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }), n),
      this._instances(planeGeometry, new THREE.MeshBasicMaterial({ color: 0x182d43, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }), n),
    ];
    const horizontalVertices = [];
    for (let i = 0; i < n; i++) {
      const k = i - half;
      horizontalVertices.push(-half, k, 0, half, k, 0, k, -half, 0, k, half, 0);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(horizontalVertices, 3));
    this.grids = [];
    this.labels = [];
    for (let z = 0; z < n; z++) {
      const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x9a8460, transparent: true, opacity: 0.32, depthWrite: false }));
      this.grids.push(grid);
      this.boardGroup.add(grid);
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#b6aa93';
        context.font = '500 28px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(`z=${z}`, 64, 32);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.8 }));
        sprite.scale.set(0.7, 0.35, 1);
        sprite.position.set(half + 0.6, half + 0.05, 0);
        this.labels.push(sprite);
        this.boardGroup.add(sprite);
      }
    }
    const verticalVertices = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) verticalVertices.push(x - half, y - half, -half, x - half, y - half, half);
    const verticalGeometry = new THREE.BufferGeometry();
    verticalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(verticalVertices, 3));
    this.verticals = new THREE.LineSegments(verticalGeometry, new THREE.LineBasicMaterial({ color: 0x567586, transparent: true, opacity: 0.24, depthWrite: false }));
    this.boardGroup.add(this.verticals);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry((n - 1) * 0.94 + 0.6, 80), new THREE.MeshBasicMaterial({ color: 0x0c182a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.floorRing = new THREE.Mesh(new THREE.RingGeometry((n - 1) * 0.94 + 0.58, (n - 1) * 0.94 + 0.6, 80), new THREE.MeshBasicMaterial({ color: 0x30465b, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    this.boardGroup.add(this.floor, this.floorRing);
    const ringMaterial = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
    this.libertyRings = this._instances(new THREE.TorusGeometry(0.23, 0.014, 5, 28), ringMaterial(TEAL, 0.92), capacity);
    this.groupRings = this._instances(new THREE.TorusGeometry(0.395, 0.014, 5, 32), ringMaterial(TEAL, 0.64), capacity);
    this.neighborMarks = this._instances(new THREE.OctahedronGeometry(0.1), ringMaterial(0xd4b98c, 0.9), capacity);
    this.libertyRings.renderOrder = 5;
    this.groupRings.renderOrder = 5;
    this.neighborMarks.renderOrder = 4;
    this.focusRing = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.021, 6, 40), ringMaterial(GOLD));
    this.lastRing = new THREE.Mesh(new THREE.TorusGeometry(0.375, 0.013, 5, 40), ringMaterial(GOLD, 0.7));
    this.hintRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.027, 6, 40), ringMaterial(TEAL));
    [this.focusRing, this.lastRing, this.hintRing].forEach((mesh) => { mesh.renderOrder = 6; this.boardGroup.add(mesh); });
    this.particles = this._instances(new THREE.OctahedronGeometry(0.037), ringMaterial(0xced6de, 0.8), 72);
    this.particles.renderOrder = 7;
    this.dirtyTransforms = true;
  }

  _disposeBoard() {
    const geometries = new Set();
    const materials = new Set();
    this.boardGroup?.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    if (this.picking) {
      geometries.add(this.picking.geometry);
      materials.add(this.picking.material);
      this.picking.dispose();
      this.picking = null;
    }
    this.boardGroup?.traverse((object) => { if (object.isInstancedMesh) object.dispose(); });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => { material.map?.dispose(); material.dispose(); });
    if (this.boardGroup) this.scene.remove(this.boardGroup);
    this.boardGroup = null;
  }

  _put(mesh, position, scale = 1) {
    this.temp.position.copy(position);
    this.temp.scale.setScalar(scale);
    this.temp.updateMatrix();
    mesh.setMatrixAt(mesh.count++, this.temp.matrix);
  }

  _finishInstances(mesh) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  _refreshTransforms(now) {
    if (!this.boardGroup) return;
    const half = (this.size - 1) / 2;
    const meshes = [...this.stoneMeshes, ...this.pointMeshes, ...this.captureMeshes, ...this.planeMeshes, this.libertyRings, this.groupRings, this.neighborMarks, this.particles];
    meshes.forEach((mesh) => { mesh.count = 0; });
    this.picking.count = 0;
    this.pickingIndices.length = 0;
    for (let i = 0; i < this.board.length; i++) {
      this._worldPosition(i, this.vector);
      const dim = this.layer !== null && Math.floor(i / this.size ** 2) !== this.layer;
      const color = this.board[i];
      if (color) {
        let scale = this.dead.has(i) ? 0.69 : 1;
        if (this.placements.has(i)) {
          const t = clamp((now - this.placements.get(i)) / 620, 0, 1);
          scale *= Math.max(0.035, 1 - Math.exp(-7 * t) * Math.cos(t * 12));
          if (t === 1) this.placements.delete(i);
        }
        this._put(this.stoneMeshes[(color - 1) + (dim ? 2 : 0)], this.vector, scale);
      } else {
        this._put(this.pointMeshes[Number(dim)], this.vector, dim ? 0.82 : 1);
      }
      if (!dim) {
        this._put(this.picking, this.vector, color ? 1.25 : 1);
        this.pickingIndices.push(i);
      }
      if (this.inspection.liberties.has(i)) this._put(this.libertyRings, this.vector);
      if (this.inspection.stones.has(i)) this._put(this.groupRings, this.vector);
      if (this.inspection.neighbors.has(i) && !color && !this.inspection.liberties.has(i)) this._put(this.neighborMarks, this.vector);
    }
    this.verticals.scale.z = this.spacing;
    this.verticals.material.opacity = this.layer === null ? 0.24 : 0.1;
    for (let z = 0; z < this.size; z++) {
      const dim = this.layer !== null && z !== this.layer;
      this.vector.set(0, 0, (z - half) * this.spacing);
      this._put(this.planeMeshes[Number(dim)], this.vector);
      this.grids[z].position.z = this.vector.z;
      this.grids[z].material.opacity = dim ? 0.09 : 0.36;
      if (this.labels[z]) {
        this.labels[z].position.z = this.vector.z;
        this.labels[z].material.opacity = dim ? 0.24 : 0.82;
      }
    }
    this.floor.position.z = -half * this.spacing - 0.53;
    this.floorRing.position.z = this.floor.position.z + 0.005;
    const focusIndex = this._index(this.inspectedPoint || this.hoverPoint);
    this.focusRing.visible = focusIndex >= 0;
    if (focusIndex >= 0) {
      this._worldPosition(focusIndex, this.focusRing.position);
      this.focusRing.scale.setScalar(this.board[focusIndex] ? 1.43 : 1);
    }
    this.hintRing.visible = Number.isInteger(this.inspection.hintIndex) && this.inspection.hintIndex >= 0 && this.inspection.hintIndex < this.board.length;
    if (this.hintRing.visible) this._worldPosition(this.inspection.hintIndex, this.hintRing.position);
    this.lastRing.visible = this.lastIndex >= 0 && Boolean(this.board[this.lastIndex]);
    if (this.lastRing.visible) {
      this._worldPosition(this.lastIndex, this.lastRing.position);
      let scale = 1;
      if (this.lastPulseActive) {
        const t = clamp((now - this.lastPulseStart) / 1350, 0, 1);
        scale += Math.sin(t * Math.PI * 3) * (1 - t) * 0.1;
        this.lastPulseActive = t < 1;
      }
      this.lastRing.scale.setScalar(scale);
    } else this.lastPulseActive = false;
    if (this.captured.length) {
      const t = clamp((now - this.captureStart) / 650, 0, 1);
      this.captureMeshes.forEach((mesh) => { mesh.material.opacity = (1 - t) * 0.8; });
      this.particles.material.opacity = (1 - t) ** 2 * 0.7;
      for (const victim of this.captured) {
        this._worldPosition(victim.index, this.vector);
        this._put(this.captureMeshes[victim.color - 1], this.vector, Math.max(0.001, (1 - t) ** 1.7));
        for (let k = 0; k < 4 && this.particles.count < 72; k++) {
          const angle = (victim.index * 2.399 + k * 1.571);
          this._worldPosition(victim.index, this.vector);
          this.vector.x += Math.cos(angle) * t * 0.55;
          this.vector.y += Math.sin(angle) * t * 0.55;
          this.vector.z += Math.sin(angle * 1.7) * t * 0.35 + t * (1 - t) * 0.4;
          this._put(this.particles, this.vector, 1 - t * 0.8);
        }
      }
      if (t === 1) {
        this.captured = [];
        this.captureMeshes.forEach((mesh) => { mesh.count = 0; });
        this.particles.count = 0;
      }
    }
    meshes.forEach((mesh) => this._finishInstances(mesh));
    this._finishInstances(this.picking);
    this.picking.updateMatrixWorld(true);
    this.dirtyTransforms = false;
  }

  _defaultView(immediate) {
    const extent = Math.max(this.size - 1, (this.size - 1) * this.spacing) + 1;
    const position = new THREE.Vector3(extent * 1.22, -extent * 1.65, extent * 1.05);
    this.controls.minDistance = Math.max(2, extent * 0.65);
    this.controls.maxDistance = extent * 7;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = !this.reducedMotion;
    if (immediate) {
      this.camera.position.copy(position);
      this.controls.target.set(0, 0, 0);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.cameraTransition = null;
    } else {
      this.cameraTransition = { from: this.camera.position.clone(), to: position, target: this.controls.target.clone(), start: performance.now(), duration: 700 };
    }
    this._requestFrame();
  }

  _bindPointerEvents(canvas) {
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push([target, type, handler, options]);
    };
    listen(canvas, 'pointerdown', (event) => {
      this.pointers.add(event.pointerId);
      if (this.pointers.size > 1) {
        if (this.gesture) this.gesture.invalid = true;
      } else {
        this.gesture = {
          id: event.pointerId, x: event.clientX, y: event.clientY,
          invalid: event.button !== 0, moved: false,
          cameraPosition: this.camera.position.clone(), cameraQuaternion: this.camera.quaternion.clone(),
        };
      }
      canvas.style.cursor = 'grabbing';
    }, true);
    listen(canvas, 'pointermove', (event) => {
      if (this.pointers.size) {
        if (this.gesture && Math.hypot(event.clientX - this.gesture.x, event.clientY - this.gesture.y) > 6) this.gesture.moved = true;
        return;
      }
      if (event.pointerType === 'mouse' && this.enabled) this._setHover(this._pick(event.clientX, event.clientY));
    });
    listen(canvas, 'pointerup', (event) => {
      const gesture = this.gesture;
      this.pointers.delete(event.pointerId);
      const cameraMoved = gesture && (gesture.cameraPosition.distanceTo(this.camera.position) > 0.06 || gesture.cameraQuaternion.angleTo(this.camera.quaternion) > 0.012);
      if (gesture?.id === event.pointerId && !gesture.invalid && !gesture.moved && !cameraMoved && this.pointers.size === 0 && this.enabled) {
        const point = this._pick(event.clientX, event.clientY);
        if (point) this._notify('onSelect', point);
      }
      if (!this.pointers.size) this.gesture = null;
      canvas.style.cursor = this.enabled && this.hoverPoint ? 'pointer' : 'grab';
    }, true);
    listen(canvas, 'pointercancel', (event) => {
      this.pointers.delete(event.pointerId);
      if (this.gesture) this.gesture.invalid = true;
      if (!this.pointers.size) this.gesture = null;
      canvas.style.cursor = 'grab';
    }, true);
    listen(canvas, 'pointerleave', () => this._setHover(null));
    listen(canvas, 'webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this._notify('onError', '3D 图形上下文暂时不可用，切层棋盘仍可继续对弈。');
    });
    listen(canvas, 'webglcontextrestored', () => {
      this.contextLost = false;
      this.dirtyTransforms = true;
      this._requestFrame();
    });
  }

  _pick(clientX, clientY) {
    if (!this.picking || this.failed || this.contextLost || this.disposed) return null;
    if (this.dirtyTransforms) this._refreshTransforms(performance.now());
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.picking, false)[0];
    return hit && hit.instanceId !== undefined ? this._point(this.pickingIndices[hit.instanceId]) : null;
  }

  _setHover(point) {
    if (String(point) === String(this.hoverPoint)) return;
    this.hoverPoint = point;
    this.dirtyTransforms = true;
    if (this.renderer && !this.pointers.size) this.renderer.domElement.style.cursor = point && this.enabled ? 'pointer' : 'grab';
    this._notify('onHover', point);
    this._requestFrame();
  }

  _resize() {
    if (!this.renderer || this.disposed || this.failed) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    try {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this._requestFrame();
    } catch (error) {
      this._fail('3D 视图无法调整尺寸，请使用切层棋盘继续对弈。', error);
    }
  }

  _requestFrame() {
    if (this.frameId || this.disposed || this.failed || this.contextLost || !this.renderer || document.hidden) return;
    this.frameId = requestAnimationFrame(this._tick);
  }

  _tick(now) {
    this.frameId = 0;
    if (this.disposed || this.failed || this.contextLost || document.hidden) return;
    this.rendering = true;
    try {
      const delta = this.lastFrameTime ? Math.min((now - this.lastFrameTime) / 1000, 0.05) : 1 / 60;
      this.lastFrameTime = now;
      if (this.spacingTransition) {
        const transition = this.spacingTransition;
        const t = clamp((now - transition.start) / transition.duration, 0, 1);
        this.spacing = THREE.MathUtils.lerp(transition.from, transition.to, smooth(t));
        if (t === 1) this.spacingTransition = null;
        this.dirtyTransforms = true;
      }
      if (this.cameraTransition) {
        const transition = this.cameraTransition;
        const t = clamp((now - transition.start) / transition.duration, 0, 1);
        this.camera.position.lerpVectors(transition.from, transition.to, smooth(t));
        this.controls.target.copy(transition.target).multiplyScalar(1 - smooth(t));
        if (t === 1) this.cameraTransition = null;
      }
      const moved = this.controls.update(delta);
      if (this.dirtyTransforms || this.placements.size || this.captured.length || this.lastPulseActive) this._refreshTransforms(now);
      this.renderer.render(this.scene, this.camera);
      this.frames++;
      if (moved || this.controls.autoRotate || this.getDiagnostics().activeAnimations) this._requestFrame();
    } catch (error) {
      this._fail('3D 绘制暂时失败，请使用切层棋盘继续对弈。', error);
    } finally {
      this.rendering = false;
    }
    if (now - this.lastStatsTime > 350 || !this.frameId) {
      this.lastStatsTime = now;
      this._notify('onStats', this.getDiagnostics());
    }
  }

  _finishTransitions() {
    if (this.spacingTransition) this.spacing = this.spacingTransition.to;
    if (this.cameraTransition && this.camera) {
      this.camera.position.copy(this.cameraTransition.to);
      this.controls.target.set(0, 0, 0);
    }
    this.spacingTransition = null;
    this.cameraTransition = null;
    this.placements.clear();
    this.captured = [];
    this.lastPulseActive = false;
    this.dirtyTransforms = true;
  }

  _visibilityChanged() {
    if (document.hidden) {
      this.pauseTime = performance.now();
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.pointers.clear();
      this.gesture = null;
    } else {
      const now = performance.now();
      const resumeStart = (start) => this.pauseTime ? start + now - Math.max(start, this.pauseTime) : start;
      for (const [index, start] of this.placements) this.placements.set(index, resumeStart(start));
      if (this.captured.length) this.captureStart = resumeStart(this.captureStart);
      if (this.lastPulseActive) this.lastPulseStart = resumeStart(this.lastPulseStart);
      if (this.spacingTransition) this.spacingTransition.start = resumeStart(this.spacingTransition.start);
      if (this.cameraTransition) this.cameraTransition.start = resumeStart(this.cameraTransition.start);
      this.pauseTime = 0;
      this.lastFrameTime = 0;
      this._requestFrame();
    }
  }

  _notify(name, value) {
    try { this.callbacks[name]?.(value); } catch (error) { console.error(`BoardScene ${name} callback failed`, error); }
  }

  _fail(message, error) {
    this.failed = true;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    console.error(message, error);
    this.dispose();
    this._notify('onError', message);
  }
}
