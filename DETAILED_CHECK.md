# 详细数值检查

## 🔍 请运行以下命令查看详细数值

### 命令1：查看命令值详情

```javascript
const demo = window.demo;
const pr = demo.policyRunner || demo.policyRunners?.[0];
console.log('=== 命令值详情 ===');
console.log('demo.cmd:', demo.cmd);
console.log('pr.command:', pr.command);
console.log('命令值是否匹配:', 
  Math.abs(demo.cmd[0] - pr.command[0]) < 0.001 &&
  Math.abs(demo.cmd[1] - pr.command[1]) < 0.001 &&
  Math.abs(demo.cmd[2] - pr.command[2]) < 0.001
);
```

---

### 命令2：查看actionTarget详细值

```javascript
const demo = window.demo;
if (demo.actionTarget) {
  console.log('=== ActionTarget详细值 ===');
  console.log('长度:', demo.actionTarget.length);
  console.log('前6个值:', Array.from(demo.actionTarget).slice(0, 6));
  console.log('所有值:', Array.from(demo.actionTarget));
  console.log('范围:', {
    min: Math.min(...Array.from(demo.actionTarget)),
    max: Math.max(...Array.from(demo.actionTarget)),
    avg: Array.from(demo.actionTarget).reduce((a, b) => a + b, 0) / demo.actionTarget.length
  });
  
  // 检查左右腿
  const leftIndices = [0, 3, 6, 9, 13, 17];
  const rightIndices = [1, 4, 7, 10, 14, 18];
  const leftValues = leftIndices.map(i => demo.actionTarget[i]);
  const rightValues = rightIndices.map(i => demo.actionTarget[i]);
  console.log('左腿动作值:', leftValues);
  console.log('右腿动作值:', rightValues);
  console.log('左腿平均值:', leftValues.reduce((a, b) => a + Math.abs(b), 0) / leftValues.length);
  console.log('右腿平均值:', rightValues.reduce((a, b) => a + Math.abs(b), 0) / rightValues.length);
}
```

---

### 命令3：查看控制值详情

```javascript
const demo = window.demo;
if (demo.ctrl_adr_policy && demo.simulation) {
  console.log('=== 控制值详情 ===');
  console.log('执行器总数:', demo.ctrl_adr_policy.length);
  
  const first6 = demo.ctrl_adr_policy.slice(0, 6).map((ctrlAdr, idx) => ({
    policyIdx: idx,
    ctrlAdr: ctrlAdr,
    ctrlValue: demo.simulation.ctrl[ctrlAdr],
    isZero: Math.abs(demo.simulation.ctrl[ctrlAdr]) < 0.001
  }));
  console.log('前6个执行器的控制值:', first6);
  
  const allCtrlValues = demo.ctrl_adr_policy.map(ctrlAdr => demo.simulation.ctrl[ctrlAdr]);
  console.log('所有控制值:', allCtrlValues);
  console.log('控制值范围:', {
    min: Math.min(...allCtrlValues),
    max: Math.max(...allCtrlValues),
    avg: allCtrlValues.reduce((a, b) => a + b, 0) / allCtrlValues.length
  });
  
  const nonZeroCount = allCtrlValues.filter(v => Math.abs(v) > 0.001).length;
  console.log('非零控制值数量:', nonZeroCount, '/', allCtrlValues.length);
}
```

---

### 命令4：查看PD增益详情

```javascript
const demo = window.demo;
if (demo.kpPolicy) {
  console.log('=== PD增益详情 ===');
  console.log('kpPolicy前6个值:', Array.from(demo.kpPolicy).slice(0, 6));
  console.log('kdPolicy前6个值:', Array.from(demo.kdPolicy).slice(0, 6));
  console.log('kpPolicy范围:', {
    min: Math.min(...Array.from(demo.kpPolicy)),
    max: Math.max(...Array.from(demo.kpPolicy)),
    avg: Array.from(demo.kpPolicy).reduce((a, b) => a + b, 0) / demo.kpPolicy.length
  });
  console.log('kdPolicy范围:', {
    min: Math.min(...Array.from(demo.kdPolicy)),
    max: Math.max(...Array.from(demo.kdPolicy)),
    avg: Array.from(demo.kdPolicy).reduce((a, b) => a + b, 0) / demo.kdPolicy.length
  });
}
```

