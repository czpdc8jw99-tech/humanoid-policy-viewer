# 控制台调试指令 - v9.0.22

## 快速检查清单

### 步骤 1：刷新页面并加载策略
1. 刷新页面
2. 选择 "G1 Locomotion (Gamepad)" 策略
3. 观察控制台输出

---

## 检查 1：验证 Warmup 观察向量（最重要）

**在策略加载时，控制台应该显示**：
```
[PolicyRunner] Warmup observation vector: {
  size: 96,
  range: "[0.000, 0.000]",
  isAllZero: "✅ YES"
}
```

**如果没有看到这个日志，运行**：
```javascript
// 检查 warmup 是否完成
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('Warmup done:', pr._warmupDone);
console.log('Num obs:', pr.numObs);
```

---

## 检查 2：验证 ProjectedGravityB 计算

```javascript
// 步骤 1: 获取 PolicyRunner 和当前状态
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 步骤 2: 获取 ProjectedGravityB 观察模块
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');

// 步骤 3: 计算重力方向
const gravity = gravityObs.compute(state);
console.log('=== ProjectedGravityB 检查 ===');
console.log('Gravity direction (robot frame):', Array.from(gravity).map(v => v.toFixed(4)));
console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2).toFixed(4));
console.log('Expected: [0, 0, -1] if robot is standing upright');

// 步骤 4: 检查四元数
console.log('Root quaternion [w,x,y,z]:', Array.from(state.rootQuat));
```

**预期结果**：
- 如果机器人站立（identity quaternion `[1, 0, 0, 0]`），重力应该是 `[0, 0, -1]`
- 如果机器人前倾，重力在 X 方向应该有正分量
- 如果机器人后倾，重力在 X 方向应该有负分量

---

## 检查 3：验证观察向量构建

```javascript
// 步骤 1: 获取 PolicyRunner
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 步骤 2: 手动构建观察向量
const obsVec = new Float32Array(pr.numObs);
let offset = 0;
for (const obs of pr.obsModules) {
  if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
    obs.update(state);
  }
  const obsValue = obs.compute(state);
  const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
  obsVec.set(obsArray, offset);
  offset += obsArray.length;
}

// 步骤 3: 检查观察向量
console.log('=== 观察向量检查 ===');
console.log('Total size:', obsVec.length, '(should be 96)');
console.log('RootAngVelB (0-2):', Array.from(obsVec.slice(0, 3)).map(v => v.toFixed(3)));
console.log('ProjectedGravityB (3-5):', Array.from(obsVec.slice(3, 6)).map(v => v.toFixed(3)));
console.log('Command (6-8):', Array.from(obsVec.slice(6, 9)).map(v => v.toFixed(3)));
console.log('JointPosRel (9-37):', Array.from(obsVec.slice(9, 38)).map(v => v.toFixed(3)));
console.log('JointVel (38-66):', Array.from(obsVec.slice(38, 67)).map(v => v.toFixed(3)));
console.log('PrevActions (67-95):', Array.from(obsVec.slice(67, 96)).map(v => v.toFixed(3)));

// 步骤 4: 检查是否有值超出 [-100, 100] 范围
const obsMin = Math.min(...Array.from(obsVec));
const obsMax = Math.max(...Array.from(obsVec));
console.log('Obs range:', `[${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}]`);
console.log('Obs clipped?', obsMin >= -100 && obsMax <= 100 ? '✅ Yes' : '❌ No (should be clipped)');
```

---

## 检查 4：验证动作值和目标位置

