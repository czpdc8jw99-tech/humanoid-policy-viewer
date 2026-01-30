# 当前需要的调试指令

## 目标

诊断为什么机器人站不住，看不出有抵抗趋势。

---

## 调试步骤（按顺序执行）

### 步骤 1：检查原始策略输出范围 ⭐⭐⭐

**目的**：确认 tanh 是否压缩了动作范围

**操作**：
1. 刷新页面
2. 选择 "G1 Locomotion (Gamepad)" 策略
3. 查看控制台输出

**预期输出**：
```
=== [PolicyRunner] Raw policy output range (BEFORE tanh/clip) ===
Min: X.XXXX
Max: X.XXXX
Mean: X.XXXX
Std: X.XXXX
Range: [-X.XX, X.XX]
```

**分析**：
- **如果范围是 [-1, 1] 左右** → tanh 影响不大，需要增加 `action_scale`
- **如果范围是 [-4, 4] 或更大** → tanh 压缩了范围，应该移除 tanh

---

### 步骤 2：监控观察向量更新 ⭐⭐

**目的**：确认策略能够感知到机器人的倾斜和旋转

**在控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 持续监控（每 500ms）
const monitor = setInterval(() => {
  const state = demo.readPolicyState();
  
  // 检查重力投影
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (gravityObs) {
    const gravity = gravityObs.compute(state);
    const magnitude = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
    console.log('ProjectedGravityB:', Array.from(gravity).map(v => v.toFixed(3)), '|magnitude:', magnitude.toFixed(3));
    // 正常应该是 [0, 0, -1] 或接近，如果机器人倾斜会偏离
  }
  
  // 检查角速度
  const angVel = state.rootAngVel;
  const angVelMag = Math.sqrt(angVel[0]**2 + angVel[1]**2 + angVel[2]**2);
  console.log('RootAngVelB:', Array.from(angVel).map(v => v.toFixed(3)), '|magnitude:', angVelMag.toFixed(3));
  
  // 检查动作输出
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
  const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
  console.log('Action magnitude - Left:', leftAvg.toFixed(3), 'Right:', rightAvg.toFixed(3));
  
  console.log('---');
}, 500);

// 运行 10 秒后停止
setTimeout(() => {
  clearInterval(monitor);
  console.log('Monitoring stopped');
}, 10000);
```

**预期结果**：
- 如果机器人倾斜，ProjectedGravityB 应该偏离 [0, 0, -1]
- 如果机器人开始倒下，RootAngVelB 应该增加
- 策略应该输出相应的恢复动作（action magnitude 应该增加）

**如果观察向量没有变化**：
- 说明状态读取有问题

**如果观察向量有变化，但动作没有响应**：
- 说明策略推理有问题

---

### 步骤 3：检查 tanh 前后的值 ⭐

**目的**：对比 tanh 前后的动作值

**在控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];

// 检查配置
console.log('Action squash:', pr.actionSquash);
console.log('Action scale:', Array.from(pr.actionScale.slice(0, 6))); // 前6个
console.log('Action clip:', pr.actionClip);

// 检查当前动作值（已经经过 tanh）
const actions = pr.lastActions;
console.log('Last actions (after tanh, first 6):', Array.from(actions.slice(0, 6)));
console.log('Last actions range:', {
  min: Math.min(...Array.from(actions)),
  max: Math.max(...Array.from(actions)),
  avg: Array.from(actions).reduce((a, b) => a + Math.abs(b), 0) / actions.length
});
```

**预期结果**：
- 如果 `actionSquash` 是 `"tanh"`，动作值应该在 [-1, 1] 范围内
- 如果 `actionSquash` 是 `null`，动作值可能在更大的范围内

---

### 步骤 4：检查实际目标位置 ⭐

**目的**：确认动作是否正确应用到关节

**在控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 检查目标位置
const targets = demo.actionTarget;
if (targets && targets.length >= 29) {
  const defaults = pr.defaultJointPos;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  
  // 计算调整幅度
  const leftAdjustments = leftLegIndices.map(i => targets[i] - defaults[i]);
  const rightAdjustments = rightLegIndices.map(i => targets[i] - defaults[i]);
  
  const leftAvg = leftAdjustments.reduce((sum, a) => sum + Math.abs(a), 0) / leftAdjustments.length;
  const rightAvg = rightAdjustments.reduce((sum, a) => sum + Math.abs(a), 0) / rightAdjustments.length;
  
  console.log('Left leg avg adjustment:', leftAvg.toFixed(4), 'radians');
  console.log('Right leg avg adjustment:', rightAvg.toFixed(4), 'radians');
  console.log('Left leg adjustments:', leftAdjustments.map(a => a.toFixed(3)));
  console.log('Right leg adjustments:', rightAdjustments.map(a => a.toFixed(3)));
}
```

**预期结果**：
- 调整幅度应该足够大（至少 ±0.1 弧度）
- 如果调整幅度太小（< 0.05 弧度），说明动作幅度不够

---

## 完整调试脚本（一次性运行）

**在控制台一次性输入**：

```javascript
// ============================================
// 完整调试脚本
// ============================================

