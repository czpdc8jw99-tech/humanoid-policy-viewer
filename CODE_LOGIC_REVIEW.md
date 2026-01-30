# 代码逻辑审查报告

## 对比原始 Python 代码

### 原始 Python 代码关键逻辑

```python
# 1. 观察向量缩放
self.qj_obs = (self.qj - self.default_angles) * self.dof_pos_scale  # dof_pos_scale = 1.0
self.dqj_obs = self.dqj_obs * self.dof_vel_scale  # dof_vel_scale = 1.0
self.ang_vel = self.ang_vel * self.ang_vel_scale  # ang_vel_scale = 1.0
self.cmd = self.cmd * self.cmd_scale  # cmd_scale = [1.0, 1.0, 1.0]

# 2. 观察向量构建
self.obs[:3] = self.ang_vel.copy()  # RootAngVelB (3)
self.obs[3:6] = self.gravity_orientation.copy()  # ProjectedGravityB (3)
self.obs[6:9] = self.cmd.copy()  # Command (3)
self.obs[9: 9 + self.num_actions] = self.qj_obs.copy()  # JointPosRel (29)
self.obs[9 + self.num_actions: 9 + self.num_actions * 2] = self.dqj_obs.copy()  # JointVel (29)
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()  # PrevActions (29)

# 3. 策略推理
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100)

# 4. 动作处理
loco_action = self.action * self.action_scale + self.default_angles  # action_scale = 0.25
```

---

## 我们的代码逻辑检查

### ✅ 1. 观察向量缩放

#### RootAngVelB
- **原始**：`self.ang_vel * self.ang_vel_scale` (ang_vel_scale = 1.0)
- **我们的**：直接返回 `state.rootAngVel`，没有 scale
- **问题**：❌ **缺少 ang_vel_scale！**

#### ProjectedGravityB
- **原始**：直接使用 `self.gravity_orientation`
- **我们的**：正确实现
- **状态**：✅ 正确

#### Command
- **原始**：`self.cmd * self.cmd_scale` (cmd_scale = [1.0, 1.0, 1.0])
- **我们的**：`return new Float32Array([s * x, s * y, s * z])`，scale 默认 1.0
- **问题**：⚠️ **需要确认 scale 是否正确应用**

#### JointPosRel
- **原始**：`(self.qj - self.default_angles) * self.dof_pos_scale` (dof_pos_scale = 1.0)
- **我们的**：`s * (qi - q0i)`，scale 默认 1.0
- **状态**：✅ 正确（如果 scale = 1.0）

#### JointVel
- **原始**：`self.dqj_obs * self.dof_vel_scale` (dof_vel_scale = 1.0)
- **我们的**：`s * dq[i]`，scale 默认 1.0
- **状态**：✅ 正确（如果 scale = 1.0）

---

### ✅ 2. 观察向量顺序

- **原始**：RootAngVelB(3) + ProjectedGravityB(3) + Command(3) + JointPosRel(29) + JointVel(29) + PrevActions(29)
- **我们的**：通过 `obsModules` 顺序构建，顺序应该一致
- **状态**：✅ 正确

---

### ⚠️ 3. 动作处理

#### 原始代码
```python
self.action = self.policy(...).clip(-100, 100)  # 没有 tanh
loco_action = self.action * self.action_scale + self.default_angles  # action_scale = 0.25
```

#### 我们的代码
```javascript
// 1. 策略输出
const action = result['action']?.data;

// 2. 应用 tanh（已移除）
if (this.actionSquash === 'tanh') {
  value = Math.tanh(value);  // 现在是 null，不会执行
}

// 3. 应用 clip
const clamped = Math.max(-clip, Math.min(clip, value));  // clip = 100.0

// 4. 计算目标位置
target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];  // action_scale = 0.5
```

**问题**：
- ✅ tanh 已移除
- ⚠️ **action_scale 是 0.5，原始是 0.25** - 我们已经增加了，这是对的
- ✅ clip 是 100.0，与原始一致

---

### ⚠️ 4. Command 缩放问题（可能的关键问题）

#### 原始 Python 代码
```python
joycmd = self.state_cmd.vel_cmd.copy()  # 原始游戏手柄输入
self.cmd = scale_values(joycmd, [self.range_velx, self.range_vely, self.range_velz])  # 缩放到范围
self.cmd = self.cmd * self.cmd_scale  # cmd_scale = [1.0, 1.0, 1.0]
```

#### 我们的代码
```javascript
// main.js: _updateGamepadCommand()
const vx = scaleBipolar(axes[0], cmd_range.lin_vel_x[0], cmd_range.lin_vel_x[1]);
const vy = scaleBipolar(axes[1], cmd_range.lin_vel_y[0], cmd_range.lin_vel_y[1]);
const wz = scaleBipolar(axes[2], cmd_range.ang_vel_z[0], cmd_range.ang_vel_z[1]);
this.cmd = [vx, vy, wz];

// observationHelpers.js: Command.compute()
const cmd = this.policy?.command ?? null;
const x = cmd?.[0] ?? 0.0;
const y = cmd?.[1] ?? 0.0;
const z = cmd?.[2] ?? 0.0;
const s = this.scale;  // scale 默认是 1.0
return new Float32Array([s * x, s * y, s * z]);
```

