# 修复后的诊断函数 V2（解决类名压缩问题）

## 问题
代码被压缩后，类名变成了 `'US', 'WS', 'tS'` 等，无法通过 `constructor.name` 查找模块。

## 解决方案
使用模块在数组中的**索引位置**来查找，而不是类名。

---

## 修复后的诊断函数

```javascript
function runAllDiagnosticsV2() {
  console.log('%c=== 开始完整诊断 V2 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
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
    return;
  }
  
  console.log('✅ 观察模块数量:', pr.obsModules.length);
  console.log('模块类名（可能被压缩）:', pr.obsModules.map(obs => obs.constructor.name));
  
  // 根据配置顺序查找模块（不使用类名）
  // 配置顺序：RootAngVelB(0), ProjectedGravityB(1), Command(2), JointPosRel(3), JointVel(4), PrevActions(5)
  const rootAngVelObs = pr.obsModules[0];
  const gravityObs = pr.obsModules[1]; // ProjectedGravityB
  const commandObs = pr.obsModules[2]; // Command
  const jointPosRelObs = pr.obsModules[3]; // JointPosRel
  const jointVelObs = pr.obsModules[4]; // JointVel (但实际从 state 读取)
  const prevActionsObs = pr.obsModules[5]; // PrevActions
  
  // 先重置机器人到初始状态（如果可能）
  console.log('\n%c⚠️ 注意：如果机器人已经倒下，建议先重置', 'color: orange; font-weight: bold;');
  
  const state = demo.readPolicyState();
  if (!state) {
    console.error('❌ 无法读取策略状态。');
    return;
  }
  
  // ========== 1. 观察向量检查 ==========
  console.log('\n%c=== 1. 观察向量检查 ===', 'color: cyan; font-weight: bold;');
  
  // 1.1 重力方向
  console.log('\n1.1 ProjectedGravityB:');
  if (!gravityObs) {
    console.error('   ❌ ProjectedGravityB 未找到（索引1）！');
  } else {
    try {
      const gravity = gravityObs.compute(state);
      console.log('   值:', Array.from(gravity).map(v => v.toFixed(4)));
      console.log('   预期: [0, 0, -1] (机器人站立时)');
      const mag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
      console.log('   大小:', mag.toFixed(4), mag > 0.9 && mag < 1.1 ? '✅' : '❌');
      
      // 检查是否接近预期值
      const expectedGravity = [0, 0, -1];
      const diff = Math.sqrt(
        (gravity[0] - expectedGravity[0])**2 +
        (gravity[1] - expectedGravity[1])**2 +
        (gravity[2] - expectedGravity[2])**2
      );
      console.log('   与预期差异:', diff.toFixed(4), diff < 0.1 ? '✅' : '❌');
    } catch (e) {
      console.error('   ❌ 计算重力时出错:', e);
    }
  }
  
  // 1.2 根角速度
  console.log('\n1.2 RootAngVelB:');
  if (state.rootAngVel) {
    console.log('   值:', Array.from(state.rootAngVel).map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0]');
    const mag = Math.sqrt(state.rootAngVel[0]**2 + state.rootAngVel[1]**2 + state.rootAngVel[2]**2);
    console.log('   大小:', mag.toFixed(4), mag < 0.01 ? '✅' : '❌');
    if (mag > 0.1) {
      console.warn('   ⚠️ 根角速度过大！机器人可能在旋转或倒下');
    }
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
  if (!jointPosRelObs) {
    console.error('   ❌ JointPosRel 未找到（索引3）！');
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
    console.log('   值 (前6个):', Array.from(state.jointVel.slice(0, 6)).map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0, 0, 0, 0]');
    const maxAbs = Math.max(...state.jointVel.slice(0, 6).map(Math.abs));
    console.log('   最大绝对值:', maxAbs.toFixed(4), maxAbs < 0.01 ? '✅' : '❌');
    if (maxAbs > 0.1) {
      console.warn('   ⚠️ 关节速度过大！机器人可能在剧烈运动');
    }
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
    
    if (ratio < 0.7) {
      console.warn('   ⚠️ 动作严重不对称！右腿动作:', rightAvg.toFixed(4), 'vs 左腿:', leftAvg.toFixed(4));
    }
  } else {
    console.error('❌ lastActions 未找到！');
  }
  
  // ========== 3. 初始状态检查 ==========
  console.log('\n%c=== 3. 初始状态检查 ===', 'color: cyan; font-weight: bold;');
  if (demo.simulation) {
    const qpos = demo.simulation.qpos;
    const qvel = demo.simulation.qvel;
    
    if (qpos && qpos.length >= 3) {
      const rootZ = qpos[2];
      console.log('根位置 Z:', rootZ.toFixed(3), rootZ === 0.8 ? '✅' : '❌ (应该是 0.8)');
      if (rootZ < 0.5) {
        console.error('   🔴 机器人已经倒下！根位置Z只有', rootZ.toFixed(3));
        console.log('   💡 建议：刷新页面并重新加载策略');
      }
    }
    
    if (qvel && qvel.length >= 6) {
      const linVel = [qvel[0], qvel[1], qvel[2]];
      const angVel = [qvel[3], qvel[4], qvel[5]];
      console.log('根线性速度:', linVel.map(v => v.toFixed(4)));
      console.log('根角速度:', angVel.map(v => v.toFixed(4)));
      
      const linVelMag = Math.sqrt(linVel[0]**2 + linVel[1]**2 + linVel[2]**2);
      const angVelMag = Math.sqrt(angVel[0]**2 + angVel[1]**2 + angVel[2]**2);
      if (linVelMag > 0.1 || angVelMag > 0.1) {
        console.warn('   ⚠️ 机器人正在运动！线性速度:', linVelMag.toFixed(4), '角速度:', angVelMag.toFixed(4));
      }
    }
    
    if (demo.qpos_adr_policy && pr.defaultJointPos) {
      console.log('\n关节位置（前6个）:');
      let allMatch = true;
      for (let i = 0; i < 6; i++) {
        const qposAdr = demo.qpos_adr_policy[i];
        if (qposAdr >= 0 && qposAdr < qpos.length) {
          const currentPos = qpos[qposAdr];
          const defaultPos = pr.defaultJointPos[i];
          const diff = Math.abs(currentPos - defaultPos);
          const match = diff < 0.001;
          if (!match) allMatch = false;
          console.log(`  Joint ${i}: current=${currentPos.toFixed(3)}, default=${defaultPos.toFixed(3)}, diff=${diff.toFixed(3)} ${match ? '✅' : '❌'}`);
        }
      }
      if (!allMatch) {
        console.warn('   ⚠️ 关节位置与默认值不匹配！机器人可能不在初始姿态');
      }
    }
  } else {
    console.error('❌ simulation 未找到！');
  }
  
  // ========== 4. 问题总结 ==========
  console.log('\n%c=== 4. 问题总结 ===', 'color: red; font-weight: bold;');
  const issues = [];
  
  if (demo.simulation && demo.simulation.qpos && demo.simulation.qpos[2] < 0.5) {
    issues.push('🔴 机器人已经倒下（根位置Z < 0.5）');
  }
  
  if (state.rootAngVel) {
    const angVelMag = Math.sqrt(state.rootAngVel[0]**2 + state.rootAngVel[1]**2 + state.rootAngVel[2]**2);
    if (angVelMag > 0.1) {
      issues.push('🔴 根角速度过大（机器人可能在旋转）');
    }
  }
  
  if (pr.lastActions) {
    const actions = pr.lastActions;
    const leftLegIndices = [0, 3, 6, 9, 13, 17];
    const rightLegIndices = [1, 4, 7, 10, 14, 18];
    const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
    const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
    const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
    if (ratio < 0.7) {
      issues.push(`🔴 动作严重不对称（对称性比例: ${ratio.toFixed(2)}）`);
    }
  }
  
  if (issues.length === 0) {
    console.log('✅ 未发现明显问题');
  } else {
    issues.forEach(issue => console.log(issue));
    console.log('\n💡 建议操作：');
    console.log('1. 刷新页面（F5）');
    console.log('2. 重新加载策略');
    console.log('3. 在机器人倒下前立即运行诊断');
  }
  
  console.log('\n%c=== 诊断完成 ===', 'color: green; font-weight: bold; font-size: 16px;');
}

runAllDiagnosticsV2();
```

---

## 使用方法

1. **刷新页面**（F5）
2. **加载策略**（选择 "G1 Locomotion (Gamepad)"）
3. **立即运行诊断**（在机器人倒下前）
4. **复制上面的函数**到控制台运行

---

## 关键改进

1. ✅ **使用索引查找模块**：不再依赖被压缩的类名
2. ✅ **添加警告信息**：当检测到异常状态时给出警告
3. ✅ **问题总结**：自动总结发现的问题
4. ✅ **操作建议**：提供具体的修复建议
