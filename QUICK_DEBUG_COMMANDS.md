# 快速调试指令

## 第一步：基本检查

```javascript
// 1. 检查策略是否加载
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

if (!pr) {
  console.error('❌ 策略未加载！请先选择 "G1 Locomotion (Gamepad)" 策略');
} else {
  console.log('✅ 策略已加载');
  console.log('Warmup done:', pr._warmupDone);
  console.log('Action scale:', pr.actionScale[0]);
}
```

---

## 第二步：检查观察向量（最重要）

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;
const state = demo.readPolicyState();

// 构建观察向量（模拟策略推理时的过程）
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

// 应用 clip
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}

// 提取关键组件
const rootAngVel = obsForPolicy.slice(0, 3);
const gravity = obsForPolicy.slice(3, 6);
const command = obsForPolicy.slice(6, 9);
const jointPosRel = obsForPolicy.slice(9, 38);
const jointVel = obsForPolicy.slice(38, 67);
const prevActions = obsForPolicy.slice(67, 96);

console.log('=== 观察向量关键组件 ===');
console.log('RootAngVel:', Array.from(rootAngVel).map(v => v.toFixed(3)));
console.log('Gravity:', Array.from(gravity).map(v => v.toFixed(3)));
console.log('Command:', Array.from(command).map(v => v.toFixed(3)));
console.log('Gravity magnitude:', Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2).toFixed(3));
console.log('JointPosRel (first 6):', Array.from(jointPosRel.slice(0, 6)).map(v => v.toFixed(3)));
console.log('JointVel (first 6):', Array.from(jointVel.slice(0, 6)).map(v => v.toFixed(3)));
console.log('PrevActions (first 6):', Array.from(prevActions.slice(0, 6)).map(v => v.toFixed(3)));

// 检查是否有异常值
const obsMin = Math.min(...Array.from(obsForPolicy));
const obsMax = Math.max(...Array.from(obsForPolicy));
console.log('观察向量范围:', `[${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}]`);
```

**关键检查点**：
- 重力方向：如果机器人站立，应该是 `[0, 0, -1]`（magnitude ≈ 1.0）
- 如果机器人后倾，重力在 X 方向应该有**负值**（向前）
- 如果机器人前倾，重力在 X 方向应该有**正值**（向后）

---

## 第三步：检查动作值

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('=== 动作值检查 ===');
console.log('Actions range:', {
  min: Math.min(...Array.from(actions)).toFixed(4),
  max: Math.max(...Array.from(actions)).toFixed(4)
});

// 检查左右腿
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

const leftActions = leftLegIndices.map(i => actions[i]);
const rightActions = rightLegIndices.map(i => actions[i]);

console.log('左腿动作:', leftActions.map(v => v.toFixed(3)));
console.log('右腿动作:', rightActions.map(v => v.toFixed(3)));

// 检查目标位置
const leftTargets = leftLegIndices.map(i => targets[i]);
const rightTargets = rightLegIndices.map(i => targets[i]);

console.log('左腿目标位置:', leftTargets.map(v => v.toFixed(3)));
console.log('右腿目标位置:', rightTargets.map(v => v.toFixed(3)));

// 检查调整幅度
const leftAdjustments = leftLegIndices.map(i => targets[i] - defaults[i]);
const rightAdjustments = rightLegIndices.map(i => targets[i] - defaults[i]);

console.log('左腿调整幅度:', leftAdjustments.map(v => v.toFixed(3)));
console.log('右腿调整幅度:', rightAdjustments.map(v => v.toFixed(3)));
```

---

## 第四步：检查当前位置和误差

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

const targets = demo.actionTarget;
const state = demo.readPolicyState();
const currentPos = state.jointPos;
const defaults = pr.defaultJointPos;

const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

