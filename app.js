import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const EXPORT_IMAGE_SIZE = { width: 960, height: 1280 };
const SCENE_BG_RGB = [7, 17, 26];
const COLOR_PALETTE_BGR = [
  [0, 0, 255],
  [0, 255, 0],
  [255, 0, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 0],
  [255, 255, 255],
  [128, 128, 255]
];

const viewport = document.getElementById("sceneViewport");
const captureCanvas = document.getElementById("cameraCaptureCanvas");

const gridColsInput = document.getElementById("gridCols");
const gridRowsInput = document.getElementById("gridRows");
const crossSizeInput = document.getElementById("crossSize");
const crossSizeValue = document.getElementById("crossSizeValue");

const distortionTypeInput = document.getElementById("distortionType");
const distortionStrengthInput = document.getElementById("distortionStrength");
const distortionStrengthValue = document.getElementById("distortionStrengthValue");

const cameraK1Input = document.getElementById("cameraK1");
const cameraK2Input = document.getElementById("cameraK2");
const cameraP1Input = document.getElementById("cameraP1");
const cameraP2Input = document.getElementById("cameraP2");
const cameraArcAngleInput = document.getElementById("cameraArcAngle");
const cameraArcAngleValue = document.getElementById("cameraArcAngleValue");
const cameraArcElevationInput = document.getElementById("cameraArcElevation");
const cameraArcElevationValue = document.getElementById("cameraArcElevationValue");
const resetCameraArcButton = document.getElementById("resetCameraArc");
const cameraK1Value = document.getElementById("cameraK1Value");
const cameraK2Value = document.getElementById("cameraK2Value");
const cameraP1Value = document.getElementById("cameraP1Value");
const cameraP2Value = document.getElementById("cameraP2Value");

const scannerK1 = document.getElementById("scannerK1");
const scannerK2 = document.getElementById("scannerK2");
const scannerP1 = document.getElementById("scannerP1");
const scannerP2 = document.getElementById("scannerP2");
const scannerK3 = document.getElementById("scannerK3");

const cameraCoeffK1 = document.getElementById("cameraCoeffK1");
const cameraCoeffK2 = document.getElementById("cameraCoeffK2");
const cameraCoeffP1 = document.getElementById("cameraCoeffP1");
const cameraCoeffP2 = document.getElementById("cameraCoeffP2");
const cameraCoeffK3 = document.getElementById("cameraCoeffK3");

const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");
const toggleButton = document.getElementById("toggleSimulation");
const resetButton = document.getElementById("resetSimulation");
const captureButton = document.getElementById("captureCamera");
const exportSceneButton = document.getElementById("exportSceneParams");
const exportScannerButton = document.getElementById("exportScannerDistortion");
const exportCameraButton = document.getElementById("exportCameraDistortion");
const statusText = document.getElementById("statusText");
const statsText = document.getElementById("statsText");
const toggleViewButton = document.getElementById("toggleView");
const viewShortcutButtons = document.querySelectorAll("[data-view-preset]");
const sectionToggleButtons = document.querySelectorAll("[data-section-toggle]");

const state = {
  gridCols: Number(gridColsInput.value),
  gridRows: Number(gridRowsInput.value),
  crossSize: Number(crossSizeInput.value),
  scannerDistortionType: distortionTypeInput.value,
  scannerDistortionStrength: Number(distortionStrengthInput.value),
  cameraDistortion: {
    k1: Number(cameraK1Input.value),
    k2: Number(cameraK2Input.value),
    p1: Number(cameraP1Input.value),
    p2: Number(cameraP2Input.value),
    k3: 0
  },
  cameraArcAngle: Number(cameraArcAngleInput.value),
  cameraArcElevation: Number(cameraArcElevationInput.value),
  speed: Number(speedSlider.value),
  running: true,
  activeView: "free",
  lastSnapshotId: null,
  points: [],
  currentIndex: 0,
  marks: []
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111a);
scene.fog = new THREE.Fog(0x07111a, 18, 34);
const tableFocus = new THREE.Vector3(0, 0.48, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);
viewport.appendChild(captureCanvas);

const distortionBufferCanvas = document.createElement("canvas");

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
camera.position.set(8.5, 7.5, 10.5);

const virtualCamera = new THREE.PerspectiveCamera(68, 1, 0.1, 100);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.2, 0);
controls.minDistance = 7;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI / 2.05;

scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x0b0d12, 0.8));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
keyLight.position.set(6, 10, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 30;
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x3fd0ff, 1.5, 20, 2);
fillLight.position.set(-6, 6, -5);
scene.add(fillLight);

const chamber = new THREE.Group();
scene.add(chamber);

const floor = new THREE.Mesh(
  new THREE.CylinderGeometry(7.6, 7.6, 0.35, 96),
  new THREE.MeshStandardMaterial({
    color: 0x3a4958,
    emissive: 0x162636,
    metalness: 0.28,
    roughness: 0.72
  })
);
floor.receiveShadow = true;
floor.position.y = -0.2;
chamber.add(floor);

const tablePreviewMaterial = new THREE.MeshStandardMaterial({
  color: 0x050607,
  roughness: 1,
  metalness: 0
});

const tableCameraMaterial = new THREE.MeshBasicMaterial({
  color: 0x050607
});

const table = new THREE.Mesh(
  new THREE.CylinderGeometry(5, 5, 0.45, 96),
  tablePreviewMaterial
);
table.receiveShadow = true;
table.castShadow = true;
table.position.y = 0.25;
chamber.add(table);

const tableRing = new THREE.Mesh(
  new THREE.TorusGeometry(5.02, 0.08, 16, 100),
  new THREE.MeshStandardMaterial({
    color: 0x2c394a,
    emissive: 0x101923,
    metalness: 0.6,
    roughness: 0.25
  })
);
tableRing.rotation.x = Math.PI / 2;
tableRing.position.y = 0.48;
chamber.add(tableRing);

const scannerGroup = new THREE.Group();
scannerGroup.position.set(0, 5.9, 0);
scene.add(scannerGroup);

const scannerBody = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 0.7, 1.5),
  new THREE.MeshStandardMaterial({
    color: 0x4ea1ff,
    emissive: 0x102746,
    metalness: 0.5,
    roughness: 0.24
  })
);
scannerBody.castShadow = true;
scannerGroup.add(scannerBody);

const scannerLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.24, 0.5, 32),
  new THREE.MeshStandardMaterial({
    color: 0x0e141a,
    emissive: 0x17293a,
    metalness: 0.4,
    roughness: 0.2
  })
);
scannerLens.rotation.z = Math.PI / 2;
scannerLens.position.set(0, -0.28, 0);
scannerGroup.add(scannerLens);

const cameraRig = new THREE.Group();
cameraRig.position.set(0, 6.15, 4.9);
scene.add(cameraRig);
const cameraRigBasePosition = cameraRig.position.clone();
const cameraRigRadius = Math.sqrt(
  (cameraRigBasePosition.x * cameraRigBasePosition.x)
  + (cameraRigBasePosition.y * cameraRigBasePosition.y)
  + (cameraRigBasePosition.z * cameraRigBasePosition.z)
);
const cameraRigBaseAzimuth = Math.atan2(cameraRigBasePosition.x, cameraRigBasePosition.z);
const cameraRigBaseElevation = Math.asin(cameraRigBasePosition.y / cameraRigRadius);

const cameraLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.2, 0.42, 24),
  new THREE.MeshStandardMaterial({
    color: 0xd8f3e9,
    emissive: 0x284f46,
    metalness: 0.7,
    roughness: 0.18
  })
);
cameraLens.rotation.x = Math.PI / 2;
cameraLens.position.set(0, 0, -0.24);
cameraRig.add(cameraLens);
scene.add(virtualCamera);

const cameraFrustum = new THREE.CameraHelper(virtualCamera);
[cameraFrustum.material].flat().forEach((material) => {
  material.transparent = true;
  material.opacity = 0.5;
});
scene.add(cameraFrustum);

const targetMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xff8a65 })
);
targetMarker.position.set(0, 0.52, 0);
scene.add(targetMarker);

const laserBeam = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xff5f6d, transparent: true, opacity: 0.96 })
);
scene.add(laserBeam);

const laserGlow = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffb3a8, transparent: true, opacity: 0.24 })
);
laserGlow.scale.setScalar(1.003);
scene.add(laserGlow);

const glow = new THREE.PointLight(0xff8469, 2.8, 3.4, 2);
glow.position.copy(targetMarker.position);
scene.add(glow);