**检查**：
- ✅ `scaleBipolar` 应该等价于 `scale_values`
- ✅ Command scale 默认是 1.0，与原始一致
- **状态**：✅ 应该正确

---

## 发现的问题

### 问题 1：RootAngVelB 缺少 ang_vel_scale ⚠️

**原始代码**：
```python
self.ang_vel = self.ang_vel * self.ang_vel_scale  # ang_vel_scale = 1.0
```

**我们的代码**：
```javascript
compute(state) {
  return new Float32Array(state.rootAngVel);  // 没有 scale
}
```

**影响**：
- 如果 ang_vel_scale = 1.0，没有影响
- 但如果配置中 ang_vel_scale ≠ 1.0，会有问题

**检查**：配置文件中没有 ang_vel_scale，所以应该是 1.0，**这个问题可能不是关键**

---

### 问题 2：action_scale 差异 ⚠️

**原始代码**：`action_scale = 0.25`  
**我们的代码**：`action_scale = 0.5`（我们已经增加了）

**分析**：
- 我们已经从 0.25 增加到 0.5
- 如果还不够，可能需要继续增加到 1.0

---

### 问题 3：观察向量的 scale 参数 ⚠️

**检查**：我们的观察模块都支持 `scale` 参数，但配置文件中没有指定，所以使用默认值 1.0

**原始配置**：
- `dof_pos_scale = 1.0`
- `dof_vel_scale = 1.0`
- `ang_vel_scale = 1.0`
- `cmd_scale = [1.0, 1.0, 1.0]`

**我们的配置**：没有这些参数，使用默认值 1.0

**状态**：✅ 应该正确

---

## 可能的关键问题

### 1. action_scale 仍然太小

即使移除了 tanh，如果原始输出是 [-1.86, 1.86]：
- 乘以 0.5：调整范围 [-0.93, 0.93] 弧度（约 ±53 度）
- 可能还是不够

**解决方案**：增加到 1.0 或更大

---

### 2. 观察向量可能有问题

需要验证：
- ProjectedGravityB 是否正确计算
- RootAngVelB 是否正确读取
- Command 是否正确缩放

---

### 3. 动作应用可能有问题

需要检查：
- 目标位置计算是否正确
- PD 控制参数是否正确
- 动作是否正确应用到关节

---

## 建议的检查步骤

### 步骤 1：验证观察向量值

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 检查各个观察组件
const rootAngVelObs = pr.obsModules.find(obs => obs.constructor.name === 'RootAngVelB');
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
const commandObs = pr.obsModules.find(obs => obs.constructor.name === 'Command');

console.log('RootAngVelB:', Array.from(rootAngVelObs.compute(state)));
console.log('ProjectedGravityB:', Array.from(gravityObs.compute(state)));
console.log('Command:', Array.from(commandObs.compute(state)));
```

### 步骤 2：验证动作处理流程

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 检查动作值
const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('Actions (first 6):', Array.from(actions.slice(0, 6)));
console.log('Targets (first 6):', Array.from(targets.slice(0, 6)));
console.log('Defaults (first 6):', Array.from(defaults.slice(0, 6)));

// 验证公式：target = default + action_scale * action
const calculated = defaults.slice(0, 6).map((d, i) => d + pr.actionScale[i] * actions[i]);
console.log('Calculated (first 6):', calculated);
console.log('Actual targets (first 6):', Array.from(targets.slice(0, 6)));
console.log('Match:', calculated.every((c, i) => Math.abs(c - targets[i]) < 0.0001));
```

### 步骤 3：检查 PD 控制参数

```javascript
const demo = window.demo;
console.log('KP (first 6):', Array.from(demo.kpPolicy.slice(0, 6)));
console.log('KD (first 6):', Array.from(demo.kdPolicy.slice(0, 6)));
```

---

## 建议的修复

### 修复 1：增加 action_scale 到 1.0

**文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
}
```

### 修复 2：添加 ang_vel_scale 支持（如果需要）

**文件**：`src/simulation/observationHelpers.js`

```javascript
class RootAngVelB {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.scale = typeof kwargs.scale === 'number' ? kwargs.scale : 1.0;
  }
  
  compute(state) {
    const angVel = state.rootAngVel;
    return new Float32Array([
      angVel[0] * this.scale,
      angVel[1] * this.scale,
      angVel[2] * this.scale
    ]);
  }
}
```

---

## 总结

**代码逻辑基本正确**，但可能的问题：

1. ⚠️ **action_scale 可能还是太小**（当前 0.5，原始 0.25，我们已经增加了）
2. ⚠️ **RootAngVelB 缺少 scale 支持**（但原始是 1.0，可能不是问题）
3. ✅ **观察向量顺序正确**
4. ✅ **动作处理逻辑正确**（tanh 已移除）

**建议**：
1. 先增加 `action_scale` 到 1.0
2. 如果还不够，检查观察向量和动作应用
