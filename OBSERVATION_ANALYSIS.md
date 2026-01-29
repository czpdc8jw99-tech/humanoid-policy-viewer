# 观察向量分析报告

## 关键发现：异常值！

### 第一组数据（较早状态/初始状态）

**左腿关节位置（相对）**：
- left_hip_pitch: -0.001（接近0，正常）
- left_hip_roll: -0.003（接近0，正常）
- 其他关节: 0（正常）

**右腿关节位置（相对）**：
- right_hip_pitch: 0（正常）
- **right_hip_roll: 1** ❌ **异常！应该是接近0**
- right_hip_yaw: 0（正常）
- **right_knee: 1** ❌ **异常！应该是接近0**
- **right_ankle_pitch: 1** ❌ **异常！应该是接近0**
- right_ankle_roll: 0（正常）

**左腿关节速度**：
- left_hip_roll: 1（异常，但可能是初始状态）
- left_hip_yaw: 0.83（异常，但可能是初始状态）
- left_knee: 0.83（异常，但可能是初始状态）

**右腿关节速度**：
- right_hip_yaw: 0.83（异常，但可能是初始状态）
- 其他: 0或接近0

---

### 第二组数据（当前状态）

**左右腿关节位置（相对）**：
- **完全对称** ✓
- left_hip_pitch: 0.2 = right_hip_pitch: 0.2
- left_knee: -0.42 = right_knee: -0.42
- left_ankle_pitch: 0.23 = right_ankle_pitch: 0.23

**左右腿关节速度**：
- **都是0** ✓（对称）

**左右腿前一步动作**：
- **都是0** ✓（对称）

---

## 问题定位

### 🔴 严重问题：第一组数据中的异常值

**右腿关节位置（posRel）出现异常值 `1`**：
- right_hip_roll: 1
- right_knee: 1
- right_ankle_pitch: 1

**这些值应该是接近0的**（相对默认位置的偏移），但却是 `1`，这说明：

1. **关节位置读取错误**：可能读取到了错误的数据
2. **默认位置计算错误**：`posRel = (currentPos - defaultPos)` 计算有误
3. **索引映射错误**：可能读取了错误的关节索引

### 可能的原因

#### 原因 A：关节位置读取索引错误（最可能）

在 `JointPosRel.compute()` 中：
```javascript
const qi = q?.[i] ?? 0.0;  // 当前关节位置
const q0i = q0?.[i] ?? 0.0;  // 默认关节位置
out[i] = s * (qi - q0i);  // 相对位置
```

如果 `q[i]` 读取到了错误的值，或者 `q0[i]` 不正确，就会导致 `posRel` 异常。

#### 原因 B：state.jointPos 的顺序与 policy_joint_names 不一致

如果 `state.jointPos` 的顺序和 `policy_joint_names` 的顺序不一致，那么：
- `q[1]`（策略索引1，right_hip_pitch）可能读取到了其他关节的位置
- 导致计算出的 `posRel` 异常

#### 原因 C：默认关节位置（defaultJointPos）不正确

如果 `defaultJointPos` 的值不正确，计算出的 `posRel` 也会异常。

---

## 需要检查的代码

### 1. 检查 state.jointPos 的构建

需要确认 `readPolicyState()` 函数中，`jointPos` 的顺序是否与 `policy_joint_names` 一致。

### 2. 检查 JointPosRel.compute() 的实现

确认 `state.jointPos` 和 `policy.defaultJointPos` 的索引是否对应正确。

### 3. 检查关节位置读取逻辑

确认从 MuJoCo 读取关节位置时，索引映射是否正确。

---

## 下一步行动

需要检查 `readPolicyState()` 函数，确认：
1. `jointPos` 数组的顺序是否与 `policy_joint_names` 一致
2. 关节位置是否正确从 MuJoCo 的 `qpos` 中读取
3. 索引映射是否正确
