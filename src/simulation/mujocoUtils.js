import * as THREE from 'three';
import { Reflector } from './utils/Reflector.js';
import { PolicyRunner } from './policyRunner.js';
import { toFloatArray } from './utils/math.js';

const MOTION_INDEX_FORMAT = 'tracking-motion-index-v1';

function stripJsonExtension(path) {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.json$/i, '');
}

function normalizeMotionEntry(entry) {
  if (typeof entry === 'string') {
    return { name: stripJsonExtension(entry), file: entry };
  }
  if (entry && typeof entry === 'object') {
    const file = entry.file ?? entry.path ?? null;
    if (!file) {
      return null;
    }
    const name = entry.name ?? stripJsonExtension(file);
    return { name, file };
  }
  return null;
}

function parseMotionIndex(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.format !== MOTION_INDEX_FORMAT) {
    return null;
  }
  const motions = Array.isArray(payload.motions) ? payload.motions : [];
  return {
    basePath: payload.base_path ?? null,
    motions
  };
}

async function loadMotionIndex(indexPayload, motionsUrl) {
  const index = parseMotionIndex(indexPayload);
  if (!index) {
    return null;
  }

  const basePath = index.basePath
    ? (index.basePath.endsWith('/') ? index.basePath : `${index.basePath}/`)
    : null;
  const baseUrl = basePath
    ? new URL(basePath, motionsUrl)
    : new URL('.', motionsUrl);
  const motions = {};
  const entries = index.motions.map((entry) => normalizeMotionEntry(entry));

  const requests = entries.map(async (entry) => {
    if (!entry || !entry.file || !entry.name) {
      throw new Error('Motion index entries must include a name and file path.');
    }
    const clipUrl = new URL(entry.file, baseUrl).toString();
    const response = await fetch(clipUrl);
    if (!response.ok) {
      throw new Error(`Failed to load motion clip from ${clipUrl}: ${response.status}`);
    }
    const clip = await response.json();
    motions[entry.name] = clip;
  });

  await Promise.all(requests);
  return motions;
}

export async function reloadScene(mjcf_path) {
  this.scene.remove(this.scene.getObjectByName('MuJoCo Root'));
  const mujoco = this.mujoco;
  console.log('Loading scene:', mjcf_path);

  [this.model, this.data, this.simulation, this.bodies, this.lights] =
    await loadSceneFromURL(mujoco, mjcf_path, this);

  const textDecoder = new TextDecoder();
  const namesArray = new Uint8Array(this.model.names);

  this.jointNamesMJC = [];
  for (let j = 0; j < this.model.njnt; j++) {
    let start_idx = this.model.name_jntadr[j];
    let end_idx = start_idx;
    while (end_idx < namesArray.length && namesArray[end_idx] !== 0) {
      end_idx++;
    }
    this.jointNamesMJC.push(textDecoder.decode(namesArray.subarray(start_idx, end_idx)));
  }

  this.defaultJposPolicy = null;

  this.policyJointNames = null;
  this.ctrl_adr_policy = [];
  this.qpos_adr_policy = [];
  this.qvel_adr_policy = [];
  this.numActions = 0;

  this.timestep = this.model.opt.timestep;
  this.decimation = Math.max(1, Math.round(0.02 / this.timestep));
}

