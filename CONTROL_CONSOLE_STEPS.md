# 控制台操作步骤指南

## 第一步：准备工作

1. **刷新页面**（按 `F5` 或 `Ctrl+R`）
2. **打开浏览器控制台**（按 `F12`）
3. **清除控制台过滤器**（重要！）：
   - 找到控制台顶部的 **过滤器输入框**（显示 "Filter" 或 "筛选"）
   - **清空过滤器输入框**（删除所有文字）
   - 确保所有日志级别都启用：✅ Verbose ✅ Info ✅ Warnings ✅ Errors
   - 如果看不到过滤器，按 `Ctrl+L` 清除控制台，然后刷新页面
4. **清除控制台日志**（可选，按 `Ctrl+L`）

---

## 第二步：加载策略

1. 在网页上选择 **"G1 Locomotion (Gamepad)"** 策略
2. **等待策略加载完成**，查看控制台是否有以下日志：
   ```
   [PolicyRunner] Built observation modules: [...]
   [PolicyRunner] Initialized X observation modules, total obs size: Y
   [PolicyRunner] Module names: [...]
   [PolicyRunner] Policy initialized - Debug logs will appear below
   [PolicyRunner] LSTM warmup completed (50 iterations)
   ```

---

## 第三步：运行诊断函数

### 方法1：一键运行所有检查（推荐）

复制下面的**完整代码**，粘贴到控制台，按 `Enter` 运行：

```javascript
function runAllDiagnostics() {
  console.log('%c=== 开始完整诊断 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr) {
    console.error('❌ PolicyRunner 未找到！请先加载策略。');
    return;
  }
  
  const demo = window.demo;
  if (!demo || !demo.readPolicyState) {
    console.error('❌ Demo 未找到或 readPolicyState 不可用。');
    return;
  }
  
  // 检查 obsModules
  if (!pr.obsModules || pr.obsModules.length === 0) {
    console.error('❌ obsModules 为空或未定义！');
    console.log('PolicyRunner 属性:', Object.keys(pr));
    return;
  }
  
  console.log('✅ 观察模块列表:', pr.obsModules.map(obs => obs.constructor.name));
  
  const state = demo.readPolicyState();
  if (!state) {
    console.error('❌ 无法读取策略状态。');
    return;
  }
  
  // ========== 1. 观察向量检查 ==========
  console.log('\n%c=== 1. 观察向量检查 ===', 'color: cyan; font-weight: bold;');
  
  // 1.1 重力方向
  console.log('\n1.1 ProjectedGravityB:');
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (!gravityObs) {
    console.error('   ❌ ProjectedGravityB 未找到！');
  } else {
    try {
      const gravity = gravityObs.compute(state);
      console.log('   值:', Array.from(gravity).map(v => v.toFixed(4)));
      console.log('   预期: [0, 0, -1] (机器人站立时)');
      const mag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
      console.log('   大小:', mag.toFixed(4), mag > 0.9 && mag < 1.1 ? '✅' : '❌');
    } catch (e) {
      console.error('   ❌ 计算重力时出错:', e);
    }
  }
  
  // 1.2 根角速度
  console.log('\n1.2 RootAngVelB:');
  if (state.rootAngVel) {
    console.log('   值:', state.rootAngVel.map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0]');
    const mag = Math.sqrt(state.rootAngVel[0]**2 + state.rootAngVel[1]**2 + state.rootAngVel[2]**2);
    console.log('   大小:', mag.toFixed(4), mag < 0.01 ? '✅' : '❌');
  } else {
    console.error('   ❌ rootAngVel 未找到！');
  }
  
  // 1.3 命令
  console.log('\n1.3 Command:');
  if (pr.command) {
    console.log('   值:', Array.from(pr.command).map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0] (零速度)');
    const mag = Math.sqrt(pr.command[0]**2 + pr.command[1]**2 + pr.command[2]**2);
    console.log('   大小:', mag.toFixed(4), mag < 0.01 ? '✅' : '❌');
  } else {
    console.error('   ❌ command 未找到！');
  }
  
  // 1.4 关节位置相对值
  console.log('\n1.4 JointPosRel:');
  const jointPosRelObs = pr.obsModules.find(obs => obs.constructor.name === 'JointPosRel');
  if (!jointPosRelObs) {
    console.error('   ❌ JointPosRel 未找到！');
  } else {
    try {
      const jointPosRel = jointPosRelObs.compute(state);
      console.log('   值 (前6个):', Array.from(jointPosRel.slice(0, 6)).map(v => v.toFixed(4)));
      console.log('   预期: [0, 0, 0, 0, 0, 0] (初始时)');
      const maxAbs = Math.max(...Array.from(jointPosRel.slice(0, 6)).map(Math.abs));
      console.log('   最大绝对值:', maxAbs.toFixed(4), maxAbs < 0.01 ? '✅' : '❌');
    } catch (e) {
      console.error('   ❌ 计算 JointPosRel 时出错:', e);
    }
  }
  
  // 1.5 关节速度
  console.log('\n1.5 JointVel:');
  if (state.jointVel) {
    console.log('   值 (前6个):', state.jointVel.slice(0, 6).map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0, 0, 0, 0]');
    const maxAbs = Math.max(...state.jointVel.slice(0, 6).map(Math.abs));
    console.log('   最大绝对值:', maxAbs.toFixed(4), maxAbs < 0.01 ? '✅' : '❌');
  } else {
    console.error('   ❌ jointVel 未找到！');
  }
  
  // 1.6 前一步动作
  console.log('\n1.6 PrevActions:');
  if (pr.lastActions) {
    console.log('   值 (前6个):', Array.from(pr.lastActions.slice(0, 6)).map(v => v.toFixed(4)));
    const maxAbs = Math.max(...Array.from(pr.lastActions.slice(0, 6)).map(Math.abs));
    console.log('   最大绝对值:', maxAbs.toFixed(4));
  } else {
    console.error('   ❌ lastActions 未找到！');
  }
  
  // ========== 2. 动作对称性检查 ==========
  console.log('\n%c=== 2. 动作对称性检查 ===', 'color: cyan; font-weight: bold;');
  if (pr.lastActions) {
    const actions = pr.lastActions;
    const leftLegIndices = [0, 3, 6, 9, 13, 17];
    const rightLegIndices = [1, 4, 7, 10, 14, 18];
    
    const leftActions = leftLegIndices.map(i => actions[i]);
    const rightActions = rightLegIndices.map(i => actions[i]);
    
    console.log('左腿动作:', leftActions.map(v => v.toFixed(4)));
    console.log('右腿动作:', rightActions.map(v => v.toFixed(4)));
    
    const leftAvg = leftActions.reduce((sum, a) => sum + Math.abs(a), 0) / leftActions.length;
    const rightAvg = rightActions.reduce((sum, a) => sum + Math.abs(a), 0) / rightActions.length;
    const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
    
    console.log('左腿平均幅度:', leftAvg.toFixed(4));
    console.log('右腿平均幅度:', rightAvg.toFixed(4));
    console.log('对称性比例:', ratio.toFixed(4), ratio > 0.7 ? '✅ 良好' : '❌ 较差');
  } else {
    console.error('❌ lastActions 未找到！');
  }
  
  // ========== 3. 初始状态检查 ==========
  console.log('\n%c=== 3. 初始状态检查 ===', 'color: cyan; font-weight: bold;');
  if (demo.simulation) {
    const qpos = demo.simulation.qpos;
    const qvel = demo.simulation.qvel;
    
    if (qpos && qpos.length >= 3) {
      console.log('根位置 Z:', qpos[2].toFixed(3), qpos[2] === 0.8 ? '✅' : '❌ (应该是 0.8)');
    }
    
    if (qvel && qvel.length >= 6) {
      console.log('根线性速度:', [qvel[0], qvel[1], qvel[2]].map(v => v.toFixed(4)));
      console.log('根角速度:', [qvel[3], qvel[4], qvel[5]].map(v => v.toFixed(4)));
    }
    
    if (demo.qpos_adr_policy && pr.defaultJointPos) {
      console.log('\n关节位置（前6个）:');
      for (let i = 0; i < 6; i++) {
        const qposAdr = demo.qpos_adr_policy[i];
        if (qposAdr >= 0 && qposAdr < qpos.length) {
          const currentPos = qpos[qposAdr];
          const defaultPos = pr.defaultJointPos[i];
          const diff = Math.abs(currentPos - defaultPos);
          console.log(`  Joint ${i}: current=${currentPos.toFixed(3)}, default=${defaultPos.toFixed(3)}, diff=${diff.toFixed(3)} ${diff < 0.001 ? '✅' : '❌'}`);
        }
      }
    }
  } else {
    console.error('❌ simulation 未找到！');
  }
  
  console.log('\n%c=== 诊断完成 ===', 'color: green; font-weight: bold; font-size: 16px;');
}

runAllDiagnostics();
```

