# 关节名称不匹配问题分析

## 错误信息
```
Error: Joint "waist_yaw" not found in MuJoCo model
```

## 问题根源

### 1. MuJoCo模型中的实际关节名称（g1.xml）

从 `public/examples/scenes/g1/g1.xml` 文件中可以看到，所有关节名称都带有 `_joint` 后缀：

```xml
<joint name="waist_yaw_joint" class="waist_yaw"/>
<joint name="left_hip_yaw_joint" class="hip_yaw"/>
<joint name="right_hip_yaw_joint" class="hip_yaw"/>
<joint name="waist_roll_joint" class="waist_roll"/>
<joint name="waist_pitch_joint" class="waist_pitch"/>
<joint name="left_hip_pitch_joint" class="hip_pitch"/>
<joint name="right_hip_pitch_joint" class="hip_pitch"/>
<joint name="left_hip_roll_joint" class="hip_roll"/>
<joint name="right_hip_roll_joint" class="hip_roll"/>
<joint name="left_knee_joint" class="knee"/>
<joint name="right_knee_joint" class="knee"/>
<joint name="left_ankle_pitch_joint" class="ankle_pitch"/>
<joint name="right_ankle_pitch_joint" class="ankle_pitch"/>
<joint name="left_ankle_roll_joint" class="ankle_roll"/>
<joint name="right_ankle_roll_joint" class="ankle_roll"/>
<joint name="left_shoulder_pitch_joint" class="shoulder_pitch"/>
<joint name="right_shoulder_pitch_joint" class="shoulder_pitch"/>
<joint name="left_shoulder_roll_joint" class="shoulder_roll"/>
<joint name="right_shoulder_roll_joint" class="shoulder_roll"/>
<joint name="left_shoulder_yaw_joint" class="shoulder_yaw"/>
<joint name="right_shoulder_yaw_joint" class="shoulder_yaw"/>
<joint name="left_elbow_joint" class="elbow"/>
<joint name="right_elbow_joint" class="elbow"/>
<joint name="left_wrist_roll_joint" class="wrist_roll"/>
<joint name="right_wrist_roll_joint" class="wrist_roll"/>
<joint name="left_wrist_pitch_joint" class="wrist_pitch"/>
<joint name="right_wrist_pitch_joint" class="wrist_pitch"/>
<joint name="left_wrist_yaw_joint" class="wrist_yaw"/>
<joint name="right_wrist_yaw_joint" class="wrist_yaw"/>
```

### 2. tracking_policy_amass.json 中的关节名称（正确）

```json
"policy_joint_names": [
  "left_hip_pitch_joint",
  "right_hip_pitch_joint",
  "waist_yaw_joint",        // ✅ 有 _joint 后缀
  "left_hip_roll_joint",
  "right_hip_roll_joint",
  "waist_roll_joint",
  "left_hip_yaw_joint",
  "right_hip_yaw_joint",
  "waist_pitch_joint",
  ...
]
```

### 3. loco_policy_29dof.json 中的关节名称（错误）

```json
"policy_joint_names": [
  "waist_yaw",              // ❌ 缺少 _joint 后缀
  "left_hip_yaw",           // ❌ 缺少 _joint 后缀
  "right_hip_yaw",          // ❌ 缺少 _joint 后缀
  "waist_roll",             // ❌ 缺少 _joint 后缀
  "waist_pitch",            // ❌ 缺少 _joint 后缀
  ...
]
```

## 对比表

