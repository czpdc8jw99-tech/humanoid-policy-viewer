# 关节映射问题诊断

## 问题描述
- 左腿在走路，右腿不动
- 机器人站不住

## 根本原因

### 问题：缺少 `joint2motor_idx` 映射

**策略的关节顺序**（policy_joint_names，策略输出的动作索引）：
```
0:  left_hip_pitch_joint
1:  right_hip_pitch_joint
2:  waist_yaw_joint
3:  left_hip_roll_joint
4:  right_hip_roll_joint
5:  waist_roll_joint
6:  left_hip_yaw_joint
7:  right_hip_yaw_joint
8:  waist_pitch_joint
9:  left_knee_joint
10: right_knee_joint
11: left_shoulder_pitch_joint
12: right_shoulder_pitch_joint
13: left_ankle_pitch_joint
14: right_ankle_pitch_joint
15: left_shoulder_roll_joint
16: right_shoulder_roll_joint
17: left_ankle_roll_joint
18: right_ankle_roll_joint
19: left_shoulder_yaw_joint
20: right_shoulder_yaw_joint
21: left_elbow_joint
22: right_elbow_joint
23: left_wrist_roll_joint
24: right_wrist_roll_joint
25: left_wrist_pitch_joint
26: right_wrist_pitch_joint
27: left_wrist_yaw_joint
28: right_wrist_yaw_joint
```

**MuJoCo 执行器顺序**（从 g1.xml，执行器索引）：
```
0:  left_hip_pitch
1:  left_hip_roll
2:  left_hip_yaw
3:  left_knee
4:  left_ankle_pitch
5:  left_ankle_roll
6:  right_hip_pitch
7:  right_hip_roll
8:  right_hip_yaw
9:  right_knee
10: right_ankle_pitch
11: right_ankle_roll
12: waist_yaw
13: waist_roll
14: waist_pitch
15: left_shoulder_pitch
16: left_shoulder_roll
17: left_shoulder_yaw
18: left_elbow
19: left_wrist_roll
20: left_wrist_pitch
21: left_wrist_yaw
22: right_shoulder_pitch
23: right_shoulder_roll
24: right_shoulder_yaw
25: right_elbow
26: right_wrist_roll
27: right_wrist_pitch
28: right_wrist_yaw
```

**LocoMode.yaml 中的 `joint2motor_idx` 映射**（策略动作索引 -> 执行器索引）：
```yaml
joint2motor_idx: [0, 6, 12,    # 策略[0]=left_hip_pitch -> 执行器[0], 策略[1]=right_hip_pitch -> 执行器[6], 策略[2]=waist_yaw -> 执行器[12]
                  1, 7, 13,    # 策略[3]=left_hip_roll -> 执行器[1], 策略[4]=right_hip_roll -> 执行器[7], 策略[5]=waist_roll -> 执行器[13]
                  2, 8, 14,    # 策略[6]=left_hip_yaw -> 执行器[2], 策略[7]=right_hip_yaw -> 执行器[8], 策略[8]=waist_pitch -> 执行器[14]
                  3, 9,        # 策略[9]=left_knee -> 执行器[3], 策略[10]=right_knee -> 执行器[9]
                  15, 22,      # 策略[11]=left_shoulder_pitch -> 执行器[15], 策略[12]=right_shoulder_pitch -> 执行器[22]
                  4, 10,       # 策略[13]=left_ankle_pitch -> 执行器[4], 策略[14]=right_ankle_pitch -> 执行器[10]
                  16, 23,      # 策略[15]=left_shoulder_roll -> 执行器[16], 策略[16]=right_shoulder_roll -> 执行器[23]
                  5, 11,       # 策略[17]=left_ankle_roll -> 执行器[5], 策略[18]=right_ankle_roll -> 执行器[11]
                  18, 25,      # 策略[19]=left_shoulder_yaw -> 执行器[17], 策略[20]=right_shoulder_yaw -> 执行器[24]
                  18, 25,      # 策略[21]=left_elbow -> 执行器[18], 策略[22]=right_elbow -> 执行器[25]
                  19, 26,      # 策略[23]=left_wrist_roll -> 执行器[19], 策略[24]=right_wrist_roll -> 执行器[26]
                  20, 27,      # 策略[25]=left_wrist_pitch -> 执行器[20], 策略[26]=right_wrist_pitch -> 执行器[27]
                  21, 28]      # 策略[27]=left_wrist_yaw -> 执行器[21], 策略[28]=right_wrist_yaw -> 执行器[28]
```

### 当前代码的问题

**当前实现**（`mujocoUtils.js` 的 `configureJointMappings`）：
- 直接按照 `policy_joint_names` 的顺序查找关节
- 找到关节后，直接使用对应的执行器索引
- **没有使用 `joint2motor_idx` 映射**

**错误示例**：
- 策略输出动作[0]（left_hip_pitch）-> 直接映射到执行器[0] ✓（碰巧正确）
- 策略输出动作[1]（right_hip_pitch）-> 直接映射到执行器[6] ✗（应该是执行器[6]，但代码可能映射到执行器[1]）

**实际发生的情况**：
- 策略输出的动作是按照策略的关节顺序（policy_joint_names）
- 但代码直接按照这个顺序查找 MuJoCo 中的关节，然后使用找到的执行器
- 由于 MuJoCo 的执行器顺序和策略的关节顺序不同，导致映射错误

### 具体错误映射示例

假设策略输出：
- action[0] = 0.1 (left_hip_pitch)
- action[1] = 0.2 (right_hip_pitch)

**正确的映射**（使用 joint2motor_idx）：
- action[0] -> 执行器[0] (left_hip_pitch) ✓
- action[1] -> 执行器[6] (right_hip_pitch) ✓

**当前错误的映射**（直接按名称顺序）：
- action[0] -> 执行器[0] (left_hip_pitch) ✓（碰巧正确）
- action[1] -> 执行器[1] (left_hip_roll) ✗（错误！应该是 right_hip_pitch）

这就是为什么左腿能动（因为左腿关节在策略顺序中靠前），但右腿不动（因为右腿的动作被错误地映射到了左腿的其他关节）。

## 解决方案

需要在 `loco_policy_29dof.json` 中添加 `joint2motor_idx` 配置，并在 `mujocoUtils.js` 中实现映射逻辑。

### 步骤 1：添加 joint2motor_idx 到配置文件

在 `loco_policy_29dof.json` 中添加：
```json
"joint2motor_idx": [0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

### 步骤 2：修改 mujocoUtils.js 使用 joint2motor_idx

在 `configureJointMappings` 和 `configureJointMappingsWithPrefix` 中：
1. 检查配置中是否有 `joint2motor_idx`
2. 如果有，使用它来映射策略动作索引到执行器索引
3. 如果没有，使用当前的直接映射方式（向后兼容）

### 步骤 3：修改动作应用逻辑

在 `main.js` 中应用动作时，如果存在 `joint2motor_idx`，需要先重排动作数组。
