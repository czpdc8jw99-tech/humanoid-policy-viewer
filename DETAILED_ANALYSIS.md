# 左右腿问题详细分析

## 代码执行流程

### 1. 策略输出动作（policyRunner.js）
- 策略输出 29 维动作数组 `action`
- 动作顺序对应 `policy_joint_names` 的顺序：
  ```
  action[0]  -> left_hip_pitch_joint
  action[1]  -> right_hip_pitch_joint
  action[3]  -> left_hip_roll_joint
  action[4]  -> right_hip_roll_joint
  action[6]  -> left_hip_yaw_joint
  action[7]  -> right_hip_yaw_joint
  action[9]  -> left_knee_joint
  action[10] -> right_knee_joint
  action[13] -> left_ankle_pitch_joint
  action[14] -> right_ankle_pitch_joint
  action[17] -> left_ankle_roll_joint
  action[18] -> right_ankle_roll_joint
  ```

### 2. 动作转换为目标关节位置（policyRunner.js）
```javascript
target[i] = defaultJointPos[i] + actionScale[i] * lastActions[i]
```
- `actionTarget[0]` 对应 left_hip_pitch_joint 的目标位置
- `actionTarget[1]` 对应 right_hip_pitch_joint 的目标位置
- ...

### 3. 关节映射建立（mujocoUtils.js - configureJointMappings）

**关键代码**：
```javascript
for (const name of jointNames) {  // 按照 policy_joint_names 顺序遍历
  const jointIdx = demo.jointNamesMJC.indexOf(name);  // 在 MuJoCo 模型中查找关节索引
  const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);  // 查找对应的执行器索引
  demo.ctrl_adr_policy.push(actuatorIdx);  // 保存映射关系
}
```

**问题可能在这里**：
- `actuator2joint` 是什么？
- `actuator2joint.findIndex` 如何工作？

### 4. actuator2joint 的构建

```javascript
const actuator2joint = [];
for (let i = 0; i < model.nu; i++) {  // 遍历所有执行器
  if (model.actuator_trntype[i] !== jointTransmission) {
    throw new Error(...);
  }
  actuator2joint.push(model.actuator_trnid[2 * i]);  // 执行器 i 对应的关节索引
}
```

**理解**：
- `actuator2joint[i]` = 执行器 i 对应的关节索引
- `actuator2joint.findIndex((jointId) => jointId === jointIdx)` = 找到第一个关节索引等于 `jointIdx` 的执行器索引

### 5. 动作应用（main.js）

```javascript
for (let i = 0; i < mapping.numActions; i++) {
  const ctrlAdr = mapping.ctrl_adr_policy[i];  // 策略动作 i 对应的执行器索引
  const targetJpos = actionTarget[i];  // 策略动作 i 的目标位置
  // ... 计算扭矩并应用到执行器 ctrlAdr
  this.simulation.ctrl[ctrlAdr] = ctrlValue;
}
```

## 关键问题分析

### 问题 1：actuator2joint.findIndex 的行为

**如果 MuJoCo 执行器顺序是**：
```
执行器 0: left_hip_pitch (关节索引 0)
执行器 1: left_hip_roll (关节索引 1)
执行器 2: left_hip_yaw (关节索引 2)
执行器 3: left_knee (关节索引 3)
执行器 4: left_ankle_pitch (关节索引 4)
执行器 5: left_ankle_roll (关节索引 5)
执行器 6: right_hip_pitch (关节索引 6)
执行器 7: right_hip_roll (关节索引 7)
...
```

**那么 actuator2joint = [0, 1, 2, 3, 4, 5, 6, 7, ...]**

**当查找 "right_hip_pitch_joint" 时**：
1. `jointIdx = demo.jointNamesMJC.indexOf("right_hip_pitch_joint")` = 6（假设）
2. `actuatorIdx = actuator2joint.findIndex((jointId) => jointId === 6)` = 6
3. 映射正确 ✓

### 问题 2：jointNamesMJC 的顺序

**关键**：`demo.jointNamesMJC` 的顺序是什么？

如果 `jointNamesMJC` 的顺序和 MuJoCo 执行器的顺序不一致，就会导致映射错误。

例如：
- 如果 `jointNamesMJC[6] = "right_hip_pitch_joint"`，但执行器 6 对应的关节索引不是 6，那么映射就会错误。

### 问题 3：左右腿配置不对称

检查配置文件中的左右腿参数：

**stiffness**：
- 索引 0 (left_hip_pitch): 200
- 索引 1 (right_hip_pitch): 200 ✓ 对称
- 索引 3 (left_hip_roll): 150
- 索引 4 (right_hip_roll): 150 ✓ 对称

**damping**：
- 索引 0 (left_hip_pitch): 5
- 索引 1 (right_hip_pitch): 5 ✓ 对称
- 索引 3 (left_hip_roll): 5
- 索引 4 (right_hip_roll): 5 ✓ 对称

**default_joint_pos**：
- 索引 0 (left_hip_pitch): -0.2
- 索引 1 (right_hip_pitch): -0.2 ✓ 对称
- 索引 3 (left_hip_roll): 0.0
- 索引 4 (right_hip_roll): 0.0 ✓ 对称

配置看起来是对称的。

## 需要验证的关键点

1. **jointNamesMJC 的实际顺序**：MuJoCo 模型中关节的顺序是什么？
2. **actuator2joint 的实际值**：每个执行器对应的关节索引是什么？
3. **ctrl_adr_policy 的实际映射**：策略动作索引到执行器索引的映射是否正确？
4. **动作值的实际输出**：策略输出的左右腿动作值是否对称？

## 下一步

需要添加更详细的调试日志来验证：
1. `jointNamesMJC` 的完整顺序
2. `actuator2joint` 的完整内容
3. `ctrl_adr_policy` 的完整映射
4. 每次推理时左右腿的动作值