```javascript
// 步骤 1: 获取 PolicyRunner
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 步骤 2: 检查动作值
const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('=== 动作值检查 ===');
console.log('Action scale:', pr.actionScale[0], '(should be 0.55)');
console.log('Actions (first 6):', Array.from(actions.slice(0, 6)).map(v => v.toFixed(4)));
console.log('Targets (first 6):', Array.from(targets.slice(0, 6)).map(v => v.toFixed(4)));
console.log('Defaults (first 6):', Array.from(defaults.slice(0, 6)).map(v => v.toFixed(4)));

// 步骤 3: 验证公式: target = default + actionScale * action
const calculated = defaults.slice(0, 6).map((d, i) => d + pr.actionScale[i] * actions[i]);
console.log('Calculated targets (first 6):', calculated.map(v => v.toFixed(4)));
console.log('Actual targets (first 6):', Array.from(targets.slice(0, 6)).map(v => v.toFixed(4)));
const match = calculated.every((c, i) => Math.abs(c - targets[i]) < 0.0001);
console.log('Formula match?', match ? '✅ Yes' : '❌ No');

// 步骤 4: 检查左右腿动作
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];
const leftLegActions = leftLegIndices.map(i => actions[i]);
const rightLegActions = rightLegIndices.map(i => actions[i]);
console.log('=== 左右腿动作对比 ===');
console.log('Left leg actions:', leftLegActions.map(v => v.toFixed(4)));
console.log('Right leg actions:', rightLegActions.map(v => v.toFixed(4)));

const leftAvg = leftLegActions.reduce((sum, a) => sum + Math.abs(a), 0) / leftLegActions.length;
const rightAvg = rightLegActions.reduce((sum, a) => sum + Math.abs(a), 0) / rightLegActions.length;
console.log('Left leg avg magnitude:', leftAvg.toFixed(4));
console.log('Right leg avg magnitude:', rightAvg.toFixed(4));
const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
console.log('Symmetry ratio:', ratio.toFixed(4), ratio > 0.7 ? '✅ Good' : '⚠️ Poor');
```

---

## 检查 5：验证初始状态

```javascript
// 步骤 1: 检查初始高度
const demo = window.demo;
const qpos = demo.simulation.qpos;
console.log('=== 初始状态检查 ===');
console.log('Initial root position:', {
  x: qpos[0].toFixed(3),
  y: qpos[1].toFixed(3),
  z: qpos[2].toFixed(3),  // 应该是 0.8
  expected: 'z should be 0.8'
});

// 步骤 2: 检查初始关节位置
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const defaults = pr.defaultJointPos;
const currentJpos = [];
for (let i = 0; i < pr.numActions; i++) {
  const qposAdr = demo.qpos_adr_policy[i];
  currentJpos.push(demo.simulation.qpos[qposAdr]);
}

console.log('Default joint positions (first 6):', Array.from(defaults.slice(0, 6)).map(v => v.toFixed(3)));
console.log('Current joint positions (first 6):', currentJpos.slice(0, 6).map(v => v.toFixed(3)));
const jposMatch = defaults.slice(0, 6).every((d, i) => Math.abs(d - currentJpos[i]) < 0.001);
console.log('Joint positions match defaults?', jposMatch ? '✅ Yes' : '❌ No');
```

---

## 检查 6：实时监控（每 60 帧）

```javascript
// 创建一个监控函数
function monitorPolicy() {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr) {
    console.log('PolicyRunner not found');
    return;
  }
  
  const demo = window.demo;
  const state = demo.readPolicyState();
  
  // 构建观察向量
  const obsVec = new Float32Array(pr.numObs);
  let offset = 0;
  for (const obs of pr.obsModules) {
    if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
      obs.update(state);
    }
    const obsValue = obs.compute(state);
    const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
    obsVec.set(obsArray, offset);
    offset += obsArray.length;
  }
  
  // 检查关键值
  const gravity = obsVec.slice(3, 6);
  const command = obsVec.slice(6, 9);
  const actions = pr.lastActions;
  
  console.log('=== 实时监控 ===');
  console.log('Gravity:', Array.from(gravity).map(v => v.toFixed(3)));
  console.log('Command:', Array.from(command).map(v => v.toFixed(3)));
  console.log('Actions (first 6):', Array.from(actions.slice(0, 6)).map(v => v.toFixed(3)));
  console.log('Obs range:', `[${Math.min(...Array.from(obsVec)).toFixed(2)}, ${Math.max(...Array.from(obsVec)).toFixed(2)}]`);
}

// 手动调用
monitorPolicy();
```

