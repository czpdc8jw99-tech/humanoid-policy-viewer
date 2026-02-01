# 策略切换问题分析

## 问题描述
1. 换成手柄策略（loco_mode）后，机器人直接停止
2. 切换回其他策略（tracking_policy），机器人依旧default无法执行

## 问题分析

### 1. 策略切换时的状态清理

#### reloadPolicy 函数（mujocoUtils.js:107）
- 会重新设置 `this.joint2motorIdx`、`this.qpos_adr_motor` 等
- 如果没有 `joint2motor_idx`，会设置为 `null`
- **但问题**：切换策略时，可能旧的变量没有被正确清理

### 2. 动作应用的条件判断

#### 当前代码（main.js:1022）
```javascript
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.qpos_adr_motor) {
  // 使用电机顺序（loco_mode）
} else {
  // 使用策略顺序（tracking_policy）
}
```

#### 潜在问题

**问题1：条件判断不完整**
- 如果 `joint2motorIdx` 存在但 `qpos_adr_motor` 为 `null`，会进入 else 分支
- 但 else 分支使用策略顺序，这对于有 `joint2motorIdx` 的策略是错误的

**问题2：切换策略时的状态残留**
- 从 loco_mode 切换到 tracking_policy：
  - `joint2motorIdx` 应该被设置为 `null`
  - 但如果设置失败，会错误地使用电机顺序逻辑
- 从 tracking_policy 切换到 loco_mode：
  - `qpos_adr_motor` 应该被创建
  - 但如果创建失败，会错误地使用策略顺序逻辑

**问题3：readPolicyState 的条件判断**
- `readPolicyState` 也有类似的条件判断（main.js:1362）
- 如果条件不匹配，会导致状态读取错误

### 3. 具体问题场景

#### 场景1：从 tracking_policy 切换到 loco_mode
1. tracking_policy 没有 `joint2motor_idx`
2. `this.joint2motorIdx = null`
3. `this.qpos_adr_motor = null`
4. 切换到 loco_mode
5. loco_mode 有 `joint2motor_idx`
6. `this.joint2motorIdx` 被设置
7. `this.qpos_adr_motor` 被创建
8. **但如果创建失败**，条件判断 `this.qpos_adr_motor` 为 `null`，会进入 else 分支
9. else 分支使用策略顺序，但 loco_mode 需要电机顺序 → **错误！**

#### 场景2：从 loco_mode 切换到 tracking_policy
1. loco_mode 有 `joint2motor_idx`
2. `this.joint2motorIdx` 被设置
3. `this.qpos_adr_motor` 被创建
4. 切换到 tracking_policy
5. tracking_policy 没有 `joint2motor_idx`
6. `this.joint2motorIdx` 应该被设置为 `null`
7. `this.qpos_adr_motor` 应该被设置为 `null`
8. **但如果清理失败**，`joint2motorIdx` 可能还存在
9. 条件判断 `this.joint2motorIdx && ...` 为 true，会进入 if 分支
10. if 分支使用电机顺序，但 tracking_policy 需要策略顺序 → **错误！**

### 4. 检查点

#### 检查1：reloadPolicy 是否正确清理
**位置**: `mujocoUtils.js:312-319`

```javascript
} else {
  this.joint2motorIdx = null;
  this.kpPolicyReorder = null;
  this.kdPolicyReorder = null;
  this.qpos_adr_motor = null;
  this.qvel_adr_motor = null;
  this.ctrl_adr_motor = null;
}
```

**问题**：这个清理是在 `if (joint2motorIdx && ...)` 的 else 分支中
- 如果 `joint2motorIdx` 存在但长度不匹配，不会进入这个 else 分支
- 旧的变量可能不会被清理

#### 检查2：条件判断是否完整
**位置**: `main.js:1022`

```javascript
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.qpos_adr_motor) {
```

**问题**：
- 需要同时检查 `this.joint2motorIdx` 和 `this.qpos_adr_motor`
- 但如果 `qpos_adr_motor` 创建失败，会进入 else 分支，使用错误的逻辑

#### 检查3：readPolicyState 的条件判断
**位置**: `main.js:1362`

```javascript
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.qpos_adr_motor) {
```

**问题**：与动作应用的条件判断一致，但可能也有同样的问题

### 5. 可能的问题

#### 问题1：条件判断不完整
- 应该检查所有必要的变量都存在且有效
- 如果任何一个变量无效，应该使用策略顺序（更安全）

#### 问题2：状态清理不彻底
- 切换策略时，应该明确清理所有相关变量
- 不应该依赖条件判断来隐式清理

#### 问题3：变量初始化顺序
- `qpos_adr_motor` 的创建依赖于 `joint2motorIdx`
- 如果 `joint2motorIdx` 存在但 `qpos_adr_motor` 创建失败，会导致问题

### 6. 建议的修复方案

#### 方案1：改进条件判断
```javascript
// 只有当所有必要的变量都存在且有效时，才使用电机顺序
const hasMotorOrdering = this.joint2motorIdx && 
                         this.joint2motorIdx.length === this.numActions &&
                         this.qpos_adr_motor &&
                         this.qvel_adr_motor &&
                         this.ctrl_adr_motor &&
                         this.kpPolicyReorder &&
                         this.kdPolicyReorder;

if (hasMotorOrdering) {
  // 使用电机顺序
} else {
  // 使用策略顺序
}
```

#### 方案2：明确清理状态
在 `reloadPolicy` 开始时，明确清理所有相关变量：
```javascript
// 清理旧的状态
this.joint2motorIdx = null;
this.kpPolicyReorder = null;
this.kdPolicyReorder = null;
this.qpos_adr_motor = null;
this.qvel_adr_motor = null;
this.ctrl_adr_motor = null;
```

#### 方案3：添加调试日志
在策略切换时，记录关键变量的状态，帮助诊断问题。
