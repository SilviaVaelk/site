// The marble scene, shared by the home page and the marble studio.
// It knows nothing about pages: give it a canvas and a list of marbles,
// and it tells you when one is hovered or selected.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const MATERIAL_DEFAULTS = {
  transmission: 0.9,
  opacity: 0.85,
  thickness: 2.0,
  roughness: 0.3,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01,
};

const ZOOM = 3;
const Z_BOUND = 2;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {Array<{id:string, title:string, summary?:string, href?:string, marble:object}>} opts.items
 * @param {string} opts.assetBase  URL of /marbles/ (with trailing slash)
 * @param {(item|null) => void} [opts.onHover]
 * @param {(item) => void} [opts.onSelect]
 * @param {boolean} [opts.orbit]  allow rotating the view by dragging
 */
export function createMarbleScene({ canvas, items, assetBase, onHover = () => {}, onSelect = () => {}, orbit = true }) {
  // — Renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 2, 6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enabled = orbit;
  controls.target.set(0, 1, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  // — Physics
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  const marbleMat = new CANNON.Material();
  const groundMat = new CANNON.Material();
  world.addContactMaterial(new CANNON.ContactMaterial(marbleMat, groundMat, { friction: 0.4, restitution: 0.6 }));
  world.addContactMaterial(new CANNON.ContactMaterial(marbleMat, marbleMat, { friction: 0.3, restitution: 0.6 }));

  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMat });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const wall = (rx, ry, rz) => {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMat });
    b.quaternion.setFromEuler(rx, ry, rz);
    world.addBody(b);
    return b;
  };
  const leftWall = wall(0, Math.PI / 2, 0);
  const rightWall = wall(0, -Math.PI / 2, 0);
  wall(0, Math.PI, 0).position.set(0, 0, Z_BOUND);
  wall(0, 0, 0).position.set(0, 0, -Z_BOUND);
  wall(Math.PI / 2, 0, 0).position.set(0, 8, 0);

  let bound = 4;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    camera.left = -aspect * ZOOM;
    camera.right = aspect * ZOOM;
    camera.top = ZOOM;
    camera.bottom = -ZOOM;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    // Keep marbles inside the visible area on narrow (phone) screens
    bound = Math.min(4.5, Math.max(1.4, aspect * ZOOM * 0.85));
    leftWall.position.set(-bound, 0, 0);
    rightWall.position.set(bound, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // — Shared loaders & caches
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const textureCache = new Map();
  const modelCache = new Map();
  const normalMap = texLoader.load(assetBase + 'marble-normal.jpg');

  const getTexture = (file) => {
    if (!textureCache.has(file)) {
      const t = texLoader.load(assetBase + 'textures/' + file);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      textureCache.set(file, t);
    }
    return textureCache.get(file);
  };
  const getModel = (file) => {
    if (!modelCache.has(file)) {
      modelCache.set(file, gltfLoader.loadAsync(assetBase + 'models/' + file).then((g) => g.scene));
    }
    return modelCache.get(file).then((s) => s.clone(true));
  };

  // — Marbles
  /** @type {Map<string, any>} */
  const marbles = new Map();

  function buildVisual(m) {
    const cfg = m.item.marble;
    const material = new THREE.MeshPhysicalMaterial({
      map: cfg.texture ? getTexture(cfg.texture) : null,
      normalMap,
      color: new THREE.Color(cfg.color ?? '#ffffff'),
      metalness: 0,
      transparent: true,
      envMapIntensity: 2.5,
      ...MATERIAL_DEFAULTS,
      ...(cfg.material ?? {}),
    });
    const size = cfg.size ?? 1;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(size, 64, 64), material);
    sphere.userData.id = m.item.id;

    const group = new THREE.Group();
    group.add(sphere);
    const light = new THREE.PointLight(new THREE.Color(cfg.light ?? '#ff66cc'), 3, 6);
    group.add(light);

    if (cfg.inner) {
      const token = (m.token = Symbol());
      getModel(cfg.inner)
        .then((model) => {
          if (m.token !== token) return; // marble changed while loading
          const box = new THREE.Box3().setFromObject(model);
          const dims = box.getSize(new THREE.Vector3());
          model.scale.setScalar((size * 2 * 0.9) / Math.max(dims.x, dims.y, dims.z));
          box.setFromObject(model);
          model.position.sub(box.getCenter(new THREE.Vector3()));
          model.traverse((c) => {
            if (c.isMesh) c.material.envMapIntensity = 2.5;
          });
          group.add(model);
        })
        .catch((e) => console.warn(`Could not load model ${cfg.inner}`, e));
    }
    return { group, sphere };
  }

  function disposeVisual(m) {
    scene.remove(m.group);
    m.group.traverse((c) => {
      if (c.isMesh && c !== m.sphere) c.geometry?.dispose();
    });
    m.sphere.geometry.dispose();
    m.sphere.material.dispose();
  }

  function addMarble(item, position) {
    const m = { item, delay: 0 };
    Object.assign(m, buildVisual(m));
    const size = item.marble.size ?? 1;
    m.body = new CANNON.Body({
      mass: 3,
      shape: new CANNON.Sphere(size),
      position: position ?? new CANNON.Vec3((Math.random() - 0.5) * 2, 5 + Math.random() * 2, (Math.random() - 0.5) * 1),
      material: marbleMat,
      angularDamping: 0.5,
      linearDamping: 0.2,
    });
    world.addBody(m.body);
    m.group.visible = false;
    m.delay = position ? 0 : 200 + Math.random() * 1200;
    m.start = performance.now();
    scene.add(m.group);
    marbles.set(item.id, m);
    return m;
  }

  function removeMarble(id) {
    const m = marbles.get(id);
    if (!m) return;
    disposeVisual(m);
    world.removeBody(m.body);
    marbles.delete(id);
  }

  // — Pointer interaction
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let down = null;
  let touchSelected = null;

  const hit = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...marbles.values()].map((m) => m.sphere), false);
    return hits.length ? marbles.get(hits[0].object.userData.id) : null;
  };

  const setHovered = (m) => {
    if (m === hovered) return;
    hovered = m;
    canvas.style.cursor = m ? 'pointer' : '';
    onHover(m ? m.item : null);
  };

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') setHovered(hit(e));
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') setHovered(null);
  });
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // was a drag
    down = null;
    const m = hit(e);
    if (!m) {
      touchSelected = null;
      return setHovered(null);
    }
    // Touch: first tap shows the info, second tap opens it
    if (e.pointerType !== 'mouse' && touchSelected !== m) {
      touchSelected = m;
      hovered = null;
      return setHovered(m);
    }
    onSelect(m.item);
  });

  // — Environment: a soft, neutral studio light generated in code (no image file)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  items.forEach((item) => addMarble(item));

  let running = true;
  let last = performance.now();
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    world.step(1 / 60, dt, 3);
    for (const m of marbles.values()) {
      if (!m.group.visible && now - m.start > m.delay) m.group.visible = true;
      // Respawn anything that escaped
      if (m.body.position.y < -5 || Math.abs(m.body.position.x) > bound + 2) {
        m.body.position.set(0, 6, 0);
        m.body.velocity.setZero();
      }
      m.group.position.copy(m.body.position);
      m.group.quaternion.copy(m.body.quaternion);
    }
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  return {
    /** Replace one marble's look, keeping its position (used by the studio). */
    updateMarble(item) {
      const old = marbles.get(item.id);
      const pos = old ? old.body.position.clone() : undefined;
      if (pos) pos.y = Math.max(pos.y, (item.marble.size ?? 1) + 0.1);
      removeMarble(item.id);
      if (item.marble.show === false) return;
      const m = addMarble(item, pos);
      m.group.visible = true;
    },
    /** Drop all marbles in again. */
    reset() {
      for (const m of marbles.values()) {
        m.body.position.set((Math.random() - 0.5) * 2, 5 + Math.random() * 2, (Math.random() - 0.5) * 1);
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
      }
    },
    nudge(id) {
      const m = marbles.get(id);
      if (m) m.body.applyImpulse(new CANNON.Vec3((Math.random() - 0.5) * 6, 12, 0));
    },
    dispose() {
      running = false;
      window.removeEventListener('resize', resize);
      for (const id of [...marbles.keys()]) removeMarble(id);
      renderer.dispose();
    },
  };
}