const marksGroup = new THREE.Group();
scene.add(marksGroup);

const clock = new THREE.Clock();
let progressAccumulator = 0;

function formatValue(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function apiRequest(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return response;
  } catch (error) {
    return null;
  }
}

function getScannerCoefficients() {
  const sign = state.scannerDistortionType === "barrel" ? -1 : 1;
  const base = sign * state.scannerDistortionStrength;
  return {
    k1: base,
    k2: -0.18 * base,
    p1: 0,
    p2: 0,
    k3: 0.04 * base
  };
}

function getCameraCoefficients() {
  return { ...state.cameraDistortion };
}

function updateCoefficientDisplays() {
  const scanner = getScannerCoefficients();
  scannerK1.textContent = formatValue(scanner.k1);
  scannerK2.textContent = formatValue(scanner.k2);
  scannerP1.textContent = formatValue(scanner.p1);
  scannerP2.textContent = formatValue(scanner.p2);
  scannerK3.textContent = formatValue(scanner.k3);

  const cameraDistortion = getCameraCoefficients();
  cameraCoeffK1.textContent = formatValue(cameraDistortion.k1);
  cameraCoeffK2.textContent = formatValue(cameraDistortion.k2);
  cameraCoeffP1.textContent = formatValue(cameraDistortion.p1);
  cameraCoeffP2.textContent = formatValue(cameraDistortion.p2);
  cameraCoeffK3.textContent = formatValue(cameraDistortion.k3);
}

function applyOpenCvDistortion(point, coefficients) {
  const { x, y } = point;
  const r2 = (x * x) + (y * y);
  const radial = 1
    + (coefficients.k1 * r2)
    + (coefficients.k2 * r2 * r2)
    + (coefficients.k3 * r2 * r2 * r2);
  const xTangential = (2 * coefficients.p1 * x * y) + (coefficients.p2 * (r2 + (2 * x * x)));
  const yTangential = (coefficients.p1 * (r2 + (2 * y * y))) + (2 * coefficients.p2 * x * y);

  return {
    x: (x * radial) + xTangential,
    y: (y * radial) + yTangential
  };
}

function worldToPixel(worldPoint, exportCamera, imageSize, distortion = null) {
  const projected = worldPoint.clone().project(exportCamera);
  const normalized = { x: projected.x, y: projected.y };
  const distorted = distortion ? applyOpenCvDistortion(normalized, distortion) : normalized;

  return {
    x: ((distorted.x + 1) * 0.5) * imageSize.width,
    y: ((1 - distorted.y) * 0.5) * imageSize.height
  };
}

function getExportCamera() {
  const exportCamera = virtualCamera.clone();
  exportCamera.aspect = EXPORT_IMAGE_SIZE.width / EXPORT_IMAGE_SIZE.height;
  exportCamera.updateProjectionMatrix();
  exportCamera.position.copy(virtualCamera.position);
  exportCamera.quaternion.copy(virtualCamera.quaternion);
  exportCamera.updateMatrixWorld(true);
  return exportCamera;
}

function getSceneExportPayload() {
  const exportCamera = getExportCamera();
  const cameraDistortion = getCameraCoefficients();
  const scenePoints = state.points.map((point, index) => {
    const worldPoint = new THREE.Vector3(point.x, 0.5, point.z);
    const original = worldToPixel(worldPoint, exportCamera, EXPORT_IMAGE_SIZE, null);
    const distorted = worldToPixel(worldPoint, exportCamera, EXPORT_IMAGE_SIZE, cameraDistortion);
    const shiftVector = [distorted.x - original.x, distorted.y - original.y];

    return {
      id: index,
      color_bgr: COLOR_PALETTE_BGR[index % COLOR_PALETTE_BGR.length],
      shifted: Math.abs(shiftVector[0]) > 0.0001 || Math.abs(shiftVector[1]) > 0.0001,
      position: [distorted.x, distorted.y],
      original_position: [original.x, original.y],
      shift_vector: shiftVector
    };
  });

  let shiftedPointId = 0;
  let maxShift = -1;
  scenePoints.forEach((point) => {
    const magnitude = Math.hypot(point.shift_vector[0], point.shift_vector[1]);
    if (magnitude > maxShift) {
      maxShift = magnitude;
      shiftedPointId = point.id;
    }
  });

  return {
    image_size: EXPORT_IMAGE_SIZE,
    points: scenePoints,
    shifted_point_id: shiftedPointId
  };
}

