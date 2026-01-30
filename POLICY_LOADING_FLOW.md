# 策略加载和部署流程

## 完整流程概览

```
用户选择策略 (Demo.vue)
    ↓
onPolicyChange() 方法
    ↓
demo.reloadPolicy() (mujocoUtils.js)
    ↓
加载 JSON 配置文件
    ↓
创建 PolicyRunner 实例
    ↓
PolicyRunner.init() (policyRunner.js)
    ↓
加载 ONNX 模型 (onnxHelper.js)
    ↓
LSTM Warmup (50次推理)
    ↓
策略就绪，开始运行
```

---

## 1. 策略定义（Demo.vue）

**文件位置**：`src/views/Demo.vue`

**代码位置**：第 506-530 行

```javascript
policies: [
  {
    value: 'g1-tracking-lafan',
    title: 'G1 Tracking (LaFan1)',
    description: 'General tracking policy trained on LaFan1 dataset.',
    supportsTracking: true,
    policyPath: './examples/checkpoints/g1/tracking_policy_lafan.json',
    onnxPath: './examples/checkpoints/g1/policy_lafan.onnx'
  },
  {
    value: 'g1-tracking-lafan_amass',
    title: 'G1 Tracking (LaFan1&AMASS)',
    description: 'General tracking policy trained on LaFan1 and AMASS datasets.',
    supportsTracking: true,
    policyPath: './examples/checkpoints/g1/tracking_policy_amass.json',
    onnxPath: './examples/checkpoints/g1/policy_amass.onnx'
  },
  {
    value: 'g1-loco-29dof',
    title: 'G1 Locomotion (Gamepad)',
    description: 'Velocity-conditioned locomotion policy. Use a gamepad to command walking.',
    supportsTracking: false,
    policyPath: './examples/checkpoints/g1/loco_policy_29dof.json',  // ← 策略配置文件路径
    onnxPath: './examples/checkpoints/g1/policy_loco_29dof.onnx'    // ← ONNX 模型路径
  }
],
```

---

## 2. 用户选择策略（Demo.vue）

**文件位置**：`src/views/Demo.vue`

**代码位置**：第 1328-1370 行

```javascript
async onPolicyChange(value) {
  if (!this.demo || !value) {
    return;
  }
  
  // 找到选中的策略配置
  const selected = this.policies.find((policy) => policy.value === value);
  if (!selected) {
    return;
  }
  
  // 检查是否需要重新加载
  const needsReload = selected.policyPath !== this.demo.currentPolicyPath || selected.onnxPath;
  if (!needsReload) {
    return;
  }
  
  // 暂停模拟
  const wasPaused = this.demo.params?.paused ?? false;
  this.demo.params.paused = true;
  this.isPolicyLoading = true;
  this.policyLoadError = '';
  
  try {
    // 调用 demo.reloadPolicy 加载策略
    await this.demo.reloadPolicy(selected.policyPath, {
      onnxPath: selected.onnxPath || undefined
    });
    
    // 更新 UI 标签
    this.policyLabel = selected.policyPath?.split('/').pop() ?? this.policyLabel;
    
    // ... 其他更新逻辑
  } catch (error) {
    // 错误处理
    this.policyLoadError = error.message || error.toString();
  } finally {
    this.isPolicyLoading = false;
    this.demo.params.paused = wasPaused;
  }
}
```

---

## 3. 加载策略配置（mujocoUtils.js）

**文件位置**：`src/simulation/mujocoUtils.js`

**代码位置**：第 107-350 行

