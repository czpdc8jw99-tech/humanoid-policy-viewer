# Tracking Policy Default Motion 无法执行问题分析

## 问题描述
原先两个的default无法正常执行（可能是指tracking_policy的default motion）

## 问题分析

### 1. 代码逻辑变化

#### 原来的逻辑（应该是）：
对于所有策略，直接使用策略顺序：
```javascript
for (let i = 0; i < this.numActions; i++) {
  const qpos_adr = this.qpos_adr_policy[i];
  const qvel_adr = this.qvel_adr_policy[i];
  const ctrl_adr = this.ctrl_adr_policy[i];
  const targetJpos = this.actionTarget[i];
  // 应用控制
}
```

#### 现在的逻辑（v9.0.43之后）：
强制使用电机顺序，即使没有 `joint2motorIdx`：
```javascript
for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
  // 尝试使用 qpos_adr_motor[motorIdx]
  // 如果不存在，回退到 qpos_adr_policy[motorIdx]  ← 问题在这里！
  const qpos_adr = this.qpos_adr_policy[motorIdx];  // ❌ 错误！
  const targetJpos = this.actionTarget[motorIdx];   // ❌ 错误！
}
```

### 2. 关键问题

**问题1：索引不匹配**
- `qpos_adr_policy`、`qvel_adr_policy`、`ctrl_adr_policy` 是按**策略顺序**的
- `actionTarget` 也是按**策略顺序**的
- 但代码按**电机顺序**（`motorIdx`）访问它们
- 对于没有 `joint2motorIdx` 的策略（如 tracking_policy），策略顺序 ≠ 电机顺序，导致索引不匹配

**问题2：条件判断**
- 代码只在 `joint2motorIdx` 存在时才创建 `actionReordered`
- 对于 tracking_policy（没有 `joint2motorIdx`），`actionReordered` 为 `null`
- 回退逻辑使用 `this.actionTarget[motorIdx]`，但 `actionTarget` 是按策略顺序的

**问题3：地址数组**
- `qpos_adr_motor`、`qvel_adr_motor`、`ctrl_adr_motor` 只在有 `joint2motorIdx` 时创建
- 对于 tracking_policy，这些数组为 `null`
- 回退逻辑使用 `qpos_adr_policy[motorIdx]`，但这是错误的索引

### 3. 正确的逻辑应该是

#### 对于有 `joint2motorIdx` 的策略（loco_mode）：
- 使用电机顺序：`qpos_adr_motor[motorIdx]`、`actionReordered[motorIdx]`

#### 对于没有 `joint2motorIdx` 的策略（tracking_policy）：
- 使用策略顺序：`qpos_adr_policy[i]`、`actionTarget[i]`
- 应该用 `for (let i = 0; i < this.numActions; i++)` 而不是 `for (let motorIdx = ...)`

### 4. 问题位置

**文件**: `src/simulation/main.js`

**问题代码块**: `if (this.control_type === 'joint_position')` 内的动作应用循环（1022-1177行）

**具体问题**:
1. 第1022行：强制使用 `motorIdx` 循环，即使没有 `joint2motorIdx`
2. 第1029-1051行：回退逻辑使用 `qpos_adr_policy[motorIdx]`，但这是错误的
3. 第1067-1081行：回退逻辑使用 `actionTarget[motorIdx]`，但这是错误的

### 5. 解决方案

需要根据是否有 `joint2motorIdx` 来选择不同的循环方式：

```javascript
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
  // 有 joint2motorIdx：使用电机顺序（loco_mode）
  for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
    // 使用 qpos_adr_motor[motorIdx], actionReordered[motorIdx]
  }
} else {
  // 没有 joint2motorIdx：使用策略顺序（tracking_policy）
  for (let i = 0; i < this.numActions; i++) {
    // 使用 qpos_adr_policy[i], actionTarget[i]
  }
}
```
