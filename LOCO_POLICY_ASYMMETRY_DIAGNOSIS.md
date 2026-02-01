# Loco Policy 左右腿不对称问题诊断

## 问题描述
手柄策略（loco_mode）仍然存在左右腿不对称问题：左腿动，右腿不动。

## 需要检查的关键点

### 1. 观察向量对称性检查
在浏览器控制台运行以下命令，检查观察向量是否对称：

```javascript
// 检查观察向量
const demo = window.demo;
const runner = demo.policyRunners[0];
if (runner && runner._obsLogged === false) {
  // 强制重新构建观察向量以触发调试日志
  runner._obsLogged = false;
  const state = demo.readPolicyState();
  runner.buildObservation(state);
}
```

**检查项：**
- `JointPosRel` 左右腿的值是否对称？
- `JointVel` 左右腿的值是否对称？
- `PrevActions` 左右腿的值是否对称？
- `RootAngVelB` 是否接近 [0, 0, 0]？
- `ProjectedGravityB` 是否接近 [0, 0, -1]？
- `Command` 是否对称（如果命令是前进，应该是 [x, 0, 0]）？

### 2. 动作输出对称性检查
检查策略输出的原始动作值：

```javascript
// 检查 actionTarget 的对称性
const demo = window.demo;
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

const leftActions = leftLegIndices.map(i => demo.actionTarget[i]);
const rightActions = rightLegIndices.map(i => demo.actionTarget[i]);

console.log('左腿动作值:', leftActions);
console.log('右腿动作值:', rightActions);

const leftAvg = leftActions.reduce((sum, v) => sum + Math.abs(v), 0) / leftActions.length;
const rightAvg = rightActions.reduce((sum, v) => sum + Math.abs(v), 0) / rightActions.length;
console.log('左腿平均值:', leftAvg);
console.log('右腿平均值:', rightAvg);
console.log('对称性比例:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
```

### 3. actionReordered 对称性检查
检查重新排序后的动作值：

```javascript
// 检查 actionReordered（需要先触发一次推理）
const demo = window.demo;
if (demo.joint2motorIdx) {
  const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
  const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];
  
  // 需要手动创建 actionReordered
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
  
  const leftReordered = leftLegMotorIndices.map(motorIdx => actionReordered[motorIdx]);
  const rightReordered = rightLegMotorIndices.map(motorIdx => actionReordered[motorIdx]);
  
  console.log('左腿 actionReordered:', leftReordered);
  console.log('右腿 actionReordered:', rightReordered);
  
  const leftAvg = leftReordered.reduce((sum, v) => sum + Math.abs(v), 0) / leftReordered.length;
  const rightAvg = rightReordered.reduce((sum, v) => sum + Math.abs(v), 0) / rightReordered.length;
  console.log('左腿平均值:', leftAvg);
  console.log('右腿平均值:', rightAvg);
  console.log('对称性比例:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}
```

### 4. 控制值对称性检查
检查实际应用到 MuJoCo 的控制值：

```javascript
// 检查控制值（需要在动作应用后）
const demo = window.demo;
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

if (demo.joint2motorIdx && demo.ctrl_adr_motor) {
  const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  
  const leftCtrlValues = leftLegMotorIndices.map(motorIdx => {
    const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
    return demo.simulation.ctrl[ctrlAdr];
  });
  
  const rightCtrlValues = rightLegMotorIndices.map(motorIdx => {
    const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
    return demo.simulation.ctrl[ctrlAdr];
  });
  
  console.log('左腿控制值:', leftCtrlValues);
  console.log('右腿控制值:', rightCtrlValues);
  
  const leftAvg = leftCtrlValues.reduce((sum, v) => sum + Math.abs(v), 0) / leftCtrlValues.length;
  const rightAvg = rightCtrlValues.reduce((sum, v) => sum + Math.abs(v), 0) / rightCtrlValues.length;
  console.log('左腿平均值:', leftAvg);
  console.log('右腿平均值:', rightAvg);
  console.log('对称性比例:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}
```

### 5. joint2motorIdx 映射验证
检查映射是否正确：

```javascript
// 验证 joint2motorIdx 映射
const demo = window.demo;
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

console.log('左腿映射 (策略索引 -> 电机索引):');
leftLegPolicyIndices.forEach(policyIdx => {
  const motorIdx = demo.joint2motorIdx[policyIdx];
  const jointName = demo.policyJointNames[policyIdx];
  console.log(`  ${policyIdx} (${jointName}) -> ${motorIdx}`);
});

console.log('右腿映射 (策略索引 -> 电机索引):');
rightLegPolicyIndices.forEach(policyIdx => {
  const motorIdx = demo.joint2motorIdx[policyIdx];
  const jointName = demo.policyJointNames[policyIdx];
  console.log(`  ${policyIdx} (${jointName}) -> ${motorIdx}`);
});
```

### 6. PD 增益对称性检查
检查 PD 增益是否对称：

```javascript
// 检查 PD 增益
const demo = window.demo;
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

if (demo.kpPolicyReorder && demo.kdPolicyReorder) {
  const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
  
  const leftKp = leftLegMotorIndices.map(motorIdx => demo.kpPolicyReorder[motorIdx]);
  const rightKp = rightLegMotorIndices.map(motorIdx => demo.kpPolicyReorder[motorIdx]);
  
  console.log('左腿 Kp:', leftKp);
  console.log('右腿 Kp:', rightKp);
  
  const leftKpAvg = leftKp.reduce((sum, v) => sum + Math.abs(v), 0) / leftKp.length;
  const rightKpAvg = rightKp.reduce((sum, v) => sum + Math.abs(v), 0) / rightKp.length;
  console.log('左腿 Kp 平均值:', leftKpAvg);
  console.log('右腿 Kp 平均值:', rightKpAvg);
  console.log('Kp 对称性比例:', Math.min(leftKpAvg, rightKpAvg) / Math.max(leftKpAvg, rightKpAvg));
}
```

## 可能的问题原因

1. **观察向量不对称**：如果 `JointPosRel`、`JointVel` 或 `PrevActions` 不对称，策略输出也会不对称。
2. **策略本身不对称**：即使观察向量对称，策略网络本身可能输出不对称的动作。
3. **动作重新排序错误**：`actionReordered` 的创建或应用可能有误。
4. **PD 增益不对称**：`kpPolicyReorder` 或 `kdPolicyReorder` 可能不对称。
5. **控制值应用错误**：控制值可能没有正确应用到 MuJoCo。

## 下一步行动

请运行上述检查命令，并将结果反馈给我。这将帮助我定位问题的根本原因。
