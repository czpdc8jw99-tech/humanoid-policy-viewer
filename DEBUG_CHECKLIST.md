# 调试检查清单

## 请在浏览器控制台运行以下代码，并复制所有输出

### 1. 检查观察向量的详细值（左右腿对比）

```javascript
const demo = window.demo;
const pr = demo.policyRunner;

// 读取当前状态
const state = demo.readPolicyState();

// 获取观察向量
const obsModules = pr.obsModules;
let obsOffset = 0;
const obsValues = {};

for (const obs of obsModules) {
  const obsValue = obs.compute(state);
  const obsArray = Array.isArray(obsValue) ? obsValue : Array.from(obsValue);
  obsValues[obs.constructor.name] = obsArray;
  obsOffset += obsArray.length;
}

// 检查左右腿的观察值
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17]; // left_hip_pitch, left_hip_roll, left_hip_yaw, left_knee, left_ankle_pitch, left_ankle_roll
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18]; // right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll

console.log('=== 观察向量详细检查 ===');

// JointPosRel (相对关节位置)
if (obsValues.JointPosRel) {
  console.log('JointPosRel (相对关节位置):');
  console.log('左腿:', leftLegPolicyIndices.map(i => obsValues.JointPosRel[i]));
  console.log('右腿:', rightLegPolicyIndices.map(i => obsValues.JointPosRel[i]));
  const leftAvg = leftLegPolicyIndices.reduce((sum, i) => sum + Math.abs(obsValues.JointPosRel[i]), 0) / leftLegPolicyIndices.length;
  const rightAvg = rightLegPolicyIndices.reduce((sum, i) => sum + Math.abs(obsValues.JointPosRel[i]), 0) / rightLegPolicyIndices.length;
  console.log('左腿平均值:', leftAvg, '右腿平均值:', rightAvg, '比例:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}

// JointVel (关节速度)
if (obsValues.JointVel) {
  console.log('JointVel (关节速度):');
  console.log('左腿:', leftLegPolicyIndices.map(i => obsValues.JointVel[i]));
  console.log('右腿:', rightLegPolicyIndices.map(i => obsValues.JointVel[i]));
  const leftAvg = leftLegPolicyIndices.reduce((sum, i) => sum + Math.abs(obsValues.JointVel[i]), 0) / leftLegPolicyIndices.length;
  const rightAvg = rightLegPolicyIndices.reduce((sum, i) => sum + Math.abs(obsValues.JointVel[i]), 0) / rightLegPolicyIndices.length;
  console.log('左腿平均值:', leftAvg, '右腿平均值:', rightAvg, '比例:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}

// PrevActions (前一步动作)
if (obsValues.PrevActions) {
  console.log('PrevActions (前一步动作):');
  // PrevActions 可能是扁平化的，需要根据 history_steps 解析
  const historySteps = pr.obsModules.find(m => m.constructor.name === 'PrevActions')?.steps || 1;
  const step0Offset = 0; // 第一步（最近的）
  const leftPrev = leftLegPolicyIndices.map(i => obsValues.PrevActions[step0Offset * pr.numActions + i]);
  const rightPrev = rightLegPolicyIndices.map(i => obsValues.PrevActions[step0Offset * pr.numActions + i]);
  console.log('左腿:', leftPrev);
  console.log('右腿:', rightPrev);
  const leftAvg = leftPrev.reduce((sum, v) => sum + Math.abs(v), 0) / leftPrev.length;
  const rightAvg = rightPrev.reduce((sum, v) => sum + Math.abs(v), 0) / rightPrev.length;
  console.log('左腿平均值:', leftAvg, '右腿平均值:', rightAvg, '比例:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}

// RootAngVelB (根角速度)
if (obsValues.RootAngVelB) {
  console.log('RootAngVelB (根角速度):', obsValues.RootAngVelB);
}

// ProjectedGravityB (投影重力)
if (obsValues.ProjectedGravityB) {
  console.log('ProjectedGravityB (投影重力):', obsValues.ProjectedGravityB);
}

// Command (命令)
if (obsValues.Command) {
  console.log('Command (命令):', obsValues.Command);
}
```

### 2. 检查动作重新排序

