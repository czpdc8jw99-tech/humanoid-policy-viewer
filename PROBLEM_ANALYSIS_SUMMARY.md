# 左右腿问题分析总结

## 问题描述
- 左右腿的运动明显不一样
- 需要搞清楚为什么右腿会动，左腿不动（或相反）

## 代码执行流程

### 1. 策略输出动作
- 策略输出 29 维动作数组，顺序对应 `policy_joint_names`
- 动作[0] = left_hip_pitch
- 动作[1] = right_hip_pitch
- 动作[3] = left_hip_roll
- 动作[4] = right_hip_roll
- ...

### 2. 关节映射建立（configureJointMappings）

**关键步骤**：
1. 构建 `actuator2joint`：`actuator2joint[i]` = 执行器 i 对应的关节索引
2. 对于每个策略关节名称：
   - 在 `jointNamesMJC` 中查找关节索引 `jointIdx`
   - 在 `actuator2joint` 中查找第一个等于 `jointIdx` 的执行器索引
   - 保存映射：`ctrl_adr_policy[policyIdx] = actuatorIdx`

**潜在问题**：
- 如果 `jointNamesMJC` 的顺序和 MuJoCo 执行器的顺序不一致，映射可能错误
- 如果 `actuator2joint.findIndex` 找到的不是正确的执行器，映射会错误

### 3. 动作应用（main.js）

```javascript
for (let i = 0; i < mapping.numActions; i++) {
  const ctrlAdr = mapping.ctrl_adr_policy[i];  // 策略动作 i -> 执行器 ctrlAdr
  const targetJpos = actionTarget[i];  // 策略动作 i 的目标位置
  // 应用到执行器 ctrlAdr
  this.simulation.ctrl[ctrlAdr] = ctrlValue;
}
```

## 需要验证的关键点

### 1. MuJoCo 执行器顺序（从 g1.xml）
```
执行器 0:  left_hip_pitch
执行器 1:  left_hip_roll
执行器 2:  left_hip_yaw
执行器 3:  left_knee
执行器 4:  left_ankle_pitch
执行器 5:  left_ankle_roll
执行器 6:  right_hip_pitch  ← 右腿第一个
执行器 7:  right_hip_roll
执行器 8:  right_hip_yaw
执行器 9:  right_knee
执行器 10: right_ankle_pitch
执行器 11: right_ankle_roll
```

### 2. 策略关节顺序（policy_joint_names）
```
索引 0:  left_hip_pitch_joint
索引 1:  right_hip_pitch_joint  ← 右腿第一个
索引 3:  left_hip_roll_joint
索引 4:  right_hip_roll_joint
索引 6:  left_hip_yaw_joint
索引 7:  right_hip_yaw_joint
索引 9:  left_knee_joint
索引 10: right_knee_joint
索引 13: left_ankle_pitch_joint
索引 14: right_ankle_pitch_joint
索引 17: left_ankle_roll_joint
索引 18: right_ankle_roll_joint
```

### 3. 正确的映射应该是
- 策略动作[1]（right_hip_pitch）-> 执行器[6] ✓
- 策略动作[4]（right_hip_roll）-> 执行器[7] ✓
- 策略动作[7]（right_hip_yaw）-> 执行器[8] ✓
- 策略动作[10]（right_knee）-> 执行器[9] ✓
- 策略动作[14]（right_ankle_pitch）-> 执行器[10] ✓
- 策略动作[18]（right_ankle_roll）-> 执行器[11] ✓

## 已添加的调试日志

现在代码会输出：
1. **MuJoCo 关节名称顺序**（jointNamesMJC）
2. **策略关节名称顺序**（policy_joint_names）
3. **执行器到关节的映射**（actuator2joint）
4. **策略动作到执行器的映射**（ctrl_adr_policy）
5. **详细的映射信息**（包括每个关节的完整映射链）
6. **左右腿关节的专门对比**

## 下一步操作

1. **运行代码**：`npm run dev`
2. **打开浏览器控制台**（F12）
3. **加载 "G1 Locomotion (Gamepad)" 策略**
4. **查看 `[Joint Mapping Debug]` 日志**
5. **重点检查**：
   - 右腿关节的映射是否正确（应该映射到执行器 6-11）
   - 左腿关节的映射是否正确（应该映射到执行器 0-5）
   - 如果映射错误，记录错误的映射关系

## 可能的问题原因

1. **jointNamesMJC 顺序问题**：MuJoCo 模型中关节的顺序可能和执行器顺序不一致
2. **actuator2joint 构建问题**：执行器到关节的映射可能不正确
3. **findIndex 逻辑问题**：如果多个执行器对应同一个关节，`findIndex` 可能返回错误的索引

## 如果映射错误，修复方案

如果发现映射错误，需要：
1. 添加 `joint2motor_idx` 配置到 `loco_policy_29dof.json`
2. 修改 `configureJointMappings` 使用 `joint2motor_idx` 进行映射
3. 或者修复 `actuator2joint.findIndex` 的逻辑