```javascript
export async function reloadPolicy(policy_path, options = {}) {
  this.currentPolicyPath = policy_path;
  console.log('Reloading policy:', policy_path);

  // 1. 等待所有 policyRunner 完成推理
  const isMultiRobot = this.robotConfigs && this.robotConfigs.length > 1;
  // ... 等待逻辑

  // 2. 加载 JSON 配置文件
  const response = await fetch(policy_path);
  if (!response.ok) {
    throw new Error(`Failed to load policy config from ${policy_path}: ${response.status}`);
  }
  const config = await response.json();
  
  // 3. 如果提供了 onnxPath，覆盖配置中的路径
  if (options?.onnxPath) {
    config.onnx = { ...(config.onnx ?? {}), path: options.onnxPath };
  }

  // 4. 处理 tracking 配置（如果有）
  let trackingConfig = null;
  if (config.tracking) {
    // ... 加载 motion 数据
  }

  // 5. 获取策略关节名称
  const policyJointNames = Array.isArray(config.policy_joint_names)
    ? config.policy_joint_names
    : null;
  if (!policyJointNames || policyJointNames.length === 0) {
    throw new Error('Policy configuration must include a non-empty policy_joint_names list');
  }

  // 6. 配置关节映射（单机器人或多机器人）
  if (isMultiRobot) {
    // 多机器人模式：为每个机器人建立映射
    // ...
  } else {
    // 单机器人模式
    configureJointMappings(this, policyJointNames);
  }
  
  // 7. 读取配置参数
  const configDefaultJointPos = Array.isArray(config.default_joint_pos)
    ? config.default_joint_pos
    : null;
  if (configDefaultJointPos) {
    this.defaultJposPolicy = new Float32Array(configDefaultJointPos);
  }
  this.kpPolicy = toFloatArray(config.stiffness, this.numActions, 0.0);
  this.kdPolicy = toFloatArray(config.damping, this.numActions, 0.0);
  this.control_type = config.control_type ?? 'joint_position';

  // 8. 创建 PolicyRunner 实例
  if (isMultiRobot) {
    // 多机器人模式：为每个机器人创建 PolicyRunner
    // ...
  } else {
    // 单机器人模式
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
    
    // 9. 初始化 PolicyRunner
    await this.policyRunner.init();

    // 10. 重置策略状态
    const state = this.readPolicyState?.();
    if (state) {
      this.policyRunner.reset(state);
    } else {
      this.policyRunner.reset();
    }
  }

  this.params.current_motion = 'default';
}
```

---

## 4. PolicyRunner 初始化（policyRunner.js）

**文件位置**：`src/simulation/policyRunner.js`

**代码位置**：第 67-84 行

```javascript
async init() {
  // 1. 初始化 ONNX 模块（加载模型）
  await this.module.init();
  
  // 2. 验证观察向量大小是否匹配
  this._assertObsSizeMatchesModelMeta();
  
  // 3. 打印初始化信息
  console.log('%c[PolicyRunner] Policy initialized - Debug logs will appear below', 'color: green; font-weight: bold; font-size: 14px;');
  console.log('[PolicyRunner] Policy initialized:', {
    numActions: this.numActions,
    numObs: this.numObs,
    obsModules: this.obsModules.map(m => ({ name: m.constructor.name, size: m.size }))
  });
  
  // 4. 重置策略状态
  this.reset();
  
  // 5. LSTM 状态预热（50次推理）
  await this._warmupLSTMState();
}
```

---

## 5. ONNX 模型加载（onnxHelper.js）

**文件位置**：`src/simulation/onnxHelper.js`

**代码位置**：第 11-31 行

```javascript
async init() {
  // 1. 加载 ONNX 模型文件
  const modelResponse = await fetch(this.modelPath);
  const modelArrayBuffer = await modelResponse.arrayBuffer();

  // 2. 读取配置中的输入/输出键
  this.inKeys = this.metaData["in_keys"];
  this.outKeys = this.metaData["out_keys"];

  // 3. 创建 ONNX Runtime 会话
  this.session = await ort.InferenceSession.create(modelArrayBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });

  // 4. 打印模型信息
  console.log('ONNX model loaded successfully');
  console.log("inKeys", this.inKeys);
  console.log("outKeys", this.outKeys);
  console.log("inputNames", this.session.inputNames);
  console.log("outputNames", this.session.outputNames);
}
```

---

## 6. LSTM 状态预热（policyRunner.js）

**文件位置**：`src/simulation/policyRunner.js`

**代码位置**：第 86-140 行