---

## 第四步：查看结果

诊断函数会输出以下信息：

### ✅ 正常情况
- 观察模块列表显示所有模块
- 各项检查都有 ✅ 标记
- 对称性比例 > 0.7

### ❌ 异常情况
- 某些项显示 ❌
- 对称性比例 < 0.7
- 出现错误信息

---

## 第五步：报告结果

请把诊断结果发给我，特别是：
1. **哪些项显示 ❌**
2. **具体的数值**（例如重力方向的值、对称性比例等）
3. **任何错误信息**

---

## 常见问题

### Q: 如果提示 "PolicyRunner 未找到"？
**A:** 确保已经加载了策略，并且策略初始化完成。

### Q: 如果提示 "obsModules 为空"？
**A:** 查看控制台是否有 `[PolicyRunner] Initialized` 日志，如果没有，说明策略还没加载完成。

### Q: 如果某个观察模块未找到？
**A:** 查看 "观察模块列表" 中显示的实际模块名称，告诉我具体是哪个模块未找到。

---

## 快速检查（如果完整诊断失败）

如果上面的完整诊断函数报错，先运行这个简单检查：

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('PolicyRunner:', pr ? '✅ 找到' : '❌ 未找到');
if (pr) {
  console.log('obsModules:', pr.obsModules ? `✅ 找到 (${pr.obsModules.length} 个)` : '❌ 未找到');
  if (pr.obsModules) {
    console.log('模块列表:', pr.obsModules.map(obs => obs.constructor.name));
  }
}
```
