# 问题根本原因分析

## 诊断结果关键发现

### 1. 控制值严重不对称（48%）
- **左腿控制值**: [-23.30, 0.01, -0.66, -2.98, -0.33, 0.17]
- **右腿控制值**: [25.01, -3.34, 0.80, 20.43, 4.77, -2.33]

### 2. 目标位置差值相反
- **左腿差值**: [-0.1264, 0.0376, -0.0126, -0.0363, -0.1379, 0.0450]
- **右腿差值**: [0.1067, -0.0015, 0.0179, 0.1439, 0.0295, -0.1150]

**第一个关节（hip_pitch）**：
- 左腿: -0.1264（目标 < 当前位置，需要向后）
- 右腿: 0.1067（目标 > 当前位置，需要向前）
- **这是相反的！**

### 3. 当前位置不对称（87%）
- **左腿当前位置**: [-0.2543, 0.2974, -0.1044, 0.2842, -0.6376, -0.0419]
- **右腿当前位置**: [-0.4350, -0.0795, -0.0207, 0.7037, -0.3608, -0.2628]

关键差异：
- **hip_pitch**: 左 -0.2543 vs 右 -0.4350（差异 0.18）
- **hip_roll**: 左 0.2974 vs 右 -0.0795（差异 0.38，**符号相反！**）
- **knee**: 左 0.2842 vs 右 0.7037（差异 0.42）

### 4. actionReordered 相对对称（94%）
- **左腿 actionReordered**: [-0.3807, 0.3350, -0.1170, 0.2479, -0.7756, 0.0031]
- **右腿 actionReordered**: [-0.3282, -0.0810, -0.0029, 0.8475, -0.3313, -0.3778]

## 问题根源

### 核心问题：初始状态设置和状态读取的顺序不一致

1. **初始状态设置** (`mujocoUtils.js:412-428`)：
   ```javascript
   // 使用策略顺序的地址数组
   for (let i = 0; i < this.numActions; i++) {
     const qposAdr = this.qpos_adr_policy[i];  // 策略顺序
     qpos[qposAdr] = this.defaultJposPolicy[i];  // 策略顺序的 default_joint_pos
   }
   ```
   - `default_joint_pos` 是**策略顺序**的（按照 `policy_joint_names`）
   - 使用 `qpos_adr_policy[i]` 设置，这是正确的

2. **状态读取** (`main.js:1403-1420`)：
   ```javascript
   // 如果使用 joint2motorIdx，会重新排序
   if (hasMotorOrdering && allMotorIndicesMapped) {
     for (let i = 0; i < this.numActions; i++) {
       const motorIdx = this.joint2motorIdx[i];
       const qposAdr = this.qpos_adr_motor[motorIdx];  // 电机顺序的地址
       jointPos[i] = qpos[qposAdr];
     }
   }
   ```
   - 读取时使用 `qpos_adr_motor[motorIdx]`
   - 但是初始设置时使用的是 `qpos_adr_policy[i]`

3. **动作应用** (`main.js:1048-1086`)：
   ```javascript
   // 使用电机顺序
   for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
     const qpos_adr = this.qpos_adr_motor[motorIdx];  // 电机顺序
     const targetJpos = actionReordered[motorIdx];  // 电机顺序
     const torque = kp * (targetJpos - this.simulation.qpos[qpos_adr]);
   }
   ```
   - 应用动作时使用 `qpos_adr_motor[motorIdx]`
   - 但是初始设置时使用的是 `qpos_adr_policy[i]`

### 问题所在

**初始状态设置和后续读取/应用使用了不同的地址数组！**

- **初始设置**: `qpos[qpos_adr_policy[i]] = default_joint_pos[i]`（策略顺序）
- **状态读取**: `jointPos[i] = qpos[qpos_adr_motor[motorIdx]]`（电机顺序）
- **动作应用**: `torque = kp * (targetJpos - qpos[qpos_adr_motor[motorIdx]])`（电机顺序）

这导致：
1. 初始状态设置到错误的关节位置
2. 读取状态时从不同的关节位置读取
3. 应用动作时与错误的关节位置比较

## 解决方案

### 方案 1：初始状态设置时也使用电机顺序（推荐）

如果 `joint2motorIdx` 存在，初始状态设置也应该使用电机顺序：

```javascript
// Set initial joint positions to default_joint_pos if available (for loco policy)
if (this.defaultJposPolicy && this.qpos_adr_policy && this.qpos_adr_policy.length > 0) {
  if (this.joint2motorIdx && this.qpos_adr_motor) {
    // 使用电机顺序：先重新排序 default_joint_pos，然后使用 qpos_adr_motor
    const defaultJposMotor = new Float32Array(this.numActions);
    for (let i = 0; i < this.numActions; i++) {
      const motorIdx = this.joint2motorIdx[i];
      defaultJposMotor[motorIdx] = this.defaultJposPolicy[i];
    }
    for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
      const qposAdr = this.qpos_adr_motor[motorIdx];
      if (qposAdr >= 0 && qposAdr < qpos.length) {
        qpos[qposAdr] = defaultJposMotor[motorIdx];
      }
    }
  } else {
    // 没有 joint2motorIdx，使用策略顺序
    for (let i = 0; i < this.numActions; i++) {
      const qposAdr = this.qpos_adr_policy[i];
      if (qposAdr >= 0 && qposAdr < qpos.length) {
        qpos[qposAdr] = this.defaultJposPolicy[i];
      }
    }
  }
}
```

### 方案 2：检查 default_joint_pos 是否需要重新排序

确认 `default_joint_pos` 在配置文件中是策略顺序还是电机顺序，然后相应地设置。

## 验证

修复后，应该检查：
1. 初始状态设置后，左右腿的关节位置是否对称
2. 读取状态时，左右腿的关节位置是否对称
3. 应用动作时，左右腿的差值是否对称
