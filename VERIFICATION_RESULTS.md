# 代码验证结果

## 验证时间
2024年（当前）

## 验证项目

### ✅ 1. 四元数顺序

**MuJoCo 格式**：`[w, x, y, z]`（确认）

**我们的代码**：
```javascript
// main.js: readPolicyState()
const rootQuat = new Float32Array([qpos[3], qpos[4], qpos[5], qpos[6]]);
// MuJoCo qpos: [x, y, z, w, x, y, z] (位置3 + 四元数4)
// 所以 qpos[3:7] = [w, x, y, z] ✅ 正确
```

**ProjectedGravityB 转换**：
```javascript
const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
// quat = [w, x, y, z]
// THREE.js = (x, y, z, w)
// 所以 (quat[1], quat[2], quat[3], quat[0]) = (x, y, z, w) ✅ 正确
```

**结论**：✅ 四元数顺序正确

---

### ⚠️ 2. ProjectedGravityB 计算

**我们的代码**：
```javascript
const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
```

**问题**：
- `quatObj.invert()` 是四元数的逆（共轭/归一化）
- `applyQuaternion` 将向量从世界坐标系转换到局部坐标系
- 但我们需要的是：将重力向量（世界坐标系）转换到机器人坐标系

**检查**：
- 重力在世界坐标系：`(0, 0, -1)`（Z向下）
- 机器人坐标系：由 `rootQuat` 定义
- 要将世界向量转换到机器人坐标系，需要：
  - 将向量乘以四元数的逆（共轭）

**对比其他代码**：
```javascript
// TargetProjectedGravityBObs 使用：
const gLocal = quatApplyInv(quat, g);
// quatApplyInv 应该是将向量从世界坐标系转换到局部坐标系
```

**需要检查**：`quatApplyInv` 的实现是否正确

---

### ✅ 3. 输入观察向量 clip

**原始 Python**：
```python
obs_tensor = torch.from_numpy(obs_tensor).clip(-100, 100)
```

**我们的代码**：
```javascript
// ✅ 已添加
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}
```

**结论**：✅ 已正确实现

---

### ⚠️ 4. 输出动作 clip

**原始 Python**：
```python
self.action = self.policy(...).clip(-100, 100)
```

**我们的代码**：
```javascript
const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
// actionClip = 100.0 (从配置读取)
for (let i = 0; i < this.numActions; i++) {
  let value = action[i];
  const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
  this.lastActions[i] = clamped;
}
```

**问题**：
- ✅ clip 值是 100.0，正确
- ⚠️ 但原始代码 clip 的是**原始输出**，我们 clip 的是**处理后的值**（如果配置了 tanh）

**检查**：
- 原始代码：`policy(...).clip(-100, 100)` - 直接 clip 原始输出
- 我们的代码：先处理（tanh），再 clip

**结论**：⚠️ 顺序可能不对，但当前配置 `action_squash: null`，所以应该没问题

---

### ⚠️ 5. 关节映射

**原始 Python**：
```python
joint2motor_idx: [0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

**含义**：
- 策略关节索引 `i` → 机器人关节索引 `joint2motor_idx[i]`
- 例如：策略关节 0 → 机器人关节 0
- 策略关节 1 → 机器人关节 6

**我们的代码**：
```javascript
// 直接通过关节名称查找
const jointIdx = demo.jointNamesMJC.indexOf(name);
```

**问题**：
- ⚠️ 我们假设 `policy_joint_names` 的顺序与原始 Python 的策略关节顺序一致
- ⚠️ 但我们没有使用 `joint2motor_idx` 映射

**需要验证**：
- `policy_joint_names` 的顺序是否与原始 Python 的策略关节顺序一致
- 我们的映射是否正确地跳过了 `joint2motor_idx` 的转换

**检查 policy_joint_names**：
```json
[
  "left_hip_pitch_joint",    // 0
  "right_hip_pitch_joint",   // 1
  "waist_yaw_joint",         // 2
  ...
]
```

**原始 Python joint2motor_idx**：
```python
[0, 6, 12, 1, 7, 13, ...]
# 策略0 → 机器人0 (left_hip_pitch)
# 策略1 → 机器人6 (right_hip_pitch?)
```

**潜在问题**：
- 如果原始 Python 的策略关节顺序与我们的 `policy_joint_names` 不一致，映射就会错误

---

### ✅ 6. 动作处理公式

**原始 Python**：
```python
loco_action = self.action * self.action_scale + self.default_angles
```

**我们的代码**：
```javascript
target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];
```

**结论**：✅ 公式一致

---

### ⚠️ 7. Warmup 时的观察向量

**原始 Python**：
```python
self.obs = np.zeros(self.num_obs)  # 全零
for _ in range(50):
    self.policy(torch.from_numpy(self.obs))
```

**我们的代码**：
```javascript
const warmupState = {
  rootAngVel: new Float32Array(3),  // [0, 0, 0]
  rootQuat: new Float32Array([0, 0, 0, 1]),  // identity
  rootPos: new Float32Array(3),  // [0, 0, 0]
  jointPos: new Float32Array(this.numActions).fill(0),  // 全零
  jointVel: new Float32Array(this.numActions).fill(0)  // 全零
};
```

**问题**：
- ⚠️ 原始 Python 使用全零观察向量
- ⚠️ 我们使用 identity quaternion `[0, 0, 0, 1]`，这会导致：
  - ProjectedGravityB = `[0, 0, -1]`（重力向下）
  - 但原始 Python 是全零

**检查**：
- Identity quaternion `[0, 0, 0, 1]` 实际上是 `[w=1, x=0, y=0, z=0]`
- 重力向量 `(0, 0, -1)` 在 identity quaternion 下应该是 `(0, 0, -1)`
- 但原始 Python 的观察向量是全零，所以 ProjectedGravityB 也应该是 `[0, 0, 0]`

**结论**：❌ **Warmup 时的观察向量不一致！**

---

## 发现的关键问题

### 问题 1：Warmup 时的观察向量不一致 ❌

**原始 Python**：全零观察向量
**我们的代码**：使用 identity quaternion，导致 ProjectedGravityB = `[0, 0, -1]`

**影响**：可能导致 LSTM 状态初始化不正确

---

### 问题 2：ProjectedGravityB 计算可能错误 ⚠️

需要验证 `quatApplyInv` 的实现是否正确

---

### 问题 3：关节映射方向可能错误 ⚠️

需要确认 `policy_joint_names` 的顺序是否与原始 Python 一致

---

## 建议的修复

### 修复 1：Warmup 时使用全零观察向量

```javascript
// 在 _warmupLSTMState 中，构建全零观察向量
const obsVec = new Float32Array(this.numObs).fill(0);
```

### 修复 2：验证 ProjectedGravityB 计算

检查 `quatApplyInv` 的实现，确保它正确地将世界向量转换到局部坐标系

### 修复 3：验证关节映射

对比原始 Python 的策略关节顺序与我们的 `policy_joint_names`
