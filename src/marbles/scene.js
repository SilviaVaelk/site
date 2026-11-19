// The marble scene, shared by the home page and the marble studio.
// It knows nothing about pages: give it a canvas and a list of marbles,
// and it tells you when one is hovered or selected.
//
// View: looking straight down at a table. Marbles rest on it, roll when
// you drag/throw one, and bump into each other. Nothing is drawn while
// everything is still, so an idle page costs almost nothing.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import DEFAULT_ENV from './environment.json';

export const MATERIAL_DEFAULTS = {
  transmission: 0.9,
  opacity: 0.85,
  thickness: 2.0,
  roughness: 0.3,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01,
};

export { DEFAULT_ENV };

const TONE_MAPPING = {
  None: THREE.NoToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

const MAX_THROW = 14; // fastest a marble can be thrown
const CLICK_SLOP = 6; // px a pointer can move and still count as a click

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {Array<{id:string, title:string, summary?:string, href?:string, marble:object}>} opts.items
 * @param {string} opts.assetBase  URL of /marbles/ (with trailing slash)
 * @param {(item|null) => void} [opts.onHover]
 * @param {(item) => void} [opts.onSelect]
 * @param {object} [opts.environment]  lighting/physics settings (see environment.json)
 * @param {{top?:number, bottom?:number}} [opts.insets]  px kept free of marbles (e.g. under the header)
 */
export function createMarbleScene({ canvas, items, assetBase, onHover = () => {}, onSelect = () => {}, environment = DEFAULT_ENV, insets = {} }) {
  let env = { ...DEFAULT_ENV, ...environment };

  // — Rendering only happens when something changed
  let renderFrames = 2;
  const invalidate = (frames = 2) => (renderFrames = Math.max(renderFrames, frames));

  // — Renderer, scene, camera (top-down)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1); // screen "up" = away from you on the table
  camera.lookAt(0, 0, 0);

  // — Backdrop: the table surface, with the hovered project's name painted on it.
  // It's part of the 3D scene (not HTML), so the glass marbles refract it.
  const backdropCanvas = document.createElement('canvas');
  const bctx = backdropCanvas.getContext('2d');
  const backdropTex = new THREE.CanvasTexture(backdropCanvas);
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: backdropTex, toneMapped: false }),
  );
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.y = -0.01;
  const title = { text: '', alpha: 0, target: 0, layout: null };
  const TITLE_FONT = (size) => `800 ${size}px Inter, system-ui, sans-serif`;

  // Largest size at which the (uppercase) name fits, wrapping onto lines
  function layoutTitle(W, H) {
    const words = title.text.toUpperCase().split(/\s+/).filter(Boolean);
    const maxW = W * 0.94;
    const maxH = H * 0.8;
    let size = Math.min(H * 0.5, W * 0.3);
    for (let i = 0; i < 50; i++) {
      bctx.font = TITLE_FONT(size);
      bctx.letterSpacing = `${-0.03 * size}px`;
      const lines = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (line && bctx.measureText(test).width > maxW) {
          lines.push(line);
          line = w;
        } else line = test;
      }
      if (line) lines.push(line);
      const widest = Math.max(...lines.map((l) => bctx.measureText(l).width));
      if (widest <= maxW && lines.length * size * 0.86 <= maxH) return { size, lines };
      size *= 0.92;
    }
    return { size, lines: [title.text.toUpperCase()] };
  }

  function drawBackdrop() {
    const ratio = Math.min(window.devicePixelRatio, 1.5);
    const W = Math.round((canvas.clientWidth || window.innerWidth) * ratio);
    const H = Math.round((canvas.clientHeight || window.innerHeight) * ratio);
    if (backdropCanvas.width !== W || backdropCanvas.height !== H) {
      backdropCanvas.width = W;
      backdropCanvas.height = H;
      title.layout = null;
    }
    bctx.globalAlpha = 1;
    bctx.fillStyle = env.background;
    bctx.fillRect(0, 0, W, H);
    if (title.text && title.alpha > 0) {
      title.layout ??= layoutTitle(W, H);
      const { size, lines } = title.layout;
      bctx.globalAlpha = title.alpha;
      bctx.fillStyle = '#000';
      bctx.font = TITLE_FONT(size);
      bctx.letterSpacing = `${-0.03 * size}px`;
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      const lh = size * 0.86;
      lines.forEach((l, i) => bctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh + size * 0.04));
    }
    backdropTex.needsUpdate = true;
    invalidate();
  }
  // Redraw once the Inter font has arrived
  document.fonts?.load(TITLE_FONT(100)).then(() => {
    title.layout = null;
    drawBackdrop();
  });

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  scene.add(keyLight);
  scene.add(backdrop);

  // — Physics: a flat table with four walls at the edges of the screen
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.allowSleep = true;
  const marbleMat = new CANNON.Material();
  const tableMat = new CANNON.Material();
  const tableContact = new CANNON.ContactMaterial(marbleMat, tableMat, { friction: 0.3, restitution: 0.3 });
  const marbleContact = new CANNON.ContactMaterial(marbleMat, marbleMat, { friction: 0.1, restitution: 0.6 });
  world.addContactMaterial(tableContact);
  world.addContactMaterial(marbleContact);

  const plane = (rx, ry) => {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: tableMat });
    b.quaternion.setFromEuler(rx, ry, 0);
    world.addBody(b);
    return b;
  };
  plane(-Math.PI / 2, 0); // table
  const walls = {
    left: plane(0, Math.PI / 2),
    right: plane(0, -Math.PI / 2),
    far: plane(0, 0),
    near: plane(0, Math.PI),
  };

  // — Marbles
  /** @type {Map<string, any>} */
  const marbles = new Map();
  const radius = (item) => item.marble.size ?? 1;

  // Visible area of the table; grows on narrow screens so everything fits
  const bounds = { x: 4, z: 2.5, cz: 0, far: -2.5, near: 2.5 };
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const top = insets.top ?? 0;
    const bottom = insets.bottom ?? 0;
    const usable = Math.max(h - top - bottom, h * 0.5) / h; // share of the height marbles may use
    const aspect = w / h;
    const area = [...marbles.values()].reduce((a, m) => a + Math.PI * radius(m.item) ** 2, 0) || 1;
    const zoom = Math.max(env.zoom, Math.sqrt((area * 3) / (4 * aspect * usable)));
    camera.left = -aspect * zoom;
    camera.right = aspect * zoom;
    camera.top = zoom;
    camera.bottom = -zoom;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);

    const perPx = (2 * zoom) / h; // table units per screen pixel
    const margin = zoom * 0.04;
    bounds.x = aspect * zoom - margin;
    bounds.far = -zoom + margin + top * perPx;
    bounds.near = zoom - margin - bottom * perPx;
    bounds.z = (bounds.near - bounds.far) / 2;
    bounds.cz = (bounds.near + bounds.far) / 2;
    walls.left.position.set(-bounds.x, 0, 0);
    walls.right.position.set(bounds.x, 0, 0);
    walls.far.position.set(0, 0, bounds.far);
    walls.near.position.set(0, 0, bounds.near);
    // Pull back anything the new walls would cut through
    for (const m of marbles.values()) {
      const r = radius(m.item);
      const p = m.body.position;
      p.x = THREE.MathUtils.clamp(p.x, -bounds.x + r, bounds.x - r);
      p.z = THREE.MathUtils.clamp(p.z, bounds.far + r, bounds.near - r);
      m.body.wakeUp();
    }
    backdrop.scale.set(camera.right - camera.left, camera.top - camera.bottom, 1);
    drawBackdrop();
  }

  // — Shared loaders & caches
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const textureCache = new Map();
  const modelCache = new Map();
  const normalMap = texLoader.load(assetBase + 'marble-normal.jpg', () => invalidate());

  const getTexture = (file) => {
    if (!textureCache.has(file)) {
      const t = texLoader.load(assetBase + 'textures/' + file, () => invalidate());
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

  function buildVisual(m) {
    const cfg = m.item.marble;
    const material = new THREE.MeshPhysicalMaterial({
      map: cfg.texture ? getTexture(cfg.texture) : null,
      normalMap,
      color: new THREE.Color(cfg.color ?? '#ffffff'),
      metalness: 0,
      transparent: true,
      ...MATERIAL_DEFAULTS,
      ...(cfg.material ?? {}),
    });
    material.normalScale.setScalar(env.normalStrength);
    const size = radius(m.item);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(size, 64, 64), material);
    sphere.userData.id = m.item.id;

    const group = new THREE.Group();
    group.add(sphere);
    const light = new THREE.PointLight(new THREE.Color(cfg.light ?? '#ff66cc'), env.glow, 6);
    group.add(light);
    group.userData.glow = light;

    if (cfg.inner) {
      const token = (m.token = Symbol());
      getModel(cfg.inner)
        .then((model) => {
          if (m.token !== token) return; // marble changed while loading
          // Fit the model inside the marble (by its bounding sphere, so no corners poke out)
          const box = new THREE.Box3().setFromObject(model);
          const sphereBounds = box.getBoundingSphere(new THREE.Sphere());
          model.scale.setScalar((size * 0.85) / sphereBounds.radius);
          box.setFromObject(model);
          model.position.sub(box.getCenter(new THREE.Vector3()));
          group.add(model);
          invalidate();
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

  // Find a free spot on the table for a marble of radius r
  function freeSpot(r, ignore) {
    let best = null;
    let bestGap = -Infinity;
    for (let i = 0; i < 150; i++) {
      const x = (Math.random() * 2 - 1) * Math.max(0, bounds.x - r);
      const z = bounds.cz + (Math.random() * 2 - 1) * Math.max(0, bounds.z - r);
      let gap = Infinity;
      for (const o of marbles.values()) {
        if (o === ignore) continue;
        const d = Math.hypot(o.body.position.x - x, o.body.position.z - z) - r - radius(o.item);
        gap = Math.min(gap, d);
      }
      if (gap > 0.15) return new CANNON.Vec3(x, r, z);
      if (gap > bestGap) [best, bestGap] = [new CANNON.Vec3(x, r, z), gap];
    }
    return best;
  }

  const drift = (body, strength = 1) => {
    const a = Math.random() * Math.PI * 2;
    const s = (0.4 + Math.random() * 0.8) * strength;
    body.velocity.set(Math.cos(a) * s, 0, Math.sin(a) * s);
    body.wakeUp();
  };

  function addMarble(item, position, appearDelay = 0) {
    const m = { item };
    Object.assign(m, buildVisual(m));
    const r = radius(item);
    m.body = new CANNON.Body({
      mass: r ** 3, // bigger marbles are heavier
      shape: new CANNON.Sphere(r),
      material: marbleMat,
      position: position ?? freeSpot(r),
      linearDamping: 0.35,
      angularDamping: 0.35,
      sleepSpeedLimit: 0.06,
      sleepTimeLimit: 0.6,
    });
    m.body.position.y = r;
    world.addBody(m.body);
    m.appearAt = performance.now() + appearDelay;
    m.group.scale.setScalar(appearDelay ? 0.0001 : 1);
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

  // — Pointer: hover, click, and drag-to-throw
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tablePoint = new THREE.Vector3();
  let hovered = null;
  let touchSelected = null;
  let press = null; // { x, y, marble, dragging, target }

  const setPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  };
  const hit = (e) => {
    setPointer(e);
    const hits = raycaster.intersectObjects([...marbles.values()].map((m) => m.sphere), false);
    return hits.length ? marbles.get(hits[0].object.userData.id) : null;
  };
  const pointOnTable = (e) => {
    setPointer(e);
    return raycaster.ray.intersectPlane(tablePlane, tablePoint);
  };

  const setHovered = (m) => {
    if (m === hovered) return;
    hovered = m;
    if (!press?.dragging) canvas.style.cursor = m ? 'pointer' : '';
    onHover(m ? m.item : null);
  };

  canvas.addEventListener('pointerdown', (e) => {
    const m = hit(e);
    press = { x: e.clientX, y: e.clientY, marble: m, dragging: false, target: null };
    if (m) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (press?.marble) {
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) {
        press.dragging = true;
        canvas.style.cursor = 'grabbing';
      }
      if (press.dragging) {
        const p = pointOnTable(e);
        if (p) press.target = p.clone();
        return;
      }
    }
    if (e.pointerType === 'mouse') setHovered(hit(e));
  });

  const endPress = (e) => {
    const p = press;
    press = null;
    if (!p) return;
    if (p.dragging) {
      canvas.style.cursor = hovered ? 'pointer' : '';
      return; // let it fly with the velocity it has
    }
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return;
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
  };
  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', () => (press = null));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !press) setHovered(null);
  });

  // — Environment & lighting (all driven by `env`, see environment.json)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdrLoader = new HDRLoader();
  let envKey = null;
  let envTexture = null;

  function gradientScene(top, bottom) {
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.6, 0.8, vP.y)), 1.0); }',
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    return s;
  }

  function setEnvMap(texture) {
    if (envTexture) envTexture.dispose();
    envTexture = texture;
    scene.environment = texture;
    invalidate();
  }

  function applyEnvMap() {
    const key = env.env === 'gradient' ? `gradient:${env.gradientTop}:${env.gradientBottom}` : env.env;
    if (key === envKey) return;
    envKey = key;
    if (env.env === 'none') return setEnvMap(null);
    if (env.env === 'room') return setEnvMap(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    if (env.env === 'gradient') return setEnvMap(pmrem.fromScene(gradientScene(env.gradientTop, env.gradientBottom)).texture);
    if (env.env.startsWith('hdr:')) {
      hdrLoader.load(assetBase + 'env/' + env.env.slice(4), (hdr) => {
        if (envKey !== key) return hdr.dispose();
        setEnvMap(pmrem.fromEquirectangular(hdr).texture);
        hdr.dispose();
      });
    }
  }

  function applyEnvironment() {
    applyEnvMap();
    scene.environmentIntensity = env.envIntensity;
    scene.environmentRotation.set(0, THREE.MathUtils.degToRad(env.envRotation), 0);
    const tm = TONE_MAPPING[env.toneMapping] ?? THREE.ACESFilmicToneMapping;
    if (renderer.toneMapping !== tm) {
      renderer.toneMapping = tm;
      scene.traverse((o) => o.material && (o.material.needsUpdate = true));
    }
    renderer.toneMappingExposure = env.exposure;
    ambient.intensity = env.ambient;
    ambient.color.set(env.ambientColor);
    keyLight.intensity = env.keyLight;
    keyLight.color.set(env.keyColor);
    const a = THREE.MathUtils.degToRad(env.keyAngle);
    keyLight.position.set(Math.sin(a) * 7, 10, Math.cos(a) * 7);
    world.gravity.set(0, -env.gravity, 0);
    marbleContact.restitution = env.bounce;
    for (const m of marbles.values()) {
      m.group.userData.glow.intensity = env.glow;
      m.sphere.material.normalScale.setScalar(env.normalStrength);
    }
    document.documentElement.style.setProperty('--bg', env.background);
    resize();
  }

  // — Set the table: place marbles, let them settle in with a gentle drift
  resize();
  items.forEach((item, i) => {
    const m = addMarble(item, undefined, 80 + i * 70);
    drift(m.body);
  });
  resize(); // fit the view now that we know the marbles' sizes
  applyEnvironment();
  window.addEventListener('resize', resize);

  // — Loop
  let running = true;
  let last = performance.now();
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    // Dragged marble follows the pointer; its speed becomes the throw
    if (press?.dragging && press.target) {
      const b = press.marble.body;
      const v = new CANNON.Vec3((press.target.x - b.position.x) * 12, 0, (press.target.z - b.position.z) * 12);
      const speed = v.length();
      if (speed > MAX_THROW) v.scale(MAX_THROW / speed, v);
      b.velocity.x = v.x;
      b.velocity.z = v.z;
      b.wakeUp();
    }

    // Fade the name in/out
    if (title.alpha !== title.target) {
      const step = dt / 0.15;
      title.alpha = title.target > title.alpha ? Math.min(1, title.alpha + step) : Math.max(0, title.alpha - step);
      drawBackdrop();
    }

    let moving = false;
    for (const m of marbles.values()) if (m.body.sleepState !== CANNON.Body.SLEEPING) moving = true;
    if (moving) world.step(1 / 60, dt, 3);

    for (const m of marbles.values()) {
      // Pop-in when the page loads
      const t = Math.min(1, Math.max(0, (now - m.appearAt) / 350));
      const s = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
      if (m.group.scale.x !== s) {
        m.group.scale.setScalar(Math.max(s, 0.0001));
        invalidate();
      }
      m.group.position.copy(m.body.position);
      m.group.quaternion.copy(m.body.quaternion);
    }

    if (moving) invalidate();
    if (renderFrames > 0) {
      renderer.render(scene, camera);
      renderFrames--;
    }
  }
  requestAnimationFrame(tick);

  return {
    /** Change lighting/physics settings live (used by the studio). */
    setEnvironment(next) {
      env = { ...env, ...next };
      applyEnvironment();
    },
    /** Update a marble's look; colours and material sliders change in place, other changes rebuild it. */
    patchMarble(item) {
      const m = marbles.get(item.id);
      const prev = m?.item.marble;
      const cfg = item.marble;
      if (!m || cfg.show === false || prev.size !== cfg.size || prev.texture !== cfg.texture || prev.inner !== cfg.inner) {
        return this.updateMarble(item);
      }
      m.item = item;
      const mat = m.sphere.material;
      Object.assign(mat, { ...MATERIAL_DEFAULTS, ...(cfg.material ?? {}) });
      mat.color.set(cfg.color ?? '#ffffff');
      m.group.userData.glow.color.set(cfg.light ?? '#ff66cc');
      invalidate();
    },
    /** Replace one marble's look, keeping its place on the table (used by the studio). */
    updateMarble(item) {
      const old = marbles.get(item.id);
      const pos = old ? old.body.position.clone() : undefined;
      removeMarble(item.id);
      if (item.marble.show !== false) {
        const m = addMarble(item, pos);
        m.body.wakeUp();
      }
      resize();
    },
    /** Rearrange the marbles on the table. */
    reset() {
      for (const m of marbles.values()) {
        m.body.position.copy(freeSpot(radius(m.item), m));
        drift(m.body);
      }
    },
    /** Show a project name on the table behind the marbles (null hides it). */
    setTitle(text) {
      if (text) {
        if (text !== title.text) {
          title.text = text;
          title.layout = null;
          title.alpha = 0;
        }
        title.target = 1;
      } else title.target = 0;
      invalidate();
    },
    /** Give one marble a little push. */
    nudge(id) {
      const m = marbles.get(id);
      if (m) drift(m.body, 6);
    },
    dispose() {
      running = false;
      pmrem.dispose();
      window.removeEventListener('resize', resize);
      for (const id of [...marbles.keys()]) removeMarble(id);
      renderer.dispose();
    },
  };
}
