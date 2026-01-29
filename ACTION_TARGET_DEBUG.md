# 动作目标位置调试指南

## 问题分析

用户反馈：
- ✅ Warmup 正常工作
- ✅ 左右腿动作对称性良好（ratio: 0.82）
- ❌ 机器人依旧会往前倒，且基本没有什么调节

## 可能的原因

1. **动作值范围问题**：`lastActions` 是经过 tanh 后的值（[-1, 1]），但实际目标位置是 `defaultJointPos + actionScale * lastActions`
2. **初始姿态问题**：机器人可能没有从正确的初始姿态开始
3. **动作处理顺序问题**：tanh、clip、scale 的顺序可能不对

## 验证步骤

### 步骤 1：检查实际的目标关节位置

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 检查 actionTarget（这是实际应用到 MuJoCo 的目标位置）
demo.actionTarget
```

**然后输入：**
```javascript
// 检查默认关节位置
pr.defaultJointPos
```

**然后输入：**
```javascript
// 检查动作缩放
pr.actionScale
```

**然后输入：**
```javascript
// 手动计算目标位置，验证是否正确
const actions = pr.lastActions;
const defaults = pr.defaultJointPos;
const scales = pr.actionScale;
const calculatedTargets = new Array(29);
for (let i = 0; i < 29; i++) {
  calculatedTargets[i] = defaults[i] + scales[i] * actions[i];
}
console.log('Calculated targets:', calculatedTargets);
console.log('Actual actionTarget:', Array.from(demo.actionTarget || []));
```

### 步骤 2：检查左右腿的目标位置差异

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const targets = demo.actionTarget;

if (targets && targets.length >= 29) {
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  
  console.log('Left leg targets:', leftLegIndices.map(i => targets[i]));
  console.log('Right leg targets:', rightLegIndices.map(i => targets[i]));
  
  // 检查与默认位置的差异
  const defaults = pr.defaultJointPos;
  console.log('Left leg target - default:', leftLegIndices.map(i => targets[i] - defaults[i]));
  console.log('Right leg target - default:', rightLegIndices.map(i => targets[i] - defaults[i]));
}
```

### 步骤 3：检查当前关节位置

**在控制台输入：**
```javascript
const demo = window.demo;
const simulation = demo.simulation;

if (simulation && simulation.qpos) {
  const qpos = simulation.qpos;
  const qposAdr = demo.qpos_adr_policy;
  
  if (qposAdr && qposAdr.length >= 29) {
    const leftLegIndices = [0, 3, 6, 9, 13, 17];
    const rightLegIndices = [1, 4, 7, 10, 14, 18];
    
    console.log('Left leg current positions:', leftLegIndices.map(i => qpos[qposAdr[i]]));
    console.log('Right leg current positions:', rightLegIndices.map(i => qpos[qposAdr[i]]));
    
    // 检查与目标位置的差异
    const targets = demo.actionTarget;
    if (targets) {
      console.log('Left leg position error:', leftLegIndices.map(i => targets[i] - qpos[qposAdr[i]]));
      console.log('Right leg position error:', rightLegIndices.map(i => targets[i] - qpos[qposAdr[i]]));
    }
  }
}
```

### 步骤 4：检查动作处理逻辑

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];

console.log('Action squash:', pr.actionSquash);
console.log('Action clip:', pr.actionClip);
console.log('Action scale:', Array.from(pr.actionScale.slice(0, 6))); // 前6个
console.log('Last actions (first 6):', Array.from(pr.lastActions.slice(0, 6)));
```

## 完整调试脚本

**在控制台一次性输入：**

```javascript
// ============================================
// 动作目标位置完整调试脚本
// ============================================

const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

console.log('=== 步骤 1: 检查动作处理参数 ===');
console.log('Action squash:', pr.actionSquash);
console.log('Action clip:', pr.actionClip);
console.log('Action scale (first 6):', Array.from(pr.actionScale.slice(0, 6)));

console.log('\n=== 步骤 2: 检查 lastActions ===');
const actions = pr.lastActions;
console.log('Last actions (first 6):', Array.from(actions.slice(0, 6)));
console.log('Last actions range:', {
  min: Math.min(...Array.from(actions)),
  max: Math.max(...Array.from(actions)),
  avg: Array.from(actions).reduce((a, b) => a + Math.abs(b), 0) / actions.length
});

