# 左右腿不对称问题分析

## 问题描述
- 左脚能迈步，右脚不动
- 不管不动还是前进，都是左脚动，右脚不动

## 策略关节顺序（policy_joint_names）

```
索引  关节名称
0     left_hip_pitch_joint
1     right_hip_pitch_joint
2     waist_yaw_joint
3     left_hip_roll_joint
4     right_hip_roll_joint
5     waist_roll_joint
6     left_hip_yaw_joint
7     right_hip_yaw_joint
8     waist_pitch_joint
9     left_knee_joint
10    right_knee_joint
11    left_shoulder_pitch_joint
12    right_shoulder_pitch_joint
13    left_ankle_pitch_joint
14    right_ankle_pitch_joint
15    left_shoulder_roll_joint
16    right_shoulder_roll_joint
17    left_ankle_roll_joint
18    right_ankle_roll_joint
...
```

## joint2motor_idx 映射

```json
[0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

### 映射关系（策略索引 -> 电机索引）

**左腿**：
- 策略索引0 (left_hip_pitch) -> motorIdx=0
- 策略索引3 (left_hip_roll) -> motorIdx=1
- 策略索引6 (left_hip_yaw) -> motorIdx=2
- 策略索引9 (left_knee) -> motorIdx=3
- 策略索引13 (left_ankle_pitch) -> motorIdx=4
- 策略索引17 (left_ankle_roll) -> motorIdx=5

**右腿**：
- 策略索引1 (right_hip_pitch) -> motorIdx=6
- 策略索引4 (right_hip_roll) -> motorIdx=7
- 策略索引7 (right_hip_yaw) -> motorIdx=8
- 策略索引10 (right_knee) -> motorIdx=9
- 策略索引14 (right_ankle_pitch) -> motorIdx=10
- 策略索引18 (right_ankle_roll) -> motorIdx=11

## Python 原始代码逻辑

```python
# Python LocoMode.py line 97-101
loco_action = self.action * self.action_scale + self.default_angles
action_reorder = loco_action.copy()
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    action_reorder[motor_idx] = loco_action[i]

self.policy_output.actions = action_reorder.copy()
```

**关键理解**：
- `loco_action[i]` 是策略索引i的动作值
- `motor_idx = joint2motor_idx[i]` 是策略索引i对应的电机索引
- `action_reorder[motor_idx] = loco_action[i]` 将策略索引i的动作放到电机索引motor_idx的位置

## JavaScript 当前实现

```javascript
// main.js:957-974
let actionReordered = null;
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.actionTarget) {
  actionReordered = new Float32Array(this.numActions);
  for (let i = 0; i < this.numActions; i++) {
    const motorIdx = this.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < this.numActions) {
      actionReordered[motorIdx] = this.actionTarget[i];
    }
  }
}
```

**这个逻辑看起来是正确的**，与Python一致。

## 可能的问题

### 问题1：actionTarget 的顺序
`actionTarget` 是从 `policyRunner.step()` 返回的，它应该是：
```javascript
target[i] = defaultJointPos[i] + actionScale[i] * lastActions[i]
```

`lastActions` 是策略输出的原始动作（策略顺序），所以 `actionTarget` 也是策略顺序的。

### 问题2：电机顺序地址数组的创建
在 `mujocoUtils.js` 中创建电机顺序地址数组时：
```javascript
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = joint2motorIdx[i];
  this.qpos_adr_motor[motorIdx] = this.qpos_adr_policy[i];
  this.qvel_adr_motor[motorIdx] = this.qvel_adr_policy[i];
  this.ctrl_adr_motor[motorIdx] = this.ctrl_adr_policy[i];
}
```

这个逻辑看起来也是正确的。

### 问题3：动作应用时的索引
在 `main.js:980-1005` 中：
```javascript
for (let motorIdx = 0; motorIdx < this.numActions; motorIdx++) {
  const ctrl_adr = this.ctrl_adr_motor[motorIdx];
  const targetJpos = actionReordered ? actionReordered[motorIdx] : ...;
  // ...
  this.simulation.ctrl[ctrl_adr] = ctrlValue;
}
```

这里使用 `actionReordered[motorIdx]`，应该是正确的。

## 需要检查的点

1. **actionReordered 是否正确创建？**
   - 检查 `actionReordered` 数组的值
   - 特别是左右腿对应的电机索引位置

2. **ctrl_adr_motor 是否正确？**
   - 检查 `ctrl_adr_motor` 数组的值
   - 确认左右腿的执行器地址是否正确

3. **PD增益是否正确？**
   - 检查 `kpPolicyReorder` 和 `kdPolicyReorder`
   - 确认左右腿的PD增益是否对称

4. **动作值是否对称？**
   - 检查策略输出的原始动作值
   - 检查重新排序后的动作值

## 调试建议

在控制台运行以下代码检查：

```javascript
const demo = window.demo;

