# 控制台调试指令

## 准备工作

1. 打开浏览器控制台（F12）
2. 清除控制台过滤器（确保能看到所有日志）
3. 刷新页面
4. 选择 "G1 Locomotion (Gamepad)" 策略

---

## 指令 1：检查策略初始化

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('=== 策略基本信息 ===');
console.log('Num actions:', pr.numActions);
console.log('Num obs:', pr.numObs);
console.log('Warmup done:', pr._warmupDone);
console.log('Action scale:', pr.actionScale[0]);
console.log('Action clip:', pr.actionClip);
console.log('Action squash:', pr.actionSquash);
```

**预期结果**：
- `Warmup done: true`
- `Action scale: 0.55`
- `Action clip: 100`
- `Action squash: null`

---

## 指令 2：检查观察向量（首次推理后）

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 手动构建观察向量（模拟策略推理时的构建过程）
const state = demo.readPolicyState();
const obsModules = pr.obsModules;

console.log('=== 观察向量组件 ===');
let offset = 0;
const obsComponents = [];
for (const obs of obsModules) {
  const obsValue = obs.compute(state);
  const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
  const min = Math.min(...Array.from(obsArray));
  const max = Math.max(...Array.from(obsArray));
  const mean = Array.from(obsArray).reduce((a, b) => a + Math.abs(b), 0) / obsArray.length;
  obsComponents.push({
    name: obs.constructor.name,
    size: obsArray.length,
    offset: offset,
    range: `[${min.toFixed(3)}, ${max.toFixed(3)}]`,
    meanAbs: mean.toFixed(3)
  });
  offset += obsArray.length;
}

console.table(obsComponents);

// 检查重力方向
const gravityObs = obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
if (gravityObs) {
  const gravity = gravityObs.compute(state);
  console.log('=== 重力方向（机器人坐标系）===');
  console.log('Gravity:', Array.from(gravity).map(v => v.toFixed(4)));
  console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2).toFixed(4));
  console.log('Expected: ~1.0 (normalized)');
}
```

**预期结果**：
- 重力方向应该是归一化的向量（magnitude ≈ 1.0）
- 如果机器人站立，重力应该是 `[0, 0, -1]` 或接近这个值

---

## 指令 3：检查动作值

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('=== 动作值检查 ===');
console.log('Actions range:', {
  min: Math.min(...Array.from(actions)).toFixed(4),
  max: Math.max(...Array.from(actions)).toFixed(4),
  mean: (Array.from(actions).reduce((a, b) => a + Math.abs(b), 0) / actions.length).toFixed(4)
});

// 检查左右腿动作
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

const leftLegActions = leftLegIndices.map(i => actions[i]);
const rightLegActions = rightLegIndices.map(i => actions[i]);

console.log('=== 左右腿动作对比 ===');
console.log('Left leg actions:', leftLegActions.map(v => v.toFixed(4)));
console.log('Right leg actions:', rightLegActions.map(v => v.toFixed(4)));

const leftAvg = leftLegActions.reduce((sum, v) => sum + Math.abs(v), 0) / leftLegActions.length;
const rightAvg = rightLegActions.reduce((sum, v) => sum + Math.abs(v), 0) / rightLegActions.length;
const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
console.log('Left leg avg magnitude:', leftAvg.toFixed(4));
console.log('Right leg avg magnitude:', rightAvg.toFixed(4));
console.log('Symmetry ratio:', ratio.toFixed(4));
console.log(ratio > 0.7 ? '✅ 对称性良好' : '⚠️ 对称性较差');
```

**预期结果**：
- 动作值应该在合理范围内（例如 [-2, 2]）
- 左右腿动作应该大致对称（ratio > 0.7）

---

## 指令 4：检查目标位置和当前位置

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;
const state = demo.readPolicyState();
const currentPos = state.jointPos;

console.log('=== 目标位置 vs 当前位置 ===');

// 检查前6个关节（左右腿）
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

console.log('=== 左腿 ===');
leftLegIndices.forEach((idx, i) => {
  const jointName = pr.policyJointNames[idx];
  const target = targets[idx];
  const current = currentPos[idx];
  const defaultPos = defaults[idx];
  const error = target - current;
  console.log(`[${idx}] ${jointName}:`, {
    default: defaultPos.toFixed(4),
    target: target.toFixed(4),
    current: current.toFixed(4),
    error: error.toFixed(4),
    adjustment: (target - defaultPos).toFixed(4)
  });
});

console.log('=== 右腿 ===');
rightLegIndices.forEach((idx, i) => {
  const jointName = pr.policyJointNames[idx];
  const target = targets[idx];
  const current = currentPos[idx];
  const defaultPos = defaults[idx];
  const error = target - current;
  console.log(`[${idx}] ${jointName}:`, {
    default: defaultPos.toFixed(4),
    target: target.toFixed(4),
    current: current.toFixed(4),
    error: error.toFixed(4),
    adjustment: (target - defaultPos).toFixed(4)
  });
});
```

**预期结果**：
- 目标位置应该接近当前位置（error 应该很小）
- 调整幅度（target - default）应该在合理范围内

