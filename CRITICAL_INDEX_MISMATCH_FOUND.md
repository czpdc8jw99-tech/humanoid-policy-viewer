# 关键问题：索引不匹配导致动作应用到错误的执行器

## 问题发现

根据调试输出，发现了**严重的索引不匹配问题**：

### 调试输出分析

```
关节0 (motorIdx=0, ctrlAdr=0): targetJpos=-0.576, ctrlValue=-2.38
关节3 (motorIdx=1, ctrlAdr=6): targetJpos=0.254, ctrlValue=-2.82
关节6 (motorIdx=2, ctrlAdr=12): targetJpos=-0.180, ctrlValue=0.96
关节9 (motorIdx=3, ctrlAdr=1): targetJpos=0.472, ctrlValue=-1.76
关节13 (motorIdx=4, ctrlAdr=7): targetJpos=-0.932, ctrlValue=-2.60
关节17 (motorIdx=5, ctrlAdr=13): targetJpos=0.122, ctrlValue=1.26
```

### 问题分析

#### 1. joint2motorIdx 映射
- 策略索引 `i=0` → `motorIdx=0` (left_hip_pitch)
- 策略索引 `i=3` → `motorIdx=1` (left_hip_roll)
- 策略索引 `i=6` → `motorIdx=2` (left_hip_yaw)
- 策略索引 `i=9` → `motorIdx=3` (left_knee)
- 策略索引 `i=13` → `motorIdx=4` (left_ankle_pitch)
- 策略索引 `i=17` → `motorIdx=5` (left_ankle_roll)

#### 2. ctrl_adr_policy 的使用
代码使用：
```javascript
const ctrl_adr = this.ctrl_adr_policy[motorIdx];
```

**关键问题**：`ctrl_adr_policy` 是按**策略顺序**初始化的，不是按**电机顺序**！

#### 3. 索引不匹配
- `ctrl_adr_policy[0]` 对应策略索引0（left_hip_pitch），MuJoCo执行器地址0 ✅
- `ctrl_adr_policy[1]` 对应策略索引1（right_hip_pitch），MuJoCo执行器地址6 ✅
- `ctrl_adr_policy[2]` 对应策略索引2（waist_yaw），MuJoCo执行器地址12 ✅
- `ctrl_adr_policy[3]` 对应策略索引3（left_hip_roll），MuJoCo执行器地址1 ✅

但是代码使用 `ctrl_adr_policy[motorIdx]`：
- `motorIdx=0` → `ctrl_adr_policy[0]` = 0 ✅ (正确，因为策略索引0也是motorIdx=0)
- `motorIdx=1` → `ctrl_adr_policy[1]` = 6 ❌ (错误！应该是策略索引3对应的执行器地址1)

**根本原因**：`ctrl_adr_policy` 是按策略顺序的，但代码按电机顺序使用它！

---

## 代码位置

### 问题代码1：动作应用
**位置**: `main.js:978-1004`

```javascript
// 按电机顺序迭代
for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
  const qpos_adr = this.qpos_adr_policy[motorIdx];  // ❌ 错误！
  const qvel_adr = this.qvel_adr_policy[motorIdx];  // ❌ 错误！
  const ctrl_adr = this.ctrl_adr_policy[motorIdx];  // ❌ 错误！
  
  const targetJpos = actionReordered ? actionReordered[motorIdx] : ...;
  const kp = this.kpPolicyReorder[motorIdx];
  const kd = this.kdPolicyReorder[motorIdx];
  
  // 应用控制
  this.simulation.ctrl[ctrl_adr] = ctrlValue;
}
```

**问题**：
- `qpos_adr_policy`、`qvel_adr_policy`、`ctrl_adr_policy` 都是按**策略顺序**的
- 但代码按**电机顺序**（`motorIdx`）访问它们
- 导致索引不匹配，动作应用到错误的执行器

### 问题代码2：状态读取
**位置**: `main.js:1194-1210`

```javascript
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
  for (let i = 0; i < this.numActions; i++) {
    const motorIdx = this.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < this.numActions) {
      const qposAdr = this.qpos_adr_policy[motorIdx];  // ❌ 错误！
      const qvelAdr = this.qvel_adr_policy[motorIdx];  // ❌ 错误！
      jointPos[i] = qpos[qposAdr];
      jointVel[i] = qvel[qvelAdr];
    }
  }
}
```

