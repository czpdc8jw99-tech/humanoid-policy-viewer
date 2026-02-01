# 控制台调试指令 - v9.0.22

## 验证修复是否生效

### 1. 验证 Warmup 观察向量是否为全零

```javascript
// 步骤 1: 获取 PolicyRunner 实例
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];

// 步骤 2: 检查 warmup 是否完成
console.log('Warmup done:', pr._warmupDone);

// 步骤 3: 手动触发一次 warmup 观察向量检查（需要重新加载策略）
// 注意：这个需要在策略加载时检查，所以我们需要在策略加载后立即检查
```

**更好的方法**：在策略加载时，检查 warmup 过程中的观察向量。

---

### 2. 验证 ProjectedGravityB 计算

```javascript
// 步骤 1: 获取 PolicyRunner 和当前状态
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 步骤 2: 获取 ProjectedGravityB 观察模块
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');

// 步骤 3: 计算重力方向
const gravity = gravityObs.compute(state);
console.log('ProjectedGravityB (robot frame):', Array.from(gravity));
console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2));

// 步骤 4: 检查四元数
console.log('Root quaternion [w,x,y,z]:', Array.from(state.rootQuat));

// 步骤 5: 验证机器人站立时重力方向
// 如果机器人站立（identity quaternion），重力应该是 [0, 0, -1]
// 如果机器人前倾，重力在 X 方向应该有分量
```

---

### 3. 验证观察向量构建

```javascript
// 步骤 1: 获取 PolicyRunner
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 步骤 2: 手动构建观察向量（用于对比）
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
console.log('Total size:', obsVec.length);
console.log('RootAngVelB (0-2):', Array.from(obsVec.slice(0, 3)));
console.log('ProjectedGravityB (3-5):', Array.from(obsVec.slice(3, 6)));
console.log('Command (6-8):', Array.from(obsVec.slice(6, 9)));
console.log('JointPosRel (9-37):', Array.from(obsVec.slice(9, 38)));
console.log('JointVel (38-66):', Array.from(obsVec.slice(38, 67)));
console.log('PrevActions (67-95):', Array.from(obsVec.slice(67, 96)));

// 步骤 4: 检查是否有值超出 [-100, 100] 范围
const obsMin = Math.min(...Array.from(obsVec));
const obsMax = Math.max(...Array.from(obsVec));
console.log('Obs range:', `[${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}]`);
console.log('Obs clipped?', obsMin >= -100 && obsMax <= 100 ? '✅ Yes' : '❌ No');
```

---

### 4. 验证动作值

```javascript
// 步骤 1: 获取 PolicyRunner
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 步骤 2: 检查动作值
const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('=== 动作值检查 ===');
console.log('Actions (first 6):', Array.from(actions.slice(0, 6)));
console.log('Targets (first 6):', Array.from(targets.slice(0, 6)));
console.log('Defaults (first 6):', Array.from(defaults.slice(0, 6)));

// 步骤 3: 验证公式
const calculated = defaults.slice(0, 6).map((d, i) => d + pr.actionScale[i] * actions[i]);
console.log('Calculated targets (first 6):', calculated);
console.log('Actual targets (first 6):', Array.from(targets.slice(0, 6)));
console.log('Match?', calculated.every((c, i) => Math.abs(c - targets[i]) < 0.0001) ? '✅ Yes' : '❌ No');

// 步骤 4: 检查左右腿动作
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];
const leftLegActions = leftLegIndices.map(i => actions[i]);
const rightLegActions = rightLegIndices.map(i => actions[i]);
console.log('Left leg actions:', leftLegActions);
console.log('Right leg actions:', rightLegActions);

const leftAvg = leftLegActions.reduce((sum, a) => sum + Math.abs(a), 0) / leftLegActions.length;
const rightAvg = rightLegActions.reduce((sum, a) => sum + Math.abs(a), 0) / rightLegActions.length;
console.log('Left leg avg magnitude:', leftAvg.toFixed(4));
console.log('Right leg avg magnitude:', rightAvg.toFixed(4));
console.log('Symmetry ratio:', (Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg)).toFixed(4));
```

---

### 5. 验证初始状态

```javascript
// 步骤 1: 检查初始高度
const demo = window.demo;
const qpos = demo.simulation.qpos;
console.log('Initial root position:', {
  x: qpos[0],
  y: qpos[1],
  z: qpos[2]  // 应该是 0.8
});

// 步骤 2: 检查初始关节位置
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const defaults = pr.defaultJointPos;
const currentJpos = [];
for (let i = 0; i < pr.numActions; i++) {
  const qposAdr = demo.qpos_adr_policy[i];
  currentJpos.push(demo.simulation.qpos[qposAdr]);
}

console.log('Default joint positions (first 6):', Array.from(defaults.slice(0, 6)));
console.log('Current joint positions (first 6):', currentJpos.slice(0, 6));
console.log('Match?', defaults.slice(0, 6).every((d, i) => Math.abs(d - currentJpos[i]) < 0.001) ? '✅ Yes' : '❌ No');
```

---

### 6. 实时监控观察向量和动作

```javascript
// 创建一个监控函数
function monitorPolicy() {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
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

// 每 60 帧调用一次（约 1 秒）
let monitorCount = 0;
const originalStep = window.demo.policyRunner?.step;
if (originalStep) {
  window.demo.policyRunner.step = async function(...args) {
    const result = await originalStep.apply(this, args);
    monitorCount++;
    if (monitorCount % 60 === 0) {
      monitorPolicy();
    }
    return result;
  };
}
```

---

## 快速检查清单

### 检查 1：Warmup 观察向量
```javascript
// 这个需要在策略加载时检查，所以我们需要修改代码添加日志
// 或者重新加载策略时观察控制台输出
```

### 检查 2：ProjectedGravityB 计算
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
const gravity = gravityObs.compute(state);
console.log('Gravity:', Array.from(gravity));
// 机器人站立时应该是 [0, 0, -1] 或接近这个值
```

### 检查 3：观察向量范围
```javascript
// 在策略运行时，观察向量应该在 [-100, 100] 范围内
// 检查控制台中的 "Obs range" 日志
```

### 检查 4：动作值
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('Actions range:', {
  min: Math.min(...Array.from(pr.lastActions)),
  max: Math.max(...Array.from(pr.lastActions))
});
```

---

## 建议的调试流程

1. **重新加载策略**：刷新页面，选择 "G1 Locomotion (Gamepad)" 策略
2. **检查控制台日志**：查看是否有 warmup 相关的日志
3. **运行检查 2**：验证 ProjectedGravityB 计算
4. **运行检查 3**：验证观察向量范围
5. **运行检查 4**：验证动作值
6. **观察机器人行为**：看是否能正常站立
