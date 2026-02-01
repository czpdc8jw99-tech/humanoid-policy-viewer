# 控制值不对称问题详细诊断

## 问题发现
- **actionTarget 对称性**: 86% (相对可接受)
- **控制值严重不对称**: 左腿和右腿的控制值差异很大，符号相反

## 需要检查的因素

控制值计算公式：
```
torque = kp * (targetJpos - currentJpos) + kd * (0 - currentVel)
ctrlValue = clamp(torque, min, max)
```

可能的不对称来源：
1. `actionReordered` 不对称
2. `currentJpos` (当前关节位置) 不对称
3. `kpPolicyReorder` 不对称
4. `kdPolicyReorder` 不对称
5. `currentVel` (当前关节速度) 不对称

## 详细诊断脚本

请在浏览器控制台运行以下脚本：

```javascript
// ===== 完整诊断脚本 =====
const demo = window.demo;
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

if (!demo.joint2motorIdx || !demo.ctrl_adr_motor) {
  console.error('joint2motorIdx 或 ctrl_adr_motor 不存在！');
} else {
  // 1. 检查 actionReordered
  const actionReordered = new Float32Array(29);
  actionReordered.fill(NaN);
  for (let i = 0; i < 29; i++) {
    const motorIdx = demo.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < 29) {
      actionReordered[motorIdx] = demo.actionTarget[i];
    }
  }
  
  const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  
  console.log('%c=== [诊断] actionReordered 对称性 ===', 'color: blue; font-weight: bold;');
  const leftReordered = leftLegMotorIndices.map(motorIdx => actionReordered[motorIdx]);
  const rightReordered = rightLegMotorIndices.map(motorIdx => actionReordered[motorIdx]);
  console.log('左腿 actionReordered:', leftReordered.map(v => v.toFixed(4)));
  console.log('右腿 actionReordered:', rightReordered.map(v => v.toFixed(4)));
  
  // 2. 检查当前关节位置
  console.log('%c=== [诊断] 当前关节位置对称性 ===', 'color: blue; font-weight: bold;');
  const leftCurrentJpos = leftLegMotorIndices.map(motorIdx => {
    const qposAdr = demo.qpos_adr_motor[motorIdx];
    return demo.simulation.qpos[qposAdr];
  });
  const rightCurrentJpos = rightLegMotorIndices.map(motorIdx => {
    const qposAdr = demo.qpos_adr_motor[motorIdx];
    return demo.simulation.qpos[qposAdr];
  });
  console.log('左腿当前位置:', leftCurrentJpos.map(v => v.toFixed(4)));
  console.log('右腿当前位置:', rightCurrentJpos.map(v => v.toFixed(4)));
  
  // 3. 检查目标位置差值
  console.log('%c=== [诊断] 目标位置差值 (targetJpos - currentJpos) ===', 'color: blue; font-weight: bold;');
  const leftDiff = leftReordered.map((target, idx) => target - leftCurrentJpos[idx]);
  const rightDiff = rightReordered.map((target, idx) => target - rightCurrentJpos[idx]);
  console.log('左腿差值:', leftDiff.map(v => v.toFixed(4)));
  console.log('右腿差值:', rightDiff.map(v => v.toFixed(4)));
  
  // 4. 检查 PD 增益
  console.log('%c=== [诊断] PD 增益对称性 ===', 'color: blue; font-weight: bold;');
  const leftKp = leftLegMotorIndices.map(motorIdx => demo.kpPolicyReorder[motorIdx]);
  const rightKp = rightLegMotorIndices.map(motorIdx => demo.kpPolicyReorder[motorIdx]);
  const leftKd = leftLegMotorIndices.map(motorIdx => demo.kdPolicyReorder[motorIdx]);
  const rightKd = rightLegMotorIndices.map(motorIdx => demo.kdPolicyReorder[motorIdx]);
  console.log('左腿 Kp:', leftKp.map(v => v.toFixed(2)));
  console.log('右腿 Kp:', rightKp.map(v => v.toFixed(2)));
  console.log('左腿 Kd:', leftKd.map(v => v.toFixed(2)));
  console.log('右腿 Kd:', rightKd.map(v => v.toFixed(2)));
  
  // 5. 检查当前速度
  console.log('%c=== [诊断] 当前关节速度对称性 ===', 'color: blue; font-weight: bold;');
  const leftCurrentVel = leftLegMotorIndices.map(motorIdx => {
    const qvelAdr = demo.qvel_adr_motor[motorIdx];
    return demo.simulation.qvel[qvelAdr];
  });
  const rightCurrentVel = rightLegMotorIndices.map(motorIdx => {
    const qvelAdr = demo.qvel_adr_motor[motorIdx];
    return demo.simulation.qvel[qvelAdr];
  });
  console.log('左腿速度:', leftCurrentVel.map(v => v.toFixed(4)));
  console.log('右腿速度:', rightCurrentVel.map(v => v.toFixed(4)));
  
  // 6. 手动计算扭矩
  console.log('%c=== [诊断] 手动计算扭矩 ===', 'color: blue; font-weight: bold;');
  const leftTorque = leftReordered.map((target, idx) => {
    const diff = target - leftCurrentJpos[idx];
    const vel = leftCurrentVel[idx];
    return leftKp[idx] * diff + leftKd[idx] * (0 - vel);
  });
  const rightTorque = rightReordered.map((target, idx) => {
    const diff = target - rightCurrentJpos[idx];
    const vel = rightCurrentVel[idx];
    return rightKp[idx] * diff + rightKd[idx] * (0 - vel);
  });
  console.log('左腿扭矩:', leftTorque.map(v => v.toFixed(4)));
  console.log('右腿扭矩:', rightTorque.map(v => v.toFixed(4)));
  
  // 7. 检查实际控制值
  console.log('%c=== [诊断] 实际控制值 ===', 'color: blue; font-weight: bold;');
  const leftCtrlValues = leftLegMotorIndices.map(motorIdx => {
    const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
    return demo.simulation.ctrl[ctrlAdr];
  });
  const rightCtrlValues = rightLegMotorIndices.map(motorIdx => {
    const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
    return demo.simulation.ctrl[ctrlAdr];
  });
  console.log('左腿控制值:', leftCtrlValues.map(v => v.toFixed(4)));
  console.log('右腿控制值:', rightCtrlValues.map(v => v.toFixed(4)));
  
  // 8. 对比手动计算的扭矩和实际控制值
  console.log('%c=== [诊断] 扭矩 vs 控制值对比 ===', 'color: red; font-weight: bold;');
  for (let i = 0; i < 6; i++) {
    const jointName = demo.policyJointNames[leftLegPolicyIndices[i]];
    console.log(`左腿 ${jointName}:`);
    console.log(`  手动扭矩: ${leftTorque[i].toFixed(4)}, 实际控制值: ${leftCtrlValues[i].toFixed(4)}, 差异: ${(leftCtrlValues[i] - leftTorque[i]).toFixed(4)}`);
  }
  for (let i = 0; i < 6; i++) {
    const jointName = demo.policyJointNames[rightLegPolicyIndices[i]];
    console.log(`右腿 ${jointName}:`);
    console.log(`  手动扭矩: ${rightTorque[i].toFixed(4)}, 实际控制值: ${rightCtrlValues[i].toFixed(4)}, 差异: ${(rightCtrlValues[i] - rightTorque[i]).toFixed(4)}`);
  }
  
  // 9. 总结
  console.log('%c=== [诊断] 总结 ===', 'color: green; font-weight: bold;');
  const leftReorderedAvg = leftReordered.reduce((sum, v) => sum + Math.abs(v), 0) / leftReordered.length;
  const rightReorderedAvg = rightReordered.reduce((sum, v) => sum + Math.abs(v), 0) / rightReordered.length;
  console.log(`actionReordered 对称性: ${(Math.min(leftReorderedAvg, rightReorderedAvg) / Math.max(leftReorderedAvg, rightReorderedAvg)).toFixed(4)}`);
  
  const leftJposAvg = leftCurrentJpos.reduce((sum, v) => sum + Math.abs(v), 0) / leftCurrentJpos.length;
  const rightJposAvg = rightCurrentJpos.reduce((sum, v) => sum + Math.abs(v), 0) / rightCurrentJpos.length;
  console.log(`当前位置对称性: ${(Math.min(leftJposAvg, rightJposAvg) / Math.max(leftJposAvg, rightJposAvg)).toFixed(4)}`);
  
  const leftKpAvg = leftKp.reduce((sum, v) => sum + Math.abs(v), 0) / leftKp.length;
  const rightKpAvg = rightKp.reduce((sum, v) => sum + Math.abs(v), 0) / rightKp.length;
  console.log(`Kp 对称性: ${(Math.min(leftKpAvg, rightKpAvg) / Math.max(leftKpAvg, rightKpAvg)).toFixed(4)}`);
  
  const leftCtrlAvg = leftCtrlValues.reduce((sum, v) => sum + Math.abs(v), 0) / leftCtrlValues.length;
  const rightCtrlAvg = rightCtrlValues.reduce((sum, v) => sum + Math.abs(v), 0) / rightCtrlValues.length;
  console.log(`控制值对称性: ${(Math.min(leftCtrlAvg, rightCtrlAvg) / Math.max(leftCtrlAvg, rightCtrlAvg)).toFixed(4)}`);
}
```

## 预期发现

运行此脚本后，应该能够识别：
1. **actionReordered 是否对称**：如果不对称，问题在动作重新排序
2. **当前关节位置是否对称**：如果不对称，可能是初始状态或之前的动作导致
3. **PD 增益是否对称**：如果不对称，问题在 PD 增益重新排序
4. **手动计算的扭矩是否与实际控制值匹配**：如果不匹配，可能有 clamp 或其他处理

请运行此脚本并将结果反馈给我。
