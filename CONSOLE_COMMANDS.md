# 控制台诊断命令

## 🎯 快速检查命令

### 步骤1：检查策略是否加载

**在控制台输入以下命令**：

```javascript
// 检查demo对象是否存在
console.log('Demo exists:', !!window.demo);

// 检查策略是否加载
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('Policy runner exists:', !!pr);
console.log('Policy runner type:', pr ? pr.constructor.name : 'null');

// 检查策略配置
if (pr) {
  console.log('Policy config:', {
    numActions: pr.numActions,
    numObs: pr.numObs,
    command: Array.from(pr.command),
    lastActions: Array.from(pr.lastActions).slice(0, 6)
  });
}
```

**✅ 应该看到**：
- `Demo exists: true`
- `Policy runner exists: true`
- `numActions: 29`
- `numObs: 96`

---

### 步骤2：检查当前命令值

**在控制台输入**：

```javascript
// 检查demo的命令值
console.log('Demo command:', Array.from(window.demo.cmd));

// 检查策略中的命令值
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (pr) {
  console.log('Policy command:', Array.from(pr.command));
  console.log('Commands match:', 
    Math.abs(window.demo.cmd[0] - pr.command[0]) < 0.001 &&
    Math.abs(window.demo.cmd[1] - pr.command[1]) < 0.001 &&
    Math.abs(window.demo.cmd[2] - pr.command[2]) < 0.001
  );
}
```

**✅ 应该看到**：
- `Demo command: [0.3, 0, 0]`（如果点击了Forward按钮）
- `Policy command: [0.3, 0, 0]`
- `Commands match: true`

---

### 步骤3：检查策略推理结果

**在控制台输入**：

```javascript
// 检查actionTarget是否存在
const demo = window.demo;
console.log('ActionTarget exists:', !!demo.actionTarget);
console.log('ActionTarget type:', typeof demo.actionTarget);
console.log('ActionTarget is array:', Array.isArray(demo.actionTarget));
console.log('ActionTarget length:', demo.actionTarget?.length);

// 检查actionTarget的值
if (demo.actionTarget && demo.actionTarget.length > 0) {
  console.log('ActionTarget first 6 values:', Array.from(demo.actionTarget).slice(0, 6));
  const values = Array.from(demo.actionTarget);
  console.log('ActionTarget range:', {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length
  });
  
  // 检查左右腿动作
  const leftIndices = [0, 3, 6, 9, 13, 17];
  const rightIndices = [1, 4, 7, 10, 14, 18];
  const leftAvg = leftIndices.reduce((sum, i) => sum + Math.abs(demo.actionTarget[i]), 0) / leftIndices.length;
  const rightAvg = rightIndices.reduce((sum, i) => sum + Math.abs(demo.actionTarget[i]), 0) / rightIndices.length;
  console.log('Left leg avg:', leftAvg);
  console.log('Right leg avg:', rightAvg);
  console.log('Symmetry ratio:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}
```

**✅ 应该看到**：
- `ActionTarget exists: true`
- `ActionTarget length: 29`
- `ActionTarget range` 有非零值
- 左右腿动作值

---

### 步骤4：检查控制值是否被应用

**在控制台输入**：

```javascript
// 检查关节映射
const demo = window.demo;
console.log('ctrl_adr_policy exists:', !!demo.ctrl_adr_policy);
console.log('ctrl_adr_policy length:', demo.ctrl_adr_policy?.length);

// 检查前几个执行器的控制值
if (demo.ctrl_adr_policy && demo.ctrl_adr_policy.length > 0 && demo.simulation) {
  console.log('First 6 actuators control values:', 
    demo.ctrl_adr_policy.slice(0, 6).map((ctrlAdr, idx) => ({
      policyIdx: idx,
      ctrlAdr: ctrlAdr,
      ctrlValue: demo.simulation.ctrl[ctrlAdr],
      isZero: Math.abs(demo.simulation.ctrl[ctrlAdr]) < 0.001
    }))
  );
  
  // 检查是否有非零控制值
  const nonZeroCount = demo.ctrl_adr_policy.filter(ctrlAdr => 
    Math.abs(demo.simulation.ctrl[ctrlAdr]) > 0.001
  ).length;
  console.log('Non-zero control values count:', nonZeroCount, '/', demo.ctrl_adr_policy.length);
}
```

**✅ 应该看到**：
- `ctrl_adr_policy length: 29`
- `Non-zero control values count: > 0`（至少有一些非零值）

---

### 步骤5：检查PD增益

**在控制台输入**：

```javascript
// 检查PD增益
const demo = window.demo;
console.log('kpPolicy exists:', !!demo.kpPolicy);
console.log('kdPolicy exists:', !!demo.kdPolicy);

if (demo.kpPolicy && demo.kpPolicy.length > 0) {
  console.log('kpPolicy first 6 values:', Array.from(demo.kpPolicy).slice(0, 6));
  console.log('kpPolicy range:', {
    min: Math.min(...Array.from(demo.kpPolicy)),
    max: Math.max(...Array.from(demo.kpPolicy)),
    avg: Array.from(demo.kpPolicy).reduce((a, b) => a + b, 0) / demo.kpPolicy.length
  });
  
  // 检查是否有零值
  const zeroKpCount = Array.from(demo.kpPolicy).filter(kp => Math.abs(kp) < 0.001).length;
  console.log('Zero kp count:', zeroKpCount, '/', demo.kpPolicy.length);
}
```

