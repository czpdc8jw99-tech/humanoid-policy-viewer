# 关节映射详细分析

## 问题：左腿动，右腿不动

### 当前代码逻辑分析

`configureJointMappings` 函数的逻辑：
1. 按照 `policy_joint_names` 的顺序遍历
2. 对每个关节名称，在 MuJoCo 模型中查找对应的关节索引
3. 然后查找对应的执行器索引

**这个逻辑假设**：MuJoCo 模型中的关节名称和策略中的关节名称完全一致，且执行器顺序与策略关节顺序一致。

### 关键发现

**策略的关节顺序**（policy_joint_names）：
```
索引 0:  left_hip_pitch_joint
索引 1:  right_hip_pitch_joint  ← 右腿第一个关节
索引 2:  waist_yaw_joint
索引 3:  left_hip_roll_joint
索引 4:  right_hip_roll_joint   ← 右腿第二个关节
...
```

**MuJoCo 执行器顺序**（从 g1.xml）：
```
执行器 0:  left_hip_pitch
执行器 1:  left_hip_roll
执行器 2:  left_hip_yaw
执行器 3:  left_knee
执行器 4:  left_ankle_pitch
执行器 5:  left_ankle_roll
执行器 6:  right_hip_pitch      ← 右腿第一个执行器
执行器 7:  right_hip_roll       ← 右腿第二个执行器
...
```

**LocoMode.yaml 中的 joint2motor_idx**：
```
[0, 6, 12, ...]  ← 策略[0] -> 执行器[0], 策略[1] -> 执行器[6], 策略[2] -> 执行器[12]
```

### 问题分析

当前代码**没有使用 `joint2motor_idx`**，而是直接按照关节名称查找。

**如果代码正确工作**：
- 策略 action[1]（right_hip_pitch）-> 查找 "right_hip_pitch_joint" -> 找到执行器[6] ✓

**但如果代码错误工作**（可能的原因）：
- 策略 action[1]（right_hip_pitch）-> 查找 "right_hip_pitch_joint" -> 但可能找到错误的执行器 ✗

### 需要验证的点

1. **MuJoCo 模型中的关节名称顺序**：`jointNamesMJC` 的顺序是什么？
2. **执行器到关节的映射**：`actuator2joint` 的映射是否正确？
3. **策略动作到执行器的映射**：`ctrl_adr_policy` 的值是什么？

### 解决方案

**方案 1：添加 joint2motor_idx 支持（推荐）**
- 在配置文件中添加 `joint2motor_idx`
- 修改代码使用这个映射

**方案 2：验证当前映射是否正确**
- 添加调试日志，输出实际的映射关系
- 检查是否有映射错误

### 立即行动

需要添加调试日志来验证：
1. `ctrl_adr_policy` 的实际值
2. 策略动作索引到执行器索引的映射关系
3. 左右腿关节的映射是否正确