```javascript
async _warmupLSTMState() {
  // 1. 创建全零状态用于预热
  const warmupState = {
    rootAngVel: new Float32Array(3),
    rootQuat: new Float32Array([0, 0, 0, 1]), // identity quaternion
    rootPos: new Float32Array(3),
    jointPos: new Float32Array(this.numActions).fill(0),
    jointVel: new Float32Array(this.numActions).fill(0)
  };
  
  // 2. 确保命令为零
  this.command.fill(0.0);
  
  // 3. 重置观察模块
  for (const obs of this.obsModules) {
    if (typeof obs.reset === 'function') {
      obs.reset(warmupState);
    }
  }
  
  // 4. 构建全零观察向量
  const obsVec = new Float32Array(this.numObs);
  let offset = 0;
  for (const obs of this.obsModules) {
    const obsValue = obs.compute(warmupState);
    if (obsValue instanceof Float32Array || Array.isArray(obsValue)) {
      const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
      obsVec.set(obsArray, offset);
      offset += obsArray.length;
    }
  }
  
  // 5. 运行 50 次预热推理
  console.log('%c[PolicyRunner] Warming up LSTM/internal state (50 iterations)...', 'color: cyan; font-weight: bold;');
  const warmupCount = 50;
  for (let i = 0; i < warmupCount; i++) {
    const inputDict = { ...this.inputDict };
    inputDict["policy"] = new ort.Tensor('float32', obsVec, [1, this.numObs]);
    
    try {
      const [result, carry] = await this.module.runInference(inputDict);
      // 更新 inputDict（用于 recurrent 模型）
      if (carry && Object.keys(carry).length > 0) {
        Object.assign(this.inputDict, carry);
      }
    } catch (err) {
      console.warn(`[PolicyRunner] Warmup inference ${i + 1}/${warmupCount} failed:`, err);
    }
  }
  console.log(`%c[PolicyRunner] LSTM warmup completed (${warmupCount} iterations)`, 'color: cyan; font-weight: bold;');
  this._warmupDone = true;
}
```

---

## 7. 策略执行（main.js）

**文件位置**：`src/simulation/main.js`

**代码位置**：第 620-627 行（单机器人模式）

```javascript
// 在主循环中
const state = this.readPolicyState();
try {
  // 设置命令（游戏手柄输入）
  this.policyRunner.setCommand?.(this.cmd);
  
  // 运行策略推理
  this.actionTarget = await this.policyRunner.step(state);
  
  // actionTarget 会被应用到 MuJoCo 关节
} catch (e) {
  console.error('Inference error in main loop:', e);
}
```

---

## 关键文件总结

| 文件 | 作用 |
|------|------|
| `src/views/Demo.vue` | UI 界面，策略选择 |
| `src/simulation/mujocoUtils.js` | 策略配置加载，创建 PolicyRunner |
| `src/simulation/policyRunner.js` | 策略运行器，推理逻辑 |
| `src/simulation/onnxHelper.js` | ONNX 模型加载和推理 |
| `src/simulation/observationHelpers.js` | 观察向量构建 |
| `src/simulation/main.js` | 主循环，调用策略推理 |
| `public/examples/checkpoints/g1/loco_policy_29dof.json` | 策略配置文件 |

---

## 策略配置文件结构

**文件位置**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

```json
{
  "onnx": {
    "meta": {
      "in_keys": ["policy"],
      "out_keys": ["action"],
      "in_shapes": [[[1, 96]]]
    },
    "path": "./examples/checkpoints/g1/policy_loco_29dof.onnx"
  },
  "obs_config": {
    "policy": [
      { "name": "RootAngVelB" },
      { "name": "ProjectedGravityB" },
      { "name": "Command" },
      { "name": "JointPosRel" },
      { "name": "JointVel" },
      { "name": "PrevActions", "history_steps": 1 }
    ]
  },
  "policy_joint_names": [...],
  "action_scale": 0.5,
  "action_clip": 100.0,
  "action_squash": "tanh",
  "stiffness": [...],
  "damping": [...],
  "control_type": "joint_position",
  "default_joint_pos": [...]
}
```

---

## 总结

策略的加载和部署流程：

1. **定义**：在 `Demo.vue` 的 `policies` 数组中定义策略配置
2. **选择**：用户选择策略，触发 `onPolicyChange()`
3. **加载配置**：`reloadPolicy()` 加载 JSON 配置文件
4. **创建运行器**：创建 `PolicyRunner` 实例
5. **初始化**：`PolicyRunner.init()` 加载 ONNX 模型
6. **预热**：运行 50 次 LSTM 状态预热
7. **执行**：在主循环中每帧调用 `policyRunner.step()`
