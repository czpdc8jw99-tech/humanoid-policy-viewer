# 关节顺序对比

## 原始 Python JOINT_NAMES_29（scripts/export_tracking_motions.py）

```python
JOINT_NAMES_29 = [
    "left_hip_pitch_joint",      # 0
    "left_hip_roll_joint",       # 1
    "left_hip_yaw_joint",        # 2
    "left_knee_joint",           # 3
    "left_ankle_pitch_joint",    # 4
    "left_ankle_roll_joint",     # 5
    "right_hip_pitch_joint",     # 6
    "right_hip_roll_joint",      # 7
    "right_hip_yaw_joint",       # 8
    "right_knee_joint",          # 9
    "right_ankle_pitch_joint",   # 10
    "right_ankle_roll_joint",    # 11
    "waist_yaw_joint",           # 12
    "waist_roll_joint",          # 13
    "waist_pitch_joint",         # 14
    "left_shoulder_pitch_joint", # 15
    "left_shoulder_roll_joint",  # 16
    "left_shoulder_yaw_joint",   # 17
    "left_elbow_joint",          # 18
    "left_wrist_roll_joint",     # 19
    "left_wrist_pitch_joint",    # 20
    "left_wrist_yaw_joint",      # 21
    "right_shoulder_pitch_joint",# 22
    "right_shoulder_roll_joint", # 23
    "right_shoulder_yaw_joint",  # 24
    "right_elbow_joint",         # 25
    "right_wrist_roll_joint",    # 26
    "right_wrist_pitch_joint",   # 27
    "right_wrist_yaw_joint"      # 28
]
```

## 我们的 policy_joint_names（loco_policy_29dof.json）

```json
[
  "left_hip_pitch_joint",    // 0 ✅
  "right_hip_pitch_joint",   // 1 ❌ 应该是 left_hip_roll_joint (1)
  "waist_yaw_joint",         // 2 ❌ 应该是 left_hip_yaw_joint (2)
  "left_hip_roll_joint",     // 3 ❌ 应该是 left_knee_joint (3)
  "right_hip_roll_joint",    // 4 ❌ 应该是 left_ankle_pitch_joint (4)
  "waist_roll_joint",        // 5 ❌ 应该是 left_ankle_roll_joint (5)
  "left_hip_yaw_joint",      // 6 ❌ 应该是 right_hip_pitch_joint (6)
  "right_hip_yaw_joint",     // 7 ❌ 应该是 right_hip_roll_joint (7)
  "waist_pitch_joint",       // 8 ❌ 应该是 right_hip_yaw_joint (8)
  "left_knee_joint",         // 9 ❌ 应该是 right_knee_joint (9)
  "right_knee_joint",        // 10 ❌ 应该是 right_ankle_pitch_joint (10)
  ...
]
```

## 原始 Python joint2motor_idx

```yaml
joint2motor_idx: [0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28]
```

**含义**：
- 策略关节 0 → 机器人关节 0（left_hip_pitch）
- 策略关节 1 → 机器人关节 6（right_hip_pitch）
- 策略关节 2 → 机器人关节 12（waist_yaw）

**反推策略关节顺序**：
- 策略关节 0：机器人关节 0 = left_hip_pitch ✅
- 策略关节 1：机器人关节 6 = right_hip_pitch ✅
- 策略关节 2：机器人关节 12 = waist_yaw ✅
- 策略关节 3：机器人关节 1 = left_hip_roll ✅
- 策略关节 4：机器人关节 7 = right_hip_roll ✅
- 策略关节 5：机器人关节 13 = waist_roll ✅

**结论**：原始 Python 的策略关节顺序是：
```
0: left_hip_pitch
1: right_hip_pitch
2: waist_yaw
3: left_hip_roll
4: right_hip_roll
5: waist_roll
6: left_hip_yaw
7: right_hip_yaw
8: waist_pitch
9: left_knee
10: right_knee
...
```

**这与我们的 policy_joint_names 顺序一致！** ✅

## 验证结果

✅ **关节顺序正确**：我们的 `policy_joint_names` 顺序与原始 Python 的策略关节顺序一致

⚠️ **但需要确认**：我们的映射是否正确应用了 `joint2motor_idx`？
