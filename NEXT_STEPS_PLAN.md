# 下一步行动计划

## 当前问题

- ✅ LSTM warmup 已实现
- ✅ 初始姿态设置已修复
- ✅ action_scale 已从 0.25 增加到 0.5
- ❌ **机器人仍然站不住，且看不出有抵抗趋势**

## 问题分析

### 可能的原因

1. **动作幅度仍然太小**
   - 即使增加到 0.5，如果原始动作值在 [-1, 1] 范围内
   - 实际调整只有 ±0.5 弧度（约 ±29 度）
   - 可能不足以维持平衡

2. **tanh 压缩了动作范围**
   - 原始代码没有 tanh
   - 如果策略原始输出是 [-4, 4]，tanh 后变成 [-1, 1]
   - 这会导致动作幅度大幅减小

3. **观察向量可能有问题**
   - ProjectedGravityB 可能没有正确更新
   - RootAngVelB 可能没有正确读取
   - 策略可能没有感知到倾斜

4. **策略输出本身有问题**
   - ONNX 转换可能改变了输出分布
   - 策略可能没有正确初始化

## 诊断步骤（按优先级）

### 步骤 1：验证观察向量是否正确更新 ⭐⭐⭐

**目的**：确认策略能够感知到机器人的倾斜和旋转

**在控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 持续监控观察向量
const monitor = setInterval(() => {
  const state = demo.readPolicyState();
  
  // 检查重力投影
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (gravityObs) {
    const gravity = gravityObs.compute(state);
    const magnitude = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
    console.log('ProjectedGravityB:', Array.from(gravity), '|magnitude:', magnitude.toFixed(3));
    // 正常应该是 [0, 0, -1] 或接近，如果机器人倾斜会偏离
  }
  
  // 检查角速度
  console.log('RootAngVelB:', Array.from(state.rootAngVel));
  
  // 检查动作输出
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
  const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
  console.log('Action magnitude - Left:', leftAvg.toFixed(3), 'Right:', rightAvg.toFixed(3));
  
  console.log('---');
}, 500); // 每 500ms 输出一次

// 运行一段时间后停止
setTimeout(() => clearInterval(monitor), 10000);
```

**预期结果**：
- 如果机器人倾斜，ProjectedGravityB 应该偏离 [0, 0, -1]
- 如果机器人开始倒下，RootAngVelB 应该增加
- 策略应该输出相应的恢复动作

**如果观察向量没有变化**：
- 说明状态读取有问题
- 需要检查 `readPolicyState()` 的实现

**如果观察向量有变化，但动作没有响应**：
- 说明策略推理有问题
- 需要检查策略输出

### 步骤 2：检查策略的原始输出范围 ⭐⭐⭐

**目的**：确认 tanh 是否压缩了动作范围

**方法**：修改代码，在应用 tanh 之前记录原始输出

**需要修改的文件**：`src/simulation/policyRunner.js`

**修改位置**：在 `step()` 方法中，应用 tanh 之前

**修改内容**：
```javascript
// 在应用 tanh 之前记录原始输出
if (!this._rawOutputLogged) {
  console.log('=== Raw policy output (before tanh) ===');
  console.log('Range:', Math.min(...Array.from(action)), Math.max(...Array.from(action)));
  console.log('Mean:', Array.from(action).reduce((a, b) => a + b, 0) / action.length);
  this._rawOutputLogged = true;
}
```

**预期结果**：
- 如果原始输出范围是 [-1, 1] 左右 → tanh 影响不大，需要增加 action_scale
- 如果原始输出范围是 [-4, 4] 或更大 → tanh 压缩了范围，应该移除 tanh

### 步骤 3：尝试移除 tanh ⭐⭐

**目的**：如果原始输出范围较大，移除 tanh 可以让动作幅度更大

**修改文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**修改内容**：
```json
{
  "action_squash": null,  // 从 "tanh" 改为 null
  // 或者直接删除这一行
}
```

**注意事项**：
- 用户说之前移除 tanh 失败了
- 需要同时检查 clip 范围
- 可能需要调整 action_scale

### 步骤 4：继续增加 action_scale ⭐

**目的**：如果 tanh 必须保留，继续增加动作幅度

**修改文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**修改内容**：
```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
}
```

**如果还不够**：
- 可以尝试 1.5 或 2.0
- 但要注意不要超出合理范围

## 推荐方案

### 方案 A：先诊断，再修复（推荐）

1. **先运行步骤 1**：验证观察向量是否正确
2. **然后运行步骤 2**：检查原始输出范围
3. **根据结果决定**：
   - 如果观察向量有问题 → 修复观察向量
   - 如果原始输出范围大 → 移除 tanh
   - 如果原始输出范围小 → 增加 action_scale 到 1.0

### 方案 B：直接尝试移除 tanh

1. **移除 tanh**（设置 `action_squash: null`）
2. **保持 action_scale = 0.5**
3. **测试效果**
4. **如果不行，再增加 action_scale**

### 方案 C：继续增加 action_scale

1. **增加 action_scale 到 1.0**（保持 tanh）
2. **测试效果**
3. **如果不行，再考虑移除 tanh**

## 我的建议

**优先尝试方案 A（诊断优先）**：

1. **先验证观察向量**：确认策略能够感知到倾斜
2. **检查原始输出**：确认 tanh 是否压缩了范围
3. **根据诊断结果**：有针对性地修复

**如果诊断显示观察向量正常，但动作没有响应**：
- 可能是策略本身的问题
- 需要检查 ONNX 转换是否正确
- 或者策略训练时就没有学会平衡恢复

**如果诊断显示观察向量有问题**：
- 需要修复状态读取或观察向量构建
- 这是更根本的问题

## 下一步行动

1. **立即执行**：运行步骤 1 的诊断代码，观察输出
2. **根据结果**：决定是修复观察向量，还是调整动作处理
3. **如果都不行**：可能需要检查策略本身或 ONNX 转换
