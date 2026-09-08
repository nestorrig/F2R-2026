import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  checker,
  uv,
  add,
  mul,
  time,
  mix,
  vec2,
  vec3,
  vec4,
  positionLocal,
  sin,
  mx_noise_float,
  mx_noise_vec3,
  pass,
  mrt,
  output,
  emissive,
  Fn,
  uniform,
  float,
  screenSize,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";

/**
 * Base
 */
// Canvas
const canvas = document.querySelector("canvas.threejs");

// Scene
const scene = new THREE.Scene();

// Loaders
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

/**
 * Sizes
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

window.addEventListener("resize", () => {
  // Update sizes
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  // Update camera
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(
  30,
  sizes.width / sizes.height,
  0.1,
  100,
);
camera.position.set(-3.156, 0.606, 2.878);
scene.add(camera);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.target.set(-0.147, 0.86, -0.098);
controls.enableDamping = true;
controls.minDistance = 1;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI / 2;
const logControls = () => {
  if (window.location.hash !== "#debug") return;

  const { x, y, z } = camera.position;
  const { x: tx, y: ty, z: tz } = controls.target;
  const round = (value) => Number(value.toFixed(3));

  console.log(`camera.position.set(${round(x)}, ${round(y)}, ${round(z)});
controls.target.set(${round(tx)}, ${round(ty)}, ${round(tz)});
controls.minDistance = ${round(controls.minDistance)};
controls.maxDistance = ${round(controls.maxDistance)};
// current orbit: distance ${round(camera.position.distanceTo(controls.target))} | polar ${round(controls.getPolarAngle())} | azimuth ${round(controls.getAzimuthalAngle())}`);
};

let controlsLogTimer;
controls.addEventListener("change", () => {
  clearTimeout(controlsLogTimer);
  controlsLogTimer = setTimeout(logControls, 100);
});
controls.addEventListener("end", logControls);

/**
 * Renderer
 */
