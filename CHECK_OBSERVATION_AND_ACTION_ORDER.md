# 检查观测顺序和输出顺序的诊断脚本

## 完整诊断脚本

请在浏览器控制台运行以下脚本：

```javascript
// ===== 检查观测顺序和输出顺序 =====
const demo = window.demo;
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

if (!demo.joint2motorIdx || !demo.qpos_adr_motor) {
  console.error('joint2motorIdx 或 qpos_adr_motor 不存在！');
} else {
  console.log('%c=== [检查] 观测顺序验证 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  // 1. 检查 readPolicyState() 返回的顺序
  const state = demo.readPolicyState();
  console.log('readPolicyState() 返回的 jointPos 和 jointVel:');
  
  // 2. 手动构建电机顺序数组（模拟 Python qj）
  const qj_motor = new Float32Array(29);
  const dqj_motor = new Float32Array(29);
  for (let motorIdx = 0; motorIdx < 29; motorIdx++) {
    const qposAdr = demo.qpos_adr_motor[motorIdx];
    const qvelAdr = demo.qvel_adr_motor[motorIdx];
    if (qposAdr >= 0 && qvelAdr >= 0) {
      qj_motor[motorIdx] = demo.simulation.qpos[qposAdr];
      dqj_motor[motorIdx] = demo.simulation.qvel[qvelAdr];
    }
  }
  
  // 3. 手动重新排序到策略顺序（模拟 Python qj_obs）
  const qj_obs_manual = new Float32Array(29);
  const dqj_obs_manual = new Float32Array(29);
  for (let i = 0; i < 29; i++) {
    const motorIdx = demo.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < 29) {
      qj_obs_manual[i] = qj_motor[motorIdx];
      dqj_obs_manual[i] = dqj_motor[motorIdx];
    }
  }
  
  // 4. 对比 readPolicyState() 返回的值和手动计算的值
  console.log('%c[对比] readPolicyState() vs 手动计算', 'color: green; font-weight: bold;');
  let allMatch = true;
  for (let i = 0; i < 29; i++) {
    const diffPos = Math.abs(state.jointPos[i] - qj_obs_manual[i]);
    const diffVel = Math.abs(state.jointVel[i] - dqj_obs_manual[i]);
    if (diffPos > 0.0001 || diffVel > 0.0001) {
      console.error(`索引 ${i} (${demo.policyJointNames[i]}):`);
      console.error(`  jointPos: readPolicyState=${state.jointPos[i].toFixed(4)}, 手动计算=${qj_obs_manual[i].toFixed(4)}, 差异=${diffPos.toFixed(4)}`);
      console.error(`  jointVel: readPolicyState=${state.jointVel[i].toFixed(4)}, 手动计算=${dqj_obs_manual[i].toFixed(4)}, 差异=${diffVel.toFixed(4)}`);
      allMatch = false;
    }
  }
  if (allMatch) {
    console.log('✅ readPolicyState() 返回的顺序与手动计算一致');
  } else {
    console.error('❌ readPolicyState() 返回的顺序与手动计算不一致！');
  }
  
  // 5. 检查左右腿的观测值对称性
  console.log('%c=== [检查] 观测值对称性 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  const leftObsPos = leftLegPolicyIndices.map(i => state.jointPos[i]);
  const rightObsPos = rightLegPolicyIndices.map(i => state.jointPos[i]);
  const leftObsVel = leftLegPolicyIndices.map(i => state.jointVel[i]);
  const rightObsVel = rightLegPolicyIndices.map(i => state.jointVel[i]);
  
  console.log('左腿观测位置:', leftObsPos.map(v => v.toFixed(4)));
  console.log('右腿观测位置:', rightObsPos.map(v => v.toFixed(4)));
  console.log('左腿观测速度:', leftObsVel.map(v => v.toFixed(4)));
  console.log('右腿观测速度:', rightObsVel.map(v => v.toFixed(4)));
  
  const leftPosAvg = leftObsPos.reduce((sum, v) => sum + Math.abs(v), 0) / leftObsPos.length;
  const rightPosAvg = rightObsPos.reduce((sum, v) => sum + Math.abs(v), 0) / rightObsPos.length;
  const posSymmetry = Math.min(leftPosAvg, rightPosAvg) / Math.max(leftPosAvg, rightPosAvg);
  console.log(`位置对称性: ${posSymmetry.toFixed(4)} ${posSymmetry > 0.9 ? '✅' : '❌'}`);
  
  const leftVelAvg = leftObsVel.reduce((sum, v) => sum + Math.abs(v), 0) / leftObsVel.length;
  const rightVelAvg = rightObsVel.reduce((sum, v) => sum + Math.abs(v), 0) / rightObsVel.length;
  const velSymmetry = Math.min(leftVelAvg, rightVelAvg) / Math.max(leftVelAvg, rightVelAvg);
  console.log(`速度对称性: ${velSymmetry.toFixed(4)} ${velSymmetry > 0.9 ? '✅' : '❌'}`);
  
  // 6. 检查输出顺序（actionReordered）
  console.log('%c=== [检查] 输出顺序验证 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  
  // 手动创建 actionReordered
  const actionReorderedManual = new Float32Array(29);
  actionReorderedManual.fill(NaN);
  for (let i = 0; i < 29; i++) {
    const motorIdx = demo.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < 29) {
      actionReorderedManual[motorIdx] = demo.actionTarget[i];
    }
  }
  
  // 检查实际代码中创建的 actionReordered（需要从 main.js 的逻辑中获取）
  // 由于 actionReordered 是在 main.js 中创建的局部变量，我们需要手动验证逻辑
  console.log('手动创建的 actionReordered:');
  const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  
  const leftActionReordered = leftLegMotorIndices.map(motorIdx => actionReorderedManual[motorIdx]);
  const rightActionReordered = rightLegMotorIndices.map(motorIdx => actionReorderedManual[motorIdx]);
  
  console.log('左腿 actionReordered:', leftActionReordered.map(v => v.toFixed(4)));
  console.log('右腿 actionReordered:', rightActionReordered.map(v => v.toFixed(4)));
  
  const leftActionAvg = leftActionReordered.reduce((sum, v) => sum + Math.abs(v), 0) / leftActionReordered.length;
  const rightActionAvg = rightActionReordered.reduce((sum, v) => sum + Math.abs(v), 0) / rightActionReordered.length;
  const actionSymmetry = Math.min(leftActionAvg, rightActionAvg) / Math.max(leftActionAvg, rightActionAvg);
  console.log(`actionReordered 对称性: ${actionSymmetry.toFixed(4)} ${actionSymmetry > 0.9 ? '✅' : '❌'}`);
  
  // 7. 详细对比：检查每个关节的映射关系
  console.log('%c=== [检查] 详细映射关系 ===', 'color: blue; font-weight: bold; font-size: 16px;');
  console.log('左腿关节映射:');
  leftLegPolicyIndices.forEach(policyIdx => {
    const motorIdx = demo.joint2motorIdx[policyIdx];
    const jointName = demo.policyJointNames[policyIdx];
    const qposAdrPolicy = demo.qpos_adr_policy[policyIdx];
    const qposAdrMotor = demo.qpos_adr_motor[motorIdx];
    const qposFromPolicy = demo.simulation.qpos[qposAdrPolicy];
    const qposFromMotor = demo.simulation.qpos[qposAdrMotor];
    const qjMotorValue = qj_motor[motorIdx];
    const qjObsValue = qj_obs_manual[policyIdx];
    const readPolicyStateValue = state.jointPos[policyIdx];
    
    console.log(`  ${jointName} (策略索引=${policyIdx}, 电机索引=${motorIdx}):`);
    console.log(`    qpos_adr_policy[${policyIdx}]: ${qposAdrPolicy}`);
    console.log(`    qpos_adr_motor[${motorIdx}]: ${qposAdrMotor}`);
    console.log(`    从策略地址读取: ${qposFromPolicy.toFixed(4)}`);
    console.log(`    从电机地址读取: ${qposFromMotor.toFixed(4)}`);
    console.log(`    qj_motor[${motorIdx}]: ${qjMotorValue.toFixed(4)}`);
    console.log(`    qj_obs_manual[${policyIdx}]: ${qjObsValue.toFixed(4)}`);
    console.log(`    readPolicyState()[${policyIdx}]: ${readPolicyStateValue.toFixed(4)}`);
    console.log(`    是否匹配: ${Math.abs(qjObsValue - readPolicyStateValue) < 0.0001 ? '✅' : '❌'}`);
  });
}
```

## 预期结果

运行脚本后，应该能看到：
1. `readPolicyState()` 返回的顺序是否与手动计算一致
2. 观测值的对称性
3. `actionReordered` 的对称性
4. 每个关节的详细映射关系

请运行脚本并把结果发给我。
