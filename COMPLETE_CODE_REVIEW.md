# 完整代码审查报告

## 审查目标
对比我们的 JavaScript 实现与原始 Python 代码，找出所有差异和潜在问题。

---

## 1. 观察向量构建（96维）

### 1.1 RootAngVelB (3维)

**原始 Python**：
```python
self.ang_vel = self.state_cmd.ang_vel.copy()
self.ang_vel = self.ang_vel * self.ang_vel_scale  # ang_vel_scale = 1.0
self.obs[:3] = self.ang_vel.copy()
```

**我们的代码**：
```javascript
class RootAngVelB {
  compute(state) {
    return new Float32Array(state.rootAngVel);  // 没有 scale
  }
}
```

**问题**：
- ❌ 缺少 `ang_vel_scale`（但原始是 1.0，可能不是问题）
- ⚠️ 需要确认 `state.rootAngVel` 的顺序和符号是否正确

**检查点**：
- `state.rootAngVel` 来自 `readPolicyState()`：`[qvel[3], qvel[4], qvel[5]]`
- MuJoCo 的 `qvel` 前 3 个是线速度，后 3 个是角速度
- 需要确认坐标系：MuJoCo 使用右手坐标系，Z 轴向上

---

### 1.2 ProjectedGravityB (3维)

**原始 Python**：
```python
self.gravity_orientation = self.state_cmd.gravity_ori
self.obs[3:6] = self.gravity_orientation.copy()
```

**关键**：`gravity_ori` 是从外部传入的，需要找到它的计算方式。

**我们的代码**：
```javascript
class ProjectedGravityB {
  constructor() {
    this.gravity = new THREE.Vector3(0, 0, -1);  // 世界坐标系：Z向下
  }
  
  compute(state) {
    const quat = state.rootQuat;
    // MuJoCo quat: [w, x, y, z]
    // THREE.js Quaternion: (x, y, z, w)
    const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
    const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
    return new Float32Array([gravityLocal.x, gravityLocal.y, gravityLocal.z]);
  }
}
```

**潜在问题**：
- ⚠️ **四元数顺序**：需要确认 MuJoCo 的四元数顺序
- ⚠️ **坐标系**：需要确认 THREE.js 和 MuJoCo 的坐标系是否一致
- ⚠️ **重力方向**：`(0, 0, -1)` 表示 Z 向下，需要确认是否正确

**检查点**：
- MuJoCo 使用右手坐标系，Z 轴向上
- 重力在世界坐标系中是 `(0, 0, -9.81)`（Z 向下）
- 在机器人坐标系中，如果机器人站立，重力应该是 `(0, 0, -1)`（归一化）
- 如果机器人前倾，重力在机器人坐标系中应该有 X 分量（向前）

---

### 1.3 Command (3维)

**原始 Python**：
```python
joycmd = self.state_cmd.vel_cmd.copy()
self.cmd = scale_values(joycmd, [self.range_velx, self.range_vely, self.range_velz])
self.cmd = self.cmd * self.cmd_scale  # cmd_scale = [1.0, 1.0, 1.0]
self.obs[6:9] = self.cmd.copy()
```

**我们的代码**：
```javascript
// main.js: _updateGamepadCommand()
const vx = scaleBipolar(uVx, -0.4, 0.7);
const vy = scaleBipolar(uVy, -0.4, 0.4);
const wz = scaleBipolar(uWz, -1.57, 1.57);
this.cmd[0] = vx;
this.cmd[1] = vy;
this.cmd[2] = wz;

// observationHelpers.js: Command.compute()
const cmd = this.policy?.command ?? null;
const x = cmd?.[0] ?? 0.0;
const y = cmd?.[1] ?? 0.0;
const z = cmd?.[2] ?? 0.0;
const s = this.scale;  // 默认 1.0
return new Float32Array([s * x, s * y, s * z]);
```

**检查点**：
- ✅ `scaleBipolar` 应该等价于 `scale_values`
- ✅ Command scale 默认 1.0，与原始一致
- ⚠️ 需要确认命令的顺序：`[vx, vy, wz]` 是否正确

---

### 1.4 JointPosRel (29维)

**原始 Python**：
```python
for i in range(len(self.joint2motor_idx)):
    self.qj_obs[i] = self.qj[self.joint2motor_idx[i]]
    self.dqj_obs[i] = self.dqj[self.joint2motor_idx[i]]

self.qj_obs = (self.qj_obs - self.default_angles) * self.dof_pos_scale  # dof_pos_scale = 1.0
self.obs[9: 9 + self.num_actions] = self.qj_obs.copy()
```