export async function reloadPolicy(policy_path, options = {}) {
  this.currentPolicyPath = policy_path;
  console.log('Reloading policy:', policy_path);

  // 等待所有policyRunner完成推理 (v7.0.4)
  const isMultiRobot = this.robotConfigs && this.robotConfigs.length > 1;
  // v8.0.2: 若切回单机器人，清理多机残留状态（否则会出现 configs=1 但 runners/mappings>1）
  if (!isMultiRobot) {
    this.policyRunners = [];
    this.robotJointMappings = [];
    this.robotPelvisBodyIds = [];
    this.robotPolicyParams = [];
  }
  if (isMultiRobot && this.policyRunners) {
    for (const runner of this.policyRunners) {
      while (runner?.isInferencing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  } else {
    while (this.policyRunner?.isInferencing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const response = await fetch(policy_path);
  if (!response.ok) {
    throw new Error(`Failed to load policy config from ${policy_path}: ${response.status}`);
  }
  const config = await response.json();
  if (options?.onnxPath) {
    config.onnx = { ...(config.onnx ?? {}), path: options.onnxPath };
  }

  let trackingConfig = null;
  if (config.tracking) {
    trackingConfig = { ...config.tracking };
    if (trackingConfig.motions_path && !trackingConfig.motions) {
      const motionsUrl = new URL(trackingConfig.motions_path, window.location.href);
      const response = await fetch(motionsUrl);
      if (!response.ok) {
        throw new Error(`Failed to load tracking motions from ${motionsUrl}: ${response.status}`);
      }
      const payload = await response.json();
      const indexedMotions = await loadMotionIndex(payload, motionsUrl);
      trackingConfig.motions = indexedMotions ?? payload;
    }
  }

  const policyJointNames = Array.isArray(config.policy_joint_names)
    ? config.policy_joint_names
    : null;
  if (!policyJointNames || policyJointNames.length === 0) {
    throw new Error('Policy configuration must include a non-empty policy_joint_names list');
  }

  // 检测多机器人模式 (v7.0.0) - 使用之前已声明的isMultiRobot变量
  if (isMultiRobot) {
    // 多机器人模式：为每个机器人建立映射
    this.robotJointMappings = [];
    
    for (let robotIdx = 0; robotIdx < this.robotConfigs.length; robotIdx++) {
      const robotPrefix = robotIdx === 0 ? '' : `robot${robotIdx + 1}_`;
      configureJointMappingsWithPrefix(this, policyJointNames, robotPrefix, robotIdx);
    }
    
    // 第一个机器人的映射同时更新向后兼容的数组
    if (this.robotJointMappings[0]) {
      this.qpos_adr_policy = this.robotJointMappings[0].qpos_adr_policy.slice();
      this.qvel_adr_policy = this.robotJointMappings[0].qvel_adr_policy.slice();
      this.ctrl_adr_policy = this.robotJointMappings[0].ctrl_adr_policy.slice();
      this.numActions = this.robotJointMappings[0].numActions;
    }
  } else {
    // 单机器人模式（原有逻辑）
    configureJointMappings(this, policyJointNames);
  }
  
  const configDefaultJointPos = Array.isArray(config.default_joint_pos)
    ? config.default_joint_pos
    : null;
  if (configDefaultJointPos) {
    if (configDefaultJointPos.length !== this.numActions) {
      throw new Error(
        `default_joint_pos length ${configDefaultJointPos.length} does not match policy_joint_names length ${this.numActions}`
      );
    }
    this.defaultJposPolicy = new Float32Array(configDefaultJointPos);
  }
  this.kpPolicy = toFloatArray(config.stiffness, this.numActions, 0.0);
  this.kdPolicy = toFloatArray(config.damping, this.numActions, 0.0);
  this.control_type = config.control_type ?? 'joint_position';
  
  // Debug: Log joint mapping for loco policy
  if (policy_path && policy_path.includes('loco') && this.model) {
    // Rebuild actuator2joint mapping for debug output
    const jointTransmission = this.mujoco.mjtTrn.mjTRN_JOINT.value;
    const actuator2joint = [];
    for (let i = 0; i < this.model.nu; i++) {
      if (this.model.actuator_trntype[i] === jointTransmission) {
        actuator2joint.push(this.model.actuator_trnid[2 * i]);
      }
    }
    
    console.log('[Joint Mapping Debug] ===== JOINT MAPPING ANALYSIS =====');
    console.log('[Joint Mapping Debug] MuJoCo joint names order (jointNamesMJC):', this.jointNamesMJC);
    console.log('[Joint Mapping Debug] Policy joint names order:', policyJointNames);
    console.log('[Joint Mapping Debug] Actuator to joint mapping (actuator2joint):', 
      Array.from({length: this.model.nu}, (_, i) => ({
        actuatorIdx: i,
        jointIdx: actuator2joint[i],
        jointName: this.jointNamesMJC[actuator2joint[i]]
      }))
    );
    console.log('[Joint Mapping Debug] Policy action index -> Actuator index (ctrl_adr_policy):', this.ctrl_adr_policy);
    console.log('[Joint Mapping Debug] Detailed mapping (policy action -> MuJoCo actuator):', 
      policyJointNames.map((name, idx) => {
        const jointIdx = this.jointNamesMJC.indexOf(name);
        const actuatorIdx = this.ctrl_adr_policy[idx];
        return {
          policyActionIdx: idx,
          jointName: name,
          mujocoJointIdx: jointIdx,
          mujocoActuatorIdx: actuatorIdx,
          actuatorJointName: actuatorIdx >= 0 && actuatorIdx < actuator2joint.length ? this.jointNamesMJC[actuator2joint[actuatorIdx]] : 'unknown',
          kp: this.kpPolicy[idx],
          kd: this.kdPolicy[idx],
          defaultPos: this.defaultJposPolicy[idx]
        };
      })
    );
    console.log('[Joint Mapping Debug] Left leg joints:', 
      policyJointNames.map((name, idx) => (name.startsWith('left_') && (name.includes('hip') || name.includes('knee') || name.includes('ankle'))) ? {
        policyIdx: idx,
        name: name,
        actuatorIdx: this.ctrl_adr_policy[idx]
      } : null).filter(x => x !== null)
    );
    console.log('[Joint Mapping Debug] Right leg joints:', 
      policyJointNames.map((name, idx) => (name.startsWith('right_') && (name.includes('hip') || name.includes('knee') || name.includes('ankle'))) ? {
        policyIdx: idx,
        name: name,
        actuatorIdx: this.ctrl_adr_policy[idx]
      } : null).filter(x => x !== null)
    );
    console.log('[Joint Mapping Debug] ===== END ANALYSIS =====');
  }

  if (trackingConfig) {
    trackingConfig.policy_joint_names = policyJointNames.slice();
  }

  this.simulation.resetData();
  
  // Set initial joint positions to default_joint_pos if available (for loco policy)
  if (this.defaultJposPolicy && this.qpos_adr_policy && this.qpos_adr_policy.length > 0) {
    const qpos = this.simulation.qpos;
    for (let i = 0; i < this.numActions; i++) {
      const qposAdr = this.qpos_adr_policy[i];
      if (qposAdr >= 0 && qposAdr < qpos.length) {
        qpos[qposAdr] = this.defaultJposPolicy[i];
      }
    }
    // Reset velocities to zero
    const qvel = this.simulation.qvel;
    for (let i = 0; i < this.numActions; i++) {
      const qvelAdr = this.qvel_adr_policy[i];
      if (qvelAdr >= 0 && qvelAdr < qvel.length) {
        qvel[qvelAdr] = 0.0;
      }
    }
  }
  
  this.simulation.forward();
  
  // 检测多机器人模式 (v7.0.4) - 使用之前已声明的isMultiRobot变量
  if (isMultiRobot) {
    // 多机器人模式：为每个机器人创建独立的policyRunner
    // 清理旧的policyRunners（如果有）
    if (this.policyRunners) {
      for (const runner of this.policyRunners) {
        // PolicyRunner可能没有显式的清理方法，但会被垃圾回收
      }
    }
    this.policyRunners = [];
    
    for (let robotIdx = 0; robotIdx < this.robotConfigs.length; robotIdx++) {
      const policyRunner = new PolicyRunner(
        {
          ...config,
          tracking: trackingConfig,
          policy_joint_names: policyJointNames,
          action_scale: config.action_scale,
          default_joint_pos: this.defaultJposPolicy
        },
        {
          policyJointNames,
          actionScale: config.action_scale,
          defaultJointPos: this.defaultJposPolicy
        }
      );
      await policyRunner.init();
      
      const state = this.readPolicyStateForRobot?.(robotIdx);
      if (state) {
        policyRunner.reset(state);
      } else {
        policyRunner.reset();
      }
      
      this.policyRunners[robotIdx] = policyRunner;
      console.log(`Created policy runner for robot ${robotIdx + 1}`);
    }
    
    // 保持向后兼容：第一个机器人的policyRunner也保存到this.policyRunner
    this.policyRunner = this.policyRunners[0];
  } else {
    // 单机器人模式：保持原有逻辑
    this.policyRunner = new PolicyRunner(
      {
        ...config,
        tracking: trackingConfig,
        policy_joint_names: policyJointNames,
        action_scale: config.action_scale,
        default_joint_pos: this.defaultJposPolicy
      },
      {
        policyJointNames,
        actionScale: config.action_scale,
        defaultJointPos: this.defaultJposPolicy
      }
    );
    await this.policyRunner.init();

    const state = this.readPolicyState?.();
    if (state) {
      this.policyRunner.reset(state);
    } else {
      this.policyRunner.reset();
    }
  }

  this.params.current_motion = 'default';
}

/**
 * 仅为指定机器人重载策略（多机器人独立策略的基础能力）(v7.2.2)
 *
 * 注意：
 * - 当前模拟主循环在多机器人模式下仍使用全局 this.control_type 进行分支判断。
 *   因此这里要求所有机器人的 control_type 一致，否则直接抛错。
 * - 主循环的 PD 增益在 v7.2.2 起支持按 robotIdx 读取 this.robotPolicyParams[robotIdx].kp/kd。
 */
export async function reloadPolicyForRobot(robotIdx, policy_path, options = {}) {
  if (typeof robotIdx !== 'number' || !Number.isFinite(robotIdx)) {
    throw new Error('reloadPolicyForRobot: robotIdx must be a number');
  }
  if (!policy_path || typeof policy_path !== 'string') {
    throw new Error('reloadPolicyForRobot: policy_path must be a string');
  }

  const isMultiRobot = this.robotConfigs && this.robotConfigs.length > 1;
  if (!isMultiRobot) {
    // 单机器人：退回全量 reload
    return await reloadPolicy.call(this, policy_path, options);
  }

  const idx = Math.max(0, Math.min(Math.floor(robotIdx), (this.robotConfigs.length - 1)));

  // 等待该机器人的 runner 完成推理，避免并发冲突
  const existingRunner = this.policyRunners?.[idx];
  while (existingRunner?.isInferencing) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const response = await fetch(policy_path);
  if (!response.ok) {
    throw new Error(`Failed to load policy config from ${policy_path}: ${response.status}`);
  }
  const config = await response.json();
  if (options?.onnxPath) {
    config.onnx = { ...(config.onnx ?? {}), path: options.onnxPath };
  }

  let trackingConfig = null;
  if (config.tracking) {
    trackingConfig = { ...config.tracking };
    if (trackingConfig.motions_path && !trackingConfig.motions) {
      const motionsUrl = new URL(trackingConfig.motions_path, window.location.href);
      const response = await fetch(motionsUrl);
      if (!response.ok) {
        throw new Error(`Failed to load tracking motions from ${motionsUrl}: ${response.status}`);
      }
      const payload = await response.json();
      const indexedMotions = await loadMotionIndex(payload, motionsUrl);
      trackingConfig.motions = indexedMotions ?? payload;
    }
  }

  const policyJointNames = Array.isArray(config.policy_joint_names)
    ? config.policy_joint_names
    : null;
  if (!policyJointNames || policyJointNames.length === 0) {
    throw new Error('Policy configuration must include a non-empty policy_joint_names list');
  }

  const newControlType = config.control_type ?? 'joint_position';
  if (this.control_type && this.control_type !== newControlType) {
    throw new Error(`control_type mismatch: existing=${this.control_type}, new=${newControlType}`);
  }
  this.control_type = newControlType;

  // 为该机器人更新关节映射（允许不同策略有不同 policy_joint_names）
  if (!this.robotJointMappings) {
    this.robotJointMappings = [];
  }
  const robotPrefix = idx === 0 ? '' : `robot${idx + 1}_`;
  configureJointMappingsWithPrefix(this, policyJointNames, robotPrefix, idx);

  const mapping = this.robotJointMappings[idx];
  if (!mapping) {
    throw new Error(`Failed to configure joint mapping for robot ${idx}`);
  }

  const numActions = mapping.numActions ?? policyJointNames.length;
  const configDefaultJointPos = Array.isArray(config.default_joint_pos)
    ? config.default_joint_pos
    : null;
  if (configDefaultJointPos && configDefaultJointPos.length !== numActions) {
    throw new Error(
      `default_joint_pos length ${configDefaultJointPos.length} does not match numActions ${numActions}`
    );
  }

  const defaultJposPolicy = configDefaultJointPos ? new Float32Array(configDefaultJointPos) : null;
  const kpPolicy = toFloatArray(config.stiffness, numActions, 0.0);
  const kdPolicy = toFloatArray(config.damping, numActions, 0.0);

  if (trackingConfig) {
    trackingConfig.policy_joint_names = policyJointNames.slice();
  }

  // 创建该机器人的独立 PolicyRunner
  const policyRunner = new PolicyRunner(
    {
      ...config,
      tracking: trackingConfig,
      policy_joint_names: policyJointNames,
      action_scale: config.action_scale,
      default_joint_pos: defaultJposPolicy
    },
    {
      policyJointNames,
      actionScale: config.action_scale,
      defaultJointPos: defaultJposPolicy
    }
  );
  await policyRunner.init();

  const state = this.readPolicyStateForRobot?.(idx);
  if (state) {
    policyRunner.reset(state);
  } else {
    policyRunner.reset();
  }

  if (!this.policyRunners) {
    this.policyRunners = [];
  }
  this.policyRunners[idx] = policyRunner;
  if (idx === 0) {
    // 向后兼容
    this.policyRunner = policyRunner;
  }

  // 记录 per-robot 策略参数，供主循环使用
  if (!this.robotPolicyParams) {
    this.robotPolicyParams = [];
  }
  this.robotPolicyParams[idx] = {
    kp: kpPolicy,
    kd: kdPolicy,
    control_type: newControlType,
    defaultJointPos: defaultJposPolicy,
    policyPath: policy_path,
    policyJointNames: policyJointNames.slice()
  };

  // 更新配置记录（供 UI/调试查看）
  if (Array.isArray(this.robotConfigs) && this.robotConfigs[idx]) {
    this.robotConfigs[idx].policyPath = policy_path;
  }
  this.currentPolicyPath = policy_path;

  console.log(`Reloaded policy for robot ${idx + 1}:`, policy_path);
  return true;
}

export async function loadSceneFromURL(mujoco, filename, parent) {
  if (parent.simulation) {
    parent.simulation.free();
    parent.simulation = null;
    parent.model = null;
    parent.data = null;
  }

  const model = mujoco.MjModel.loadFromXML('/working/' + filename);
  const data = new mujoco.MjData(model);
  const simulation = createSimulationWrapper(mujoco, model, data);

  const textDecoder = new TextDecoder('utf-8');
  const names_array = new Uint8Array(model.names);
  const fullString = textDecoder.decode(model.names);
  const names = fullString.split(textDecoder.decode(new ArrayBuffer(1)));

  const mujocoRoot = new THREE.Group();
  mujocoRoot.name = 'MuJoCo Root';
  parent.scene.add(mujocoRoot);

  const bodies = {};
  const meshes = {};
  const lights = [];

  let material = new THREE.MeshPhysicalMaterial();
  material.color = new THREE.Color(1, 1, 1);

  for (let g = 0; g < model.ngeom; g++) {
    if (!(model.geom_group[g] < 3)) { continue; }

    let b = model.geom_bodyid[g];
    let type = model.geom_type[g];
    let size = [
      model.geom_size[(g * 3) + 0],
      model.geom_size[(g * 3) + 1],
      model.geom_size[(g * 3) + 2]
    ];

    if (!(b in bodies)) {
      bodies[b] = new THREE.Group();

      let start_idx = model.name_bodyadr[b];
      let end_idx = start_idx;
      while (end_idx < names_array.length && names_array[end_idx] !== 0) {
        end_idx++;
      }
      let name_buffer = names_array.subarray(start_idx, end_idx);
      bodies[b].name = textDecoder.decode(name_buffer);

      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;

      if (bodies[b].name === 'base') {
        parent.pelvis_body_id = b;
      }
    }

    let geometry = new THREE.SphereGeometry(size[0] * 0.5);
    if (type == mujoco.mjtGeom.mjGEOM_PLANE.value) {
      // Special handling for plane later.
    } else if (type == mujoco.mjtGeom.mjGEOM_HFIELD.value) {
      // TODO: Implement this.
    } else if (type == mujoco.mjtGeom.mjGEOM_SPHERE.value) {
      geometry = new THREE.SphereGeometry(size[0]);
    } else if (type == mujoco.mjtGeom.mjGEOM_CAPSULE.value) {
      geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2.0, 20, 20);
    } else if (type == mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) {
      geometry = new THREE.SphereGeometry(1);
    } else if (type == mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
      geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_BOX.value) {
      geometry = new THREE.BoxGeometry(size[0] * 2.0, size[2] * 2.0, size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_MESH.value) {
      let meshID = model.geom_dataid[g];

      if (!(meshID in meshes)) {
        geometry = new THREE.BufferGeometry();

        let vertex_buffer = model.mesh_vert.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3);
        for (let v = 0; v < vertex_buffer.length; v += 3) {
          let temp = vertex_buffer[v + 1];
          vertex_buffer[v + 1] = vertex_buffer[v + 2];
          vertex_buffer[v + 2] = -temp;
        }

        let normal_buffer = model.mesh_normal.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3);
        for (let v = 0; v < normal_buffer.length; v += 3) {
          let temp = normal_buffer[v + 1];
          normal_buffer[v + 1] = normal_buffer[v + 2];
          normal_buffer[v + 2] = -temp;
        }

        let uv_buffer = model.mesh_texcoord.subarray(
          model.mesh_texcoordadr[meshID] * 2,
          (model.mesh_texcoordadr[meshID] + model.mesh_vertnum[meshID]) * 2);
        let triangle_buffer = model.mesh_face.subarray(
          model.mesh_faceadr[meshID] * 3,
          (model.mesh_faceadr[meshID] + model.mesh_facenum[meshID]) * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertex_buffer, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normal_buffer, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv_buffer, 2));
        geometry.setIndex(Array.from(triangle_buffer));
        meshes[meshID] = geometry;
      } else {
        geometry = meshes[meshID];
      }

      bodies[b].has_custom_mesh = true;
    }

    let texture = undefined;
    let color = [
      model.geom_rgba[(g * 4) + 0],
      model.geom_rgba[(g * 4) + 1],
      model.geom_rgba[(g * 4) + 2],
      model.geom_rgba[(g * 4) + 3]
    ];
    if (model.geom_matid[g] != -1) {
      let matId = model.geom_matid[g];
      color = [
        model.mat_rgba[(matId * 4) + 0],
        model.mat_rgba[(matId * 4) + 1],
        model.mat_rgba[(matId * 4) + 2],
        model.mat_rgba[(matId * 4) + 3]
      ];

      texture = undefined;
      const mjNTEXROLE = 10;
      const mjTEXROLE_RGB = 1;
      let texId = model.mat_texid[(matId * mjNTEXROLE) + mjTEXROLE_RGB];

      if (texId != -1) {
        let width = model.tex_width[texId];
        let height = model.tex_height[texId];
        let offset = model.tex_adr[texId];
        let channels = model.tex_nchannel[texId];
        let texData = model.tex_data;
        let rgbaArray = new Uint8Array(width * height * 4);
        for (let p = 0; p < width * height; p++) {
          rgbaArray[(p * 4) + 0] = texData[offset + ((p * channels) + 0)];
          rgbaArray[(p * 4) + 1] = channels > 1 ? texData[offset + ((p * channels) + 1)] : rgbaArray[(p * 4) + 0];
          rgbaArray[(p * 4) + 2] = channels > 2 ? texData[offset + ((p * channels) + 2)] : rgbaArray[(p * 4) + 0];
          rgbaArray[(p * 4) + 3] = channels > 3 ? texData[offset + ((p * channels) + 3)] : 255;
        }
        texture = new THREE.DataTexture(rgbaArray, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
        if (texId == 2) {
          texture.repeat = new THREE.Vector2(100, 100);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
        } else {
          texture.repeat = new THREE.Vector2(
            model.mat_texrepeat[(model.geom_matid[g] * 2) + 0],
            model.mat_texrepeat[(model.geom_matid[g] * 2) + 1]);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
        }

        texture.needsUpdate = true;
      }
    }

    const materialOptions = {
      color: new THREE.Color(color[0], color[1], color[2]),
      transparent: color[3] < 1.0,
      opacity: color[3] / 255,
      specularIntensity: model.geom_matid[g] != -1 ? model.mat_specular[model.geom_matid[g]] : undefined,
      reflectivity: model.geom_matid[g] != -1 ? model.mat_reflectance[model.geom_matid[g]] : undefined,
      roughness: model.geom_matid[g] != -1 ? 1.0 - model.mat_shininess[model.geom_matid[g]] * -1.0 : undefined,
      metalness: model.geom_matid[g] != -1 ? model.mat_metallic[model.geom_matid[g]] : undefined
    };
    if (texture) {
      materialOptions.map = texture;
    }

    let currentMaterial = new THREE.MeshPhysicalMaterial(materialOptions);

    let mesh = new THREE.Mesh();
    if (type == 0) {
      mesh = new Reflector(new THREE.PlaneGeometry(100, 100), { clipBias: 0.003, texture });
      mesh.rotateX(-Math.PI / 2);
      mesh.material.depthWrite = false;
      mesh.renderOrder = -1;
    } else {
      mesh = new THREE.Mesh(geometry, currentMaterial);
    }

    mesh.castShadow = g == 0 ? false : true;
    mesh.receiveShadow = type != 7;
    mesh.bodyID = b;
    bodies[b].add(mesh);
    getPosition(model.geom_pos, g, mesh.position);
    if (type != 0) {
      getQuaternion(model.geom_quat, g, mesh.quaternion);
    }
    if (type == 4) {
      mesh.scale.set(size[0], size[2], size[1]);
    }
  }

  let tendonMat = new THREE.MeshPhongMaterial();
  tendonMat.color = new THREE.Color(0.8, 0.3, 0.3);
  mujocoRoot.cylinders = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1),
    tendonMat,
    1023
  );
  mujocoRoot.cylinders.receiveShadow = true;
  mujocoRoot.cylinders.castShadow = true;
  mujocoRoot.add(mujocoRoot.cylinders);
  mujocoRoot.spheres = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 10),
    tendonMat,
    1023
  );
  mujocoRoot.spheres.receiveShadow = true;
  mujocoRoot.spheres.castShadow = true;
  mujocoRoot.add(mujocoRoot.spheres);

  for (let l = 0; l < model.nlight; l++) {
    let light = new THREE.SpotLight();
    if (model.light_type[l] == 0) {
      light = new THREE.SpotLight();
    } else if (model.light_type[l] == 1) {
      light = new THREE.DirectionalLight();
    } else if (model.light_type[l] == 2) {
      light = new THREE.PointLight();
    } else if (model.light_type[l] == 3) {
      light = new THREE.HemisphereLight();
    }
    if (model.light_diffuse && model.light_diffuse.length >= (l + 1) * 3) {
      const r = model.light_diffuse[(l * 3) + 0];
      const g = model.light_diffuse[(l * 3) + 1];
      const b = model.light_diffuse[(l * 3) + 2];
      const max = Math.max(r, g, b);
      if (max > 0) {
        light.color.setRGB(r / max, g / max, b / max);
        light.intensity = max;
      } else {
        light.color.setRGB(1, 1, 1);
        light.intensity = 1;
      }
    }
    light.decay = model.light_attenuation[l] * 100;
    light.penumbra = 0.5;
    if (model.light_castshadow) {
      light.castShadow = model.light_castshadow[l] !== 0;
    } else {
      light.castShadow = true;
    }

    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 10;
    if (bodies[0]) {
      bodies[0].add(light);
    } else {
      mujocoRoot.add(light);
    }
    lights.push(light);
  }
  if (model.nlight == 0) {
    let light = new THREE.DirectionalLight();
    mujocoRoot.add(light);
  }

  for (let b = 0; b < model.nbody; b++) {
    if (b == 0 || !bodies[0]) {
      mujocoRoot.add(bodies[b]);
    } else if (bodies[b]) {
      bodies[0].add(bodies[b]);
    } else {
      bodies[b] = new THREE.Group();
      bodies[b].name = names[b + 1];
      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;
      bodies[0].add(bodies[b]);
    }
  }

  parent.mujocoRoot = mujocoRoot;
  if (parent.lastSimState) {
    parent.lastSimState.bodies = new Map();
    parent.lastSimState.lights = new Map();
    parent.lastSimState.tendons = {
      numWraps: { count: 0 },
      matrix: new THREE.Matrix4()
    };
  }

  parent.lastSimState.bodies.clear?.();
  parent.lastSimState.lights.clear?.();

  return [model, data, simulation, bodies, lights];
}