const renderer = new THREE.WebGPURenderer({
  canvas: canvas,
  antialias: true,
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xffffff);

/**
 * Floor
 */
const floorMaterial = new THREE.MeshStandardNodeMaterial({
  transparent: true,
  color: 0xffffff,
});
{
  const geometry = new THREE.PlaneGeometry(10, 10, 10, 10);

  const fade = uv().sub(0.5).length().smoothstep(0.5, 0.1);
  floorMaterial.opacityNode = fade;

  const mesh = new THREE.Mesh(geometry, floorMaterial);
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/**
 * Model
 */
const colorWhite = uniform(new THREE.Color(0xffffff));
const colorBlue = uniform(new THREE.Color(0x004bff));

{
  const makeMaterial = ({
    color,
    roughness = 0.4,
    metalness = 0,
    colorNode,
    emissiveNode,
  }) => {
    const partMaterial = new THREE.MeshStandardNodeMaterial({
      color,
      roughness,
      metalness,
    });

    if (colorNode) {
      partMaterial.colorNode = colorNode;
    }

    if (emissiveNode) {
      partMaterial.emissiveNode = emissiveNode;
    }

    return partMaterial;
  };

  const stripeMask = uv().x.mul(18).add(time.mul(1.2)).fract().step(0.5);
  const bustoColor = mix(colorBlue, colorWhite, stripeMask);

  const headNoise = mx_noise_float(
    positionLocal.mul(6).add(vec3(0, time.mul(0.45), 0)),
  );
  const cabezaColor = mix(colorBlue, colorWhite, headNoise.step(0));

  const parchesColor = mix(
    colorBlue,
    colorWhite,
    checker(uv().mul(24).add(time.mul(-1))),
  );

  const screenUV = uv();
  const scanlines = screenUV.y
    .mul(90)
    .add(time.mul(10))
    .sin()
    .mul(0.5)
    .add(0.5);
  const roll = screenUV.y.add(time.mul(-0.4)).fract();
  const scanBar = roll.min(roll.oneMinus()).oneMinus().smoothstep(0.94, 1);
  //   const snow = mx_noise_float(
  //     vec2(screenUV.x.mul(140), screenUV.y.mul(900).add(time.mul(18))),
  //   );
  const visorMix = scanlines
    .mul(0.45)
    .add(0.01)
    .add(scanBar.mul(0.55))
    // .add(snow.mul(0.08))
    .clamp();
  const visorColor = mix(colorBlue, colorWhite, visorMix);

  const materialsByPart = {
    cabeza: makeMaterial({
      color: 0x004bff,
      roughness: 1,
      metalness: 0.05,
      colorNode: cabezaColor,
    }),
    parches: makeMaterial({
      color: 0x004bff,
      roughness: 1,
      metalness: 0.05,
      colorNode: parchesColor,
    }),
    visera: makeMaterial({
      color: 0x004bff,
      roughness: 1,
      metalness: 0.05,
      colorNode: colorBlue,
    }),
    visor: makeMaterial({
      color: 0x004bff,
      roughness: 1,
      metalness: 0.05,
      colorNode: visorColor,
      emissiveNode: visorColor.mul(1.15),
    }),
    busto: makeMaterial({
      color: 0x004bff,
      roughness: 1,
      metalness: 0.05,
      colorNode: bustoColor,
    }),
  };

  gltfLoader.load(
    "/modelo.glb",
    (gltf) => {
      const model = gltf.scene;

      model.position.y = 0;

      model.scale.setScalar(3);

      model.traverse((child) => {
        if (!child.isMesh) return;

        child.castShadow = true;
        child.receiveShadow = true;

        const partMaterial = materialsByPart[child.name];
        if (partMaterial) {
          child.material = partMaterial;
        } else {
          console.warn(`No material for part "${child.name}"`);
        }
      });

      scene.add(model);
    },
    undefined,
    (error) => {
      console.error("Failed to load ./modelo.glb", error);
    },
  );
}

/**
 * Lights
 */
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.castShadow = true;
directionalLight.position.set(-2, 1.75, 3);
directionalLight.shadow.mapSize.set(2048, 2048);
directionalLight.shadow.bias = -0.0004;
directionalLight.shadow.normalBias = 0.03;
directionalLight.shadow.radius = 5;
directionalLight.shadow.camera.top = 4;
directionalLight.shadow.camera.right = 4;
directionalLight.shadow.camera.bottom = -4;
directionalLight.shadow.camera.left = -4;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 24;
directionalLight.shadow.camera.updateProjectionMatrix();
scene.add(directionalLight);
scene.add(directionalLight.target);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

const spotLight = new THREE.SpotLight(
  0xffffff,
  28,
  14,
  0.5235987755982988,
  0.35,
  2,
);
spotLight.position.set(1.8, 5.45, 1.64);
spotLight.target.position.set(-0.147, 0.86, -0.098);
spotLight.castShadow = true;
spotLight.shadow.mapSize.set(1024, 1024);
spotLight.shadow.bias = -0.0003;
spotLight.shadow.normalBias = 0.05;
spotLight.shadow.camera.near = 0.4;
spotLight.shadow.camera.far = 16;
spotLight.shadow.radius = 8;
scene.add(spotLight);
scene.add(spotLight.target);

/**
 * Postprocessing
 */
const scenePass = pass(scene, camera);
scenePass.setMRT(
  mrt({
    output,
    emissive,
  }),
);

const bloomPass = bloom(scenePass.getTextureNode("emissive"), 6, 1, 0.8);
const bloomedColor = scenePass.getTextureNode("output").add(bloomPass);

const htRadius = uniform(8);
const htBlending = uniform(1);
const htEnabled = uniform(1);

const halftoneChannel = (channel, angle) => {
  const s = angle.sin();
  const c = angle.cos();
  const coord = uv().mul(screenSize).div(htRadius);
  const rotated = vec2(
    c.mul(coord.x).sub(s.mul(coord.y)),
    s.mul(coord.x).add(c.mul(coord.y)),
  );
  const dist = rotated.fract().sub(0.5).length();
  return channel.mul(0.72).sub(dist).div(0.07).clamp();
};

const halftoneNode = Fn(() => {
  const col = bloomedColor;
  const patterned = vec3(
    halftoneChannel(col.r, float(Math.PI / 12)),
    halftoneChannel(col.g, float((Math.PI / 12) * 2)),
    halftoneChannel(col.b, float((Math.PI / 12) * 3)),
  );
  const mixed = mix(col.rgb, patterned, htBlending);
  return htEnabled.greaterThan(0.5).select(vec4(mixed, col.a), col);
})();

const renderPipeline = new THREE.RenderPipeline(renderer);
renderPipeline.outputNode = halftoneNode;

/**
 * Debug
 */
const debug = {
  background: "#ffffff",
  floor: "#ffffff",
  shaderBlue: "#004bff",
  shaderWhite: "#ffffff",
  directionalLight: "#ffffff",
  ambientLight: "#ffffff",
  spotLight: "#ffffff",
};

const gui = new GUI();
gui.domElement.style.width = "200px";
const syncDebugUI = () => {
  if (window.location.hash === "#debug") {
    gui.show();
  } else {
    gui.hide();
  }
};
syncDebugUI();
window.addEventListener("hashchange", syncDebugUI);
gui.addColor(debug, "background").onChange((value) => {
  renderer.setClearColor(value);
});
gui.addColor(debug, "floor").onChange((value) => {
  floorMaterial.color.set(value);
});

const shaderFolder = gui.addFolder("Shader");
shaderFolder
  .addColor(debug, "shaderBlue")
  .name("blue")
  .onChange((value) => {
    colorBlue.value.set(value);
  });
shaderFolder
  .addColor(debug, "shaderWhite")
  .name("white")
  .onChange((value) => {
    colorWhite.value.set(value);
  });

const lightFolder = gui.addFolder("Light");
lightFolder
  .addColor(debug, "directionalLight")
  .name("color")
  .onChange((value) => {
    directionalLight.color.set(value);
  });
lightFolder
  .add(directionalLight.position, "x", -20, 20, 0.01)
  .name("position X");
lightFolder
  .add(directionalLight.position, "y", -20, 20, 0.01)
  .name("position Y");
lightFolder
  .add(directionalLight.position, "z", -20, 20, 0.01)
  .name("position Z");
lightFolder.add(directionalLight, "intensity", 0, 10, 0.01);

const ambientFolder = gui.addFolder("AmbientLight");
ambientFolder
  .addColor(debug, "ambientLight")
  .name("color")
  .onChange((value) => {
    ambientLight.color.set(value);
  });
ambientFolder.add(ambientLight, "intensity", 0, 4, 0.01);

const spotFolder = gui.addFolder("SpotLight");
spotFolder
  .addColor(debug, "spotLight")
  .name("color")
  .onChange((value) => {
    spotLight.color.set(value);
  });
spotFolder.add(spotLight.position, "x", -10, 10, 0.01).name("position X");
spotFolder.add(spotLight.position, "y", 0, 10, 0.01).name("position Y");
spotFolder.add(spotLight.position, "z", -10, 10, 0.01).name("position Z");
spotFolder.add(spotLight, "intensity", 0, 80, 0.1);
spotFolder.add(spotLight, "angle", 0.05, 1.2, 0.01);
spotFolder.add(spotLight, "penumbra", 0, 1, 0.01);
spotFolder.add(spotLight, "distance", 1, 30, 0.1);

const bloomFolder = gui.addFolder("Bloom");
bloomFolder.add(bloomPass.strength, "value", 0, 4, 0.01).name("strength");
bloomFolder.add(bloomPass.radius, "value", 0, 1, 0.01).name("radius");
bloomFolder.add(bloomPass.threshold, "value", 0, 1, 0.01).name("threshold");

const htDebug = { enabled: true };
const halftoneFolder = gui.addFolder("Halftone");
halftoneFolder.add(htDebug, "enabled").onChange((value) => {
  htEnabled.value = value ? 1 : 0;
});
halftoneFolder.add(htRadius, "value", 1, 16, 0.1).name("radius");
halftoneFolder.add(htBlending, "value", 0, 1, 0.01).name("blending");

/**
 * Animate
 */
const tick = () => {
  // Update controls
  controls.update();

  // Render
  renderPipeline.render();
};

renderer.setAnimationLoop(tick);