**关键**：
- 使用 `joint2motor_idx` 映射从机器人关节顺序到策略关节顺序
- 计算相对位置：`(qj - default_angles) * dof_pos_scale`

**我们的代码**：
```javascript
class JointPosRel {
  compute(state) {
    const q = state?.jointPos ?? null;  // 已经是策略关节顺序
    const q0 = this.policy?.defaultJointPos ?? null;
    const s = this.scale;  // 默认 1.0
    out[i] = s * (qi - q0i);
  }
}
```

**潜在问题**：
- ⚠️ **关节顺序**：`state.jointPos` 是否已经是策略关节顺序？
- ⚠️ **映射**：我们是否正确地应用了 `joint2motor_idx` 映射？

**检查点**：
- `readPolicyState()` 中，`jointPos` 是通过 `qpos_adr_policy` 读取的
- `qpos_adr_policy` 应该已经应用了策略关节到 MuJoCo 关节的映射
- 需要确认映射方向是否正确

---

### 1.5 JointVel (29维)

**原始 Python**：
```python
self.dqj_obs = self.dqj_obs * self.dof_vel_scale  # dof_vel_scale = 1.0
self.obs[9 + self.num_actions: 9 + self.num_actions * 2] = self.dqj_obs.copy()
```

**我们的代码**：
```javascript
class JointVel {
  compute(state) {
    const dq = state?.jointVel ?? null;  // 已经是策略关节顺序
    out[i] = s * dq[i];
  }
}
```

**检查点**：与 JointPosRel 相同

---

### 1.6 PrevActions (29维)

**原始 Python**：
```python
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()
```

**关键**：使用**前一步的动作**（在本次推理之前的值）

**我们的代码**：
```javascript
// PrevActions.update() 在推理之后调用
for (const obs of this.obsModules) {
  if (obs.constructor.name === 'PrevActions' && typeof obs.update === 'function') {
    obs.update(state);
  }
}
```

**检查点**：
- ✅ 更新时机正确（在推理之后）
- ⚠️ 需要确认 `PrevActions` 存储的是原始动作还是处理后的动作

---

## 2. 动作处理

### 2.1 策略推理

**原始 Python**：
```python
obs_tensor = self.obs.reshape(1, -1)
obs_tensor = obs_tensor.astype(np.float32)
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100).detach().numpy().squeeze()
```

**关键**：
- 输入 obs 被 clip 到 `[-100, 100]`
- 输出 action 也被 clip 到 `[-100, 100]`

**我们的代码**：
```javascript
// ✅ 已添加输入 clip
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}

this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);
const [result, carry] = await this.module.runInference(this.inputDict);
const action = result['action']?.data || result['action'];
```

**检查点**：
- ✅ 输入 clip 已添加
- ⚠️ 输出 action 是否也需要 clip？原始代码有，但我们可能没有

---

### 2.2 动作处理公式

**原始 Python**：
```python
loco_action = self.action * self.action_scale + self.default_angles
action_reorder = loco_action.copy()
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    action_reorder[motor_idx] = loco_action[i]
```

**关键**：
- 公式：`target = default_angles + action * action_scale`
- 然后通过 `joint2motor_idx` 重新排序到机器人关节顺序

**我们的代码**：
```javascript
// PolicyRunner.step()
target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];

// 在 main.js 中应用
const targetJpos = this.actionTarget[i];
const torque = kp * (targetJpos - this.simulation.qpos[qpos_adr]) + kd * (0 - this.simulation.qvel[qvel_adr]);
```

**潜在问题**：
- ⚠️ **映射方向**：我们的 `actionTarget` 是否已经是机器人关节顺序？
- ⚠️ **动作符号**：如果映射方向错误，动作符号可能相反

---

## 3. 关节映射

### 3.1 原始 Python 的映射

**LocoMode.yaml**：
```yaml
joint2motor_idx: [0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

**含义**：
- 策略关节索引 `i` 对应机器人关节索引 `joint2motor_idx[i]`
- 例如：策略关节 0（left_hip_pitch）对应机器人关节 0

**Python 代码**：
```python
# 读取关节状态时
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    self.qj_obs[i] = self.qj[motor_idx]  # 从机器人关节读取到策略关节