function getGridParamsPayload() {
  const exportPayload = getSceneExportPayload();
  return {
    grid: {
      cols: state.gridCols,
      rows: state.gridRows
    },
    cross_size: state.crossSize,
    image_size: exportPayload.image_size,
    points: exportPayload.points,
    shifted_point_id: exportPayload.shifted_point_id
  };
}

function getScannerExportPayload() {
  return {
    model: "opencv-radial",
    source: "scanner-lens",
    enabled: state.scannerDistortionType !== "none",
    distortion_type: state.scannerDistortionType,
    strength: state.scannerDistortionStrength,
    coefficients: getScannerCoefficients()
  };
}

function getCameraExportPayload() {
  return {
    model: "opencv-radial-tangential",
    source: "virtual-camera",
    image_size: EXPORT_IMAGE_SIZE,
    coefficients: getCameraCoefficients()
  };
}

function getCameraPositionPayload() {
  return {
    arc_angle: state.cameraArcAngle,
    arc_elevation: state.cameraArcElevation,
    position: {
      x: cameraRig.position.x,
      y: cameraRig.position.y,
      z: cameraRig.position.z
    },
    look_at: {
      x: tableFocus.x,
      y: tableFocus.y,
      z: tableFocus.z
    }
  };
}

function syncGridParamsToApi() {
  void apiRequest("/api/grid/params", {
    method: "POST",
    body: JSON.stringify(getGridParamsPayload())
  });
}

function syncCameraParamsToApi() {
  void apiRequest("/api/camera/params", {
    method: "POST",
    body: JSON.stringify(getCameraExportPayload())
  });
}

function syncScannerParamsToApi() {
  void apiRequest("/api/scan/params", {
    method: "POST",
    body: JSON.stringify(getScannerExportPayload())
  });
}

function syncCameraPositionToApi() {
  void apiRequest("/api/camera", {
    method: "POST",
    body: JSON.stringify(getCameraPositionPayload())
  });
}

function aimVirtualCamera() {
  const azimuth = cameraRigBaseAzimuth + THREE.MathUtils.degToRad(state.cameraArcAngle);
  const elevation = cameraRigBaseElevation + THREE.MathUtils.degToRad(state.cameraArcElevation);
  const horizontalRadius = Math.cos(elevation) * cameraRigRadius;
  cameraRig.position.set(
    Math.sin(azimuth) * horizontalRadius,
    Math.sin(elevation) * cameraRigRadius,
    Math.cos(azimuth) * horizontalRadius
  );
  cameraRig.lookAt(tableFocus);
  cameraRig.rotateZ(-0.08);
  cameraRig.updateMatrixWorld(true);
  virtualCamera.position.copy(cameraLens.getWorldPosition(new THREE.Vector3()));
  virtualCamera.quaternion.copy(cameraRig.quaternion);
  virtualCamera.lookAt(tableFocus);
  virtualCamera.rotateZ(-0.08);
  virtualCamera.updateMatrixWorld(true);
  syncCameraPositionToApi();
}

function makeMark() {
  const size = state.crossSize;
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-size, 0, 0),
    new THREE.Vector3(size, 0, 0),
    new THREE.Vector3(0, 0, -size),
    new THREE.Vector3(0, 0, size)
  ]);
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xf8fbff })
  );
}

function applyScannerDistortion(x, z) {
  if (state.scannerDistortionType === "none") {
    return { x, z };
  }

  const radiusLimit = 4.45;
  const r = Math.sqrt((x * x) + (z * z));
  if (!r) {
    return { x, z };
  }

  const normalized = Math.min(r / radiusLimit, 1);
  const strength = state.scannerDistortionStrength;
  const factor = state.scannerDistortionType === "barrel"
    ? 1 - (strength * normalized * normalized)
    : 1 + (strength * normalized * normalized);
  const distortedRadius = Math.min(radiusLimit, r * factor);

  return {
    x: (x / r) * distortedRadius,
    z: (z / r) * distortedRadius
  };
}