console.log('\n=== 步骤 3: 检查默认关节位置 ===');
const defaults = pr.defaultJointPos;
console.log('Default joint pos (first 6):', Array.from(defaults.slice(0, 6)));

console.log('\n=== 步骤 4: 检查实际目标位置 ===');
const targets = demo.actionTarget;
if (targets && targets.length >= 29) {
  console.log('ActionTarget (first 6):', Array.from(targets.slice(0, 6)));
  
  // 手动计算验证
  const scales = pr.actionScale;
  const calculatedTargets = new Array(29);
  for (let i = 0; i < 29; i++) {
    calculatedTargets[i] = defaults[i] + scales[i] * actions[i];
  }
  console.log('Calculated targets (first 6):', calculatedTargets.slice(0, 6));
  
  // 检查差异
  const diff = targets.slice(0, 6).map((t, i) => Math.abs(t - calculatedTargets[i]));
  console.log('Difference (first 6):', diff);
  console.log('Max difference:', Math.max(...diff));
}

console.log('\n=== 步骤 5: 检查左右腿目标位置 ===');
if (targets && targets.length >= 29) {
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  
  const leftTargets = leftLegIndices.map(i => targets[i]);
  const rightTargets = rightLegIndices.map(i => targets[i]);
  
  console.log('Left leg targets:', leftTargets);
  console.log('Right leg targets:', rightTargets);
  
  const leftAvg = leftTargets.reduce((a, b) => a + Math.abs(b), 0) / leftTargets.length;
  const rightAvg = rightTargets.reduce((a, b) => a + Math.abs(b), 0) / rightTargets.length;
  console.log('Left leg avg magnitude:', leftAvg);
  console.log('Right leg avg magnitude:', rightAvg);
  
  // 检查与默认位置的差异
  const leftDiff = leftLegIndices.map(i => targets[i] - defaults[i]);
  const rightDiff = rightLegIndices.map(i => targets[i] - defaults[i]);
  console.log('Left leg target - default:', leftDiff);
  console.log('Right leg target - default:', rightDiff);
  
  const leftDiffAvg = leftDiff.reduce((a, b) => a + Math.abs(b), 0) / leftDiff.length;
  const rightDiffAvg = rightDiff.reduce((a, b) => a + Math.abs(b), 0) / rightDiff.length;
  console.log('Left leg avg adjustment:', leftDiffAvg);
  console.log('Right leg avg adjustment:', rightDiffAvg);
}

console.log('\n=== 步骤 6: 检查当前关节位置（如果模拟正在运行）===');
const simulation = demo.simulation;
if (simulation && simulation.qpos && demo.qpos_adr_policy) {
  const qpos = simulation.qpos;
  const qposAdr = demo.qpos_adr_policy;
  
  if (qposAdr && qposAdr.length >= 29 && targets) {
    const leftLegIndices = [0, 3, 6, 9, 13, 17];
    const rightLegIndices = [1, 4, 7, 10, 14, 18];
    
    const leftCurrent = leftLegIndices.map(i => qpos[qposAdr[i]]);
    const rightCurrent = rightLegIndices.map(i => qpos[qposAdr[i]]);
    
    console.log('Left leg current positions:', leftCurrent);
    console.log('Right leg current positions:', rightCurrent);
    
    const leftError = leftLegIndices.map(i => targets[i] - qpos[qposAdr[i]]);
    const rightError = rightLegIndices.map(i => targets[i] - qpos[qposAdr[i]]);
    
    console.log('Left leg position error:', leftError);
    console.log('Right leg position error:', rightError);
    
    const leftErrorAvg = leftError.reduce((a, b) => a + Math.abs(b), 0) / leftError.length;
    const rightErrorAvg = rightError.reduce((a, b) => a + Math.abs(b), 0) / rightError.length;
    console.log('Left leg avg error:', leftErrorAvg);
    console.log('Right leg avg error:', rightErrorAvg);
  }
}

console.log('\n=== 调试完成 ===');
```
