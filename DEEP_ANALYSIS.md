# 深度代码分析 - 机器人往后倒问题

## 问题描述
- 机器人往后倒
- 选择左腿往前（但实际可能不对）
- 感觉策略本身有问题

## 关键检查点

### 1. ProjectedGravityB 计算 ⚠️

**原始 Python 代码**：
```python
self.gravity_orientation = self.state_cmd.gravity_ori
```
- `gravity_ori` 是从 `state_cmd` 传入的，需要检查它的计算方式

**我们的代码**：
```javascript
class ProjectedGravityB {
  constructor() {
    this.gravity = new THREE.Vector3(0, 0, -1);  // 世界坐标系中的重力方向
  }
  
  compute(state) {
    const quat = state.rootQuat;
    const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);  // w, x, y, z
    const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
    return new Float32Array([gravityLocal.x, gravityLocal.y, gravityLocal.z]);
  }
}
```

**潜在问题**：
- 四元数顺序：`new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0])` 是 `(x, y, z, w)`
- 但 `state.rootQuat` 的顺序是 `[w, x, y, z]`（从 `readPolicyState` 看：`[qpos[3], qpos[4], qpos[5], qpos[6]]`）
- 需要确认 MuJoCo 的四元数顺序

**检查**：MuJoCo 的四元数顺序通常是 `[w, x, y, z]`，但 THREE.js 的 `Quaternion` 构造函数是 `(x, y, z, w)`，所以我们的转换应该是正确的。

---

### 2. 动作应用公式 ⚠️

**原始 Python**：
```python
loco_action = self.action * self.action_scale + self.default_angles
```

**我们的代码**：
```javascript
target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];
```

**检查**：✅ 公式一致

---

### 3. 左右腿关节顺序 ⚠️

**我们的 policy_joint_names**：
```json
[
  "left_hip_pitch_joint",    // 0
  "right_hip_pitch_joint",   // 1
  "waist_yaw_joint",         // 2
  "left_hip_roll_joint",     // 3
  "right_hip_roll_joint",    // 4
  ...
]
```

**左腿索引**：`[0, 3, 6, 9, 13, 17]` = `[left_hip_pitch, left_hip_roll, left_hip_yaw, left_knee, left_ankle_pitch, left_ankle_roll]`
**右腿索引**：`[1, 4, 7, 10, 14, 18]` = `[right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll]`

**需要检查**：原始 Python 代码中的 `joint2motor_idx` 顺序是否与我们的 `policy_joint_names` 一致

---

### 4. 观察向量输入 clip ⚠️

**原始 Python**：
```python
obs_tensor = self.obs.reshape(1, -1)
obs_tensor = obs_tensor.astype(np.float32)
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100)
```

**关键**：输入 obs 被 clip 到 `[-100, 100]`

**我们的代码**：
```javascript
this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);
```

**问题**：❌ **我们没有对输入 obs 进行 clip！**

---

### 5. 动作符号问题 ⚠️

如果机器人往后倒，可能是：
1. 重力方向计算错误（导致策略认为机器人前倾，实际是后倾）
2. 动作符号错误（策略输出正动作，但实际应用时方向相反）
3. 关节定义方向错误

---

## 建议的修复

### 修复 1：添加输入 obs clip

**文件**：`src/simulation/policyRunner.js`

```javascript
// 在构建 obsForPolicy 后，应用 clip
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}
```

### 修复 2：验证重力方向计算

添加调试日志，检查重力方向是否正确：
- 机器人站立时，重力方向应该是 `[0, 0, -1]`（在机器人坐标系中）
- 如果机器人前倾，重力方向应该变化

### 修复 3：检查动作符号

添加调试日志，检查：
- 策略输出的原始动作值
- 应用后的目标位置
- 实际关节位置

---

## 调试指令

### 检查重力方向

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 检查重力方向
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
const gravity = gravityObs.compute(state);
console.log('Gravity direction (robot frame):', Array.from(gravity));
console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2));

// 检查四元数
console.log('Root quaternion:', Array.from(state.rootQuat));
```

### 检查动作值

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 检查动作值
const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('Left leg actions (indices 0,3,6,9,13,17):', [0,3,6,9,13,17].map(i => actions[i]));
console.log('Right leg actions (indices 1,4,7,10,14,18):', [1,4,7,10,14,18].map(i => actions[i]));

console.log('Left leg targets:', [0,3,6,9,13,17].map(i => targets[i]));
console.log('Right leg targets:', [1,4,7,10,14,18].map(i => targets[i]));

console.log('Left leg adjustments (target - default):', [0,3,6,9,13,17].map(i => targets[i] - defaults[i]));
console.log('Right leg adjustments (target - default):', [1,4,7,10,14,18].map(i => targets[i] - defaults[i]));
```

---

## 下一步

1. **先添加输入 obs clip**（最可能的问题）
2. **添加重力方向调试日志**
3. **检查动作符号**
