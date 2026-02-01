import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DragStateManager } from './utils/DragStateManager.js';
import { downloadExampleScenesFolder, getPosition, getQuaternion, toMujocoPos, reloadScene, reloadPolicy, reloadPolicyForRobot } from './mujocoUtils.js';
import { generateMultiRobotXML } from './multiRobotGenerator.js';

const defaultPolicy = "./examples/checkpoints/g1/tracking_policy_amass.json";

function applyDeadzone(x, deadzone = 0.12) {
  const ax = Math.abs(x);
  if (ax <= deadzone) return 0.0;
  const scaled = (ax - deadzone) / (1.0 - deadzone);
  return Math.sign(x) * scaled;
}

// Match Python scale_values function: linear mapping from [-1, 1] to [min, max]
function scaleValues(values, targetRanges) {
  const scaled = [];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (!Number.isFinite(val)) {
      scaled.push(0.0);
      continue;
    }
    const [newMin, newMax] = targetRanges[i];
    // Linear mapping: (val + 1) * (newMax - newMin) / 2 + newMin
    // Examples: -1 -> newMin, 0 -> (newMin+newMax)/2, 1 -> newMax
    const scaledVal = (val + 1) * (newMax - newMin) / 2 + newMin;
    scaled.push(scaledVal);
  }
  return scaled;
}

// Keep scaleBipolar for backward compatibility (if needed elsewhere)
function scaleBipolar(u, min, max) {
  // Map joystick u in [-1, 1] to an asymmetric range, keeping 0 -> 0.
  // For example: min=-0.4, max=0.7
  if (!Number.isFinite(u)) return 0.0;
  if (u >= 0) return u * max;
  const negMax = Number.isFinite(min) ? -min : 0.0;
  return u * negMax;
}

export class MuJoCoDemo {
  constructor(mujoco) {
    this.mujoco = mujoco;
    mujoco.FS.mkdir('/working');
    mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');

    this.params = {
      paused: true,
      current_motion: 'default'
    };
    this.policyRunner = null; // 保持向后兼容（单机器人模式）
    this.policyRunners = []; // 多机器人模式 (v7.0.4)
    this.kpPolicy = null;
    this.kdPolicy = null;
    this.robotPolicyParams = []; // v7.2.2: 每个机器人的PD参数/策略信息
    this.actionTarget = null;
    this.model = null;
    this.data = null;
    this.simulation = null;
    this.currentPolicyPath = defaultPolicy;

    this.bodies = {};
    this.lights = {};

    this.container = document.getElementById('mujoco-container');

    this.scene = new THREE.Scene();
    this.scene.name = 'scene';

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.001, 100);
    this.camera.name = 'PerspectiveCamera';
    // 足球场视角 - 聚焦在机器人上，可以看到更大的场地
    // 相机位置：从右前方斜上方看向机器人（确保机器人居中）
    // Three.js坐标系统：X右，Y上，Z前
    // 机器人位置：Three.js(0, 0.8, 0)
    // 相机位置：从(4, 3, 5)看向(0, 0.8, 0)，确保机器人居中
    this.camera.position.set(4.0, 3.0, 5.0);
    this.scene.add(this.camera);

    // 足球场背景 - 天空蓝色
    this.scene.background = new THREE.Color(0.5, 0.7, 1.0);
    this.scene.fog = null;

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    this.ambientLight.name = 'AmbientLight';
    this.scene.add(this.ambientLight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderScale = 2.0;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.simStepHz = 0;
    this._stepFrameCount = 0;
    this._stepLastTime = performance.now();
    this._lastRenderTime = 0;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // 聚焦在机器人上（机器人初始位置MuJoCo: 0, 0, 0.8 -> Three.js: 0, 0.8, 0）
    // getPosition转换：MuJoCo(x,y,z) -> Three.js(x, z, -y)
    // 所以MuJoCo(0, 0, 0.8) -> Three.js(0, 0.8, 0)
    // 注意：必须确保target设置在机器人位置，不是球门位置
    // 初始target：机器人pelvis位置（MuJoCo: 0,0,0.8 -> Three.js: 0,0.8,0）
    // 注意：球门在X=-20和X=20，机器人应该在X=0，所以target应该是(0, 0.8, 0)
    this.controls.target.set(0, 0.8, 0);
    this.controls.panSpeed = 2;
    this.controls.zoomSpeed = 1;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.10;
    this.controls.screenSpacePanning = true;
    // 强制更新，确保target设置生效
    this.controls.update();

    window.addEventListener('resize', this.onWindowResize.bind(this));

    // WASD键盘控制相机移动
    this.keys = {};
    this.cameraSpeed = 0.5; // 移动速度
    
    // 创建绑定到this的处理函数
    this._handleKeyDown = (e) => {
      // 防止在输入框中触发
      const target = e.target || e.srcElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        // v8.0.7: 如果启用了跟随，用户按下任意控制键就自动解除跟随
        // 这样用户可以立刻用 WASDQE 手动控制视角，而不需要额外开关
        if (this.followEnabled) {
          this.setFollowEnabled(false);
        }
        this.keys[key] = true;
        // 调试日志
        if (key === 'w') {
          console.log('W键按下，keys:', this.keys);
        }
      }
    };
    
