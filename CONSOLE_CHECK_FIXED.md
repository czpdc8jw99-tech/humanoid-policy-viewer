# 修复后的控制台检查函数

## 修复版本（带错误处理）

```javascript
// 复制粘贴到控制台运行
function checkAll() {
  console.log('%c=== 开始全面检查 v9.0.22 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr) {
    console.error('❌ PolicyRunner not found. Please load "G1 Locomotion (Gamepad)" policy first.');
    return;
  }
  
  const demo = window.demo;
  if (!demo || !demo.readPolicyState) {
    console.error('❌ Demo not found or readPolicyState not available.');
    return;
  }
  
  const state = demo.readPolicyState();
  if (!state) {
    console.error('❌ Failed to read policy state.');
    return;
  }
  
  // 1. Warmup 检查
  console.log('%c1. Warmup 检查', 'color: cyan; font-weight: bold;');
  console.log('  Warmup done:', pr._warmupDone ? '✅ Yes' : '❌ No');
  console.log('  (Check console for: "[PolicyRunner] Warmup observation vector: { isAllZero: ✅ YES }")');
  
  // 2. ProjectedGravityB 检查
  console.log('%c2. ProjectedGravityB 检查', 'color: cyan; font-weight: bold;');
  if (!pr.obsModules || pr.obsModules.length === 0) {
    console.error('  ❌ obsModules not found');
  } else {
    console.log('  Obs modules:', pr.obsModules.map(obs => obs.constructor.name));
    const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
    if (!gravityObs) {
      console.error('  ❌ ProjectedGravityB not found in obsModules');
      console.log('  Available modules:', pr.obsModules.map(obs => obs.constructor.name));
    } else {
      try {
        const gravity = gravityObs.compute(state);
        const gravityMag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
        console.log('  Gravity direction:', Array.from(gravity).map(v => v.toFixed(4)));
        console.log('  Gravity magnitude:', gravityMag.toFixed(4), '(should be ~1.0)');
        console.log('  Expected: [0, 0, -1] if robot is standing upright');
      } catch (e) {
        console.error('  ❌ Error computing gravity:', e);
      }
    }
  }
  
  // 3. 观察向量检查
  console.log('%c3. 观察向量检查', 'color: cyan; font-weight: bold;');
  if (!pr.obsModules || pr.obsModules.length === 0) {
    console.error('  ❌ obsModules not found');
  } else {
    try {
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
      console.log('  Obs size:', obsVec.length, '(should be 96)');
      console.log('  Obs range:', `[${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}]`);
      console.log('  Obs clipped?', obsMin >= -100 && obsMax <= 100 ? '✅ Yes' : '❌ No');
      console.log('  RootAngVelB (0-2):', Array.from(obsVec.slice(0, 3)).map(v => v.toFixed(3)));
      console.log('  ProjectedGravityB (3-5):', Array.from(obsVec.slice(3, 6)).map(v => v.toFixed(3)));
      console.log('  Command (6-8):', Array.from(obsVec.slice(6, 9)).map(v => v.toFixed(3)));
    } catch (e) {
      console.error('  ❌ Error building observation vector:', e);
    }
  }
  
  // 4. 动作值检查
  console.log('%c4. 动作值检查', 'color: cyan; font-weight: bold;');
  if (!pr.lastActions || !demo.actionTarget || !pr.defaultJointPos) {
    console.error('  ❌ Action data not available');
  } else {
    const actions = pr.lastActions;
    const targets = demo.actionTarget;
    const defaults = pr.defaultJointPos;
    console.log('  Action scale:', pr.actionScale[0], '(should be 0.55)');
    console.log('  Actions range:', `[${Math.min(...Array.from(actions)).toFixed(2)}, ${Math.max(...Array.from(actions)).toFixed(2)}]`);
    console.log('  Actions (first 6):', Array.from(actions.slice(0, 6)).map(v => v.toFixed(3)));
    console.log('  Targets (first 6):', Array.from(targets.slice(0, 6)).map(v => v.toFixed(3)));
    
    // 验证公式
    const calculated = defaults.slice(0, 6).map((d, i) => d + pr.actionScale[i] * actions[i]);
    const match = calculated.every((c, i) => Math.abs(c - targets[i]) < 0.0001);
    console.log('  Formula match?', match ? '✅ Yes' : '❌ No');
    
    // 左右腿对比
    const leftLegIndices = [0, 3, 6, 9, 13, 17];
    const rightLegIndices = [1, 4, 7, 10, 14, 18];
    const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
    const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
    const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
    console.log('  Left leg avg magnitude:', leftAvg.toFixed(4));
    console.log('  Right leg avg magnitude:', rightAvg.toFixed(4));
    console.log('  Symmetry ratio:', ratio.toFixed(4), ratio > 0.7 ? '✅ Good' : '⚠️ Poor');
  }
  
  // 5. 初始状态检查
  console.log('%c5. 初始状态检查', 'color: cyan; font-weight: bold;');
  if (!demo.simulation || !demo.simulation.qpos) {
    console.error('  ❌ Simulation data not available');
  } else {
    const qpos = demo.simulation.qpos;
    console.log('  Initial height (z):', qpos[2].toFixed(3), qpos[2] === 0.8 ? '✅ Correct' : '❌ Wrong (should be 0.8)');
    
    // 6. 关节位置检查
    if (demo.qpos_adr_policy && pr.defaultJointPos) {
      const currentJpos = [];
      for (let i = 0; i < Math.min(6, pr.numActions); i++) {
        const qposAdr = demo.qpos_adr_policy[i];
        if (qposAdr >= 0 && qposAdr < qpos.length) {
          currentJpos.push(qpos[qposAdr]);
        }
      }
      if (currentJpos.length === 6) {
        const defaults = pr.defaultJointPos;
        const jposMatch = defaults.slice(0, 6).every((d, i) => Math.abs(d - currentJpos[i]) < 0.001);
        console.log('  Joint positions match defaults?', jposMatch ? '✅ Yes' : '❌ No');
        console.log('  Defaults (first 6):', Array.from(defaults.slice(0, 6)).map(v => v.toFixed(3)));
        console.log('  Current (first 6):', currentJpos.map(v => v.toFixed(3)));
      }
    }
  }
  
  console.log('%c=== 检查完成 ===', 'color: green; font-weight: bold; font-size: 16px;');
}

checkAll();
```

---

## 简化版本（逐步检查）

如果上面的函数还有问题，可以分步检查：

### 步骤 1：基础检查
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('PolicyRunner:', pr ? '✅ Found' : '❌ Not found');
if (pr) {
  console.log('Obs modules:', pr.obsModules?.map(obs => obs.constructor.name));
  console.log('Num obs:', pr.numObs);
  console.log('Num actions:', pr.numActions);
  console.log('Warmup done:', pr._warmupDone);
}
```

### 步骤 2：检查观察模块
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (pr && pr.obsModules) {
  pr.obsModules.forEach((obs, idx) => {
    console.log(`Module ${idx}:`, obs.constructor.name, 'size:', obs.size);
  });
}
```

### 步骤 3：检查重力方向
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 找到 ProjectedGravityB
const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
console.log('GravityObs:', gravityObs);

if (gravityObs) {
  const gravity = gravityObs.compute(state);
  console.log('Gravity:', Array.from(gravity));
}
```

### 步骤 4：检查动作值
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

console.log('Actions:', Array.from(pr.lastActions).slice(0, 6));
console.log('Targets:', Array.from(demo.actionTarget).slice(0, 6));
console.log('Action scale:', pr.actionScale[0]);
```