**✅ 应该看到**：
- `kpPolicy exists: true`
- `kpPolicy range` 有合理的值（通常 > 0）
- `Zero kp count: 0`（不应该有零值）

---

## 🔍 一键完整检查

**复制以下代码到控制台，一次性检查所有关键点**：

```javascript
(function() {
  console.log('%c=== 策略诊断完整检查 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  const demo = window.demo;
  if (!demo) {
    console.error('❌ Demo对象不存在！');
    return;
  }
  
  console.log('✅ Demo对象存在');
  
  // 1. 检查策略
  const pr = demo.policyRunner || demo.policyRunners?.[0];
  if (!pr) {
    console.error('❌ 策略未加载！');
    return;
  }
  console.log('✅ 策略已加载:', {
    numActions: pr.numActions,
    numObs: pr.numObs
  });
  
  // 2. 检查命令
  console.log('📋 当前命令:', {
    demoCmd: Array.from(demo.cmd),
    policyCmd: Array.from(pr.command),
    match: Math.abs(demo.cmd[0] - pr.command[0]) < 0.001 &&
           Math.abs(demo.cmd[1] - pr.command[1]) < 0.001 &&
           Math.abs(demo.cmd[2] - pr.command[2]) < 0.001
  });
  
  // 3. 检查actionTarget
  if (!demo.actionTarget) {
    console.warn('⚠️ ActionTarget不存在（可能模拟未启动）');
  } else {
    console.log('✅ ActionTarget存在:', {
      length: demo.actionTarget.length,
      first6: Array.from(demo.actionTarget).slice(0, 6),
      range: {
        min: Math.min(...Array.from(demo.actionTarget)),
        max: Math.max(...Array.from(demo.actionTarget))
      }
    });
  }
  
  // 4. 检查控制值
  if (demo.ctrl_adr_policy && demo.simulation) {
    const nonZeroCount = demo.ctrl_adr_policy.filter(ctrlAdr => 
      Math.abs(demo.simulation.ctrl[ctrlAdr]) > 0.001
    ).length;
    console.log('📊 控制值:', {
      totalActuators: demo.ctrl_adr_policy.length,
      nonZeroCount: nonZeroCount,
      first6: demo.ctrl_adr_policy.slice(0, 6).map(ctrlAdr => demo.simulation.ctrl[ctrlAdr])
    });
  }
  
  // 5. 检查PD增益
  if (demo.kpPolicy) {
    const zeroKpCount = Array.from(demo.kpPolicy).filter(kp => Math.abs(kp) < 0.001).length;
    console.log('⚙️ PD增益:', {
      kpExists: !!demo.kpPolicy,
      kdExists: !!demo.kdPolicy,
      kpRange: {
        min: Math.min(...Array.from(demo.kpPolicy)),
        max: Math.max(...Array.from(demo.kpPolicy))
      },
      zeroKpCount: zeroKpCount
    });
  }
  
  console.log('%c=== 检查完成 ===', 'color: green; font-weight: bold; font-size: 16px;');
})();
```

---

## 📋 操作步骤

1. **打开控制台**：按 `F12`，切换到 "Console" 标签
2. **清空控制台**：点击清空按钮或按 `Ctrl+L`
3. **选择策略**：在页面上选择 "G1 Locomotion (Gamepad)"
4. **等待策略加载**：看到 `[PolicyRunner] Policy initialized` 日志
5. **点击 "Forward" 按钮**：设置命令为 [0.3, 0, 0]
6. **启动模拟**：点击播放按钮（▶️）
7. **运行一键检查**：复制上面的"一键完整检查"代码到控制台，按回车

---

## 🎯 关键检查点

### ✅ 正常情况应该看到：
- ✅ Demo对象存在
- ✅ 策略已加载（numActions: 29）
- ✅ 命令匹配（match: true）
- ✅ ActionTarget存在（length: 29，有非零值）
- ✅ 控制值有非零值
- ✅ PD增益不为零

### ❌ 如果有问题：
- ❌ 策略未加载 → 检查策略文件路径
- ❌ 命令不匹配 → 检查命令传递逻辑
- ❌ ActionTarget不存在 → 检查策略推理
- ❌ 控制值全为零 → 检查动作应用逻辑
- ❌ PD增益为零 → 检查策略配置

---

## 📝 报告格式

运行一键检查后，请复制控制台的输出发给我，格式如下：

```
=== 策略诊断完整检查 ===
✅ Demo对象存在
✅ 策略已加载: { numActions: 29, numObs: 96 }
📋 当前命令: { demoCmd: [...], policyCmd: [...], match: true/false }
...
```

或者直接截图控制台输出也可以！