function generatePattern() {
  const radiusLimit = 4.35;
  const cols = clamp(Math.round(state.gridCols), 4, 32);
  const rows = clamp(Math.round(state.gridRows), 4, 32);
  const points = [];
  const stepX = (radiusLimit * 2) / (cols - 1);
  const stepZ = (radiusLimit * 2) / (rows - 1);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = -radiusLimit + (col * stepX);
      const z = -radiusLimit + (row * stepZ);
      if ((x * x) + (z * z) > radiusLimit * radiusLimit) {
        continue;
      }
      const distorted = applyScannerDistortion(x, z);
      points.push(new THREE.Vector3(distorted.x, 0.5, distorted.z));
    }
  }

  points.sort((a, b) => {
    if (Math.abs(a.z - b.z) < 0.001) {
      return a.x - b.x;
    }
    return a.z - b.z;
  });

  return points;
}

function clearMarks() {
  state.marks.forEach((mark) => {
    marksGroup.remove(mark);
    mark.geometry.dispose();
    mark.material.dispose();
  });
  state.marks = [];
}

function moveTargetToCurrentPoint() {
  const fallback = new THREE.Vector3(0, 0.52, 0);
  const target = state.points[state.currentIndex] ?? fallback;
  targetMarker.position.set(target.x, 0.52, target.z);
  glow.position.copy(targetMarker.position);
}

function rebuildSimulation() {
  clearMarks();
  state.points = generatePattern();
  state.currentIndex = 0;
  progressAccumulator = 0;
  statusText.textContent = state.running ? "Симуляция выполняется" : "Симуляция на паузе";
  statsText.textContent = `Метки: 0 / ${state.points.length}`;
  moveTargetToCurrentPoint();
  syncGridParamsToApi();
}

function stampNextMark() {
  if (state.currentIndex >= state.points.length) {
    state.running = false;
    toggleButton.textContent = "Плей";
    statusText.textContent = "Моделирование завершено";
    return;
  }

  const point = state.points[state.currentIndex];
  const mark = makeMark();
  mark.position.copy(point);
  marksGroup.add(mark);
  state.marks.push(mark);
  state.currentIndex += 1;
  statsText.textContent = `Метки: ${state.marks.length} / ${state.points.length}`;
  moveTargetToCurrentPoint();
}

function updateLaser() {
  const start = scannerLens.getWorldPosition(new THREE.Vector3());
  const end = targetMarker.position.clone();
  laserBeam.geometry.setFromPoints([start, end]);
  laserGlow.geometry.setFromPoints([start, end]);
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = viewport;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  virtualCamera.aspect = clientWidth / clientHeight;
  virtualCamera.updateProjectionMatrix();
}

function restoreToggleButtonMarkup() {
  toggleViewButton.innerHTML = `
    <span class="shortcut-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M4 8h3l1.3-2h7.4L17 8h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>
    </span>
    <span>Камера</span>
  `;
}

function updateViewMode() {
  const cameraMode = state.activeView === "virtual";
  controls.enabled = !cameraMode;
  toggleViewButton.classList.toggle("active", cameraMode);
  laserBeam.visible = !cameraMode;
  laserGlow.visible = !cameraMode;
  cameraFrustum.visible = !cameraMode;
  cameraLens.visible = !cameraMode;
  targetMarker.visible = !cameraMode;
  floor.visible = !cameraMode;
  glow.visible = !cameraMode;
  table.material = cameraMode ? tableCameraMaterial : tablePreviewMaterial;
  renderer.domElement.style.display = cameraMode ? "none" : "block";
  captureCanvas.style.display = cameraMode ? "block" : "none";
  restoreToggleButtonMarkup();
}

function applyViewPreset(preset) {
  state.activeView = "free";
  updateViewMode();

  const distance = 12.5;
  const presets = {
    top: new THREE.Vector3(0, 13, 0.001),
    iso: new THREE.Vector3(8.5, 7.5, 10.5)
  };

  const position = presets[preset];
  if (!position) {
    return;
  }

  if (preset === "top") {
    camera.position.copy(position);
  } else {
    camera.position.copy(position.clone().normalize().multiplyScalar(distance));
  }
  controls.target.copy(tableFocus);
  camera.lookAt(tableFocus);
  controls.update();
}