// 1. 检查 joint2motorIdx 映射
console.log('=== joint2motorIdx 映射 ===');
const leftLegPolicyIndices = [0, 3, 6, 9, 13, 17];
const rightLegPolicyIndices = [1, 4, 7, 10, 14, 18];
console.log('左腿策略索引 -> 电机索引:');
leftLegPolicyIndices.forEach(i => {
  console.log(`  策略${i} (${demo.policyJointNames[i]}) -> motorIdx=${demo.joint2motorIdx[i]}`);
});
console.log('右腿策略索引 -> 电机索引:');
rightLegPolicyIndices.forEach(i => {
  console.log(`  策略${i} (${demo.policyJointNames[i]}) -> motorIdx=${demo.joint2motorIdx[i]}`);
});

// 2. 检查 actionTarget（策略顺序）
console.log('=== actionTarget (策略顺序) ===');
console.log('左腿动作值:', leftLegPolicyIndices.map(i => demo.actionTarget[i]));
console.log('右腿动作值:', rightLegPolicyIndices.map(i => demo.actionTarget[i]));

// 3. 检查 actionReordered（需要手动创建，因为代码中可能没有暴露）
// 手动重新排序
const actionReordered = new Float32Array(29);
for (let i = 0; i < 29; i++) {
  const motorIdx = demo.joint2motorIdx[i];
  actionReordered[motorIdx] = demo.actionTarget[i];
}
console.log('=== actionReordered (电机顺序) ===');
const leftLegMotorIndices = leftLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
const rightLegMotorIndices = rightLegPolicyIndices.map(i => demo.joint2motorIdx[i]);
console.log('左腿电机索引:', leftLegMotorIndices);
console.log('左腿动作值:', leftLegMotorIndices.map(motorIdx => actionReordered[motorIdx]));
console.log('右腿电机索引:', rightLegMotorIndices);
console.log('右腿动作值:', rightLegMotorIndices.map(motorIdx => actionReordered[motorIdx]));

// 4. 检查 ctrl_adr_motor
console.log('=== ctrl_adr_motor (电机顺序) ===');
console.log('左腿执行器地址:', leftLegMotorIndices.map(motorIdx => demo.ctrl_adr_motor[motorIdx]));
console.log('右腿执行器地址:', rightLegMotorIndices.map(motorIdx => demo.ctrl_adr_motor[motorIdx]));

// 5. 检查实际控制值
console.log('=== 实际控制值 ===');
leftLegMotorIndices.forEach((motorIdx, idx) => {
  const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
  const ctrlValue = demo.simulation.ctrl[ctrlAdr];
  console.log(`左腿${idx} (motorIdx=${motorIdx}, ctrlAdr=${ctrlAdr}): ${ctrlValue}`);
});
rightLegMotorIndices.forEach((motorIdx, idx) => {
  const ctrlAdr = demo.ctrl_adr_motor[motorIdx];
  const ctrlValue = demo.simulation.ctrl[ctrlAdr];
  console.log(`右腿${idx} (motorIdx=${motorIdx}, ctrlAdr=${ctrlAdr}): ${ctrlValue}`);
});
```