| loco_policy_29dof.json (错误) | tracking_policy_amass.json (正确) | MuJoCo XML (实际) |
|-------------------------------|-----------------------------------|-------------------|
| `waist_yaw`                   | `waist_yaw_joint`                 | `waist_yaw_joint` |
| `left_hip_yaw`                | `left_hip_yaw_joint`              | `left_hip_yaw_joint` |
| `right_hip_yaw`               | `right_hip_yaw_joint`             | `right_hip_yaw_joint` |
| `waist_roll`                  | `waist_roll_joint`                | `waist_roll_joint` |
| `waist_pitch`                 | `waist_pitch_joint`               | `waist_pitch_joint` |
| `left_hip_pitch`              | `left_hip_pitch_joint`            | `left_hip_pitch_joint` |
| `right_hip_pitch`             | `right_hip_pitch_joint`           | `right_hip_pitch_joint` |
| `left_hip_roll`               | `left_hip_roll_joint`             | `left_hip_roll_joint` |
| `right_hip_roll`              | `right_hip_roll_joint`             | `right_hip_roll_joint` |
| `left_knee`                   | `left_knee_joint`                 | `left_knee_joint` |
| `right_knee`                  | `right_knee_joint`                | `right_knee_joint` |
| `left_ankle_pitch`            | `left_ankle_pitch_joint`          | `left_ankle_pitch_joint` |
| `right_ankle_pitch`           | `right_ankle_pitch_joint`         | `right_ankle_pitch_joint` |
| `left_ankle_roll`             | `left_ankle_roll_joint`           | `left_ankle_roll_joint` |
| `right_ankle_roll`            | `right_ankle_roll_joint`          | `right_ankle_roll_joint` |
| `left_shoulder_pitch`         | `left_shoulder_pitch_joint`      | `left_shoulder_pitch_joint` |
| `right_shoulder_pitch`        | `right_shoulder_pitch_joint`      | `right_shoulder_pitch_joint` |
| `left_shoulder_roll`          | `left_shoulder_roll_joint`        | `left_shoulder_roll_joint` |
| `right_shoulder_roll`         | `right_shoulder_roll_joint`       | `right_shoulder_roll_joint` |
| `left_shoulder_yaw`           | `left_shoulder_yaw_joint`         | `left_shoulder_yaw_joint` |
| `right_shoulder_yaw`          | `right_shoulder_yaw_joint`        | `right_shoulder_yaw_joint` |
| `left_elbow`                  | `left_elbow_joint`                | `left_elbow_joint` |
| `right_elbow`                 | `right_elbow_joint`               | `right_elbow_joint` |
| `left_wrist_yaw`              | `left_wrist_yaw_joint`            | `left_wrist_yaw_joint` |
| `right_wrist_yaw`             | `right_wrist_yaw_joint`           | `right_wrist_yaw_joint` |
| `left_wrist_pitch`            | `left_wrist_pitch_joint`          | `left_wrist_pitch_joint` |
| `right_wrist_pitch`           | `right_wrist_pitch_joint`         | `right_wrist_pitch_joint` |
| `left_wrist_roll`             | `left_wrist_roll_joint`           | `left_wrist_roll_joint` |
| `right_wrist_roll`            | `right_wrist_roll_joint`          | `right_wrist_roll_joint` |

## 解决方案

需要在 `loco_policy_29dof.json` 中为所有关节名称添加 `_joint` 后缀。

### 需要修改的关节名称列表（共29个）

1. `waist_yaw` → `waist_yaw_joint`
2. `left_hip_yaw` → `left_hip_yaw_joint`
3. `right_hip_yaw` → `right_hip_yaw_joint`
4. `waist_roll` → `waist_roll_joint`
5. `left_hip_roll` → `left_hip_roll_joint`
6. `right_hip_roll` → `right_hip_roll_joint`
7. `waist_pitch` → `waist_pitch_joint`
8. `left_hip_pitch` → `left_hip_pitch_joint`
9. `right_hip_pitch` → `right_hip_pitch_joint`
10. `left_knee` → `left_knee_joint`
11. `right_knee` → `right_knee_joint`
12. `left_ankle_pitch` → `left_ankle_pitch_joint`
13. `right_ankle_pitch` → `right_ankle_pitch_joint`
14. `left_ankle_roll` → `left_ankle_roll_joint`
15. `right_ankle_roll` → `right_ankle_roll_joint`
16. `left_shoulder_pitch` → `left_shoulder_pitch_joint`
17. `right_shoulder_pitch` → `right_shoulder_pitch_joint`
18. `left_shoulder_roll` → `left_shoulder_roll_joint`
19. `right_shoulder_roll` → `right_shoulder_roll_joint`
20. `left_shoulder_yaw` → `left_shoulder_yaw_joint`
21. `right_shoulder_yaw` → `right_shoulder_yaw_joint`
22. `left_elbow` → `left_elbow_joint`
23. `right_elbow` → `right_elbow_joint`
24. `left_wrist_yaw` → `left_wrist_yaw_joint`
25. `right_wrist_yaw` → `right_wrist_yaw_joint`
26. `left_wrist_pitch` → `left_wrist_pitch_joint`
27. `right_wrist_pitch` → `right_wrist_pitch_joint`
28. `left_wrist_roll` → `left_wrist_roll_joint`
29. `right_wrist_roll` → `right_wrist_roll_joint`

## 注意事项

1. **关节顺序**：虽然名称需要修改，但关节的顺序应该保持不变，因为 `joint2motor_idx` 映射依赖于这个顺序。

2. **参考来源**：`loco_policy_29dof.json` 的关节名称可能来自 FSMDeploy_G1 的 Python 配置，但该配置可能使用了不同的命名约定（不带 `_joint` 后缀）。在 Web 版本中，必须使用 MuJoCo XML 文件中的实际关节名称。

3. **验证方法**：修改后，可以通过以下方式验证：
   - 检查 `configureJointMappings` 函数是否成功找到所有关节
   - 确认没有抛出 "Joint not found" 错误