function configureJointMappings(demo, jointNames) {
  const model = demo.model;
  const mujoco = demo.mujoco;

  demo.policyJointNames = jointNames.slice();

  const jointTransmission = mujoco.mjtTrn.mjTRN_JOINT.value;
  const actuator2joint = [];
  for (let i = 0; i < model.nu; i++) {
    if (model.actuator_trntype[i] !== jointTransmission) {
      throw new Error(`Actuator ${i} transmission type is not mjTRN_JOINT`);
    }
    actuator2joint.push(model.actuator_trnid[2 * i]);
  }

  demo.ctrl_adr_policy = [];
  demo.qpos_adr_policy = [];
  demo.qvel_adr_policy = [];

  for (const name of jointNames) {
    const jointIdx = demo.jointNamesMJC.indexOf(name);
    if (jointIdx < 0) {
      throw new Error(`Joint "${name}" not found in MuJoCo model`);
    }
    const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);
    if (actuatorIdx < 0) {
      throw new Error(`No actuator mapped to joint "${name}"`);
    }
    demo.ctrl_adr_policy.push(actuatorIdx);
    demo.qpos_adr_policy.push(model.jnt_qposadr[jointIdx]);
    demo.qvel_adr_policy.push(model.jnt_dofadr[jointIdx]);
  }

  demo.numActions = jointNames.length;

  demo.defaultJposPolicy = new Float32Array(demo.numActions);
  demo.defaultJposPolicy.fill(0.0);
}

