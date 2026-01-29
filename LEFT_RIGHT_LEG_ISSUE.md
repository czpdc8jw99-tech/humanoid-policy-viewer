# 左右腿问题诊断和修复方案

## 问题描述
- 左腿在走路，右腿不动
- 机器人站不住

## 可能的原因

### 1. 关节映射顺序问题（最可能）

**策略输出的动作顺序**（policy_joint_names）：
- 索引 0: left_hip_pitch_joint
- 索引 1: right_hip_pitch_joint ← **右腿第一个关节**
- 索引 3: left_hip_roll_joint
- 索引 4: right_hip_roll_joint ← **右腿第二个关节**

**MuJoCo 执行器顺序**（从 g1.xml）：
- 执行器 0: left_hip_pitch
- 执行器 1: left_hip_roll
- 执行器 2: left_hip_yaw
- 执行器 3: left_knee
- 执行器 4: left_ankle_pitch
- 执行器 5: left_ankle_roll
- 执行器 6: right_hip_pitch ← **右腿第一个执行器**
- 执行器 7: right_hip_roll ← **右腿第二个执行器**

**当前代码逻辑**：
- 按照 `policy_joint_names` 的顺序查找关节名称
- 找到关节后，查找对应的执行器索引

**如果映射正确**：
- 策略 action[1]（right_hip_pitch）-> 查找 "right_hip_pitch_joint" -> 执行器[6] ✓

**如果映射错误**：
- 可能的原因：`actuator2joint.findIndex` 返回了错误的索引
- 或者：关节名称不匹配

### 2. 缺少 joint2motor_idx 映射

原始 Python 实现使用 `joint2motor_idx` 来映射策略动作到执行器：
```yaml
joint2motor_idx: [0, 6, 12, 1, 7, 13, 2, 8, 14, ...]
```

这意味着：
- 策略 action[0] -> 执行器[0]
- 策略 action[1] -> 执行器[6]（不是执行器[1]！）
- 策略 action[2] -> 执行器[12]

**当前代码没有使用这个映射**，而是直接按照关节名称查找。

## 已添加的调试日志

我已经在 `mujocoUtils.js` 中添加了调试日志，会在加载 loco 策略时输出：
1. 策略关节名称列表
2. `ctrl_adr_policy` 映射（策略动作索引 -> 执行器索引）
3. 详细的映射信息（包括每个关节的 PD 参数和默认位置）

## 验证步骤

1. **打开浏览器控制台**
2. **加载 "G1 Locomotion (Gamepad)" 策略**
3. **查看控制台输出**，找到 `[Joint Mapping Debug]` 开头的日志
4. **检查映射关系**：
   - `policyIdx: 1`（right_hip_pitch）应该映射到 `actuatorIdx: 6`
   - `policyIdx: 4`（right_hip_roll）应该映射到 `actuatorIdx: 7`
   - 如果映射错误，这就是问题所在

## 如果映射错误，修复方案

### 方案 A：使用 joint2motor_idx（推荐）

1. 在 `loco_policy_29dof.json` 中添加：
```json
"joint2motor_idx": [0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

2. 修改 `mujocoUtils.js` 的 `configureJointMappings` 函数，使用 `joint2motor_idx` 来映射

### 方案 B：修复当前映射逻辑

如果当前映射逻辑有问题，需要修复 `actuator2joint.findIndex` 的逻辑

## 下一步

**请先运行代码，查看控制台输出，然后告诉我映射关系是否正确。**

如果映射错误，我会立即修复。