```javascript
const demo = window.demo;

// 手动重新排序动作
const actionReordered = new Float32Array(29);
for (let i = 0; i < 29; i++) {
  const motorIdx = demo.joint2motorIdx[i];
  actionReordered[motorIdx] = demo.actionTarget[i];
}

// 检查左右腿的动作值
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];
const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);

console.log('=== 动作重新排序检查 ===');
console.log('左腿策略索引:', leftLegPolicyIndices);
console.log('左腿电机索引:', leftLegMotorIndices);
console.log('左腿 actionTarget (策略顺序):', leftLegPolicyIndices.map(i => demo.actionTarget[i]));
console.log('左腿 actionReordered (电机顺序):', leftLegMotorIndices.map(motorIdx => actionReordered[motorIdx]));

console.log('右腿策略索引:', rightLegPolicyIndices);
console.log('右腿电机索引:', rightLegMotorIndices);
console.log('右腿 actionTarget (策略顺序):', rightLegPolicyIndices.map(i => demo.actionTarget[i]));
console.log('右腿 actionReordered (电机顺序):', rightLegMotorIndices.map(motorIdx => actionReordered[motorIdx]));
```

### 3. 检查实际应用的控制值

```javascript
const demo = window.demo;

const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];
const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);

console.log('=== 实际控制值检查 ===');
console.log('左腿控制值:');
leftLegMotorIndices.forEach((motorIdx, idx) => {
  const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
  const ctrlValue = demo.simulation.ctrl[ctrlAdr];
  const targetJpos = demo.actionTarget[leftLegPolicyIndices[idx]];
  const currentJpos = demo.simulation.qpos[demo.qpos_adr_motor[motorIdx]];
  const kp = demo.kpPolicyReorder[motorIdx];
  console.log(`  电机${motorIdx} (${demo.policyJointNames[leftLegPolicyIndices[idx]]}): ctrlAdr=${ctrlAdr}, ctrlValue=${ctrlValue.toFixed(4)}, targetJpos=${targetJpos.toFixed(4)}, currentJpos=${currentJpos.toFixed(4)}, kp=${kp}`);
});

console.log('右腿控制值:');
rightLegMotorIndices.forEach((motorIdx, idx) => {
  const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
  const ctrlValue = demo.simulation.ctrl[ctrlAdr];
  const targetJpos = demo.actionTarget[rightLegPolicyIndices[idx]];
  const currentJpos = demo.simulation.qpos[demo.qpos_adr_motor[motorIdx]];
  const kp = demo.kpPolicyReorder[motorIdx];
  console.log(`  电机${motorIdx} (${demo.policyJointNames[rightLegPolicyIndices[idx]]}): ctrlAdr=${ctrlAdr}, ctrlValue=${ctrlValue.toFixed(4)}, targetJpos=${targetJpos.toFixed(4)}, currentJpos=${currentJpos.toFixed(4)}, kp=${kp}`);
});
```

### 4. 检查完整的观察向量（用于策略推理）

```javascript
const demo = window.demo;
const pr = demo.policyRunner;

// 构建完整的观察向量
const state = demo.readPolicyState();
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

console.log('=== 完整观察向量 ===');
console.log('观察向量长度:', obsForPolicy.length);
console.log('观察向量前20个值:', Array.from(obsForPolicy.slice(0, 20)));
console.log('观察向量范围:', {
  min: Math.min(...Array.from(obsForPolicy)),
  max: Math.max(...Array.from(obsForPolicy)),
  mean: Array.from(obsForPolicy).reduce((a, b) => a + b, 0) / obsForPolicy.length
});

// 检查观察向量是否对称（左右腿部分）
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];

// JointPosRel 在观察向量中的位置（假设顺序：RootAngVelB(3) + ProjectedGravityB(3) + Command(3) + JointPosRel(29) + ...）
const jointPosRelOffset = 9; // 3 + 3 + 3
const leftJointPosRel = leftLegPolicyIndices.map(i => obsForPolicy[jointPosRelOffset + i]);
const rightJointPosRel = rightLegPolicyIndices.map(i => obsForPolicy[jointPosRelOffset + i]);
console.log('观察向量中的 JointPosRel (左腿):', leftJointPosRel);
console.log('观察向量中的 JointPosRel (右腿):', rightJointPosRel);
```
