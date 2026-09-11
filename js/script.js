import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  checker,
  uv,
  time,
  mix,
  vec2,
  vec3,
  vec4,
  positionLocal,
  mx_noise_float,
  pass,
  mrt,
  output,
  emissive,
  Fn,
  uniform,
  screenSize,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { Inspector } from "three/addons/inspector/Inspector.js";

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

class App {
  constructor() {
    this.canvas = document.querySelector("canvas.threejs");
    this.scene = new THREE.Scene();
    this.gltfLoader = new GLTFLoader();
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.mobileQuery = window.matchMedia("(max-width: 768px)");

    this.sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    this.debug = {
      blue: "#004bff",
      shaderWhite: "#ffffff",
      directionalLight: "#ffffff",
      ambientLight: "#ffffff",
      spotLight: "#ffffff",
    };

    this.renderer = null;
    this.controls = null;
    this.renderPipeline = null;
    this.floorMaterial = null;
    this.colorBlue = null;
    this.colorWhite = null;

    this.createCamera();
    this.bindEvents();
  }

  createCamera() {
    this.camera = new THREE.PerspectiveCamera(
      30,
      this.sizes.width / this.sizes.height,
      0.1,
      100,
    );
    this.camera.position.set(-3.156, 0.606, 2.878);
    this.scene.add(this.camera);

    this.lookAtTarget = new THREE.Vector3(-0.147, 0.86, -0.098);
    this.camera.lookAt(this.lookAtTarget);

    this.cameraBase = this.camera.position.clone();
    this.cameraGoal = new THREE.Vector3();
    this.cameraSpherical = new THREE.Spherical().setFromVector3(
      this.cameraBase.clone().sub(this.lookAtTarget),
    );
    this.cameraPhi = this.cameraSpherical.phi;
    this.cameraTheta = this.cameraSpherical.theta;
    this.cameraRadius = this.cameraSpherical.radius;

    this.applyCameraDistance();
    this.syncCameraMode();
  }

