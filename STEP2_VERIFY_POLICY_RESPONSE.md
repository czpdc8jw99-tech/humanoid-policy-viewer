# 步骤2：验证策略响应

## 🎯 目标

确认策略在接收到非零命令时是否输出不同的动作。

---

## 📋 验证步骤

### 步骤2.1：记录零命令时的动作值

**在浏览器控制台运行**：

```javascript
// 1. 记录零命令时的动作值
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found.');
} else {
  console.log('=== 步骤2.1：记录零命令时的动作值 ===');
  
  // 确保命令为零
  pr.setCommand([0.0, 0.0, 0.0]);
  console.log('Command set to zero:', Array.from(pr.command));
  
  // 等待一帧，让策略推理
  setTimeout(() => {
    const zeroActions = Array.from(pr.lastActions);
    console.log('Actions with zero command:', zeroActions);
    console.log('Action range:', {
      min: Math.min(...zeroActions).toFixed(4),
      max: Math.max(...zeroActions).toFixed(4),
      avg: (zeroActions.reduce((a, b) => a + Math.abs(b), 0) / zeroActions.length).toFixed(4)
    });
    
    // 存储零命令时的动作值（用于后续对比）
    window._zeroCommandActions = zeroActions;
    console.log('✅ Zero command actions saved to window._zeroCommandActions');
  }, 100);
}
```

**预期结果**：
- 应该显示零命令时的动作值
- 动作值应该被保存到 `window._zeroCommandActions`

---

### 步骤2.2：设置非零命令并对比动作值

**在浏览器控制台运行**（等待步骤2.1完成后再运行）：

```javascript
// 2. 设置非零命令并对比动作值
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found.');
} else {
  console.log('=== 步骤2.2：设置非零命令并对比动作值 ===');
  
  // 设置前进命令
  const testCmd = [0.3, 0.0, 0.0]; // 前进速度 0.3
  pr.setCommand(testCmd);
  console.log('Command set to:', testCmd);
  
  // 等待一帧，让策略推理
  setTimeout(() => {
    const nonZeroActions = Array.from(pr.lastActions);
    console.log('Actions with non-zero command:', nonZeroActions);
    console.log('Action range:', {
      min: Math.min(...nonZeroActions).toFixed(4),
      max: Math.max(...nonZeroActions).toFixed(4),
      avg: (nonZeroActions.reduce((a, b) => a + Math.abs(b), 0) / nonZeroActions.length).toFixed(4)
    });
    
    // 对比零命令和非零命令时的动作值
    if (window._zeroCommandActions) {
      const diff = nonZeroActions.map((v, i) => v - window._zeroCommandActions[i]);
      const maxDiff = Math.max(...diff.map(Math.abs));
      const avgDiff = diff.reduce((a, b) => a + Math.abs(b), 0) / diff.length;
      
      console.log('=== 动作值对比 ===');
      console.log('Max difference:', maxDiff.toFixed(4));
      console.log('Average difference:', avgDiff.toFixed(4));
      console.log('Actions changed:', maxDiff > 0.01 ? '✅ Yes' : '❌ No');
      
      // 检查左右腿动作变化
      const leftIndices = [0, 3, 6, 9, 13, 17];
      const rightIndices = [1, 4, 7, 10, 14, 18];
      
      const leftDiff = leftIndices.map(i => Math.abs(diff[i])).reduce((a, b) => a + b, 0) / leftIndices.length;
      const rightDiff = rightIndices.map(i => Math.abs(diff[i])).reduce((a, b) => a + b, 0) / rightIndices.length;
      
      console.log('Left leg average change:', leftDiff.toFixed(4));
      console.log('Right leg average change:', rightDiff.toFixed(4));
    } else {
      console.warn('⚠️ Zero command actions not found. Please run step 2.1 first.');
    }
  }, 100);
}
```

**预期结果**：
- 非零命令时的动作值应该与零命令时不同
- `maxDiff` 应该 > 0.01（说明动作值确实变化了）
- 左右腿动作都应该有变化

---

### 步骤2.3：测试不同命令值

**在浏览器控制台运行**：

```javascript
// 3. 测试不同命令值
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
if (!pr) {
  console.error('PolicyRunner not found.');
} else {
  console.log('=== 步骤2.3：测试不同命令值 ===');
  
  const testCommands = [
    [0.0, 0.0, 0.0],   // 零命令
    [0.1, 0.0, 0.0],   // 低速前进
    [0.3, 0.0, 0.0],   // 中速前进
    [0.5, 0.0, 0.0],   // 高速前进
    [0.0, 0.0, 0.5],   // 左转
    [0.0, 0.0, -0.5],  // 右转
  ];
  
  const results = [];
  
  testCommands.forEach((cmd, idx) => {
    pr.setCommand(cmd);
    
    setTimeout(() => {
      const actions = Array.from(pr.lastActions);
      const avgAction = actions.reduce((a, b) => a + Math.abs(b), 0) / actions.length;
      
      results.push({
        command: cmd,
        avgAction: avgAction
      });
      
      console.log(`Command ${idx + 1}: [${cmd.join(', ')}] -> Avg action: ${avgAction.toFixed(4)}`);
      
      if (results.length === testCommands.length) {
        console.log('\n=== 总结 ===');
        console.log('Different commands produce different actions:', 
          results.every((r, i) => i === 0 || Math.abs(r.avgAction - results[0].avgAction) > 0.01) 
          ? '✅ Yes' : '❌ No');
      }
    }, 100 * (idx + 1));
  });
}
```

**预期结果**：
- 不同命令应该产生不同的动作值
- 速度越快，动作幅度可能越大
- 转向命令应该产生不同的动作模式

---

## ✅ 验证清单

完成步骤2后，应该确认：

- [ ] 零命令时的动作值可以正常读取
- [ ] 非零命令时动作值发生变化
- [ ] 不同命令值产生不同的动作
- [ ] 策略确实响应命令输入

---

## 🔧 如果验证失败

### 问题1：动作值不变化

**可能原因**：
- 命令未正确传递到观察向量
- 策略未正确处理命令

**解决方法**：
- 检查步骤1的验证结果
- 检查 Command 观察模块是否正确构建

### 问题2：动作值变化但机器人不移动

**可能原因**：
- 动作值太小
- 动作值未正确应用到关节

**解决方法**：
- 检查 `action_scale` 是否正确
- 检查动作是否正确应用到 MuJoCo

---

## 📝 下一步

完成步骤2后，继续**步骤3：测试固定速度命令**。