function distortSnapshot(sourceCanvas, destinationCanvas, coefficients) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const sourceContext = sourceCanvas.getContext("2d");
  const destinationContext = destinationCanvas.getContext("2d");
  const sourceData = sourceContext.getImageData(0, 0, width, height);
  const output = destinationContext.createImageData(width, height);
  const source = sourceData.data;
  const target = output.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = ((x / width) * 2) - 1;
      const ny = 1 - ((y / height) * 2);
      const distorted = applyOpenCvDistortion({ x: nx, y: ny }, coefficients);
      const sx = Math.round(((distorted.x + 1) * 0.5) * width);
      const sy = Math.round(((1 - distorted.y) * 0.5) * height);
      const targetIndex = (y * width + x) * 4;

      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        target[targetIndex] = SCENE_BG_RGB[0];
        target[targetIndex + 1] = SCENE_BG_RGB[1];
        target[targetIndex + 2] = SCENE_BG_RGB[2];
        target[targetIndex + 3] = 255;
        continue;
      }

      const sourceIndex = (sy * width + sx) * 4;
      target[targetIndex] = source[sourceIndex];
      target[targetIndex + 1] = source[sourceIndex + 1];
      target[targetIndex + 2] = source[sourceIndex + 2];
      target[targetIndex + 3] = 255;
    }
  }

  destinationContext.putImageData(output, 0, 0);
}

function renderDistortedCameraView() {
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  if (!width || !height) {
    return;
  }

  distortionBufferCanvas.width = width;
  distortionBufferCanvas.height = height;
  captureCanvas.width = width;
  captureCanvas.height = height;

  const bufferContext = distortionBufferCanvas.getContext("2d");
  bufferContext.clearRect(0, 0, width, height);
  bufferContext.drawImage(renderer.domElement, 0, 0, width, height);
  distortSnapshot(distortionBufferCanvas, captureCanvas, getCameraCoefficients());
}

function saveCameraSnapshot() {
  const previousView = state.activeView;
  state.activeView = "virtual";
  updateViewMode();
  renderer.render(scene, virtualCamera);
  renderDistortedCameraView();

  state.activeView = previousView;
  updateViewMode();
  renderer.render(scene, state.activeView === "virtual" ? virtualCamera : camera);

  const link = document.createElement("a");
  link.download = `slm-camera-${Date.now()}.png`;
  link.href = captureCanvas.toDataURL("image/png");
  link.click();
  void apiRequest("/api/snapshot", {
    method: "POST",
    body: JSON.stringify({ image_base64: link.href })
  }).then((result) => {
    if (result?.id) {
      state.lastSnapshotId = result.id;
    }
  });
}

function syncUiValues() {
  cameraArcAngleValue.textContent = `${Math.round(state.cameraArcAngle)}°`;
  cameraArcElevationValue.textContent = `${Math.round(state.cameraArcElevation)}°`;
  crossSizeValue.textContent = formatValue(state.crossSize, 2);
  distortionStrengthValue.textContent = formatValue(state.scannerDistortionStrength, 2);
  speedValue.textContent = `${state.speed.toFixed(2)}x`;
  cameraK1Value.textContent = formatValue(state.cameraDistortion.k1, 2);
  cameraK2Value.textContent = formatValue(state.cameraDistortion.k2, 2);
  cameraP1Value.textContent = formatValue(state.cameraDistortion.p1, 3);
  cameraP2Value.textContent = formatValue(state.cameraDistortion.p2, 3);
  updateCoefficientDisplays();
}

gridColsInput.addEventListener("change", () => {
  state.gridCols = Number(gridColsInput.value);
  state.running = true;
  toggleButton.textContent = "Пауза";
  rebuildSimulation();
});

gridRowsInput.addEventListener("change", () => {
  state.gridRows = Number(gridRowsInput.value);
  state.running = true;
  toggleButton.textContent = "Пауза";
  rebuildSimulation();
});

crossSizeInput.addEventListener("input", () => {
  state.crossSize = Number(crossSizeInput.value);
  syncUiValues();
  rebuildSimulation();
});

distortionTypeInput.addEventListener("change", () => {
  state.scannerDistortionType = distortionTypeInput.value;
  syncUiValues();
  syncScannerParamsToApi();
  rebuildSimulation();
});

distortionStrengthInput.addEventListener("input", () => {
  state.scannerDistortionStrength = Number(distortionStrengthInput.value);
  syncUiValues();
  syncScannerParamsToApi();
  rebuildSimulation();
});