---

## 指令 5：检查观察向量范围（是否有异常值）

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 手动构建完整观察向量
const state = demo.readPolicyState();
const obsForPolicy = new Float32Array(pr.numObs);
let offset = 0;
for (const obs of pr.obsModules) {
  if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
    obs.update(state);
  }
  const obsValue = obs.compute(state);
  const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
  obsForPolicy.set(obsArray, offset);
  offset += obsArray.length;
}

// 应用 clip（模拟策略推理时的处理）
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}

console.log('=== 观察向量统计 ===');
const obsMin = Math.min(...Array.from(obsForPolicy));
const obsMax = Math.max(...Array.from(obsForPolicy));
const obsMean = Array.from(obsForPolicy).reduce((a, b) => a + b, 0) / obsForPolicy.length;
const obsMeanAbs = Array.from(obsForPolicy).reduce((a, b) => a + Math.abs(b), 0) / obsForPolicy.length;

console.log('Total size:', obsForPolicy.length);
console.log('Range:', `[${obsMin.toFixed(3)}, ${obsMax.toFixed(3)}]`);
console.log('Mean:', obsMean.toFixed(3));
console.log('Mean absolute:', obsMeanAbs.toFixed(3));

// 检查是否有异常值（超出 [-10, 10] 范围）
const outliers = [];
for (let i = 0; i < obsForPolicy.length; i++) {
  if (Math.abs(obsForPolicy[i]) > 10) {
    outliers.push({ index: i, value: obsForPolicy[i].toFixed(3) });
  }
}
if (outliers.length > 0) {
  console.warn('⚠️ 发现异常值（绝对值 > 10）:', outliers);
} else {
  console.log('✅ 观察向量值在合理范围内');
}
```

**预期结果**：
- 观察向量值应该在合理范围内（大部分值在 [-5, 5] 之间）
- 如果有大量异常值，可能是计算错误

---

## 指令 6：检查重力方向计算

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 检查重力方向
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
if (gravityObs) {
  const gravity = gravityObs.compute(state);
  console.log('=== 重力方向检查 ===');
  console.log('Gravity (robot frame):', Array.from(gravity).map(v => v.toFixed(4)));
  console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2).toFixed(4));
  
  // 检查四元数
  console.log('Root quaternion:', Array.from(state.rootQuat).map(v => v.toFixed(4)));
  
  // 如果机器人站立，重力应该是 [0, 0, -1]
  const expectedGravity = [0, 0, -1];
  const diff = [
    gravity[0] - expectedGravity[0],
    gravity[1] - expectedGravity[1],
    gravity[2] - expectedGravity[2]
  ];
  const diffMag = Math.sqrt(diff[0]**2 + diff[1]**2 + diff[2]**2);
  console.log('Difference from expected [0, 0, -1]:', diff.map(v => v.toFixed(4)));
  console.log('Difference magnitude:', diffMag.toFixed(4));
  
  if (diffMag < 0.1) {
    console.log('✅ 重力方向正确（机器人站立）');
  } else if (diffMag < 0.5) {
    console.log('⚠️ 重力方向接近预期，但可能有轻微倾斜');
  } else {
    console.warn('❌ 重力方向异常，可能机器人倾斜或计算错误');
  }
}
```

**预期结果**：
- 如果机器人站立，重力应该是 `[0, 0, -1]`（magnitude = 1.0）
- 如果机器人前倾，重力在 X 方向应该有正值
- 如果机器人后倾，重力在 X 方向应该有负值

---

## 指令 7：检查 Warmup 观察向量（策略加载时）

**注意**：这个需要在策略加载时立即执行，或者查看控制台日志

```javascript
// 查看控制台日志中是否有：
// "[PolicyRunner] Warming up LSTM/internal state (50 iterations)..."
// 如果看到这个日志，说明 warmup 正在执行

// 检查 warmup 是否完成
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('Warmup done:', pr._warmupDone);
```

**预期结果**：
- `Warmup done: true`（策略加载后）
- 控制台应该看到 warmup 日志

---

## 指令 8：实时监控观察向量和动作值

```javascript
// 创建一个监控函数
function monitorPolicy() {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  const demo = window.demo;
  
  if (!pr || !demo) {
    console.log('策略未加载');
    return;
  }
  
  const state = demo.readPolicyState();
  const actions = pr.lastActions;
  const targets = demo.actionTarget;
  
  // 构建观察向量
  const obsForPolicy = new Float32Array(pr.numObs);
  let offset = 0;
  for (const obs of pr.obsModules) {
    if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
      obs.update(state);
    }
    const obsValue = obs.compute(state);
    const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
    obsForPolicy.set(obsArray, offset);
    offset += obsArray.length;
  }
  
  // 提取关键组件
  const rootAngVel = obsForPolicy.slice(0, 3);
  const gravity = obsForPolicy.slice(3, 6);
  const command = obsForPolicy.slice(6, 9);
  
  console.log('=== 实时监控 ===');
  console.log('Gravity:', Array.from(gravity).map(v => v.toFixed(3)));
  console.log('Root ang vel:', Array.from(rootAngVel).map(v => v.toFixed(3)));
  console.log('Command:', Array.from(command).map(v => v.toFixed(3)));
  console.log('Actions (first 6):', Array.from(actions.slice(0, 6)).map(v => v.toFixed(3)));
  console.log('Targets (first 6):', Array.from(targets.slice(0, 6)).map(v => v.toFixed(3)));
}

// 每 1 秒执行一次
const monitorInterval = setInterval(monitorPolicy, 1000);

// 停止监控（5秒后）
setTimeout(() => {
  clearInterval(monitorInterval);
  console.log('监控已停止');
}, 5000);
```