/**
 * 为指定机器人配置关节映射（多机器人支持）(v7.0.0)
 * 复用configureJointMappings的逻辑，但支持关节名称前缀
 * @param {MuJoCoDemo} demo - MuJoCoDemo实例
 * @param {Array<string>} jointNames - 策略关节名称列表（原始名称，无前缀）
 * @param {string} prefix - 机器人前缀（如 'robot2_' 或 ''）
 * @param {number} robotIndex - 机器人索引
 */
function configureJointMappingsWithPrefix(demo, jointNames, prefix, robotIndex) {
  const model = demo.model;
  const mujoco = demo.mujoco;
  
  // 构建带前缀的关节名称列表
  const prefixedJointNames = jointNames.map(name => prefix + name);
  
  // 建立actuator到joint的映射（和configureJointMappings一样）
  const jointTransmission = mujoco.mjtTrn.mjTRN_JOINT.value;
  const actuator2joint = [];
  for (let i = 0; i < model.nu; i++) {
    if (model.actuator_trntype[i] !== jointTransmission) {
      continue; // 跳过非关节执行器
    }
    actuator2joint.push(model.actuator_trnid[2 * i]);
  }
  
  // 创建映射对象
  const mapping = {
    qpos_adr_policy: [],
    qvel_adr_policy: [],
    ctrl_adr_policy: [],
    numActions: 0
  };
  
  // 为每个策略关节建立映射
  for (let i = 0; i < prefixedJointNames.length; i++) {
    const fullJointName = prefixedJointNames[i];
    const jointIdx = demo.jointNamesMJC.indexOf(fullJointName);
    
    if (jointIdx < 0) {
      throw new Error(`Joint "${fullJointName}" not found in MuJoCo model for robot ${robotIndex + 1}`);
    }
    
    // 查找对应的执行器
    const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);
    if (actuatorIdx < 0) {
      throw new Error(`No actuator mapped to joint "${fullJointName}" for robot ${robotIndex + 1}`);
    }
    
    mapping.qpos_adr_policy.push(model.jnt_qposadr[jointIdx]);
    mapping.qvel_adr_policy.push(model.jnt_dofadr[jointIdx]);
    mapping.ctrl_adr_policy.push(actuatorIdx);
  }
  
  mapping.numActions = prefixedJointNames.length;
  
  // 查找该机器人的freejoint地址 (v7.0.4: 使用已记录的robotPelvisBodyIds)
  let pelvisBodyId = -1;
  
  // 优先使用已记录的robotPelvisBodyIds（在setMultiRobotInitialPositions中已查找）
  if (demo.robotPelvisBodyIds && demo.robotPelvisBodyIds[robotIndex] !== undefined) {
    pelvisBodyId = demo.robotPelvisBodyIds[robotIndex];
  } else {
    // 如果robotPelvisBodyIds不存在，回退到重新查找
    const robotPrefix = robotIndex === 0 ? 'pelvis' : `robot${robotIndex + 1}_pelvis`;
    const textDecoder = new TextDecoder();
    const namesArray = new Uint8Array(model.names);
    
    for (let b = 0; b < model.nbody; b++) {
      let start_idx = model.name_bodyadr[b];
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
  }
  
  // 查找对应的freejoint (v7.0.5: 不检查类型，直接使用pelvis body的第一个joint)
  if (pelvisBodyId >= 0) {
    for (let j = 0; j < model.njnt; j++) {
      if (model.jnt_bodyid[j] === pelvisBodyId) {
        const qposAdr = model.jnt_qposadr[j];
        const qvelAdr = model.jnt_dofadr[j];
        if (qposAdr >= 0) {
          // 存储freejoint地址到映射中（pelvis body通常只有一个joint，就是freejoint）
          mapping.freejoint_qpos_adr = qposAdr;
          mapping.freejoint_qvel_adr = qvelAdr;
          break;
        }
      }
    }
  }
  
  // 如果没有找到freejoint，使用默认值（第一个机器人的地址）
  if (mapping.freejoint_qpos_adr === undefined) {
    console.warn(`Could not find freejoint for robot ${robotIndex + 1}, using default (0-6)`);
    mapping.freejoint_qpos_adr = 0;
    mapping.freejoint_qvel_adr = 0;
  }
  
  // 存储到robotJointMappings数组
  if (!demo.robotJointMappings) {
    demo.robotJointMappings = [];
  }
  demo.robotJointMappings[robotIndex] = mapping;
  
  console.log(`Configured joint mappings for robot ${robotIndex + 1} (prefix: "${prefix}"), freejoint qpos_adr: ${mapping.freejoint_qpos_adr}`);
}

