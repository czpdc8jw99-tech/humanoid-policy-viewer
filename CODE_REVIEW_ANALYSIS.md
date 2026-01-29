# 代码审查分析报告

## 1. 策略关节顺序（policy_joint_names）

从 `loco_policy_29dof.json`：
- [0] left_hip_pitch_joint
- [1] right_hip_pitch_joint
- [3] left_hip_roll_joint
- [4] right_hip_roll_joint
- [6] left_hip_yaw_joint
- [7] right_hip_yaw_joint
- [9] left_knee_joint
- [10] right_knee_joint
- [13] left_ankle_pitch_joint
- [14] right_ankle_pitch_joint
- [17] left_ankle_roll_joint
- [18] right_ankle_roll_joint

## 2. configureJointMappings 函数逻辑

```javascript
for (const name of jointNames) {
  const jointIdx = demo.jointNamesMJC.indexOf(name);  // 在 MuJoCo 模型中查找关节索引
  const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);  // 查找对应的执行器
  demo.ctrl_adr_policy.push(actuatorIdx);  // 保存执行器索引
}
```

### 潜在问题 1：findIndex 返回第一个匹配

`actuator2joint.findIndex((jointId) => jointId === jointIdx)` 会返回**第一个**匹配的执行器索引。

**如果 MuJoCo 模型中有多个执行器对应同一个关节**（虽然不太可能），或者执行器顺序和策略顺序不一致，可能会导致：
- 左腿的动作被应用到错误的执行器
- 右腿的动作被应用到错误的执行器

### 潜在问题 2：actuator2joint 的构建顺序

```javascript
const actuator2joint = [];
for (let i = 0; i < model.nu; i++) {
  if (model.actuator_trntype[i] !== jointTransmission) {
    throw new Error(`Actuator ${i} transmission type is not mjTRN_JOINT`);
  }
  actuator2joint.push(model.actuator_trnid[2 * i]);
}
```

这里 `actuator2joint[i]` 存储的是执行器 `i` 对应的关节索引。

**关键问题**：如果 MuJoCo 模型中的执行器顺序是：
- Actuator 0 -> left_hip_pitch_joint
- Actuator 1 -> right_hip_pitch_joint
- Actuator 2 -> left_hip_roll_joint
- Actuator 3 -> right_hip_roll_joint
- ...

那么 `actuator2joint` 应该是：
- actuator2joint[0] = left_hip_pitch_joint 的索引
- actuator2joint[1] = right_hip_pitch_joint 的索引
- ...

但是，如果 MuJoCo 模型中的执行器顺序是：
- Actuator 0 -> left_hip_pitch_joint
- Actuator 1 -> left_hip_roll_joint
- Actuator 2 -> left_hip_yaw_joint
- Actuator 3 -> right_hip_pitch_joint
- ...

那么 `findIndex` 可能会找到错误的执行器。

## 3. 动作应用逻辑

```javascript
for (let i = 0; i < this.numActions; i++) {
  const ctrl_adr = this.ctrl_adr_policy[i];
  this.simulation.ctrl[ctrl_adr] = ctrlValue;
}
```

这里 `action[i]` 被应用到执行器 `ctrl_adr_policy[i]`。

**如果 `ctrl_adr_policy` 的映射错误，动作就会被应用到错误的执行器。**

## 4. 关键检查点

需要验证：
1. **MuJoCo 模型中的执行器顺序**是否与策略中的关节顺序一致
2. **`actuator2joint.findIndex`** 是否总是找到正确的执行器
3. **左右腿的执行器索引**是否对称

## 5. 可能的修复方案

如果发现映射错误，可以考虑：
1. **直接使用关节索引查找执行器**，而不是使用 `findIndex`
2. **验证执行器顺序**，确保左右腿的执行器索引是对称的
3. **添加验证逻辑**，检查左右腿的执行器索引是否正确对应