---

### 命令5：查看机器人当前状态

```javascript
const demo = window.demo;
if (demo.simulation) {
  console.log('=== 机器人当前状态 ===');
  const qpos = demo.simulation.qpos;
  const qvel = demo.simulation.qvel;
  
  // 根位置（Z坐标）
  console.log('根位置Z:', qpos[2]);
  
  // 前6个关节的位置和速度
  if (demo.qpos_adr_policy && demo.qvel_adr_policy) {
    console.log('前6个关节位置:', 
      demo.qpos_adr_policy.slice(0, 6).map(adr => qpos[adr])
    );
    console.log('前6个关节速度:', 
      demo.qvel_adr_policy.slice(0, 6).map(adr => qvel[adr])
    );
  }
  
  // 检查机器人是否倒下（Z < 0.5）
  if (qpos[2] < 0.5) {
    console.warn('⚠️ 机器人可能已倒下（Z < 0.5）');
  }
}
```

---

### 命令6：一键完整详细检查

```javascript
(function() {
  console.log('%c=== 详细数值检查 ===', 'color: red; font-weight: bold; font-size: 16px;');
  
  const demo = window.demo;
  const pr = demo.policyRunner || demo.policyRunners?.[0];
  
  // 1. 命令值
  console.log('%c1. 命令值', 'color: blue; font-weight: bold;');
  console.log('demo.cmd:', Array.from(demo.cmd));
  console.log('pr.command:', Array.from(pr.command));
  
  // 2. ActionTarget
  console.log('%c2. ActionTarget', 'color: blue; font-weight: bold;');
  if (demo.actionTarget) {
    const values = Array.from(demo.actionTarget);
    console.log('所有值:', values);
    console.log('范围:', {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length
    });
    
    // 左右腿
    const leftIndices = [0, 3, 6, 9, 13, 17];
    const rightIndices = [1, 4, 7, 10, 14, 18];
    const leftValues = leftIndices.map(i => values[i]);
    const rightValues = rightIndices.map(i => values[i]);
    console.log('左腿:', leftValues);
    console.log('右腿:', rightValues);
  }
  
  // 3. 控制值
  console.log('%c3. 控制值', 'color: blue; font-weight: bold;');
  if (demo.ctrl_adr_policy && demo.simulation) {
    const ctrlValues = demo.ctrl_adr_policy.map(ctrlAdr => demo.simulation.ctrl[ctrlAdr]);
    console.log('所有控制值:', ctrlValues);
    console.log('范围:', {
      min: Math.min(...ctrlValues),
      max: Math.max(...ctrlValues),
      avg: ctrlValues.reduce((a, b) => a + b, 0) / ctrlValues.length
    });
  }
  
  // 4. PD增益
  console.log('%c4. PD增益', 'color: blue; font-weight: bold;');
  if (demo.kpPolicy) {
    console.log('kpPolicy:', Array.from(demo.kpPolicy));
    console.log('kdPolicy:', Array.from(demo.kdPolicy));
  }
  
  // 5. 机器人状态
  console.log('%c5. 机器人状态', 'color: blue; font-weight: bold;');
  if (demo.simulation) {
    console.log('根位置Z:', demo.simulation.qpos[2]);
    if (demo.simulation.qpos[2] < 0.5) {
      console.warn('⚠️ 机器人可能已倒下！');
    }
  }
  
  console.log('%c=== 检查完成 ===', 'color: green; font-weight: bold; font-size: 16px;');
})();
```

---

## 📋 请运行命令6并告诉我结果

运行命令6后，请把控制台的完整输出发给我，特别是：
1. **命令值**：demo.cmd 和 pr.command 的具体数值
2. **ActionTarget**：所有值、范围、左右腿的值
3. **控制值**：所有控制值、范围
4. **PD增益**：kpPolicy 和 kdPolicy 的值
5. **机器人状态**：根位置Z（如果 < 0.5 说明倒下了）

这样我就能知道问题出在哪里了！