export async function downloadExampleScenesFolder(mujoco) {
  const response = await fetch('./examples/scenes/files.json');
  const allFiles = await response.json();

  const requests = allFiles.map((url) => fetch('./examples/scenes/' + url));
  const responses = await Promise.all(requests);

  for (let i = 0; i < responses.length; i++) {
    let split = allFiles[i].split('/');
    let working = '/working/';
    for (let f = 0; f < split.length - 1; f++) {
      working += split[f];
      if (!mujoco.FS.analyzePath(working).exists) {
        mujoco.FS.mkdir(working);
      }
      working += '/';
    }

    if (allFiles[i].match(/\.(png|stl|skn)$/i)) {
      mujoco.FS.writeFile('/working/' + allFiles[i], new Uint8Array(await responses[i].arrayBuffer()));
    } else {
      mujoco.FS.writeFile('/working/' + allFiles[i], await responses[i].text());
    }
  }
}

export function getPosition(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      buffer[(index * 3) + 0],
      buffer[(index * 3) + 2],
      -buffer[(index * 3) + 1]
    );
  }
  return target.set(
    buffer[(index * 3) + 0],
    buffer[(index * 3) + 1],
    buffer[(index * 3) + 2]
  );
}

export function getQuaternion(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      -buffer[(index * 4) + 1],
      -buffer[(index * 4) + 3],
      buffer[(index * 4) + 2],
      -buffer[(index * 4) + 0]
    );
  }
  return target.set(
    buffer[(index * 4) + 0],
    buffer[(index * 4) + 1],
    buffer[(index * 4) + 2],
    buffer[(index * 4) + 3]
  );
}