console.log('=== 位置误差检查 ===');
leftLegIndices.forEach(idx => {
  const jointName = pr.policyJointNames[idx];
  const target = targets[idx];
  const current = currentPos[idx];
  const error = target - current;
  const adjustment = target - defaults[idx];
  console.log(`[${idx}] ${jointName}:`, {
    default: defaults[idx].toFixed(3),
    target: target.toFixed(3),
    current: current.toFixed(3),
    error: error.toFixed(3),
    adjustment: adjustment.toFixed(3)
  });
});
```

---

## 第五步：实时监控（运行5秒）

```javascript
let count = 0;
const monitor = setInterval(() => {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  const demo = window.demo;
  
  if (!pr || !demo) {
    clearInterval(monitor);
    return;
  }
  
  const state = demo.readPolicyState();
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  const gravity = gravityObs ? gravityObs.compute(state) : null;
  const actions = pr.lastActions;
  const targets = demo.actionTarget;
  const currentPos = state.jointPos;
  
  console.log(`[${count}] Gravity:`, gravity ? Array.from(gravity).map(v => v.toFixed(2)) : 'N/A');
  console.log(`[${count}] Actions (0,1):`, [actions[0].toFixed(2), actions[1].toFixed(2)]);
  console.log(`[${count}] Targets (0,1):`, [targets[0].toFixed(2), targets[1].toFixed(2)]);
  console.log(`[${count}] Current (0,1):`, [currentPos[0].toFixed(2), currentPos[1].toFixed(2)]);
  console.log(`[${count}] Error (0,1):`, [(targets[0] - currentPos[0]).toFixed(3), (targets[1] - currentPos[1]).toFixed(3)]);
  console.log('---');
  
  count++;
  if (count >= 5) {
    clearInterval(monitor);
    console.log('监控结束');
  }
}, 1000);
```

---

## 一键完整诊断

```javascript
(function() {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  const demo = window.demo;
  
  if (!pr || !demo) {
    console.error('❌ 策略未加载！请先选择策略。');
    return;
  }
  
  console.log('%c=== 完整诊断 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  // 1. 基本信息
  console.log('%c1. 策略配置', 'color: green; font-weight: bold;');
  console.log('  Action scale:', pr.actionScale[0]);
  console.log('  Action clip:', pr.actionClip);
  console.log('  Warmup done:', pr._warmupDone);
  
  // 2. 观察向量
  console.log('%c2. 观察向量', 'color: green; font-weight: bold;');
  const state = demo.readPolicyState();
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (gravityObs) {
    const gravity = gravityObs.compute(state);
    const gravityMag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
    console.log('  重力方向:', Array.from(gravity).map(v => v.toFixed(3)));
    console.log('  重力大小:', gravityMag.toFixed(3));
    console.log('  预期: [0, 0, -1], magnitude = 1.0 (如果机器人站立)');
    
    // 检查重力方向是否正确
    if (gravityMag > 0.9 && gravityMag < 1.1) {
      console.log('  ✅ 重力方向归一化正确');
    } else {
      console.warn('  ⚠️ 重力方向未归一化');
    }
    
    // 检查机器人是否后倾（重力 X 为负）
    if (gravity[0] < -0.1) {
      console.warn('  ⚠️ 机器人可能后倾（重力 X < -0.1）');
    } else if (gravity[0] > 0.1) {
      console.warn('  ⚠️ 机器人可能前倾（重力 X > 0.1）');
    } else {
      console.log('  ✅ 机器人大致直立（重力 X ≈ 0）');
    }
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
  const symmetry = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
  console.log('  对称性:', symmetry.toFixed(3));
  console.log(symmetry > 0.7 ? '  ✅ 对称性良好' : '  ⚠️ 对称性较差');
  
  // 4. 位置误差
  console.log('%c4. 位置控制', 'color: green; font-weight: bold;');
  const targets = demo.actionTarget;
  const currentPos = state.jointPos;
  const errors = leftLegIndices.map(i => Math.abs(targets[i] - currentPos[i]));
  const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const maxError = Math.max(...errors);
  console.log('  平均位置误差:', avgError.toFixed(4));
  console.log('  最大位置误差:', maxError.toFixed(4));
  console.log(avgError < 0.1 ? '  ✅ 位置误差小' : '  ⚠️ 位置误差较大');
  
  // 5. 初始高度
  console.log('%c5. 初始状态', 'color: green; font-weight: bold;');
  const qpos = demo.simulation.qpos;
  console.log('  初始高度 (Z):', qpos[2].toFixed(4));
  console.log(qpos[2] > 0.75 && qpos[2] < 0.85 ? '  ✅ 高度正确' : '  ⚠️ 高度异常');
  
  // 6. 检查动作是否在应用
  console.log('%c6. 动作应用检查', 'color: green; font-weight: bold;');
  const leftAdjustments = leftLegIndices.map(i => targets[i] - defaults[i]);
  const rightAdjustments = rightLegIndices.map(i => targets[i] - defaults[i]);
  const leftMaxAdj = Math.max(...leftAdjustments.map(Math.abs));
  const rightMaxAdj = Math.max(...rightAdjustments.map(Math.abs));
  console.log('  左腿最大调整:', leftMaxAdj.toFixed(4));
  console.log('  右腿最大调整:', rightMaxAdj.toFixed(4));
  console.log(leftMaxAdj > 0.01 || rightMaxAdj > 0.01 ? '  ✅ 有动作调整' : '  ⚠️ 动作调整很小');
  
  console.log('%c=== 诊断完成 ===', 'color: blue; font-weight: bold; font-size: 16px;');
})();
```

---

## 使用建议

1. **首次检查**：复制"一键完整诊断"代码到控制台执行
2. **如果发现问题**：执行相应的详细检查指令
3. **实时监控**：使用"第五步：实时监控"观察策略行为变化

---

## 常见问题

### 如果重力方向异常
- 检查 `quatApplyInv` 计算
- 检查四元数顺序

### 如果动作值很小或为零
- 检查观察向量是否有异常值
- 检查策略是否真的在推理

### 如果位置误差很大
- 检查 PD 参数（KP/KD）
- 检查动作是否真的被应用
