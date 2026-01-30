# 代码修改指南

## 当前问题

机器人站不住，看不出有抵抗趋势。

## 需要修改的代码位置

### ⚠️ 重要：我们**不需要**修改策略本身（ONNX 模型）

策略（ONNX 模型）是训练好的，我们只需要调整**如何使用它**的参数和逻辑。

---

## 需要修改的文件和位置

### 1. 策略配置文件（最可能修改）⭐⭐⭐

**文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**当前配置**：
```json
{
  "action_scale": 0.5,
  "action_clip": 100.0,
  "action_squash": "tanh",
  // ... 其他配置
}
```

**可能的修改**：

#### 方案 A：移除 tanh
```json
{
  "action_scale": 0.5,
  "action_clip": 100.0,
  "action_squash": null,  // 从 "tanh" 改为 null
  // 或者直接删除这一行
}
```

#### 方案 B：增加 action_scale
```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
  "action_clip": 100.0,
  "action_squash": "tanh",
}
```

#### 方案 C：同时调整
```json
{
  "action_scale": 1.0,  // 增加到 1.0
  "action_clip": 4.0,   // 如果移除 tanh，可能需要调整 clip 范围
  "action_squash": null,  // 移除 tanh
}
```

---

### 2. 动作处理逻辑（可能需要修改）⭐⭐

**文件**：`src/simulation/policyRunner.js`

**位置**：第 314-324 行

**当前代码**：
```javascript
const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
for (let i = 0; i < this.numActions; i++) {
  let value = action[i];
  // Apply squash (e.g., tanh) if configured
  if (this.actionSquash === 'tanh') {
    value = Math.tanh(value);
  }
  // Then apply clip
  const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
  this.lastActions[i] = clamped;
}
```

**可能的修改**：

#### 如果移除 tanh 后需要调整 clip 范围：
```javascript
const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
for (let i = 0; i < this.numActions; i++) {
  let value = action[i];
  // Apply squash (e.g., tanh) if configured
  if (this.actionSquash === 'tanh') {
    value = Math.tanh(value);
  }
  // Then apply clip
  // 如果移除了 tanh，可能需要更小的 clip 范围（比如 4.0）
  const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
  this.lastActions[i] = clamped;
}
```

**注意**：这个文件通常**不需要修改**，因为逻辑已经支持通过配置文件控制。

---

### 3. 观察向量构建（检查，通常不需要修改）⭐

**文件**：`src/simulation/observationHelpers.js`

**位置**：
- `ProjectedGravityB.compute()` - 第 60-65 行
- `RootAngVelB.compute()` - 第 26-28 行
- `Command.compute()` - 第 41-47 行

**当前代码**：这些通常**不需要修改**，除非诊断发现有问题。

---

### 4. 状态读取（检查，通常不需要修改）⭐

**文件**：`src/simulation/main.js`

**位置**：`readPolicyState()` - 第 1017-1067 行

**当前代码**：通常**不需要修改**，除非诊断发现状态读取有问题。

---

## 推荐修改方案

### 方案 1：先尝试移除 tanh（推荐）

**修改文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**修改内容**：
```json
{
  "action_scale": 0.5,  // 保持 0.5
  "action_clip": 100.0,  // 保持 100.0（原始代码也是这个值）
  "action_squash": null,  // 从 "tanh" 改为 null
  // ... 其他配置不变
}
```

**理由**：
- 原始 Python 代码没有 tanh
- 如果策略原始输出范围较大（比如 [-4, 4]），tanh 会压缩到 [-1, 1]
- 移除 tanh 可以让动作幅度更大

---

### 方案 2：如果移除 tanh 不行，增加 action_scale

**修改文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**修改内容**：
```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
  "action_clip": 100.0,
  "action_squash": null,  // 保持 null（如果方案 1 已经移除了）
  // ... 其他配置不变
}
```

---

### 方案 3：如果还是不行，调整 clip 范围

**修改文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**修改内容**：
```json
{
  "action_scale": 1.0,
  "action_clip": 4.0,  // 从 100.0 改为 4.0（如果原始输出范围是 [-4, 4]）
  "action_squash": null,
  // ... 其他配置不变
}
```

---

## 修改步骤

### 步骤 1：先运行诊断

刷新页面，查看控制台输出：
- `Raw policy output range (BEFORE tanh/clip)` - 查看原始输出范围
- `Obs update` - 查看观察向量是否更新

### 步骤 2：根据诊断结果决定

- **如果原始输出范围是 [-1, 1] 左右** → 增加 `action_scale` 到 1.0
- **如果原始输出范围是 [-4, 4] 或更大** → 移除 `tanh`

### 步骤 3：修改配置文件

只修改 `loco_policy_29dof.json`，不需要修改其他代码文件。

### 步骤 4：测试

刷新页面，选择策略，观察机器人行为。

---

## 总结

**需要修改的文件**：
1. ✅ **`public/examples/checkpoints/g1/loco_policy_29dof.json`** - 主要修改这里
2. ⚠️ `src/simulation/policyRunner.js` - 通常不需要修改（除非需要特殊逻辑）

**不需要修改的文件**：
- ❌ ONNX 模型文件（`policy_loco_29dof.onnx`）
- ❌ 观察向量构建代码（`observationHelpers.js`）
- ❌ 状态读取代码（`main.js`）
- ❌ UI 代码（`Demo.vue`）

**修改方式**：
- 只需要修改 JSON 配置文件中的参数
- 不需要修改代码逻辑（代码已经支持通过配置控制）
