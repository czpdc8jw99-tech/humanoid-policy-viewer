# 最终验证结果

## 1. ProjectedGravityB 计算等价性验证

### 方法 1：我们的 ProjectedGravityB
```javascript
const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
// quat = [w, x, y, z] from MuJoCo
// THREE.js = (x, y, z, w)
const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
```

### 方法 2：TargetProjectedGravityBObs 使用的方法
```javascript
const gLocal = quatApplyInv(quat, g);
```

### 验证
需要测试两种方法是否产生相同结果。

**理论分析**：
- `applyQuaternion(q.invert())` 应该等价于 `quatApplyInv(q, vec)`
- 两者都是将世界坐标系向量转换到局部坐标系

**测试用例**：
- Identity quaternion `[1, 0, 0, 0]` + 重力 `[0, 0, -1]` → 应该得到 `[0, 0, -1]`
- 旋转 90 度绕 X 轴 + 重力 `[0, 0, -1]` → 应该得到 `[0, 1, 0]`（重力在 Y 方向）

---

## 2. 关节映射方向验证

### 原始 Python joint2motor_idx
```yaml
joint2motor_idx: [0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

**含义**：
- 策略关节索引 `i` → 机器人关节索引 `joint2motor_idx[i]`
- 例如：
  - 策略关节 0 → 机器人关节 0
  - 策略关节 1 → 机器人关节 6
  - 策略关节 2 → 机器人关节 12

### 我们的 policy_joint_names
```json
[
  "left_hip_pitch_joint",    // 0
  "right_hip_pitch_joint",   // 1
  "waist_yaw_joint",         // 2
  "left_hip_roll_joint",      // 3
  "right_hip_roll_joint",     // 4
  "waist_roll_joint",         // 5
  ...
]
```

### 关键问题
**原始 Python 的策略关节顺序是什么？**

从 `joint2motor_idx` 可以看出：
- 策略关节 0 → 机器人关节 0（可能是 left_hip_pitch）
- 策略关节 1 → 机器人关节 6（可能是 right_hip_pitch？）

**需要确认**：
1. 原始 Python 的策略关节顺序是否与我们的 `policy_joint_names` 一致？
2. 如果不一致，我们需要应用 `joint2motor_idx` 映射

### 验证方法
检查原始 Python 代码中策略关节的定义顺序，或者通过 `joint2motor_idx` 反推策略关节顺序。

---

## 3. Warmup 观察向量问题

### 问题确认
原始 Python 使用全零观察向量，但我们的代码会计算 ProjectedGravityB，得到 `[0, 0, -1]`。

### 修复方案
在 warmup 时直接使用全零观察向量：
```javascript
const obsVec = new Float32Array(this.numObs).fill(0);
```

---

## 验证计划

### 步骤 1：验证 ProjectedGravityB 计算
编写测试代码，对比两种方法的结果。

### 步骤 2：验证关节映射
查找原始 Python 代码中策略关节的定义顺序，或通过 joint2motor_idx 反推。

### 步骤 3：修复所有问题
1. Warmup 时使用全零观察向量
2. 如果 ProjectedGravityB 计算错误，修复它
3. 如果关节映射错误，修复它