**预期结果**：
- 重力方向应该反映机器人的姿态
- 动作值应该平滑变化
- 目标位置应该接近当前位置

---

## 指令 9：检查初始高度设置

```javascript
const demo = window.demo;
const qpos = demo.simulation.qpos;

console.log('=== 初始位置检查 ===');
console.log('Root position:', {
  x: qpos[0].toFixed(4),
  y: qpos[1].toFixed(4),
  z: qpos[2].toFixed(4)
});
console.log('Expected Z (height): 0.8');
console.log('Actual Z:', qpos[2].toFixed(4));
console.log(qpos[2] > 0.75 && qpos[2] < 0.85 ? '✅ 高度正确' : '⚠️ 高度异常');
```

**预期结果**：
- Z 坐标应该是 0.8（或接近）

---

## 指令 10：检查 PD 控制参数

```javascript
const demo = window.demo;

console.log('=== PD 控制参数 ===');
console.log('KP (first 6):', Array.from(demo.kpPolicy.slice(0, 6)));
console.log('KD (first 6):', Array.from(demo.kdPolicy.slice(0, 6)));

// 检查左右腿的 KP/KD 是否对称
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

const leftKP = leftLegIndices.map(i => demo.kpPolicy[i]);
const rightKP = rightLegIndices.map(i => demo.kpPolicy[i]);

console.log('Left leg KP:', leftKP);
console.log('Right leg KP:', rightKP);
console.log('KP symmetric:', JSON.stringify(leftKP) === JSON.stringify(rightKP) ? '✅' : '❌');
```

**预期结果**：
- 左右腿的 KP/KD 应该对称
- KP 值应该在合理范围内（例如 100-200）

---

## 综合诊断指令

```javascript
// 一次性检查所有关键指标
function fullDiagnostic() {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  const demo = window.demo;
  
  if (!pr || !demo) {
    console.error('策略未加载！请先选择策略。');
    return;
  }
  
  console.log('%c=== 完整诊断 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  // 1. 基本信息
  console.log('%c1. 策略基本信息', 'color: green; font-weight: bold;');
  console.log('  Actions:', pr.numActions);
  console.log('  Obs:', pr.numObs);
  console.log('  Warmup done:', pr._warmupDone);
  console.log('  Action scale:', pr.actionScale[0]);
  
  // 2. 观察向量
  console.log('%c2. 观察向量', 'color: green; font-weight: bold;');
  const state = demo.readPolicyState();
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (gravityObs) {
    const gravity = gravityObs.compute(state);
    console.log('  重力方向:', Array.from(gravity).map(v => v.toFixed(3)));
    console.log('  重力大小:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2).toFixed(3));
  }
  
  // 3. 动作值
  console.log('%c3. 动作值', 'color: green; font-weight: bold;');
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
  const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
  console.log('  左腿平均幅度:', leftAvg.toFixed(4));
  console.log('  右腿平均幅度:', rightAvg.toFixed(4));
  console.log('  对称性:', (Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg)).toFixed(3));
  
  // 4. 位置误差
  console.log('%c4. 位置误差', 'color: green; font-weight: bold;');
  const targets = demo.actionTarget;
  const currentPos = state.jointPos;
  const errors = leftLegIndices.map(i => Math.abs(targets[i] - currentPos[i]));
  const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
  console.log('  平均位置误差:', avgError.toFixed(4));
  console.log('  最大位置误差:', Math.max(...errors).toFixed(4));
  
  // 5. 初始高度
  console.log('%c5. 初始高度', 'color: green; font-weight: bold;');
  const qpos = demo.simulation.qpos;
  console.log('  Z坐标:', qpos[2].toFixed(4));
  console.log('  预期: 0.8');
  
  console.log('%c=== 诊断完成 ===', 'color: blue; font-weight: bold; font-size: 16px;');
}

// 执行诊断
fullDiagnostic();
```

---

## 使用建议

1. **首次检查**：执行"指令 10：综合诊断指令"
2. **如果发现问题**：执行相应的详细检查指令
3. **实时监控**：使用"指令 8：实时监控"观察策略行为

---

## 常见问题排查

### 如果重力方向异常
- 检查四元数顺序
- 检查 `quatApplyInv` 计算

### 如果动作值异常
- 检查观察向量是否有异常值
- 检查动作 clip 是否正确应用

### 如果左右腿不对称
- 检查关节映射
- 检查观察向量中的左右腿数据