cameraK1Input.addEventListener("input", () => {
  state.cameraDistortion.k1 = Number(cameraK1Input.value);
  syncUiValues();
  syncCameraParamsToApi();
});

cameraK2Input.addEventListener("input", () => {
  state.cameraDistortion.k2 = Number(cameraK2Input.value);
  syncUiValues();
  syncCameraParamsToApi();
});

cameraP1Input.addEventListener("input", () => {
  state.cameraDistortion.p1 = Number(cameraP1Input.value);
  syncUiValues();
  syncCameraParamsToApi();
});

cameraP2Input.addEventListener("input", () => {
  state.cameraDistortion.p2 = Number(cameraP2Input.value);
  syncUiValues();
  syncCameraParamsToApi();
});

cameraArcAngleInput.addEventListener("input", () => {
  state.cameraArcAngle = Number(cameraArcAngleInput.value);
  syncUiValues();
  aimVirtualCamera();
  if (state.activeView === "virtual") {
    renderer.render(scene, virtualCamera);
    renderDistortedCameraView();
  }
});

cameraArcElevationInput.addEventListener("input", () => {
  state.cameraArcElevation = Number(cameraArcElevationInput.value);
  syncUiValues();
  aimVirtualCamera();
  if (state.activeView === "virtual") {
    renderer.render(scene, virtualCamera);
    renderDistortedCameraView();
  }
});

resetCameraArcButton.addEventListener("click", () => {
  state.cameraArcAngle = 0;
  state.cameraArcElevation = 0;
  cameraArcAngleInput.value = "0";
  cameraArcElevationInput.value = "0";
  syncUiValues();
  aimVirtualCamera();
  if (state.activeView === "virtual") {
    renderer.render(scene, virtualCamera);
    renderDistortedCameraView();
  }
});

speedSlider.addEventListener("input", () => {
  state.speed = Number(speedSlider.value);
  syncUiValues();
  void apiRequest(`/api/speed?value=${encodeURIComponent(String(state.speed))}`);
});

toggleButton.addEventListener("click", () => {
  state.running = !state.running;
  toggleButton.textContent = state.running ? "Пауза" : "Плей";
  statusText.textContent = state.running ? "Симуляция выполняется" : "Симуляция на паузе";
  void apiRequest(state.running ? "/api/run" : "/api/pause");
});

resetButton.addEventListener("click", () => {
  state.running = true;
  toggleButton.textContent = "Пауза";
  rebuildSimulation();
  void apiRequest("/api/reset");
  void apiRequest("/api/run");
});

toggleViewButton.addEventListener("click", () => {
  state.activeView = state.activeView === "free" ? "virtual" : "free";
  updateViewMode();
});

viewShortcutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyViewPreset(button.dataset.viewPreset);
  });
});

captureButton.addEventListener("click", saveCameraSnapshot);
exportSceneButton.addEventListener("click", () => {
  downloadJson("scene-parameters.json", getSceneExportPayload());
});
exportScannerButton.addEventListener("click", () => {
  downloadJson("scanner-distortion.json", getScannerExportPayload());
});
exportCameraButton.addEventListener("click", () => {
  downloadJson("camera-distortion.json", getCameraExportPayload());
});

window.addEventListener("resize", resizeRenderer);

sectionToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const section = button.closest("[data-collapsible]");
    const collapsed = section.classList.toggle("is-collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
  });
});

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  controls.update();

  if (state.running && state.currentIndex < state.points.length) {
    progressAccumulator += delta * state.speed * 8;
    while (progressAccumulator >= 1) {
      stampNextMark();
      progressAccumulator -= 1;
      if (!state.running) {
        break;
      }
    }
  }

  updateLaser();
  cameraFrustum.update();
  const activeCamera = state.activeView === "virtual" ? virtualCamera : camera;
  renderer.render(scene, activeCamera);
  if (state.activeView === "virtual") {
    renderDistortedCameraView();
  }
}

resizeRenderer();
aimVirtualCamera();
syncUiValues();
restoreToggleButtonMarkup();
rebuildSimulation();
updateViewMode();
syncScannerParamsToApi();
syncCameraParamsToApi();
syncGridParamsToApi();
void apiRequest(`/api/speed?value=${encodeURIComponent(String(state.speed))}`);
animate();