**问题**：
- 同样的问题：`qpos_adr_policy[motorIdx]` 应该是 `qpos_adr_policy[i]`（策略索引）

---

## 正确的逻辑

### Python 原始代码逻辑

```python
# Python LocoMode.py
# 1. 读取状态（策略顺序）
for i in range(len(self.joint2motor_idx)):
    self.qj_obs[i] = self.qj[self.joint2motor_idx[i]]  # 从电机索引读取到策略索引i

# 2. 应用动作（电机顺序）
action_reorder = loco_action.copy()
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    action_reorder[motor_idx] = loco_action[i]  # 策略索引i -> 电机索引motor_idx

# 3. 输出（电机顺序）
self.policy_output.actions = action_reorder.copy()  # 电机顺序
self.policy_output.kps = self.kps_reorder.copy()    # 电机顺序
```

**关键理解**：
- `joint2motor_idx[i]` = 策略索引i对应的电机索引
- `qj[joint2motor_idx[i]]` = 从电机索引读取状态到策略索引i
- `action_reorder[motor_idx]` = 策略索引i的动作放到电机索引motor_idx

### JavaScript 应该的逻辑

#### 1. 读取状态（策略顺序）
```javascript
// 策略索引i -> 电机索引motorIdx -> MuJoCo地址
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = this.joint2motorIdx[i];
  // ❌ 错误：this.qpos_adr_policy[motorIdx]
  // ✅ 正确：需要找到电机索引motorIdx对应的MuJoCo地址
  // 但是 qpos_adr_policy 是按策略顺序的，不是按电机顺序的！
}
```

**问题**：`qpos_adr_policy`、`qvel_adr_policy`、`ctrl_adr_policy` 是按策略顺序的，但我们需要按电机顺序访问它们。

#### 2. 应用动作（电机顺序）
```javascript
// 电机索引motorIdx -> MuJoCo地址
for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
  // ❌ 错误：this.ctrl_adr_policy[motorIdx]
  // ✅ 正确：需要找到电机索引motorIdx对应的MuJoCo地址
  // 但是 ctrl_adr_policy 是按策略顺序的，不是按电机顺序的！
}
```

---

## 解决方案

需要创建**电机顺序**的地址数组：

```javascript
// 在 mujocoUtils.js 中，创建电机顺序的地址数组
this.qpos_adr_motor = new Int32Array(this.numActions);
this.qvel_adr_motor = new Int32Array(this.numActions);
this.ctrl_adr_motor = new Int32Array(this.numActions);

// 从策略顺序映射到电机顺序
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = joint2motorIdx[i];
  this.qpos_adr_motor[motorIdx] = this.qpos_adr_policy[i];
  this.qvel_adr_motor[motorIdx] = this.qvel_adr_policy[i];
  this.ctrl_adr_motor[motorIdx] = this.ctrl_adr_policy[i];
}
```

然后在 `main.js` 中使用：
```javascript
// 读取状态（策略顺序）
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = this.joint2motorIdx[i];
  const qposAdr = this.qpos_adr_motor[motorIdx];  // ✅ 正确
  const qvelAdr = this.qvel_adr_motor[motorIdx];  // ✅ 正确
  jointPos[i] = qpos[qposAdr];
  jointVel[i] = qvel[qvelAdr];
}

// 应用动作（电机顺序）
for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
  const qpos_adr = this.qpos_adr_motor[motorIdx];  // ✅ 正确
  const qvel_adr = this.qvel_adr_motor[motorIdx];  // ✅ 正确
  const ctrl_adr = this.ctrl_adr_motor[motorIdx];  // ✅ 正确
  // ...
}
```

---

## 总结

**根本问题**：
- `qpos_adr_policy`、`qvel_adr_policy`、`ctrl_adr_policy` 是按**策略顺序**的
- 但代码按**电机顺序**（`motorIdx`）访问它们
- 导致索引不匹配，动作应用到错误的执行器

**解决方案**：
- 创建电机顺序的地址数组（`qpos_adr_motor`、`qvel_adr_motor`、`ctrl_adr_motor`）
- 在读取状态和应用动作时使用正确的地址数组