  bindEvents() {
    this.onResize = this.onResize.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.syncCameraMode = this.syncCameraMode.bind(this);
    this.syncDebugUI = this.syncDebugUI.bind(this);
    this.tick = this.tick.bind(this);

    window.addEventListener("resize", this.onResize);
    window.visualViewport?.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointerMove);
    this.mobileQuery.addEventListener("change", () => {
      this.syncCameraMode();
      this.syncDebugUI();
    });
  }

  getCameraRadius() {
    return this.cameraRadius * (this.mobileQuery.matches ? 1.5 : 1);
  }

  applyCameraDistance() {
    this.cameraSpherical.radius = this.getCameraRadius();
    this.camera.position.copy(
      this.cameraGoal
        .setFromSpherical(this.cameraSpherical)
        .add(this.lookAtTarget),
    );
    this.camera.lookAt(this.lookAtTarget);
  }

  syncCameraMode() {
    if (this.mobileQuery.matches) {
      if (!this.controls) {
        this.applyCameraDistance();
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = false;
        this.controls.enablePan = false;
        this.controls.target.copy(this.lookAtTarget);
        this.controls.maxPolarAngle = Math.PI / 2;
        this.controls.update();
        const azimuth = this.controls.getAzimuthalAngle();
        this.controls.minAzimuthAngle = azimuth - Math.PI / 4;
        this.controls.maxAzimuthAngle = azimuth + Math.PI / 1.5;
      }

      const radius = this.getCameraRadius();
      this.controls.minDistance = radius * 0.8;
      this.controls.maxDistance = radius * 1.5;
      this.controls.enabled = true;
      return;
    }

    if (this.controls) {
      this.controls.enabled = false;
    }
  }

  onPointerMove(event) {
    if (this.mobileQuery.matches) return;
    this.pointer.x = (event.clientX / this.sizes.width) * 2 - 1;
    this.pointer.y = -(event.clientY / this.sizes.height) * 2 + 1;
  }

  updateCameraRig(delta) {
    const lookX = THREE.MathUtils.clamp(this.pointer.x, -1, 1);
    const lookY = THREE.MathUtils.clamp(this.pointer.y, -1, 1);

    this.cameraSpherical.theta = this.cameraTheta + lookX * (Math.PI / 4);
    this.cameraSpherical.phi = THREE.MathUtils.clamp(
      this.cameraPhi - lookY * (Math.PI / 12),
      0.2,
      Math.max(this.cameraPhi, Math.PI),
    );
    this.cameraSpherical.radius = this.getCameraRadius();

    this.cameraGoal
      .setFromSpherical(this.cameraSpherical)
      .add(this.lookAtTarget);

    this.camera.position.x = THREE.MathUtils.damp(
      this.camera.position.x,
      this.cameraGoal.x,
      1,
      delta,
    );
    this.camera.position.y = THREE.MathUtils.damp(
      this.camera.position.y,
      this.cameraGoal.y,
      1,
      delta,
    );
    this.camera.position.z = THREE.MathUtils.damp(
      this.camera.position.z,
      this.cameraGoal.z,
      1,
      delta,
    );

    this.camera.lookAt(this.lookAtTarget);
  }

  onResize() {
    if (!this.renderer) return;

    this.sizes.width = window.innerWidth;
    this.sizes.height = window.innerHeight;

    this.camera.aspect = this.sizes.width / this.sizes.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.sizes.width, this.sizes.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.syncCameraMode();
  }

  createRenderer(forceWebGL = false) {
    const instance = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      forceWebGL,
    });
    instance.shadowMap.enabled = true;
    instance.shadowMap.type = THREE.PCFSoftShadowMap;
    instance.setSize(this.sizes.width, this.sizes.height);
    instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    instance.setClearColor(this.debug.blue);
    return instance;
  }

  async startRenderer(forceWebGL) {
    const instance = this.createRenderer(forceWebGL);
    await instance.init();
    return instance;
  }

  showError(msg) {
    const box = document.querySelector(".webgpu-unavailable");
    const text = box?.querySelector("p");
    if (text) text.textContent = msg;
    box?.removeAttribute("hidden");
    this.canvas.hidden = true;
  }

  async initRenderer() {
    const forceWebGL = !navigator.gpu;

    try {
      this.renderer = await this.startRenderer(forceWebGL);
    } catch (err) {
      if (forceWebGL) {
        this.showError(err?.message || "Couldn't initialize the renderer.");
        return false;
      }

      console.warn("WebGPU init failed, forcing WebGL2", err);
      try {
        this.renderer?.dispose();
      } catch {}
      this.renderer = await this.startRenderer(true);
    }

    if (
      !forceWebGL &&
      this.renderer.backend &&
      !this.renderer.backend.isWebGPUBackend
    ) {
      console.warn("WebGPU backend unavailable, forcing WebGL2");
      try {
        this.renderer.dispose();
      } catch {}
      this.renderer = await this.startRenderer(true);
    }

    if (!this.renderer.backend) {
      this.showError("Couldn't initialize the renderer.");
      this.renderer = null;
      return false;
    }

    this.renderer.inspector = new AppInspector();
    this.renderer.inspector.init();
    return true;
  }

  createFloor() {
    this.floorMaterial = new THREE.MeshStandardNodeMaterial({
      transparent: true,
      color: new THREE.Color(this.debug.blue),
    });

    const geometry = new THREE.PlaneGeometry(10, 10, 10, 10);
    const fade = uv().sub(0.5).length().smoothstep(0.5, 0.1);
    this.floorMaterial.opacityNode = fade;

    const mesh = new THREE.Mesh(geometry, this.floorMaterial);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  createModel() {
    this.colorWhite = uniform(new THREE.Color(this.debug.shaderWhite));
    this.colorBlue = uniform(new THREE.Color(this.debug.blue));

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
    const bustoColor = mix(this.colorBlue, this.colorWhite, stripeMask);

    const headNoise = mx_noise_float(
      positionLocal.mul(6).add(vec3(0, time.mul(0.45), 0)),
    );
    const cabezaColor = mix(this.colorBlue, this.colorWhite, headNoise.step(0));

    const parchesColor = mix(
      this.colorBlue,
      this.colorWhite,
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
    const visorMix = scanlines
      .mul(0.45)
      .add(0.01)
      .add(scanBar.mul(0.55))
      .clamp();
    const visorColor = mix(this.colorBlue, this.colorWhite, visorMix);

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
        colorNode: this.colorBlue,
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

    this.gltfLoader.load(
      new URL("../assets/modelo.glb", import.meta.url).href,
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

        this.scene.add(model);
      },
      undefined,
      (err) => {
        console.error("Failed to load modelo.glb", err);
      },
    );
  }

  createLights() {
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    this.directionalLight.castShadow = true;
    this.directionalLight.position.set(-2, 1.75, 3);
    this.directionalLight.shadow.mapSize.set(2048, 2048);
    this.directionalLight.shadow.bias = -0.0004;
    this.directionalLight.shadow.normalBias = 0.03;
    this.directionalLight.shadow.radius = 5;
    this.directionalLight.shadow.camera.top = 4;
    this.directionalLight.shadow.camera.right = 4;
    this.directionalLight.shadow.camera.bottom = -4;
    this.directionalLight.shadow.camera.left = -4;
    this.directionalLight.shadow.camera.near = 0.5;
    this.directionalLight.shadow.camera.far = 24;
    this.directionalLight.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.directionalLight);
    this.scene.add(this.directionalLight.target);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 1);
    this.scene.add(this.ambientLight);

    this.spotLight = new THREE.SpotLight(
      0xffffff,
      80,
      30,
      0.5235987755982988,
      1,
      2,
    );
    this.spotLight.position.set(1.8, 5.45, 1.64);
    this.spotLight.target.position.set(-0.147, 0.86, -0.098);
    this.spotLight.castShadow = true;
    this.spotLight.shadow.mapSize.set(1024, 1024);
    this.spotLight.shadow.bias = -0.0003;
    this.spotLight.shadow.normalBias = 0.05;
    this.spotLight.shadow.camera.near = 0.4;
    this.spotLight.shadow.camera.far = 16;
    this.spotLight.shadow.radius = 8;
    this.scene.add(this.spotLight);
    this.scene.add(this.spotLight.target);
  }

  createPostprocessing() {
    const scenePass = pass(this.scene, this.camera);
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
    this.bloomPass = bloom(emissivePass, 6, 1, 0.8).toInspector("Bloom");
    const bloomedColor = sceneColor.add(this.bloomPass).toInspector("Bloomed");

    this.htRadius = uniform(14);
    this.htBlending = uniform(0.7);
    this.htGain = uniform(0.72);
    this.htSoftness = uniform(0.07);
    this.htAngleR = uniform(Math.PI / 12);
    this.htAngleG = uniform((Math.PI / 12) * 2);
    this.htAngleB = uniform((Math.PI / 12) * 3);
    this.htView = uniform(0);

    const htRadius = this.htRadius;
    const htBlending = this.htBlending;
    const htGain = this.htGain;
    const htSoftness = this.htSoftness;
    const htAngleR = this.htAngleR;
    const htAngleG = this.htAngleG;
    const htAngleB = this.htAngleB;
    const htView = this.htView;

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

    this.renderPipeline = new THREE.RenderPipeline(this.renderer);
    this.renderPipeline.outputNode = halftoneNode;
  }

  syncDebugUI() {
    if (!this.renderer?.inspector) return;

    const showDebug =
      !this.mobileQuery.matches || window.location.hash === "#debug";
    this.renderer.inspector.domElement.style.display = showDebug ? "" : "none";
  }

  createDebugUI() {
    const gui = this.renderer.inspector.createParameters("Parameters");

    gui
      .addColor(this.debug, "blue")
      .name("color 1")
      .onChange((value) => {
        this.renderer.setClearColor(value);
        this.floorMaterial.color.set(value);
        this.colorBlue.value.set(value);
        document.body.style.backgroundColor = value;
        document.querySelector("main").style.backgroundColor = value;
      });

    gui
      .addColor(this.debug, "shaderWhite")
      .name("color 2")
      .onChange((value) => {
        this.colorWhite.value.set(value);
      });

    const bloomFolder = gui.addFolder("Bloom");
    bloomFolder
      .add(this.bloomPass.strength, "value", 0, 10, 0.01)
      .name("strength");
    bloomFolder.add(this.bloomPass.radius, "value", 0, 2, 0.01).name("radius");
    bloomFolder
      .add(this.bloomPass.threshold, "value", 0, 1, 0.01)
      .name("threshold");

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
    halftoneFolder
      .add(htDebug, "view", Object.keys(htViews))
      .onChange((value) => {
        this.htView.value = htViews[value];
      });
    halftoneFolder.add(this.htRadius, "value", 1, 32, 0.1).name("radius");
    halftoneFolder.add(this.htBlending, "value", 0, 1, 0.01).name("blending");
    halftoneFolder.add(this.htGain, "value", 0, 2, 0.01).name("gain");
    halftoneFolder
      .add(this.htSoftness, "value", 0.01, 0.5, 0.001)
      .name("softness");

    gui.close();

    this.syncDebugUI();
    window.addEventListener("hashchange", this.syncDebugUI);
  }

  tick() {
    if (this.mobileQuery.matches) {
      this.controls?.update();
    } else {
      this.updateCameraRig(this.clock.getDelta());
    }
    this.renderPipeline.render();
  }

  async init() {
    const ready = await this.initRenderer();
    if (!ready) return;

    this.createFloor();
    this.createModel();
    this.createLights();
    this.createPostprocessing();
    this.createDebugUI();

    await this.renderer.setAnimationLoop(this.tick);
  }
}

const app = new App();
app.init().catch((err) => {
  console.error(err);
  app.showError(err?.message || String(err));
});