const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

console.log('=== 步骤 1: 检查配置 ===');
console.log('Action squash:', pr.actionSquash);
console.log('Action scale:', pr.actionScale[0]); // 第一个值（应该都是 0.5）
console.log('Action clip:', pr.actionClip);

console.log('\n=== 步骤 2: 检查原始输出范围 ===');
console.log('（查看控制台中的 "Raw policy output range" 日志）');

console.log('\n=== 步骤 3: 检查当前动作值（经过 tanh） ===');
const actions = pr.lastActions;
console.log('Last actions range:', {
  min: Math.min(...Array.from(actions)).toFixed(4),
  max: Math.max(...Array.from(actions)).toFixed(4),
  avg: (Array.from(actions).reduce((a, b) => a + Math.abs(b), 0) / actions.length).toFixed(4)
});

console.log('\n=== 步骤 4: 检查目标位置调整 ===');
const targets = demo.actionTarget;
if (targets && targets.length >= 29) {
  const defaults = pr.defaultJointPos;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  
  const leftAdjustments = leftLegIndices.map(i => targets[i] - defaults[i]);
  const rightAdjustments = rightLegIndices.map(i => targets[i] - defaults[i]);
  
  const leftAvg = leftAdjustments.reduce((sum, a) => sum + Math.abs(a), 0) / leftAdjustments.length;
  const rightAvg = rightAdjustments.reduce((sum, a) => sum + Math.abs(a), 0) / rightAdjustments.length;
  
  console.log('Left leg avg adjustment:', leftAvg.toFixed(4), 'radians (', (leftAvg * 180 / Math.PI).toFixed(1), 'degrees)');
  console.log('Right leg avg adjustment:', rightAvg.toFixed(4), 'radians (', (rightAvg * 180 / Math.PI).toFixed(1), 'degrees)');
  
  if (leftAvg < 0.1 && rightAvg < 0.1) {
    console.log('⚠️ 调整幅度太小！可能需要移除 tanh 或增加 action_scale');
  }
}

console.log('\n=== 步骤 5: 检查观察向量 ===');
const state = demo.readPolicyState();
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
if (gravityObs) {
  const gravity = gravityObs.compute(state);
  const magnitude = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
  console.log('ProjectedGravityB:', Array.from(gravity).map(v => v.toFixed(3)), '|magnitude:', magnitude.toFixed(3));
  if (Math.abs(gravity[0]) > 0.1 || Math.abs(gravity[1]) > 0.1) {
    console.log('✅ 机器人有倾斜，策略应该能感知到');
  } else {
    console.log('ℹ️ 机器人基本直立');
  }
}

const angVel = state.rootAngVel;
const angVelMag = Math.sqrt(angVel[0]**2 + angVel[1]**2 + angVel[2]**2);
console.log('RootAngVelB:', Array.from(angVel).map(v => v.toFixed(3)), '|magnitude:', angVelMag.toFixed(3));

console.log('\n=== 调试完成 ===');
console.log('请把以上输出结果发给我，特别是：');
console.log('1. Raw policy output range（如果看到了）');
console.log('2. Left/Right leg avg adjustment');
console.log('3. ProjectedGravityB 的值');
```

---

## 根据结果决定下一步

### 如果原始输出范围是 [-1, 1] 左右
→ **增加 action_scale 到 1.0**

### 如果原始输出范围是 [-4, 4] 或更大
→ **移除 tanh**（设置 `action_squash: null`）

### 如果调整幅度 < 0.1 弧度
→ **移除 tanh 或增加 action_scale**

### 如果观察向量没有变化
→ **检查状态读取代码**

---

## tanh 代码位置

**文件**：`src/simulation/policyRunner.js`  
**位置**：第 354-356 行

```javascript
// Apply squash (e.g., tanh) if configured
if (this.actionSquash === 'tanh') {
  value = Math.tanh(value);  // ← 这里应用 tanh
}
```

**配置位置**：`public/examples/checkpoints/g1/loco_policy_29dof.json`  
**位置**：第 53 行

```json
{
  "action_squash": "tanh",  // ← 这里控制是否使用 tanh
}
```