    this._handleKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
        this.keys[key] = false;
      }
    };
    
    // 在容器上监听，确保焦点在画布上
    if (this.container) {
      this.container.setAttribute('tabindex', '0');
      this.container.style.outline = 'none';
      this.container.addEventListener('keydown', this._handleKeyDown);
      this.container.addEventListener('keyup', this._handleKeyUp);
      // 点击容器时聚焦，确保可以接收键盘事件
      this.container.addEventListener('click', () => {
        this.container.focus();
        console.log('画布已聚焦，可以按WASD');
      });
      // 鼠标进入时也聚焦
      this.container.addEventListener('mouseenter', () => {
        this.container.focus();
      });
    }
    
    // 也监听document事件作为备用（使用capture模式）
    document.addEventListener('keydown', this._handleKeyDown, true);
    document.addEventListener('keyup', this._handleKeyUp, true);

    this.dragStateManager = new DragStateManager(this.scene, this.renderer, this.camera, this.container.parentElement, this.controls);

    // 跟踪鼠标是否正在拖动（用于判断是否应该让OrbitControls控制相机）
    this._isMouseDragging = false;
    this._mouseDownHandler = () => {
      this._isMouseDragging = true;
    };
    this._mouseUpHandler = () => {
      this._isMouseDragging = false;
    };
    // 跟踪鼠标滚轮是否正在使用（用于判断是否应该让OrbitControls控制相机缩放）
    this._isWheeling = false;
    this._wheelTimeout = null;
    this._wheelHandler = () => {
      this._isWheeling = true;
      // 清除之前的超时
      if (this._wheelTimeout) {
        clearTimeout(this._wheelTimeout);
      }
      // 200ms后重置滚轮状态
      this._wheelTimeout = setTimeout(() => {
        this._isWheeling = false;
      }, 200);
    };
    // 监听鼠标事件
    if (this.renderer.domElement) {
      this.renderer.domElement.addEventListener('mousedown', this._mouseDownHandler);
      this.renderer.domElement.addEventListener('mouseup', this._mouseUpHandler);
      this.renderer.domElement.addEventListener('mouseleave', this._mouseUpHandler); // 鼠标离开画布时也停止拖动
      this.renderer.domElement.addEventListener('wheel', this._wheelHandler, { passive: true }); // 监听滚轮事件
    }

    this.followEnabled = false;
    this.followHeight = 0.75;
    this.followLerp = 0.05;
    this.followTarget = new THREE.Vector3();
    this.followTargetDesired = new THREE.Vector3();
    this.followDelta = new THREE.Vector3();
    this.followOffset = new THREE.Vector3();
    this.followInitialized = false;
    this.followBodyId = null;
    this.followDistance = this.camera.position.distanceTo(this.controls.target);

    this.cmd = new Float32Array([0.0, 0.0, 0.0]); // [vx, vy, wz]
    this.cmdScale = new Float32Array([1.0, 1.0, 1.0]); // cmd_scale from policy config
    this.gamepadState = {
      connected: false,
      index: null,
      id: '',
      axes: [],
      buttons: [],
      cmd: [0.0, 0.0, 0.0]
    };

    this.lastSimState = {
      bodies: new Map(),
      lights: new Map(),
      tendons: {
        numWraps: 0,
        matrix: new THREE.Matrix4()
      }
    };

    this.renderer.setAnimationLoop(this.render.bind(this));

    this.reloadScene = reloadScene.bind(this);
    this.reloadPolicy = reloadPolicy.bind(this);
    this.reloadPolicyForRobot = reloadPolicyForRobot.bind(this);
    
    // 多机器人配置 (v6.1.3)
    this.robotConfigs = []; // 机器人配置数组，包含每个机器人的位置信息 {x, y, z}
    this.robotPelvisBodyIds = []; // 存储每个机器人的pelvis body ID，用于快速定位和聚焦
    this.followRobotIndex = 0; // 当前跟随/聚焦的机器人索引（0-based，默认第一个）
    // 多机器人关节映射 (v7.0.0)
    this.robotJointMappings = []; // 每个机器人的关节映射数组
  }
  
  /**
   * 生成多机器人场景 (v6.1.3)
   * 根据机器人配置动态生成包含多个机器人的MuJoCo XML场景
   * @param {Array<{x: number, y: number, z: number}>} robotConfigs - 机器人配置数组，每个元素包含机器人的初始位置
   * @throws {Error} 如果配置为空或机器人数量超过10个
   */
  async generateMultiRobotScene(robotConfigs) {
    if (!robotConfigs || robotConfigs.length === 0) {
      throw new Error('Robot configs cannot be empty');
    }
    
    if (robotConfigs.length > 11) {
      throw new Error('Maximum 11 robots allowed');
    }
    
    this.robotConfigs = robotConfigs;
    
    // 生成多机器人XML
    const baseXmlPath = './examples/scenes/g1/g1.xml';
    const generatedXml = await generateMultiRobotXML(baseXmlPath, robotConfigs);
    
    // 将生成的XML写入MuJoCo文件系统
    const targetPath = '/working/g1/g1.xml';
    this.mujoco.FS.writeFile(targetPath, generatedXml);
    
    console.log(`Generated multi-robot scene with ${robotConfigs.length} robots`);
  }
  
  /**
   * 为多个机器人设置初始位置 (v6.1.3)
   * 在场景加载后调用，为每个机器人的freejoint设置初始qpos（位置和姿态）
   * 同时记录每个机器人的pelvis body ID，用于后续的聚焦和跟随功能
   */
  setMultiRobotInitialPositions() {
    if (!this.robotConfigs || this.robotConfigs.length <= 1) {
      return; // 单个机器人不需要设置
    }
    
    if (!this.model || !this.data || !this.simulation) {
      console.warn('Cannot set robot positions: model/data not loaded');
      return;
    }
    
    const textDecoder = new TextDecoder();
    const namesArray = new Uint8Array(this.model.names);
    const qpos = this.simulation.qpos;
    
    // 为每个机器人设置初始位置，并记录pelvis body ID
    this.robotPelvisBodyIds = []; // 重置数组
    this.robotConfigs.forEach((config, index) => {
      const robotPrefix = index === 0 ? 'pelvis' : `robot${index + 1}_pelvis`;
      
      // 查找pelvis body的ID
      let pelvisBodyId = -1;
      for (let b = 0; b < this.model.nbody; b++) {
        let start_idx = this.model.name_bodyadr[b];
        let end_idx = start_idx;
        while (end_idx < namesArray.length && namesArray[end_idx] !== 0) {
          end_idx++;
        }
        let name_buffer = namesArray.subarray(start_idx, end_idx);
        const bodyName = textDecoder.decode(name_buffer);
        
        if (bodyName === robotPrefix) {
          pelvisBodyId = b;
          break;
        }
      }
      
      // 记录pelvis body ID
      if (pelvisBodyId >= 0) {
        this.robotPelvisBodyIds[index] = pelvisBodyId;
      }
      
      if (pelvisBodyId < 0) {
        console.warn(`Could not find body "${robotPrefix}" for robot ${index + 1}`);
        return;
      }
      
      // 查找对应的freejoint (v7.0.5: 不检查类型，直接使用pelvis body的第一个joint)
      // freejoint的body ID应该等于pelvis body ID
      for (let j = 0; j < this.model.njnt; j++) {
        if (this.model.jnt_bodyid[j] === pelvisBodyId) {
          const qposAdr = this.model.jnt_qposadr[j];
          if (qposAdr >= 0 && qposAdr + 6 < qpos.length) {
            // 设置位置 (x, y, z)
            qpos[qposAdr + 0] = config.x;
            qpos[qposAdr + 1] = config.y;
            qpos[qposAdr + 2] = config.z;
            // 设置四元数 (w, x, y, z) - 默认直立姿态
            qpos[qposAdr + 3] = 1.0; // w
            qpos[qposAdr + 4] = 0.0; // x
            qpos[qposAdr + 5] = 0.0; // y
            qpos[qposAdr + 6] = 0.0; // z
            
            console.log(`Set robot ${index + 1} (${robotPrefix}) initial position: (${config.x}, ${config.y}, ${config.z})`);
            break;
          }
        }
      }
    });
    
    // 更新物理状态
    this.simulation.forward();
  }

  async init() {
    await downloadExampleScenesFolder(this.mujoco);
    await this.reloadScene('g1/g1.xml');
    this.updateFollowBodyId();
    await this.reloadPolicy(defaultPolicy);
    this.alive = true;
  }

  async reload(mjcf_path) {
    await this.reloadScene(mjcf_path);
    this.updateFollowBodyId();
    this.timestep = this.model.opt.timestep;
    this.decimation = Math.max(1, Math.round(0.02 / this.timestep));

    console.log('timestep:', this.timestep, 'decimation:', this.decimation);

    await this.reloadPolicy(this.currentPolicyPath ?? defaultPolicy);
    this.alive = true;
  }

  setFollowEnabled(enabled) {
    this.followEnabled = Boolean(enabled);
    this.followInitialized = false;
    if (this.followEnabled) {
      // 聚焦开启时：全部由鼠标控制（旋转、平移、缩放）
      // 键盘不控制任何东西
      this.controls.enableRotate = true;
      this.controls.enablePan = true;
      this.controls.enableZoom = true; // 鼠标滚轮缩放
      
      // 计算相机相对于target的偏移
      this.followOffset.subVectors(this.camera.position, this.controls.target);
      if (this.followOffset.lengthSq() === 0) {
        this.followOffset.set(0, 0, 1);
      }
      this.followOffset.setLength(this.followDistance);
      // 保存用户手动调整的偏移（鼠标移动后）
      this._userFollowOffset = this.followOffset.clone();
      this.camera.position.copy(this.controls.target).add(this.followOffset);
      this.controls.update();
    } else {
      // 聚焦关闭时：鼠标和键盘都可以控制
      // 鼠标：旋转、缩放
      // 键盘：WASDQE控制target和相机位置
      this.controls.enableRotate = true; // 鼠标拖动旋转
      this.controls.enablePan = false; // 禁用鼠标平移（避免冲突）
      this.controls.enableZoom = true; // 鼠标滚轮缩放
    }
  }

  /**
   * 更新跟随的body ID (v6.1.0)
   * 根据当前选择的机器人索引，查找对应的pelvis body ID
   * 优先使用多机器人模式下的指定索引，否则回退到单机器人模式
   */
  updateFollowBodyId() {
    // 多机器人模式：优先使用指定的机器人索引
    if (this.robotPelvisBodyIds && this.robotPelvisBodyIds.length > 0) {
      const robotIndex = this.followRobotIndex || 0;
      if (robotIndex >= 0 && robotIndex < this.robotPelvisBodyIds.length) {
        const bodyId = this.robotPelvisBodyIds[robotIndex];
        if (Number.isInteger(bodyId) && bodyId >= 0) {
          this.followBodyId = bodyId;
          return;
        }
      }
    }
    
    // 方法1：使用pelvis_body_id
    if (Number.isInteger(this.pelvis_body_id)) {
      this.followBodyId = this.pelvis_body_id;
      return;
    }
    
    // 方法2：通过name查找pelvis body ID
    if (this.bodies) {
      for (const bodyId in this.bodies) {
        const body = this.bodies[bodyId];
        if (body && body.name === 'pelvis') {
          this.followBodyId = parseInt(bodyId);
          return;
        }
      }
    }
    
    // 方法3：查找pelvis body（通过检查body名称或位置，移除位置限制）
    // 注意：不再限制位置范围，因为机器人可能在任何位置
    if (this.model && this.lastSimState && this.bodies) {
      for (let testId = 1; testId < this.model.nbody; testId++) {
        const body = this.bodies[testId];
        if (body && body.name && body.name.includes('pelvis')) {
          this.followBodyId = testId;
          return;
        }
      }
    }
    
    // 方法4：如果都找不到，使用body ID 1（但可能不是pelvis）
    if (this.model && this.model.nbody > 1) {
      this.followBodyId = 1;
    }
  }
  
  // v6.1.0: 聚焦到指定机器人
  focusOnRobot(robotIndex = 0) {
    // 设置要跟随的机器人索引
    if (this.robotPelvisBodyIds && this.robotPelvisBodyIds.length > 0) {
      const index = Math.max(0, Math.min(robotIndex, this.robotPelvisBodyIds.length - 1));
      this.followRobotIndex = index;
      
      // 更新follow body ID
      this.updateFollowBodyId();
      
      // 如果follow已启用，立即更新相机位置
      if (this.followEnabled) {
        this.followInitialized = false;
        this.updateCameraFollow();
      } else {
        // v6.1.3: 如果follow未启用，移动相机到机器人位置，保持合适的距离和角度
        const bodyId = this.robotPelvisBodyIds[index];
        if (Number.isInteger(bodyId) && bodyId >= 0) {
          const cached = this.lastSimState?.bodies?.get(bodyId);
          if (cached && cached.position) {
            // 设置相机目标到机器人pelvis位置（稍微抬高一点）
            const robotPos = cached.position;
            this.controls.target.set(robotPos.x, robotPos.y + 0.8, robotPos.z);
            
            // v6.1.3: 使用类似初始相机的偏移量，保持合适的距离和角度
            // 初始相机位置: (4.0, 3.0, 5.0)，目标: (0, 0.8, 0)
            // 偏移量: (4.0, 2.2, 5.0) - 从右前方斜上方看向机器人
            const offset = new THREE.Vector3(4.0, 2.2, 5.0);
            this.camera.position.copy(this.controls.target).add(offset);
            this.controls.update();
          }
        }
      }
      
      console.log(`Focused on robot ${index + 1} (body ID: ${this.robotPelvisBodyIds[index]})`);
    } else {
      // v6.1.3: 单机器人模式，使用合适的距离和角度
      if (Number.isInteger(this.pelvis_body_id)) {
        const cached = this.lastSimState?.bodies?.get(this.pelvis_body_id);
        if (cached && cached.position) {
          const robotPos = cached.position;
          this.controls.target.set(robotPos.x, robotPos.y + 0.8, robotPos.z);
          
          // 使用类似初始相机的偏移量
          const offset = new THREE.Vector3(4.0, 2.2, 5.0);
          this.camera.position.copy(this.controls.target).add(offset);
          this.controls.update();
        }
      }
    }
  }
  
  /**
   * 设置要跟随的机器人索引 (v6.1.0)
   * 当Camera follow功能启用时，指定要跟随的机器人
   * @param {number} robotIndex - 机器人索引（0-based）
   */
  setFollowRobotIndex(robotIndex) {
    this.followRobotIndex = Math.max(0, robotIndex);
    this.updateFollowBodyId();
    if (this.followEnabled) {
      this.followInitialized = false;
    }
  }

  updateCameraFollow() {
    if (!this.followEnabled) {
      return;
    }
    const bodyId = Number.isInteger(this.followBodyId) ? this.followBodyId : null;
    if (bodyId === null) {
      return;
    }
    const cached = this.lastSimState.bodies.get(bodyId);
    if (!cached) {
      return;
    }
    this.followTargetDesired.set(cached.position.x, this.followHeight, cached.position.z);
    if (!this.followInitialized) {
      this.followTarget.copy(this.followTargetDesired);
      this.followInitialized = true;
    } else {
      this.followTarget.lerp(this.followTargetDesired, this.followLerp);
    }

    this.followDelta.subVectors(this.followTarget, this.controls.target);
    this.controls.target.copy(this.followTarget);
    this.camera.position.add(this.followDelta);
  }

  async main_loop() {
    // v7.1.3: 移除初始模式检测，改为在循环内动态检测
    if (!this.policyRunner && (!this.policyRunners || this.policyRunners.length === 0)) {
      return;
    }

    while (this.alive) {
      const loopStart = performance.now();
      
      // v7.1.4: 在每次循环中动态检测多机器人模式（因为robotJointMappings可能在初始化后才被填充）
      const isMultiRobot = this.robotJointMappings && this.robotJointMappings.length > 1;
      const hasPolicyRunner = isMultiRobot 
        ? (this.policyRunners && this.policyRunners.length > 0)
        : this.policyRunner;
      
      // v7.1.4: 只在第一次检测到模式变化时输出日志（避免刷屏）
      if (!this._lastMultiRobotMode && isMultiRobot) {
        console.log(`[DEBUG] Multi-robot mode detected:`, {
          robotJointMappingsLength: this.robotJointMappings?.length,
          policyRunnersLength: this.policyRunners?.length,
          isMultiRobot: true
        });
        this._lastMultiRobotMode = true;
      } else if (this._lastMultiRobotMode === undefined && !isMultiRobot) {
        // 只在第一次且是单机器人模式时输出（避免初始化时的误报）
        if (this.robotJointMappings && this.robotJointMappings.length === 0) {
          // 这是初始化阶段，不输出日志
        } else {
          console.log(`[DEBUG] Single-robot mode:`, {
            robotJointMappingsLength: this.robotJointMappings?.length,
            hasPolicyRunner: !!this.policyRunner,
            isMultiRobot: false
          });
          this._lastMultiRobotMode = false;
        }
      }

      if (!this.params.paused && this.model && this.data && this.simulation && hasPolicyRunner) {
        // Update gamepad command (if gamepad connected, it will override test command)
        this._updateGamepadCommand();
        // If no gamepad, test command from UI will be used (already set via demo.cmd)
        
        // CRITICAL DEBUG: Log command and policy runner status (first few frames only)
        if (!this._policyCallDebugLogged) {
          this._policyCallDebugLogged = false;
        }
        if (!this._policyCallDebugLogged) {
          console.log('%c=== [策略调用诊断] 检查策略是否正确调用 ===', 'color: red; font-weight: bold; font-size: 14px;');
          console.log('1. 策略加载状态:', {
            hasPolicyRunner: !!hasPolicyRunner,
            isMultiRobot: isMultiRobot,
            policyRunnerExists: !!this.policyRunner,
            policyRunnersLength: this.policyRunners?.length ?? 0,
            currentPolicyPath: this.currentPolicyPath
          });
          console.log('2. 当前命令值:', {
            demoCmd: Array.from(this.cmd),
            cmdMagnitude: Math.sqrt(this.cmd[0]**2 + this.cmd[1]**2 + this.cmd[2]**2)
          });
          if (isMultiRobot) {
            for (let i = 0; i < this.policyRunners.length; i++) {
              const pr = this.policyRunners[i];
              console.log(`3. 机器人 ${i + 1} 策略状态:`, {
                exists: !!pr,
                hasSetCommand: typeof pr?.setCommand === 'function',
                hasStep: typeof pr?.step === 'function',
                command: pr ? Array.from(pr.command) : null,
                lastActions: pr ? Array.from(pr.lastActions).slice(0, 6) : null
              });
            }
          } else {
            console.log('3. 单机器人策略状态:', {
              exists: !!this.policyRunner,
              hasSetCommand: typeof this.policyRunner?.setCommand === 'function',
              hasStep: typeof this.policyRunner?.step === 'function',
              command: this.policyRunner ? Array.from(this.policyRunner.command) : null,
              lastActions: this.policyRunner ? Array.from(this.policyRunner.lastActions).slice(0, 6) : null
            });
          }
          this._policyCallDebugLogged = true;
        }
        
        // 状态读取和推理 (v7.0.9: 每个机器人使用独立的policyRunner，添加详细日志)
        let actionTargets = [];
        if (isMultiRobot) {
          // 多机器人模式：为每个机器人独立推理
          try {
            for (let robotIdx = 0; robotIdx < this.robotJointMappings.length; robotIdx++) {
              if (!this.policyRunners[robotIdx]) {
                console.warn(`Policy runner not found for robot ${robotIdx + 1}`);
                continue;
              }
              const state = this.readPolicyStateForRobot(robotIdx);
              if (!state) {
                console.warn(`Failed to read state for robot ${robotIdx + 1}`);
                continue;
              }
              this.policyRunners[robotIdx].setCommand?.(this.cmd);
              const actionTarget = await this.policyRunners[robotIdx].step(state);
              // v7.0.9: 检查actionTarget是否为有效数组（包括Float32Array）
              if (!actionTarget || (!Array.isArray(actionTarget) && !(actionTarget instanceof Float32Array)) || actionTarget.length === 0) {
                console.error(`Policy runner ${robotIdx + 1} returned invalid actionTarget:`, {
                  actionTarget,
                  type: typeof actionTarget,
                  isArray: Array.isArray(actionTarget),
                  isFloat32Array: actionTarget instanceof Float32Array,
                  length: actionTarget?.length
                });
                continue;
              }
              actionTargets[robotIdx] = actionTarget;
              // v7.1.4: 移除频繁的DEBUG日志（避免刷屏）
            }
            // v7.0.9: 验证actionTargets数组
            if (actionTargets.length !== this.robotJointMappings.length) {
              console.warn(`[DEBUG] actionTargets length mismatch:`, {
                actionTargetsLength: actionTargets.length,
                mappingsLength: this.robotJointMappings.length,
                actionTargetsKeys: Object.keys(actionTargets)
              });
            }
            // 保持向后兼容：第一个机器人的actionTarget也保存到this.actionTarget
            this.actionTarget = actionTargets[0];
          } catch (e) {
            console.error('Inference error in main loop:', e);
            this.alive = false;
            break;
          }
        } else {
          // 单机器人模式：使用原有方法
          const state = this.readPolicyState();
          try {
            // CRITICAL DEBUG: Log before and after setCommand/step
            if (!this._singleRobotDebugLogged) {
              console.log('%c=== [单机器人模式] 策略调用前状态 ===', 'color: orange; font-weight: bold;');
              console.log('命令值:', Array.from(this.cmd));
              console.log('策略是否存在:', !!this.policyRunner);
              console.log('策略是否有setCommand方法:', typeof this.policyRunner?.setCommand === 'function');
              console.log('策略是否有step方法:', typeof this.policyRunner?.step === 'function');
              this._singleRobotDebugLogged = true;
            }
            
            this.policyRunner.setCommand?.(this.cmd);
            
            // Verify command was set
            if (!this._commandVerifyLogged && this.policyRunner) {
              console.log('%c=== [命令验证] setCommand后的命令值 ===', 'color: cyan; font-weight: bold;');
              console.log('策略中的命令:', Array.from(this.policyRunner.command));
              console.log('demo.cmd:', Array.from(this.cmd));
              const cmdMatch = Math.abs(this.policyRunner.command[0] - this.cmd[0]) < 0.001 &&
                               Math.abs(this.policyRunner.command[1] - this.cmd[1]) < 0.001 &&
                               Math.abs(this.policyRunner.command[2] - this.cmd[2]) < 0.001;
              console.log('命令是否匹配:', cmdMatch ? '✅' : '❌');
              this._commandVerifyLogged = true;
            }
            
            this.actionTarget = await this.policyRunner.step(state);
            
            // CRITICAL DEBUG: Log after step
            if (!this._stepResultLogged) {
              console.log('%c=== [推理结果] step()返回的actionTarget ===', 'color: green; font-weight: bold;');
              console.log('actionTarget是否存在:', !!this.actionTarget);
              console.log('actionTarget类型:', typeof this.actionTarget);
              console.log('actionTarget是否为数组:', Array.isArray(this.actionTarget));
              console.log('actionTarget是否为Float32Array:', this.actionTarget instanceof Float32Array);
              console.log('actionTarget长度:', this.actionTarget?.length);
              if (this.actionTarget && this.actionTarget.length > 0) {
                console.log('actionTarget前6个值:', Array.from(this.actionTarget).slice(0, 6));
                console.log('actionTarget范围:', {
                  min: Math.min(...Array.from(this.actionTarget)),
                  max: Math.max(...Array.from(this.actionTarget)),
                  avg: Array.from(this.actionTarget).reduce((a, b) => a + b, 0) / this.actionTarget.length
                });
              } else {
                console.error('❌ actionTarget为空或长度为0！');
              }
              this._stepResultLogged = true;
            }
            
            actionTargets = [this.actionTarget]; // 保持数组格式一致
            
            // Debug: Log action values immediately after inference
            if (this._actionValueLogged === undefined) {
              this._actionValueLogged = false;
            }
            if (!this._actionValueLogged && this.actionTarget) {
              const isLocoPolicy = this.currentPolicyPath && (
                this.currentPolicyPath.includes('loco') || 
                this.currentPolicyPath.includes('Loco')
              );
              if (isLocoPolicy) {
                const leftLegIndices = [0, 3, 6, 9, 13, 17];
                const rightLegIndices = [1, 4, 7, 10, 14, 18];
                console.log('=== [Action Debug] After inference - Left leg ===', 
                  leftLegIndices.map(idx => ({
                    idx,
                    joint: this.policyJointNames ? this.policyJointNames[idx] : 'unknown',
                    target: this.actionTarget[idx]
                  }))
                );
                console.log('=== [Action Debug] After inference - Right leg ===', 
                  rightLegIndices.map(idx => ({
                    idx,
                    joint: this.policyJointNames ? this.policyJointNames[idx] : 'unknown',
                    target: this.actionTarget[idx]
                  }))
                );
                console.log('=== [Action Debug] Full actionTarget array ===', Array.from(this.actionTarget));
                this._actionValueLogged = true;
              }
            }
          } catch (e) {
            console.error('Inference error in main loop:', e);
            this.alive = false;
            break;
          }
        }

        for (let substep = 0; substep < this.decimation; substep++) {
          if (this.control_type === 'joint_position') {
            if (isMultiRobot) {
              // 多机器人模式：应用到所有机器人 (v7.0.9: 添加详细调试日志)
              for (let robotIdx = 0; robotIdx < this.robotJointMappings.length; robotIdx++) {
                const mapping = this.robotJointMappings[robotIdx];
                if (!mapping) {
                  if (substep === 0 && robotIdx > 0) {
                    console.warn(`[DEBUG] Mapping not found for robot ${robotIdx + 1}`);
                  }
                  continue;
                }
                
                const actionTarget = actionTargets[robotIdx];
                // v7.1.4: 移除频繁的DEBUG日志（避免刷屏）
                
                if (!actionTarget) {
                  // v7.0.9: 如果actionTarget不存在，记录详细错误信息
                  if (substep === 0 && robotIdx > 0) {
                    console.error(`[DEBUG] ActionTarget not found for robot ${robotIdx + 1}:`, {
                      actionTargetsLength: actionTargets.length,
                      actionTargetsKeys: Object.keys(actionTargets),
                      actionTargetsHasIndex: robotIdx in actionTargets,
                      robotIdx
                    });
                  }
                  continue;
                }
                
                // v7.0.9: 检查actionTarget是否为有效数组（包括Float32Array）
                if (!Array.isArray(actionTarget) && !(actionTarget instanceof Float32Array)) {
                  if (substep === 0 && robotIdx > 0) {
                    console.error(`[DEBUG] ActionTarget for robot ${robotIdx + 1} is not an array:`, {
                      type: typeof actionTarget,
                      constructor: actionTarget?.constructor?.name,
                      value: actionTarget
                    });
                  }
                  continue;
                }
                
                if (actionTarget.length !== mapping.numActions) {
                  if (substep === 0 && robotIdx > 0) {
                    console.error(`[DEBUG] ActionTarget length mismatch for robot ${robotIdx + 1}:`, {
                      actionTargetLength: actionTarget.length,
                      numActions: mapping.numActions
                    });
                  }
                  continue;
                }
                
                // v7.1.4: 移除频繁的DEBUG日志（避免刷屏）
                
                for (let i = 0; i < mapping.numActions; i++) {
                  const qposAdr = mapping.qpos_adr_policy[i];
                  const qvelAdr = mapping.qvel_adr_policy[i];
                  const ctrlAdr = mapping.ctrl_adr_policy[i];
                  
                  // v7.0.9: 确保actionTarget[i]是有效数字
                  const targetJpos = (actionTarget[i] !== undefined && actionTarget[i] !== null) ? actionTarget[i] : 0.0;
                  // v7.2.2: 支持每个机器人使用各自的PD参数（为独立策略准备）
                  const robotParams = this.robotPolicyParams?.[robotIdx] ?? null;
                  const kpArr = robotParams?.kp ?? this.kpPolicy;
                  const kdArr = robotParams?.kd ?? this.kdPolicy;
                  const kp = kpArr ? kpArr[i] : 0.0;
                  const kd = kdArr ? kdArr[i] : 0.0;
                  const torque = kp * (targetJpos - this.simulation.qpos[qposAdr]) 
                               + kd * (0 - this.simulation.qvel[qvelAdr]);
                  
                  let ctrlValue = torque;
                  const ctrlRange = this.model?.actuator_ctrlrange;
                  if (ctrlRange && ctrlRange.length >= (ctrlAdr + 1) * 2) {
                    const min = ctrlRange[ctrlAdr * 2];
                    const max = ctrlRange[(ctrlAdr * 2) + 1];
                    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
                      ctrlValue = Math.min(Math.max(ctrlValue, min), max);
                    }
                  }
                  this.simulation.ctrl[ctrlAdr] = ctrlValue;
                }
              }
            } else {
              // 单机器人模式（原有逻辑）
              // CRITICAL DEBUG: Verify actionTarget is being applied
              if (!this._actionApplyDebugLogged) {
                console.log('%c=== [动作应用] 检查actionTarget是否被应用 ===', 'color: magenta; font-weight: bold;');
                console.log('actionTarget是否存在:', !!this.actionTarget);
                console.log('actionTarget长度:', this.actionTarget?.length);
                console.log('ctrl_adr_policy长度:', this.ctrl_adr_policy?.length);
                if (this.actionTarget && this.ctrl_adr_policy && this.ctrl_adr_policy.length > 0) {
                  console.log('前6个关节的目标位置:', 
                    Array.from({length: Math.min(6, this.actionTarget.length)}, (_, i) => ({
                      policyIdx: i,
                      jointName: this.policyJointNames?.[i] ?? 'unknown',
                      targetJpos: this.actionTarget[i],
                      ctrlAdr: this.ctrl_adr_policy[i],
                      currentQpos: this.simulation.qpos[this.qpos_adr_policy?.[i] ?? -1],
                      kp: this.kpPolicy?.[i] ?? 0,
                      kd: this.kdPolicy?.[i] ?? 0
                    }))
                  );
                }
                this._actionApplyDebugLogged = true;
              }
              
              // Debug: Log action values for loco policy (first few steps only)
              if (this._actionValueLogged === undefined) {
                this._actionValueLogged = false;
              }
              if (!this._actionValueLogged) {
                const isLocoPolicy = this.currentPolicyPath && (
                  this.currentPolicyPath.includes('loco') || 
                  this.currentPolicyPath.includes('Loco')
                );
                if (isLocoPolicy) {
                  const leftLegIndices = [0, 3, 6, 9, 13, 17]; // left_hip_pitch, left_hip_roll, left_hip_yaw, left_knee, left_ankle_pitch, left_ankle_roll
                  const rightLegIndices = [1, 4, 7, 10, 14, 18]; // right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll
                  const leftLegActions = leftLegIndices.map(idx => ({
                    policyIdx: idx,
                    jointName: this.policyJointNames ? this.policyJointNames[idx] : 'unknown',
                    actionValue: this.actionTarget ? this.actionTarget[idx] : null,
                    actuatorIdx: this.ctrl_adr_policy ? this.ctrl_adr_policy[idx] : -1,
                    targetJpos: this.actionTarget ? this.actionTarget[idx] : 0.0,
                    currentJpos: this.simulation && this.qpos_adr_policy ? this.simulation.qpos[this.qpos_adr_policy[idx]] : 0.0,
                    kp: this.kpPolicy ? this.kpPolicy[idx] : 0.0
                  }));
                  const rightLegActions = rightLegIndices.map(idx => ({
                    policyIdx: idx,
                    jointName: this.policyJointNames ? this.policyJointNames[idx] : 'unknown',
                    actionValue: this.actionTarget ? this.actionTarget[idx] : null,
                    actuatorIdx: this.ctrl_adr_policy ? this.ctrl_adr_policy[idx] : -1,
                    targetJpos: this.actionTarget ? this.actionTarget[idx] : 0.0,
                    currentJpos: this.simulation && this.qpos_adr_policy ? this.simulation.qpos[this.qpos_adr_policy[idx]] : 0.0,
                    kp: this.kpPolicy ? this.kpPolicy[idx] : 0.0
                  }));
                  console.log('=== [Action Debug] Left leg actions ===', leftLegActions);
                  console.log('=== [Action Debug] Right leg actions ===', rightLegActions);
                  console.log('=== [Action Debug] Action target array (first 20) ===', 
                    this.actionTarget ? Array.from(this.actionTarget.slice(0, 20)) : 'null');
                  this._actionValueLogged = true;
                }
              }
              
              // Debug: Log action application mapping for left/right leg (first time only)
              if (!this._actionApplicationLogged && this.policyJointNames && this.actionTarget) {
                const leftLegIndices = [0, 3, 6, 9, 13, 17];
                const rightLegIndices = [1, 4, 7, 10, 14, 18];
                console.log('%c=== [Action Application Debug] Left leg action -> actuator mapping ===', 'color: orange; font-weight: bold;');
                leftLegIndices.forEach(policyIdx => {
                  const jointName = this.policyJointNames[policyIdx];
                  const ctrlAdr = this.ctrl_adr_policy[policyIdx];
                  const actionValue = this.actionTarget[policyIdx];
                  const mujocoJointIdx = this.jointNamesMJC.indexOf(jointName);
                  console.log(`  Policy[${policyIdx}] ${jointName}:`, {
                    actionValue: actionValue,
                    ctrlAdr: ctrlAdr,
                    mujocoJointIdx: mujocoJointIdx,
                    qposAdr: this.qpos_adr_policy[policyIdx],
                    qvelAdr: this.qvel_adr_policy[policyIdx]
                  });
                });
                console.log('%c=== [Action Application Debug] Right leg action -> actuator mapping ===', 'color: orange; font-weight: bold;');
                rightLegIndices.forEach(policyIdx => {
                  const jointName = this.policyJointNames[policyIdx];
                  const ctrlAdr = this.ctrl_adr_policy[policyIdx];
                  const actionValue = this.actionTarget[policyIdx];
                  const mujocoJointIdx = this.jointNamesMJC.indexOf(jointName);
                  console.log(`  Policy[${policyIdx}] ${jointName}:`, {
                    actionValue: actionValue,
                    ctrlAdr: ctrlAdr,
                    mujocoJointIdx: mujocoJointIdx,
                    qposAdr: this.qpos_adr_policy[policyIdx],
                    qvelAdr: this.qvel_adr_policy[policyIdx]
                  });
                });
                this._actionApplicationLogged = true;
              }
              
              // Match Python LocoMode.py: reorder actions and PD gains using joint2motor_idx
              // Python: action_reorder[motor_idx] = loco_action[i] where motor_idx = joint2motor_idx[i]
              // Python: policy_output.kps = kps_reorder (already reordered in enter())
              // Key: joint2motor_idx[i] is motor index, ctrl_adr_policy[motorIdx] is the MuJoCo actuator index
              
              // Create reordered action array (policy order -> motor order)
              // CRITICAL: Match Python LocoMode.py line 98-101 exactly
              // Python: action_reorder[motor_idx] = loco_action[i] where motor_idx = joint2motor_idx[i]
              let actionReordered = null;
              if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.actionTarget) {
                actionReordered = new Float32Array(this.numActions);
                // Initialize with NaN to detect unmapped indices
                actionReordered.fill(NaN);
                
                for (let i = 0; i < this.numActions; i++) {
                  const motorIdx = this.joint2motorIdx[i];
                  if (motorIdx >= 0 && motorIdx < this.numActions) {
                    // Python: action_reorder[motor_idx] = loco_action[i]
                    actionReordered[motorIdx] = this.actionTarget[i];
                  } else {
                    console.warn(`[Action Apply] Invalid motor index ${motorIdx} at policy index ${i}`);
                  }
                }
                
                // Debug: Check for unmapped motor indices (first time only)
                if (!this._actionReorderDebugLogged) {
                  const unmapped = [];
                  for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
                    if (isNaN(actionReordered[motorIdx])) {
                      unmapped.push(motorIdx);
                    }
                  }
                  if (unmapped.length > 0) {
                    console.warn(`[Action Apply] Unmapped motor indices: ${unmapped.join(', ')}`);
                  }
                  
                  // Debug: Check left/right leg action values
                  const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
                  const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];
                  const leftLegMotorIndices = leftLegPolicyIndices.map(i => this.joint2motorIdx[i]);
                  const rightLegMotorIndices = rightLegPolicyIndices.map(i => this.joint2motorIdx[i]);
                  
                  console.log('[Action Apply Debug] Left leg mapping:');
                  leftLegPolicyIndices.forEach((policyIdx, idx) => {
                    const motorIdx = leftLegMotorIndices[idx];
                    console.log(`  策略${policyIdx} (${this.policyJointNames[policyIdx]}) -> motorIdx=${motorIdx}, actionTarget=${this.actionTarget[policyIdx].toFixed(4)}, actionReordered=${actionReordered[motorIdx].toFixed(4)}`);
                  });
                  
                  console.log('[Action Apply Debug] Right leg mapping:');
                  rightLegPolicyIndices.forEach((policyIdx, idx) => {
                    const motorIdx = rightLegMotorIndices[idx];
                    console.log(`  策略${policyIdx} (${this.policyJointNames[policyIdx]}) -> motorIdx=${motorIdx}, actionTarget=${this.actionTarget[policyIdx].toFixed(4)}, actionReordered=${actionReordered[motorIdx].toFixed(4)}`);
                  });
                  
                  // Check symmetry of actionReordered
                  const leftReordered = leftLegMotorIndices.map(motorIdx => actionReordered[motorIdx]);
                  const rightReordered = rightLegMotorIndices.map(motorIdx => actionReordered[motorIdx]);
                  const leftReorderedAvg = leftReordered.reduce((sum, v) => sum + Math.abs(v), 0) / leftReordered.length;
                  const rightReorderedAvg = rightReordered.reduce((sum, v) => sum + Math.abs(v), 0) / rightReordered.length;
                  const reorderedRatio = Math.min(leftReorderedAvg, rightReorderedAvg) / Math.max(leftReorderedAvg, rightReorderedAvg);
                  console.log(`[Action Apply Debug] actionReordered 对称性: 左腿平均值=${leftReorderedAvg.toFixed(4)}, 右腿平均值=${rightReorderedAvg.toFixed(4)}, 比例=${reorderedRatio.toFixed(4)} ${reorderedRatio > 0.9 ? '✅' : '❌'}`);
                  
                  this._actionReorderDebugLogged = true;
                }
              }
              
              // Apply actions and PD gains
              // CRITICAL FIX: Use different logic based on whether joint2motorIdx exists
              // - If joint2motorIdx exists (loco_mode): use motor order (qpos_adr_motor, actionReordered)
              // - If joint2motorIdx doesn't exist (tracking_policy): use policy order (qpos_adr_policy, actionTarget)
              // CRITICAL: Check all necessary variables exist and are valid before using motor order
              const hasMotorOrdering = this.joint2motorIdx && 
                                      this.joint2motorIdx.length === this.numActions &&
                                      this.qpos_adr_motor &&
                                      this.qvel_adr_motor &&
                                      this.ctrl_adr_motor &&
                                      this.kpPolicyReorder &&
                                      this.kdPolicyReorder;
              
              // Additional validation: verify all motor indices are mapped (no -1 values)
              let allMotorIndicesMapped = false;
              if (hasMotorOrdering) {
                allMotorIndicesMapped = true;
                for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
                  if (this.qpos_adr_motor[motorIdx] < 0 || 
                      this.qvel_adr_motor[motorIdx] < 0 || 
                      this.ctrl_adr_motor[motorIdx] < 0) {
                    allMotorIndicesMapped = false;
                    break;
                  }
                }
              }
              
              if (hasMotorOrdering && allMotorIndicesMapped) {
                // Has joint2motorIdx: use motor order (loco_mode)
                // Python outputs actions and kps/kds in motor order, so we iterate by motor index
                for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
                  // Get MuJoCo addresses using motor-ordered arrays
                  const qpos_adr = this.qpos_adr_motor[motorIdx];
                  const qvel_adr = this.qvel_adr_motor[motorIdx];
                  const ctrl_adr = this.ctrl_adr_motor[motorIdx];
                  
                  // Skip if addresses are invalid
                  if (qpos_adr < 0 || qvel_adr < 0 || ctrl_adr < 0) {
                    if (!this._invalidAddressLogged) {
                      console.warn(`[Action Apply] Invalid addresses for motorIdx ${motorIdx}: qpos=${qpos_adr}, qvel=${qvel_adr}, ctrl=${ctrl_adr}`);
                      this._invalidAddressLogged = true;
                    }
                    continue;
                  }

                  // Use reordered action (motor order)
                  const targetJpos = (actionReordered && !isNaN(actionReordered[motorIdx])) 
                    ? actionReordered[motorIdx] 
                    : 0.0;
                  
                  // Use reordered PD gains (motor order)
                  const kp = (this.kpPolicyReorder && this.kpPolicyReorder[motorIdx] !== undefined) 
                    ? this.kpPolicyReorder[motorIdx] 
                    : 0.0;
                  const kd = (this.kdPolicyReorder && this.kdPolicyReorder[motorIdx] !== undefined) 
                    ? this.kdPolicyReorder[motorIdx] 
                    : 0.0;
                
                  const torque = kp * (targetJpos - this.simulation.qpos[qpos_adr]) + kd * (0 - this.simulation.qvel[qvel_adr]);
                  let ctrlValue = torque;
                  const ctrlRange = this.model?.actuator_ctrlrange;
                  if (ctrlRange && ctrlRange.length >= (ctrl_adr + 1) * 2) {
                    const min = ctrlRange[ctrl_adr * 2];
                    const max = ctrlRange[(ctrl_adr * 2) + 1];
                    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
                      ctrlValue = Math.min(Math.max(ctrlValue, min), max);
                    }
                  }
                  this.simulation.ctrl[ctrl_adr] = ctrlValue;
                  
                  // CRITICAL DEBUG: Log left/right leg control values (first few frames)
                  if (!this._ctrlValueDebugLogged) {
                    const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
                    const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];
                    const leftLegMotorIndices = leftLegPolicyIndices.map(i => this.joint2motorIdx[i]);
                    const rightLegMotorIndices = rightLegPolicyIndices.map(i => this.joint2motorIdx[i]);
                    
                    // Check if this motorIdx is a left or right leg motor
                    const leftIdx = leftLegMotorIndices.indexOf(motorIdx);
                    const rightIdx = rightLegMotorIndices.indexOf(motorIdx);
                    
                    if (leftIdx >= 0 || rightIdx >= 0) {
                      if (!this._ctrlValueDebugFrameCount) {
                        this._ctrlValueDebugFrameCount = 0;
                        this._leftLegCtrlValues = [];
                        this._rightLegCtrlValues = [];
                      }
                      this._ctrlValueDebugFrameCount++;
                      
                      if (leftIdx >= 0) {
                        this._leftLegCtrlValues.push({
                          motorIdx,
                          policyIdx: leftLegPolicyIndices[leftIdx],
                          jointName: this.policyJointNames[leftLegPolicyIndices[leftIdx]],
                          ctrlAdr: ctrl_adr,
                          targetJpos,
                          currentJpos: this.simulation.qpos[qpos_adr],
                          kp,
                          kd,
                          torque,
                          ctrlValue
                        });
                      }
                      if (rightIdx >= 0) {
                        this._rightLegCtrlValues.push({
                          motorIdx,
                          policyIdx: rightLegPolicyIndices[rightIdx],
                          jointName: this.policyJointNames[rightLegPolicyIndices[rightIdx]],
                          ctrlAdr: ctrl_adr,
                          targetJpos,
                          currentJpos: this.simulation.qpos[qpos_adr],
                          kp,
                          kd,
                          torque,
                          ctrlValue
                        });
                      }
                      
                      // Log after collecting all leg values (every 30 frames)
                      if (this._ctrlValueDebugFrameCount % 30 === 0 && this._leftLegCtrlValues.length === 6 && this._rightLegCtrlValues.length === 6) {
                        console.log('%c=== [控制值详细检查] 左右腿对比 ===', 'color: magenta; font-weight: bold; font-size: 14px;');
                        console.log('左腿控制值:');
                        this._leftLegCtrlValues.forEach((v, idx) => {
                          console.log(`  ${v.jointName} (motorIdx=${v.motorIdx}, ctrlAdr=${v.ctrlAdr}): targetJpos=${v.targetJpos.toFixed(4)}, currentJpos=${v.currentJpos.toFixed(4)}, kp=${v.kp}, torque=${v.torque.toFixed(4)}, ctrlValue=${v.ctrlValue.toFixed(4)}`);
                        });
                        console.log('右腿控制值:');
                        this._rightLegCtrlValues.forEach((v, idx) => {
                          console.log(`  ${v.jointName} (motorIdx=${v.motorIdx}, ctrlAdr=${v.ctrlAdr}): targetJpos=${v.targetJpos.toFixed(4)}, currentJpos=${v.currentJpos.toFixed(4)}, kp=${v.kp}, torque=${v.torque.toFixed(4)}, ctrlValue=${v.ctrlValue.toFixed(4)}`);
                        });
                        
                        const leftCtrlAvg = this._leftLegCtrlValues.reduce((sum, v) => sum + Math.abs(v.ctrlValue), 0) / this._leftLegCtrlValues.length;
                        const rightCtrlAvg = this._rightLegCtrlValues.reduce((sum, v) => sum + Math.abs(v.ctrlValue), 0) / this._rightLegCtrlValues.length;
                        const ctrlRatio = Math.min(leftCtrlAvg, rightCtrlAvg) / Math.max(leftCtrlAvg, rightCtrlAvg);
                        console.log(`控制值对称性: 左腿平均值=${leftCtrlAvg.toFixed(4)}, 右腿平均值=${rightCtrlAvg.toFixed(4)}, 比例=${ctrlRatio.toFixed(4)} ${ctrlRatio > 0.7 ? '✅' : '❌'}`);
                        
                        // Reset for next frame
                        this._leftLegCtrlValues = [];
                        this._rightLegCtrlValues = [];
                        
                        if (this._ctrlValueDebugFrameCount >= 120) {
                          this._ctrlValueDebugLogged = true;
                        }
                      }
                    }
                  }
                }
              } else {
                // No joint2motorIdx: use policy order (tracking_policy)
                // Original behavior: iterate by policy index, use policy-ordered arrays
                for (let i = 0; i < this.numActions; i++) {
                  const qpos_adr = this.qpos_adr_policy[i];
                  const qvel_adr = this.qvel_adr_policy[i];
                  const ctrl_adr = this.ctrl_adr_policy[i];
                  
                  // Skip if addresses are invalid
                  if (qpos_adr < 0 || qvel_adr < 0 || ctrl_adr < 0) {
                    continue;
                  }

                  // Use actionTarget directly (policy order)
                  const targetJpos = this.actionTarget ? (this.actionTarget[i] ?? 0.0) : 0.0;
                  
                  // Use PD gains directly (policy order)
                  const kp = this.kpPolicy ? (this.kpPolicy[i] ?? 0.0) : 0.0;
                  const kd = this.kdPolicy ? (this.kdPolicy[i] ?? 0.0) : 0.0;
                  
                  const torque = kp * (targetJpos - this.simulation.qpos[qpos_adr]) + kd * (0 - this.simulation.qvel[qvel_adr]);
                  let ctrlValue = torque;
                  const ctrlRange = this.model?.actuator_ctrlrange;
                  if (ctrlRange && ctrlRange.length >= (ctrl_adr + 1) * 2) {
                    const min = ctrlRange[ctrl_adr * 2];
                    const max = ctrlRange[(ctrl_adr * 2) + 1];
                    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
                      ctrlValue = Math.min(Math.max(ctrlValue, min), max);
                    }
                  }
                  this.simulation.ctrl[ctrl_adr] = ctrlValue;
                }
              }
            }
          } else if (this.control_type === 'torque') {
            console.error('Torque control not implemented yet.');
          }

          const applied = this.simulation.qfrc_applied;
          for (let i = 0; i < applied.length; i++) {
            applied[i] = 0.0;
          }

          const dragged = this.dragStateManager.physicsObject;
          if (dragged && dragged.bodyID) {
            for (let b = 0; b < this.model.nbody; b++) {
              if (this.bodies[b]) {
                getPosition(this.simulation.xpos, b, this.bodies[b].position);
                getQuaternion(this.simulation.xquat, b, this.bodies[b].quaternion);
                this.bodies[b].updateWorldMatrix();
              }
            }
            const bodyID = dragged.bodyID;
            this.dragStateManager.update();
            const force = toMujocoPos(
              this.dragStateManager.currentWorld.clone()
                .sub(this.dragStateManager.worldHit)
                .multiplyScalar(60.0)
            );
            // clamp force magnitude
            const forceMagnitude = Math.sqrt(force.x * force.x + force.y * force.y + force.z * force.z);
            const maxForce = 30.0;
            if (forceMagnitude > maxForce) {
              const scale = maxForce / forceMagnitude;
              force.x *= scale;
              force.y *= scale;
              force.z *= scale;
            }
            const point = toMujocoPos(this.dragStateManager.worldHit.clone());
            this.simulation.applyForce(force.x, force.y, force.z, 0, 0, 0, point.x, point.y, point.z, bodyID);
          }

          this.simulation.step();
        }

        for (let b = 0; b < this.model.nbody; b++) {
          if (!this.bodies[b]) {
            continue;
          }
          if (!this.lastSimState.bodies.has(b)) {
            this.lastSimState.bodies.set(b, {
              position: new THREE.Vector3(),
              quaternion: new THREE.Quaternion()
            });
          }
          const cached = this.lastSimState.bodies.get(b);
          getPosition(this.simulation.xpos, b, cached.position);
          getQuaternion(this.simulation.xquat, b, cached.quaternion);
        }

        const numLights = this.model.nlight;
        for (let l = 0; l < numLights; l++) {
          if (!this.lights[l]) {
            continue;
          }
          if (!this.lastSimState.lights.has(l)) {
            this.lastSimState.lights.set(l, {
              position: new THREE.Vector3(),
              direction: new THREE.Vector3()
            });
          }
          const cached = this.lastSimState.lights.get(l);
          getPosition(this.simulation.light_xpos, l, cached.position);
          getPosition(this.simulation.light_xdir, l, cached.direction);
        }

        this.lastSimState.tendons.numWraps = {
          count: this.model.nwrap,
          matrix: this.lastSimState.tendons.matrix
        };

        this._stepFrameCount += 1;
        const now = performance.now();
        const elapsedStep = now - this._stepLastTime;
        if (elapsedStep >= 500) {
          this.simStepHz = (this._stepFrameCount * 1000) / elapsedStep;
          this._stepFrameCount = 0;
          this._stepLastTime = now;
        }
      } else {
        this.simStepHz = 0;
        this._stepFrameCount = 0;
        this._stepLastTime = performance.now();
      }

      const loopEnd = performance.now();
      const elapsed = (loopEnd - loopStart) / 1000;
      const target = this.timestep * this.decimation;
      const sleepTime = Math.max(0, target - elapsed);
      await new Promise((resolve) => setTimeout(resolve, sleepTime * 1000));
    }
  }

  _updateGamepadCommand() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads ? Array.from(pads).find((p) => p && p.connected) : null;
    if (!pad) {
      // CRITICAL FIX: Don't reset cmd if no gamepad - let test command from UI work
      // Only reset gamepadState, but keep demo.cmd unchanged
      this.gamepadState.connected = false;
      this.gamepadState.index = null;
      this.gamepadState.id = '';
      this.gamepadState.axes = [];
      this.gamepadState.buttons = [];
      this.gamepadState.cmd = [0.0, 0.0, 0.0];
      // Don't reset this.cmd - it may contain test command from UI
      return;
    }

    const axes = (pad.axes || []).map((v) => applyDeadzone(Number(v) || 0.0));
    const buttons = (pad.buttons || []).map((b) => Number(b?.value ?? 0.0));

    // Standard mapping (most controllers):
    // axes[0]=LSX, axes[1]=LSY, axes[2]=RSX, axes[3]=RSY
    const uVx = -(axes[1] ?? 0.0); // forward
    const uVy = axes[0] ?? 0.0; // left/right
    const uWz = axes[2] ?? 0.0; // yaw

    // Match Python LocoMode.py: scale_values(joycmd, [range_velx, range_vely, range_velz])
    const scaledCmd = scaleValues(
      [uVx, uVy, uWz],
      [[-0.4, 0.7], [-0.4, 0.4], [-1.57, 1.57]] // cmd_range from LocoMode.yaml
    );

    // Apply cmd_scale (matching Python LocoMode.py line 85: self.cmd = self.cmd * self.cmd_scale)
    this.cmd[0] = scaledCmd[0] * this.cmdScale[0];
    this.cmd[1] = scaledCmd[1] * this.cmdScale[1];
    this.cmd[2] = scaledCmd[2] * this.cmdScale[2];

    this.gamepadState.connected = true;
    this.gamepadState.index = pad.index ?? null;
    this.gamepadState.id = pad.id ?? '';
    this.gamepadState.axes = axes;
    this.gamepadState.buttons = buttons;
    this.gamepadState.cmd = [this.cmd[0], this.cmd[1], this.cmd[2]];
  }

  getGamepadState() {
    return {
      connected: !!this.gamepadState.connected,
      index: this.gamepadState.index,
      id: this.gamepadState.id,
      cmd: this.gamepadState.cmd.slice(),
      axes: this.gamepadState.axes.slice(),
      buttons: this.gamepadState.buttons.slice()
    };
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._lastRenderTime = 0;
    this.render();
  }

  setRenderScale(scale) {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    this.renderScale = clamped;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._lastRenderTime = 0;
    this.render();
  }

  getSimStepHz() {
    return this.simStepHz;
  }

  readPolicyState() {
    const qpos = this.simulation.qpos;
    const qvel = this.simulation.qvel;
    const jointPos = new Float32Array(this.numActions);
    const jointVel = new Float32Array(this.numActions);
    
    // Match Python LocoMode.py: use joint2motor_idx to reorder if available
    // Python: qj_obs[i] = qj[joint2motor_idx[i]]
    // Key understanding: joint2motor_idx[i] is motor index (0-28)
    // Python reads from motor index joint2motor_idx[i] into policy index i
    // So: qj[joint2motor_idx[i]] in Python = qpos[qpos_adr_motor[joint2motor_idx[i]]] in JS
    // CRITICAL: Check all necessary variables exist and are valid before using motor order
    const hasMotorOrdering = this.joint2motorIdx && 
                              this.joint2motorIdx.length === this.numActions &&
                              this.qpos_adr_motor &&
                              this.qvel_adr_motor;
    
    // Additional validation: verify all motor indices are mapped (no -1 values)
    let allMotorIndicesMapped = false;
    if (hasMotorOrdering) {
      allMotorIndicesMapped = true;
      for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
        if (this.qpos_adr_motor[motorIdx] < 0 || this.qvel_adr_motor[motorIdx] < 0) {
          allMotorIndicesMapped = false;
          break;
        }
      }
    }
    
    if (hasMotorOrdering && allMotorIndicesMapped) {
      // Match Python LocoMode.py: qj_obs[i] = qj[joint2motor_idx[i]]
      // Python: qj is motor-ordered array (29 elements, index 0-28 is motor index)
      // Python: qj_obs is policy-ordered array (29 elements, index 0-28 is policy index)
      // 
      // CRITICAL: qpos_adr_motor[motorIdx] = qpos_adr_policy[i] where motorIdx = joint2motorIdx[i]
      // This means qpos_adr_motor[motorIdx] points to the SAME MuJoCo address as qpos_adr_policy[i]
      // So we can directly read from qpos_adr_policy[i] and reorder using joint2motorIdx
      
      // Direct reordering: read from policy-ordered addresses and reorder using joint2motorIdx
      // This matches Python: qj_obs[i] = qj[joint2motor_idx[i]]
      // where qj[joint2motor_idx[i]] is the motor-ordered value at motor index joint2motor_idx[i]
      for (let i = 0; i < this.numActions; i++) {
        const motorIdx = this.joint2motorIdx[i];
        if (motorIdx >= 0 && motorIdx < this.numActions) {
          // Read from the MuJoCo address corresponding to motor index motorIdx
          // Since qpos_adr_motor[motorIdx] = qpos_adr_policy[i], we can use either
          // But we need to find which policy index j corresponds to motorIdx
          // Actually, we can use qpos_adr_motor[motorIdx] directly
          const qposAdr = this.qpos_adr_motor[motorIdx];
          const qvelAdr = this.qvel_adr_motor[motorIdx];
          if (qposAdr >= 0 && qvelAdr >= 0) {
            jointPos[i] = qpos[qposAdr];
            jointVel[i] = qvel[qvelAdr];
          } else {
            // Fallback to direct mapping
            jointPos[i] = qpos[this.qpos_adr_policy[i]];
            jointVel[i] = qvel[this.qvel_adr_policy[i]];
          }
        } else {
          // Fallback to direct mapping if invalid motor index
          console.warn(`[readPolicyState] Invalid motor index ${motorIdx} at policy index ${i}, using direct mapping`);
          jointPos[i] = qpos[this.qpos_adr_policy[i]];
          jointVel[i] = qvel[this.qvel_adr_policy[i]];
        }
      }
    } else {
      // Use direct name-based mapping (original behavior)
      for (let i = 0; i < this.numActions; i++) {
        const qposAdr = this.qpos_adr_policy[i];
        const qvelAdr = this.qvel_adr_policy[i];
        jointPos[i] = qpos[qposAdr];
        jointVel[i] = qvel[qvelAdr];
      }
    }
    
    // Debug: Log raw qvel values for left/right leg joints (first call only)
    if (!this._qvelDebugLogged && this.policyJointNames) {
      const leftLegIndices = [0, 3, 6, 9, 13, 17];
      const rightLegIndices = [1, 4, 7, 10, 14, 18];
      console.log('%c=== [readPolicyState Debug] Raw qvel values and addresses ===', 'color: blue; font-weight: bold; font-size: 14px;');
      console.log('Left leg:');
      leftLegIndices.forEach(idx => {
        const qvelAdr = this.qvel_adr_policy[idx];
        const rawQvel = qvel[qvelAdr];
        console.log(`  [${idx}] ${this.policyJointNames[idx]}:`, {
          qvelAdr: qvelAdr,
          rawQvel: rawQvel,
          jointVel: jointVel[idx]
        });
      });
      console.log('Right leg:');
      rightLegIndices.forEach(idx => {
        const qvelAdr = this.qvel_adr_policy[idx];
        const rawQvel = qvel[qvelAdr];
        console.log(`  [${idx}] ${this.policyJointNames[idx]}:`, {
          qvelAdr: qvelAdr,
          rawQvel: rawQvel,
          jointVel: jointVel[idx]
        });
      });
      this._qvelDebugLogged = true;
    }
    
    const rootPos = new Float32Array([qpos[0], qpos[1], qpos[2]]);
    const rootQuat = new Float32Array([qpos[3], qpos[4], qpos[5], qpos[6]]);
    const rootAngVel = new Float32Array([qvel[3], qvel[4], qvel[5]]);
    return {
      jointPos,
      jointVel,
      rootPos,
      rootQuat,
      rootAngVel
    };
  }

  /**
   * 读取指定机器人的策略状态（多机器人支持）(v7.0.0)
   * @param {number} robotIndex - 机器人索引（0-based）
   * @returns {Object} 状态对象 {jointPos, jointVel, rootPos, rootQuat, rootAngVel}
   */
  readPolicyStateForRobot(robotIndex = 0) {
    const mapping = this.robotJointMappings?.[robotIndex];
    if (!mapping) {
      // 如果没有映射，回退到单机器人模式
      return this.readPolicyState();
    }
    
    const qpos = this.simulation.qpos;
    const qvel = this.simulation.qvel;
    
    // 读取关节状态
    const jointPos = new Float32Array(mapping.numActions);
    const jointVel = new Float32Array(mapping.numActions);
    for (let i = 0; i < mapping.numActions; i++) {
      jointPos[i] = qpos[mapping.qpos_adr_policy[i]];
      jointVel[i] = qvel[mapping.qvel_adr_policy[i]];
    }
    
    // 读取根状态（v7.0.2: 使用映射中存储的freejoint地址）
    const freejointQposAdr = mapping.freejoint_qpos_adr ?? 0;
    const freejointQvelAdr = mapping.freejoint_qvel_adr ?? 0;
    
    const rootPos = new Float32Array([
      qpos[freejointQposAdr + 0],
      qpos[freejointQposAdr + 1],
      qpos[freejointQposAdr + 2]
    ]);
    const rootQuat = new Float32Array([
      qpos[freejointQposAdr + 3],
      qpos[freejointQposAdr + 4],
      qpos[freejointQposAdr + 5],
      qpos[freejointQposAdr + 6]
    ]);
    const rootAngVel = new Float32Array([
      // v8.0.1: freejoint 的 qvel 前3维是线速度，后3维才是角速度
      // 单机器人 readPolicyState() 使用的是 qvel[3..5]，多机器人应保持一致
      qvel[freejointQvelAdr + 3],
      qvel[freejointQvelAdr + 4],
      qvel[freejointQvelAdr + 5]
    ]);
    
    return {
      jointPos,
      jointVel,
      rootPos,
      rootQuat,
      rootAngVel
    };
  }

  resetSimulation() {
    if (!this.simulation) {
      return;
    }
    this.params.paused = true;
    this.simulation.resetData();
    this.simulation.forward();
    // 多机器人模式：重新设置初始位置 (v7.0.0)
    if (this.robotConfigs && this.robotConfigs.length > 1) {
      this.setMultiRobotInitialPositions();
    }
    this.actionTarget = null;
    
    // 检测多机器人模式并重置所有policyRunner (v7.0.4)
    const isMultiRobot = this.robotJointMappings && this.robotJointMappings.length > 1;
    
    if (isMultiRobot && this.policyRunners) {
      // 多机器人模式：重置所有policyRunner
      for (let robotIdx = 0; robotIdx < this.policyRunners.length; robotIdx++) {
        if (this.policyRunners[robotIdx]) {
          const state = this.readPolicyStateForRobot(robotIdx);
          this.policyRunners[robotIdx].reset(state);
        }
      }
      this.params.current_motion = 'default';
    } else if (this.policyRunner) {
      // 单机器人模式：保持原有逻辑
      const state = this.readPolicyState();
      this.policyRunner.reset(state);
      this.params.current_motion = 'default';
    }
    this.params.paused = false;
  }

  /**
   * 请求切换 motion（多机器人支持）。
   *
   * 说明：
   * - 这个方法主要用于控制台调试/脚本化控制，避免把 Vue 组件方法暴露出来。
   * - TrackingHelper.requestMotion() 有严格门槛：非 default motion 仅在 (currentName==='default' && currentDone===true) 时允许。
   *   当 force=true 时，将绕过该门槛，直接从当前状态开始切换到目标 motion（用于验证与调试）。
   *
   * @param {string} name - motion 名称（必须存在于 tracking.availableMotions()）
   * @param {number|null} robotIndex - null 表示所有机器人；>=0 表示指定机器人
   * @param {boolean} force - 是否强制切换（绕过 requestMotion 门槛）
   * @returns {boolean} 是否接受该 motion（all / single）
   */
  requestMotion(name, robotIndex = null, force = false) {
    const hasMulti = this.robotJointMappings && this.robotJointMappings.length > 1;
    const runners = (hasMulti && Array.isArray(this.policyRunners) && this.policyRunners.length > 0)
      ? this.policyRunners
      : (this.policyRunner ? [this.policyRunner] : []);

    if (!name || typeof name !== 'string' || runners.length === 0) {
      return false;
    }

    const applyToRobot = (idx) => {
      const runner = runners[idx];
      const tracking = runner?.tracking ?? null;
      if (!tracking) {
        return false;
      }
      // motion 必须存在
      if (!tracking.motions || !tracking.motions[name]) {
        return false;
      }
      const state = hasMulti ? this.readPolicyStateForRobot(idx) : this.readPolicyState();

      let accepted = false;
      if (force && typeof tracking._startMotionFromCurrent === 'function') {
        // 强制切换：绕过 TrackingHelper.requestMotion() 的门槛
        tracking._startMotionFromCurrent(name, state);
        accepted = true;
      } else {
        accepted = tracking.requestMotion(name, state);
      }

      if (accepted && Array.isArray(this.robotConfigs) && this.robotConfigs[idx]) {
        this.robotConfigs[idx].motion = name;
      }
      return accepted;
    };

    if (robotIndex === null) {
      let allAccepted = true;
      for (let i = 0; i < runners.length; i++) {
        const ok = applyToRobot(i);
        if (!ok) {
          allAccepted = false;
        }
      }
      if (allAccepted) {
        this.params.current_motion = name;
      }
      return allAccepted;
    }

    if (typeof robotIndex !== 'number' || !Number.isFinite(robotIndex)) {
      return false;
    }
    const idx = Math.max(0, Math.min(Math.floor(robotIndex), runners.length - 1));
    return applyToRobot(idx);
  }

  render() {
    if (!this.model || !this.data || !this.simulation) {
      return;
    }
    const now = performance.now();
    if (now - this._lastRenderTime < 30) {
      return;
    }
    this._lastRenderTime = now;

    // 先让OrbitControls更新（如果启用），这样鼠标拖动和滚轮缩放可以正常工作
    // 注意：这里先调用controls.update()，让OrbitControls处理滚轮缩放
    
    // 更新相机跟随（如果启用）
    if (this.followEnabled) {
      // 先让OrbitControls更新，处理滚轮缩放等操作
      this.controls.update();
      
      // 确保followBodyId是正确的pelvis body ID
      if (this.followBodyId === null || this.followBodyId === undefined) {
        this.updateFollowBodyId();
      }
      
      // 检查鼠标是否正在拖动或滚轮是否正在使用（使用我们跟踪的状态）
      // ON时键盘不控制任何东西，只检查鼠标状态
      const isMouseDown = this._isMouseDragging;
      const isWheeling = this._isWheeling;
      
      // 更新target到机器人位置（移除位置限制，支持任意位置）
      if (this.followBodyId !== null && this.followBodyId !== undefined) {
        const cached = this.lastSimState.bodies.get(this.followBodyId);
        if (cached && cached.position) {
          const pos = cached.position;
          // 验证body名称确实是pelvis（不是球门）
          const body = this.bodies[this.followBodyId];
          if (body && body.name && body.name.includes('pelvis')) {
            // 位置正确，更新target到机器人位置
            this.followTargetDesired.set(pos.x, pos.y + this.followHeight, pos.z);
            this.followTarget.lerp(this.followTargetDesired, this.followLerp);
            this.controls.target.copy(this.followTarget);
            
            // 只有在鼠标没有拖动且滚轮没有使用时，才更新相机位置（保持跟随）
            // 如果鼠标正在拖动或滚轮正在使用，保持相机位置不变（让鼠标控制）
            if (!isMouseDown && !isWheeling) {
              // 使用保存的用户偏移（如果存在），否则使用默认偏移
              const offset = this._userFollowOffset || this.followOffset;
              this.camera.position.copy(this.controls.target).add(offset);
            } else {
              // 鼠标或滚轮正在控制相机，更新偏移量
              this._userFollowOffset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
            }
          }
        }
      }
    } else {
      // 禁用自动聚焦，保持当前target不变（用户可以通过按钮手动聚焦）
      // 只在初始化时设置一次target
      if (!this._cameraTargetInitialized) {
        this.controls.target.set(0, 0.8, 0);
        this._cameraTargetInitialized = true;
      }
    }
    
    // WASD键盘控制相机移动
    if (this.keys) {
      // 检查是否有WASD按键按下
      const isWASDPressed = Object.values(this.keys).some(v => v === true);
      
      const moveSpeed = this.cameraSpeed || 0.5;
      const direction = new THREE.Vector3();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      
      // 计算相机的前方向、右方向和上方向
      this.camera.getWorldDirection(direction);
      right.crossVectors(direction, this.camera.up).normalize();
      up.crossVectors(right, direction).normalize();
      
      let moved = false;
      
      if (this.followEnabled) {
        // 聚焦开启时：键盘不控制任何东西，全部由鼠标控制
        // 不需要处理WASD按键
        // 鼠标控制由OrbitControls自动处理（旋转、平移、缩放）
      } else {
        // 聚焦关闭时：鼠标和键盘都可以控制
        // 鼠标：旋转、缩放（由OrbitControls自动处理）
        // 键盘：WASDQE控制target和相机位置（三个正交方向）
        
        // 计算移动向量（基于相机坐标系）
        const moveDelta = new THREE.Vector3();
        
        // W/S: 前后移动（在水平面上，保持高度不变）
        // 计算相机的前方向，但投影到水平面（Y=0的平面）
        const forward = direction.clone();
        forward.y = 0; // 投影到水平面
        if (forward.lengthSq() > 0.001) {
          forward.normalize();
          if (this.keys['w']) {
            // W: 向前移动（靠近）
            moveDelta.add(forward.clone().multiplyScalar(moveSpeed));
            moved = true;
          }
          if (this.keys['s']) {
            // S: 向后移动（拉远）
            moveDelta.add(forward.clone().multiplyScalar(-moveSpeed));
            moved = true;
          }
        }
        
        // A/D: 左右移动target（沿着右方向，平移，不是旋转）
        if (this.keys['a']) {
          moveDelta.add(right.clone().multiplyScalar(-moveSpeed));
          moved = true;
        }
        if (this.keys['d']) {
          moveDelta.add(right.clone().multiplyScalar(moveSpeed));
          moved = true;
        }
        
        // Q/E: 上下移动摄像头高度（只改变Y轴，不管摄像头视角如何）
        if (this.keys['q']) {
          // Q: 向上移动（增加Y坐标）
          moveDelta.y += moveSpeed;
          moved = true;
        }
        if (this.keys['e']) {
          // E: 向下移动（减少Y坐标）
          moveDelta.y -= moveSpeed;
          moved = true;
        }
        
        // 如果移动了，同时移动target和相机（保持相对位置不变，实现真正的平移）
        if (moved) {
          // 移动target
          this.controls.target.add(moveDelta);
          // 同时移动相机（保持相对位置不变，这样看起来是平移，不是旋转）
          this.camera.position.add(moveDelta);
          // 更新controls
          this.controls.update();
        }
      }
    } else {
      // 没有按键按下
      if (this.followEnabled) {
        // 聚焦开启时，全部由鼠标控制
        this.controls.enableRotate = true;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
      } else {
        // 聚焦关闭时，鼠标和键盘都可以控制
        this.controls.enableRotate = true; // 鼠标拖动旋转
        this.controls.enablePan = false; // 禁用鼠标平移
        this.controls.enableZoom = true; // 鼠标滚轮缩放
      }
    }
    
    // 调试：每60帧输出一次keys状态
    if (!this._wasdDebugCounter) {
      this._wasdDebugCounter = 0;
    }
    this._wasdDebugCounter++;
    if (this._wasdDebugCounter % 60 === 0) {
      const activeKeys = Object.keys(this.keys).filter(k => this.keys[k]);
      if (activeKeys.length > 0) {
        console.log('WASD状态:', activeKeys, 'keys对象:', this.keys);
      }
    }
    this.controls.update();

    for (const [b, cached] of this.lastSimState.bodies) {
      if (this.bodies[b]) {
        this.bodies[b].position.copy(cached.position);
        this.bodies[b].quaternion.copy(cached.quaternion);
        this.bodies[b].updateWorldMatrix();
      }
    }

    for (const [l, cached] of this.lastSimState.lights) {
      if (this.lights[l]) {
        this.lights[l].position.copy(cached.position);
        this.lights[l].lookAt(cached.direction.clone().add(this.lights[l].position));
      }
    }

    if (this.mujocoRoot && this.mujocoRoot.cylinders) {
      const numWraps = this.lastSimState.tendons.numWraps.count;
      this.mujocoRoot.cylinders.count = numWraps;
      this.mujocoRoot.spheres.count = numWraps > 0 ? numWraps + 1 : 0;
      this.mujocoRoot.cylinders.instanceMatrix.needsUpdate = true;
      this.mujocoRoot.spheres.instanceMatrix.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
