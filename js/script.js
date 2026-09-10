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
import { Inspector } from "three/addons/inspector/Inspector.js";

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

window.addEventListener("resize", onResize);
window.visualViewport?.addEventListener("resize", onResize);

function onResize() {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  syncCameraMode();
}

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

const lookAtTarget = new THREE.Vector3(-0.147, 0.86, -0.098);
camera.lookAt(lookAtTarget);

const cameraBase = camera.position.clone();
const cameraGoal = new THREE.Vector3();
const cameraSpherical = new THREE.Spherical().setFromVector3(
  cameraBase.clone().sub(lookAtTarget),
);
const cameraPhi = cameraSpherical.phi;
const cameraTheta = cameraSpherical.theta;
const cameraRadius = cameraSpherical.radius;
const mobileQuery = window.matchMedia("(max-width: 768px)");
const getCameraRadius = () => cameraRadius * (mobileQuery.matches ? 1.5 : 1);

let controls = null;

const applyCameraDistance = () => {
  cameraSpherical.radius = getCameraRadius();
  camera.position.copy(
    cameraGoal.setFromSpherical(cameraSpherical).add(lookAtTarget),
  );
  camera.lookAt(lookAtTarget);
};

const syncCameraMode = () => {
  if (mobileQuery.matches) {
    if (!controls) {
      applyCameraDistance();
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = false;
      controls.enablePan = false;
      controls.target.copy(lookAtTarget);
      controls.maxPolarAngle = Math.PI / 2;
      controls.update();
      const azimuth = controls.getAzimuthalAngle();
      controls.minAzimuthAngle = azimuth - Math.PI / 4;
      controls.maxAzimuthAngle = azimuth + Math.PI / 1.5;
    }

    const radius = getCameraRadius();
    controls.minDistance = radius * 0.8;
    controls.maxDistance = radius * 1.5;
    controls.enabled = true;
    return;
  }

  if (controls) {
    controls.enabled = false;
  }
};

applyCameraDistance();
syncCameraMode();
mobileQuery.addEventListener("change", syncCameraMode);

const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

window.addEventListener("pointermove", (event) => {
  if (mobileQuery.matches) return;
  pointer.x = (event.clientX / sizes.width) * 2 - 1;
  pointer.y = -(event.clientY / sizes.height) * 2 + 1;
});

const updateCameraRig = (delta) => {
  const lookX = THREE.MathUtils.clamp(pointer.x, -1, 1);
  const lookY = THREE.MathUtils.clamp(pointer.y, -1, 1);

  cameraSpherical.theta = cameraTheta + lookX * (Math.PI / 4);
  cameraSpherical.phi = THREE.MathUtils.clamp(
    cameraPhi - lookY * (Math.PI / 12),
    0.2,
    Math.max(cameraPhi, Math.PI / 1),
  );
  cameraSpherical.radius = getCameraRadius();

  cameraGoal.setFromSpherical(cameraSpherical).add(lookAtTarget);

  camera.position.x = THREE.MathUtils.damp(
    camera.position.x,
    cameraGoal.x,
    1,
    delta,
  );
  camera.position.y = THREE.MathUtils.damp(
    camera.position.y,
    cameraGoal.y,
    1,
    delta,
  );
  camera.position.z = THREE.MathUtils.damp(
    camera.position.z,
    cameraGoal.z,
    1,
    delta,
  );

  camera.lookAt(lookAtTarget);
};

const debug = {
  background: "#004bff",
  floor: "#004bff",
  shaderBlue: "#004bff",
  shaderWhite: "#ffffff",
  directionalLight: "#ffffff",
  ambientLight: "#ffffff",
  spotLight: "#ffffff",
};

/**
 * Renderer
 */
class AppInspector extends Inspector {
  resolveConsole(type, message, stackTrace = null) {
    if (
      type === "error" &&
      String(message).includes("Timestamp Queries not available")
    ) {
      return;
    }

    super.resolveConsole(type, message, stackTrace);
  }
}

const createRenderer = (forceWebGL) => {
  const instance = new THREE.WebGPURenderer({
    canvas: canvas,
    antialias: true,
    alpha: false,
    forceWebGL,
  });
  instance.shadowMap.enabled = true;
  instance.shadowMap.type = THREE.PCFSoftShadowMap;
  instance.setSize(sizes.width, sizes.height);
  instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  instance.setClearColor(0x004bff);
  return instance;
};

const initRenderer = async (instance, ms = 4000) => {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Renderer init timed out")), ms);
  });
  await Promise.race([instance.init(), timeout]);

  if (!instance.backend) {
    throw new Error("Renderer backend missing");
  }
};

let renderer = createRenderer(!navigator.gpu);