---

## 检查 7：验证动作应用

```javascript
// 检查动作是否正确应用到关节
const demo = window.demo;
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];

console.log('=== 动作应用检查 ===');
for (let i = 0; i < 6; i++) {
  const qposAdr = demo.qpos_adr_policy[i];
  const targetJpos = demo.actionTarget[i];
  const currentJpos = demo.simulation.qpos[qposAdr];
  const kp = demo.kpPolicy[i];
  const error = targetJpos - currentJpos;
  const torque = kp * error;
  
  console.log(`Joint ${i} (${demo.policyJointNames[i]}):`, {
    target: targetJpos.toFixed(4),
    current: currentJpos.toFixed(4),
    error: error.toFixed(4),
    kp: kp,
    torque: torque.toFixed(2)
  });
}
```

---

## 一键检查所有项目

```javascript
// 运行所有检查
function checkAll() {
  console.log('%c=== 开始全面检查 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr) {
    console.error('❌ PolicyRunner not found. Please load a policy first.');
    return;
  }
  
  const demo = window.demo;
  const state = demo.readPolicyState();
  
  // 1. Warmup 检查
  console.log('%c1. Warmup 检查', 'color: cyan; font-weight: bold;');
  console.log('Warmup done:', pr._warmupDone ? '✅ Yes' : '❌ No');
  
  // 2. ProjectedGravityB 检查
  console.log('%c2. ProjectedGravityB 检查', 'color: cyan; font-weight: bold;');
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  const gravity = gravityObs.compute(state);
  console.log('Gravity:', Array.from(gravity).map(v => v.toFixed(4)));
  
  // 3. 观察向量检查
  console.log('%c3. 观察向量检查', 'color: cyan; font-weight: bold;');
  const obsVec = new Float32Array(pr.numObs);
  let offset = 0;
  for (const obs of pr.obsModules) {
    if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
      obs.update(state);
    }
    const obsValue = obs.compute(state);
    const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
    obsVec.set(obsArray, offset);
    offset += obsArray.length;
  }
  const obsMin = Math.min(...Array.from(obsVec));
  const obsMax = Math.max(...Array.from(obsVec));
  console.log('Obs range:', `[${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}]`);
  console.log('Obs clipped?', obsMin >= -100 && obsMax <= 100 ? '✅ Yes' : '❌ No');
  
  // 4. 动作值检查
  console.log('%c4. 动作值检查', 'color: cyan; font-weight: bold;');
  console.log('Action scale:', pr.actionScale[0]);
  const actions = pr.lastActions;
  console.log('Actions range:', `[${Math.min(...Array.from(actions)).toFixed(2)}, ${Math.max(...Array.from(actions)).toFixed(2)}]`);
  
  // 5. 初始状态检查
  console.log('%c5. 初始状态检查', 'color: cyan; font-weight: bold;');
  const qpos = demo.simulation.qpos;
  console.log('Initial height (z):', qpos[2].toFixed(3), qpos[2] === 0.8 ? '✅ Correct' : '❌ Wrong');
  
  console.log('%c=== 检查完成 ===', 'color: green; font-weight: bold; font-size: 16px;');
}

// 运行
checkAll();
```

---

## 预期结果

### Warmup 观察向量
- ✅ `isAllZero: "✅ YES"`
- ✅ `range: "[0.000, 0.000]"`

### ProjectedGravityB
- ✅ 机器人站立时：`[0, 0, -1]` 或接近
- ✅ 机器人前倾时：X 方向有正分量
- ✅ 机器人后倾时：X 方向有负分量

### 观察向量
- ✅ 所有值在 `[-100, 100]` 范围内
- ✅ 大小 = 96

### 动作值
- ✅ Action scale = 0.55
- ✅ 动作值合理（不会过大或过小）

### 初始状态
- ✅ 初始高度 z = 0.8
- ✅ 关节位置匹配 default_joint_pos