# 应用动作时
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    action_reorder[motor_idx] = loco_action[i]  # 从策略关节写入到机器人关节
```

---

### 3.2 我们的映射

**我们的代码**：
```javascript
// mujocoUtils.js: configureJointMappings()
const jointIdx = this.jointNamesMJC.indexOf(policyJointName);
this.qpos_adr_policy[i] = jointIdx >= 0 ? this.qpos_adr_mjc[jointIdx] : -1;
this.ctrl_adr_policy[i] = actuatorIdx;
```

**潜在问题**：
- ⚠️ **映射方向**：我们是从策略关节名称找到 MuJoCo 关节索引
- ⚠️ **顺序**：需要确认 `policy_joint_names` 的顺序是否与原始 Python 一致

**检查点**：
- `policy_joint_names` 的顺序应该与原始 Python 的策略关节顺序一致
- `joint2motor_idx` 定义了从策略顺序到机器人顺序的映射
- 我们需要确认我们的映射是否正确地应用了这个转换

---

## 4. 初始状态

### 4.1 原始 Python

**初始化**：
```python
self.cmd = np.array(config["cmd_init"], dtype=np.float32)  # [0, 0, 0]
self.obs = np.zeros(self.num_obs)
self.action = np.zeros(self.num_actions)

# 50 次 warmup
for _ in range(50):
    self.policy(torch.from_numpy(self.obs))
```

**关键**：
- Command 初始化为 `[0, 0, 0]`
- 观察向量初始化为全零
- 动作初始化为全零

---

### 4.2 我们的代码

**初始化**：
```javascript
this.command = new Float32Array(3);  // [0, 0, 0]
this.lastActions = new Float32Array(this.numActions);  // 全零

// Warmup
const warmupState = {
  rootAngVel: new Float32Array(3),
  rootQuat: new Float32Array([0, 0, 0, 1]),  // identity
  rootPos: new Float32Array(3),
  jointPos: new Float32Array(this.numActions).fill(0),
  jointVel: new Float32Array(this.numActions).fill(0)
};
```

**潜在问题**：
- ⚠️ **重力方向**：warmup 时使用 identity quaternion，重力方向应该是 `[0, 0, -1]`
- ⚠️ **关节位置**：warmup 时使用全零，但实际应该使用 `default_joint_pos`

---

## 5. 控制应用

### 5.1 原始 Python

**PD 控制**：
```python
# 在外部系统中应用
# policy_output.actions 是目标关节位置
# policy_output.kps 和 policy_output.kds 是 PD 参数
# 使用 PD 控制器：torque = kp * (target - current) + kd * (0 - velocity)
```

---

### 5.2 我们的代码

**PD 控制**：
```javascript
const targetJpos = this.actionTarget[i];
const kp = this.kpPolicy[i];
const kd = this.kdPolicy[i];
const torque = kp * (targetJpos - this.simulation.qpos[qpos_adr]) + kd * (0 - this.simulation.qvel[qvel_adr]);
this.simulation.ctrl[ctrl_adr] = torque;
```

**检查点**：
- ✅ 公式一致
- ⚠️ 需要确认 `targetJpos` 和 `qpos_adr` 是否对应同一个关节

---

## 6. 关键检查清单

### 6.1 观察向量
- [ ] RootAngVelB 的顺序和符号
- [ ] ProjectedGravityB 的计算（四元数顺序、坐标系）
- [ ] Command 的顺序和缩放
- [ ] JointPosRel 的关节顺序和映射
- [ ] JointVel 的关节顺序和映射
- [ ] PrevActions 的值和更新时机

### 6.2 动作处理
- [ ] 输入 obs clip（✅ 已添加）
- [ ] 输出 action clip（⚠️ 需要检查）
- [ ] 动作处理公式
- [ ] 关节映射方向

### 6.3 初始状态
- [ ] Warmup 时的观察向量
- [ ] 初始关节位置
- [ ] 初始重力方向

### 6.4 控制应用
- [ ] PD 控制公式
- [ ] 关节映射正确性

---

## 7. 建议的调试步骤

### 步骤 1：验证观察向量值

在控制台输出完整的观察向量，对比原始 Python 的预期值。

### 步骤 2：验证动作值

检查策略输出的原始动作值，对比原始 Python 的预期值。

### 步骤 3：验证关节映射

检查每个策略关节到 MuJoCo 关节的映射是否正确。

### 步骤 4：验证重力方向

检查重力方向的计算是否正确，特别是在机器人不同姿态下。

---

## 8. 最可能的问题

1. **ProjectedGravityB 计算错误**（四元数顺序或坐标系）
2. **关节映射方向错误**（导致动作应用到错误的关节）
3. **动作符号错误**（映射方向错误导致符号相反）
4. **观察向量顺序错误**（某些组件顺序不对）