try {
  await initRenderer(renderer);
} catch (error) {
  console.warn("WebGPU init failed, falling back to WebGL2", error);
  try {
    renderer.dispose();
  } catch {}
  renderer = createRenderer(true);
  await renderer.init();
}

renderer.inspector = new AppInspector();
renderer.inspector.init();

const syncDebugUI = () => {
  renderer.inspector.domElement.style.display =
    window.location.hash === "#debug" ? "" : "none";
};
syncDebugUI();
window.addEventListener("hashchange", syncDebugUI);

/**
 * Floor
 */
const floorMaterial = new THREE.MeshStandardNodeMaterial({
  transparent: true,
  color: new THREE.Color(debug.floor),
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
    new URL("../assets/modelo.glb", import.meta.url).href,
    (gltf) => {
      console.log(gltf);

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
      console.error("Failed to load modelo.glb", error);
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
  80,
  30,
  0.5235987755982988,
  1,
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

const sceneColor = scenePass.getTextureNode("output").toInspector("Color");
const emissivePass = scenePass
  .getTextureNode("emissive")
  .toInspector("Emissive");
const bloomPass = bloom(emissivePass, 6, 1, 0.8).toInspector("Bloom");
const bloomedColor = sceneColor.add(bloomPass).toInspector("Bloomed");

const htRadius = uniform(14);
const htBlending = uniform(0.7);
const htGain = uniform(0.72);
const htSoftness = uniform(0.07);
const htAngleR = uniform(Math.PI / 12);
const htAngleG = uniform((Math.PI / 12) * 2);
const htAngleB = uniform((Math.PI / 12) * 3);
const htView = uniform(0);

const halftoneChannel = (channel, angle) => {
  const s = angle.sin();
  const c = angle.cos();
  const coord = uv().mul(screenSize).div(htRadius);
  const rotated = vec2(
    c.mul(coord.x).sub(s.mul(coord.y)),
    s.mul(coord.x).add(c.mul(coord.y)),
  );
  const dist = rotated.fract().sub(0.5).length();
  return channel.mul(htGain).sub(dist).div(htSoftness).clamp();
};

const halftoneNode = Fn(() => {
  const col = bloomedColor;
  const r = halftoneChannel(col.r, htAngleR).toVar("htR");
  const g = halftoneChannel(col.g, htAngleG).toVar("htG");
  const b = halftoneChannel(col.b, htAngleB).toVar("htB");
  const patterned = vec3(r, g, b).toVar("htPatterned");
  const mixed = mix(col.rgb, patterned, htBlending).toVar("htMixed");

  const outAlpha = sceneColor.a;
  const mixedOut = vec4(mixed, outAlpha);
  const patternedOut = vec4(patterned, outAlpha);
  const rOut = vec4(vec3(r), outAlpha);
  const gOut = vec4(vec3(g), outAlpha);
  const bOut = vec4(vec3(b), outAlpha);

  return htView
    .equal(1)
    .select(
      col,
      htView
        .equal(2)
        .select(
          patternedOut,
          htView
            .equal(3)
            .select(
              rOut,
              htView
                .equal(4)
                .select(gOut, htView.equal(5).select(bOut, mixedOut)),
            ),
        ),
    );
})().toInspector("Halftone");

const renderPipeline = new THREE.RenderPipeline(renderer);
renderPipeline.outputNode = halftoneNode;

/**
 * Debug
 */

const gui = renderer.inspector.createParameters("Parameters");

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

const htViews = {
  mixed: 0,
  original: 1,
  patterned: 2,
  R: 3,
  G: 4,
  B: 5,
};
const htDebug = { view: "mixed" };
const halftoneFolder = gui.addFolder("Halftone");
halftoneFolder.add(htDebug, "view", Object.keys(htViews)).onChange((value) => {
  htView.value = htViews[value];
});
halftoneFolder.add(htRadius, "value", 1, 32, 0.1).name("radius");
halftoneFolder.add(htBlending, "value", 0, 1, 0.01).name("blending");
halftoneFolder.add(htGain, "value", 0, 2, 0.01).name("gain");
halftoneFolder.add(htSoftness, "value", 0.01, 0.5, 0.001).name("softness");
halftoneFolder.add(htAngleR, "value", 0, Math.PI, 0.01).name("angle R");
halftoneFolder.add(htAngleG, "value", 0, Math.PI, 0.01).name("angle G");
halftoneFolder.add(htAngleB, "value", 0, Math.PI, 0.01).name("angle B");

/**
 * Animate
 */
const tick = () => {
  if (mobileQuery.matches) {
    controls?.update();
  } else {
    updateCameraRig(clock.getDelta());
  }
  renderPipeline.render();
};

await renderer.setAnimationLoop(tick);