export function toMujocoPos(target) {
  return target.set(target.x, -target.z, target.y);
}


function createSimulationWrapper(mujoco, model, data) {
  const force = new Float64Array(3);
  const torque = new Float64Array(3);
  const point = new Float64Array(3);

  return {
    get qpos() { return data.qpos; },
    get qvel() { return data.qvel; },
    get ctrl() { return data.ctrl; },
    get qfrc_applied() { return data.qfrc_applied; },
    get xpos() { return data.xpos; },
    get xquat() { return data.xquat; },
    get light_xpos() { return data.light_xpos; },
    get light_xdir() { return data.light_xdir; },
    get ten_wrapadr() { return model.ten_wrapadr; },
    get ten_wrapnum() { return model.ten_wrapnum; },
    get wrap_xpos() { return data.wrap_xpos; },
    step() {
      mujoco.mj_step(model, data);
    },
    resetData() {
      mujoco.mj_resetData(model, data);
    },
    forward() {
      mujoco.mj_forward(model, data);
    },
    applyForce(fx, fy, fz, tx, ty, tz, px, py, pz, bodyId) {
      force[0] = fx; force[1] = fy; force[2] = fz;
      torque[0] = tx; torque[1] = ty; torque[2] = tz;
      point[0] = px; point[1] = py; point[2] = pz;
      mujoco.mj_applyFT(model, data, force, torque, point, bodyId, data.qfrc_applied);
    },
    free() {
      data.delete();
      model.delete();
    }
  };
}
