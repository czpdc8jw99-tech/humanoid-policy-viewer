# 策略切换问题详细分析

## 问题描述
1. 换成手柄策略（loco_mode）后，机器人直接停止
2. 切换回其他策略（tracking_policy），机器人依旧default无法执行

## 问题分析

### 1. reloadPolicy 的状态清理逻辑

#### 位置：mujocoUtils.js:214-319

**代码逻辑**：
```javascript
const joint2motorIdx = Array.isArray(config.joint2motor_idx) ? config.joint2motor_idx : null;
if (joint2motorIdx && joint2motorIdx.length === this.numActions) {
  // 创建 joint2motorIdx 和 motor-ordered arrays
  this.joint2motorIdx = new Int32Array(joint2motorIdx);
  this.qpos_adr_motor = new Int32Array(this.numActions);
  // ...
} else {
  // 清理变量
  this.joint2motorIdx = null;
  this.qpos_adr_motor = null;
  // ...
}
```

**潜在问题**：
- 如果 `joint2motorIdx` 存在但长度不匹配 `this.numActions`，不会进入 if 分支
- 也不会进入 else 分支（因为 else 是针对 `joint2motorIdx` 为 null 的情况）
- **旧的变量不会被清理！**

### 2. 动作应用的条件判断

#### 位置：main.js:1022

**代码逻辑**：
```javascript
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.qpos_adr_motor) {
  // 使用电机顺序（loco_mode）
} else {
  // 使用策略顺序（tracking_policy）
}
```

**问题场景**：

#### 场景1：从 tracking_policy 切换到 loco_mode
1. tracking_policy：`joint2motorIdx = null`，`qpos_adr_motor = null`
2. 切换到 loco_mode
3. loco_mode 有 `joint2motor_idx`
4. `this.joint2motorIdx` 被创建
5. `this.qpos_adr_motor` 被创建
6. **但如果 `qpos_adr_motor` 创建失败**（例如长度不匹配），`qpos_adr_motor` 仍为 `null`
7. 条件判断 `this.qpos_adr_motor` 为 false，进入 else 分支
8. else 分支使用策略顺序，但 loco_mode 需要电机顺序 → **错误！机器人停止**

#### 场景2：从 loco_mode 切换到 tracking_policy
1. loco_mode：`joint2motorIdx` 存在，`qpos_adr_motor` 存在
2. 切换到 tracking_policy
3. tracking_policy 没有 `joint2motor_idx`
4. `config.joint2motor_idx` 为 `null`
5. 进入 else 分支：`this.joint2motorIdx = null`，`this.qpos_adr_motor = null`
6. **但如果清理失败**（例如代码执行顺序问题），`joint2motorIdx` 可能还存在
7. 条件判断 `this.joint2motorIdx` 为 true，进入 if 分支
8. if 分支使用电机顺序，但 tracking_policy 需要策略顺序 → **错误！default无法执行**

### 3. 关键问题

#### 问题1：状态清理不彻底
- `reloadPolicy` 只在 `else` 分支清理变量
- 如果 `joint2motorIdx` 存在但长度不匹配，不会清理
- **应该在函数开始时明确清理所有相关变量**

#### 问题2：条件判断不完整
- 需要检查所有必要的变量都存在
- 如果任何一个变量无效，应该使用策略顺序（更安全）

#### 问题3：变量创建失败的处理
- 如果 `qpos_adr_motor` 创建失败，应该回退到策略顺序
- 但当前代码没有处理这种情况

### 4. 检查点

#### 检查1：reloadPolicy 开始时的状态
- `this.joint2motorIdx` 是否被正确清理？
- `this.qpos_adr_motor` 是否被正确清理？

#### 检查2：变量创建是否成功
- `qpos_adr_motor` 创建后，所有索引是否都被映射？
- 如果有未映射的索引，是否会导致问题？

#### 检查3：条件判断是否完整
- `if` 条件是否检查了所有必要的变量？
- `else` 分支是否处理了所有情况？

### 5. 建议的修复方案

#### 方案1：在 reloadPolicy 开始时明确清理
```javascript
export async function reloadPolicy(policy_path, options = {}) {
  // 明确清理旧的状态
  this.joint2motorIdx = null;
  this.kpPolicyReorder = null;
  this.kdPolicyReorder = null;
  this.qpos_adr_motor = null;
  this.qvel_adr_motor = null;
  this.ctrl_adr_motor = null;
  
  // 然后根据新策略的配置重新创建
  // ...
}
```

#### 方案2：改进条件判断
```javascript
// 检查所有必要的变量都存在且有效
const hasMotorOrdering = this.joint2motorIdx && 
                         this.joint2motorIdx.length === this.numActions &&
                         this.qpos_adr_motor &&
                         this.qvel_adr_motor &&
                         this.ctrl_adr_motor &&
                         this.kpPolicyReorder &&
                         this.kdPolicyReorder;

if (hasMotorOrdering) {
  // 验证所有电机索引都被映射
  let allMapped = true;
  for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
    if (this.qpos_adr_motor[motorIdx] < 0) {
      allMapped = false;
      break;
    }
  }
  
  if (allMapped) {
    // 使用电机顺序
  } else {
    // 回退到策略顺序
  }
} else {
  // 使用策略顺序
}
```

#### 方案3：添加调试日志
在策略切换时，记录关键变量的状态：
```javascript
console.log('[Policy Switch] joint2motorIdx:', this.joint2motorIdx ? 'exists' : 'null');
console.log('[Policy Switch] qpos_adr_motor:', this.qpos_adr_motor ? 'exists' : 'null');
console.log('[Policy Switch] numActions:', this.numActions);
```
