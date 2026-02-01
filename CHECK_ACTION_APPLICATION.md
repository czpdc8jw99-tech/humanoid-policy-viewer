# 检查动作应用逻辑的诊断脚本

## 问题
机器人连站都站不住，可能是动作应用到了错误的关节。

## 诊断脚本

请在浏览器控制台运行以下脚本：

```javascript
// ===== 检查动作应用逻辑 =====
const demo = window.demo;
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

if (!demo.joint2motorIdx || !demo.ctrl_adr_motor) {
  console.error('joint2motorIdx 或 ctrl_adr_motor 不存在！');
} else {
  console.log('%c=== [检查] 动作应用逻辑验证 ===', 'color: red; font-weight: bold; font-size: 16px;');
  
  // 1. 检查 actionReordered 的创建
  const actionReorderedManual = new Float32Array(29);
  actionReorderedManual.fill(NaN);
  for (let i = 0; i < 29; i++) {
    const motorIdx = demo.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < 29) {
      actionReorderedManual[motorIdx] = demo.actionTarget[i];
    }
  }
  
  // 2. 检查每个关节的动作应用
  console.log('%c[检查] 左腿第一个关节的动作应用', 'color: green; font-weight: bold;');
  const policyIdx = 0; // left_hip_pitch
  const motorIdx = demo.joint2motorIdx[policyIdx];
  const jointName = demo.policyJointNames[policyIdx];
  
  console.log(`${jointName}:`);
  console.log(`  策略索引: ${policyIdx}`);
  console.log(`  电机索引: ${motorIdx}`);
  console.log(`  actionTarget[${policyIdx}]: ${demo.actionTarget[policyIdx].toFixed(4)}`);
  console.log(`  actionReorderedManual[${motorIdx}]: ${actionReorderedManual[motorIdx].toFixed(4)}`);
  
  // 3. 检查 PD 增益
  console.log(`  kpPolicyReorder[${motorIdx}]: ${demo.kpPolicyReorder[motorIdx]}`);
  console.log(`  kdPolicyReorder[${motorIdx}]: ${demo.kdPolicyReorder[motorIdx]}`);
  
  // 4. 检查 MuJoCo 地址
  const qposAdr = demo.qpos_adr_motor[motorIdx];
  const qvelAdr = demo.qvel_adr_motor[motorIdx];
  const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
  console.log(`  qpos_adr_motor[${motorIdx}]: ${qposAdr}`);
  console.log(`  qvel_adr_motor[${motorIdx}]: ${qvelAdr}`);
  console.log(`  ctrl_adr_motor[${motorIdx}]: ${ctrlAdr}`);
  
  // 5. 检查实际应用的控制值
  const currentJpos = demo.simulation.qpos[qposAdr];
  const currentJvel = demo.simulation.qvel[qvelAdr];
  const targetJpos = actionReorderedManual[motorIdx];
  const kp = demo.kpPolicyReorder[motorIdx];
  const kd = demo.kdPolicyReorder[motorIdx];
  const torque = kp * (targetJpos - currentJpos) + kd * (0 - currentJvel);
  const actualCtrl = demo.simulation.ctrl[ctrlAdr];
  
  console.log(`  当前位置: ${currentJpos.toFixed(4)}`);
  console.log(`  目标位置: ${targetJpos.toFixed(4)}`);
  console.log(`  当前速度: ${currentJvel.toFixed(4)}`);
  console.log(`  计算扭矩: ${torque.toFixed(4)}`);
  console.log(`  实际控制值: ${actualCtrl.toFixed(4)}`);
  console.log(`  是否匹配: ${Math.abs(torque - actualCtrl) < 0.1 ? '✅' : '❌'}`);
  
  // 6. 检查所有左腿关节
  console.log('%c[检查] 所有左腿关节的动作应用', 'color: green; font-weight: bold;');
  leftLegPolicyIndices.forEach(policyIdx => {
    const motorIdx = demo.joint2motorIdx[policyIdx];
    const jointName = demo.policyJointNames[policyIdx];
    const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
    const actualCtrl = demo.simulation.ctrl[ctrlAdr];
    const targetJpos = actionReorderedManual[motorIdx];
    const currentJpos = demo.simulation.qpos[demo.qpos_adr_motor[motorIdx]];
    
    console.log(`${jointName} (策略${policyIdx} -> 电机${motorIdx}):`);
    console.log(`  actionTarget: ${demo.actionTarget[policyIdx].toFixed(4)}`);
    console.log(`  actionReordered: ${targetJpos.toFixed(4)}`);
    console.log(`  当前位置: ${currentJpos.toFixed(4)}`);
    console.log(`  实际控制值: ${actualCtrl.toFixed(4)}`);
  });
  
  // 7. 检查是否有 NaN 或无效值
  console.log('%c[检查] 检查 NaN 或无效值', 'color: red; font-weight: bold;');
  let hasNaN = false;
  for (let motorIdx = 0; motorIdx < 29; motorIdx++) {
    if (isNaN(actionReorderedManual[motorIdx])) {
      console.error(`actionReorderedManual[${motorIdx}] 是 NaN！`);
      hasNaN = true;
    }
    const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
    if (ctrlAdr >= 0) {
      const ctrlValue = demo.simulation.ctrl[ctrlAdr];
      if (!isFinite(ctrlValue)) {
        console.error(`ctrl[${ctrlAdr}] (motorIdx=${motorIdx}) 是无效值: ${ctrlValue}`);
        hasNaN = true;
      }
    }
  }
  if (!hasNaN) {
    console.log('✅ 没有发现 NaN 或无效值');
  }
}
```

## 可能的问题

1. **动作应用到了错误的关节**：`ctrl_adr_motor[motorIdx]` 可能指向错误的执行器
2. **PD 增益应用到了错误的关节**：`kpPolicyReorder[motorIdx]` 可能不对应正确的关节
3. **控制值计算错误**：扭矩计算可能有误
4. **NaN 或无效值**：某些控制值可能是 NaN

请运行脚本并把结果发给我。
