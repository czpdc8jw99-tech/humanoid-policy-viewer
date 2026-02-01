# 检查 default_joint_pos 对称性

## 配置文件中的 default_joint_pos

根据 `loco_policy_29dof.json`：
```json
"default_joint_pos": [
  -0.2, -0.2, 0.0,    // 0: left_hip_pitch, 1: right_hip_pitch, 2: waist_yaw
  0.0, 0.0, 0.0,      // 3: left_hip_roll, 4: right_hip_roll, 5: waist_roll
  0.0, 0.0, 0.0,      // 6: left_hip_yaw, 7: right_hip_yaw, 8: waist_pitch
  0.42, 0.42,         // 9: left_knee, 10: right_knee
  0.35, 0.35,         // 11: left_shoulder_pitch, 12: right_shoulder_pitch
  -0.23, -0.23,       // 13: left_ankle_pitch, 14: right_ankle_pitch
  0.18, -0.18,        // 15: left_shoulder_roll, 16: right_shoulder_roll
  0.0, 0.0,           // 17: left_ankle_roll, 18: right_ankle_roll
  0.0, 0.0,           // 19: left_shoulder_yaw, 20: right_shoulder_yaw
  0.87, 0.87,         // 21: left_elbow, 22: right_elbow
  0.0, 0.0,           // 23: left_wrist_roll, 24: right_wrist_roll
  0.0, 0.0,           // 25: left_wrist_pitch, 26: right_wrist_pitch
  0.0, 0.0            // 27: left_wrist_yaw, 28: right_wrist_yaw
]
```

## 左右腿关节的 default_joint_pos

**左腿**（策略索引）：
- 0: left_hip_pitch = -0.2
- 3: left_hip_roll = 0.0
- 6: left_hip_yaw = 0.0
- 9: left_knee = 0.42
- 13: left_ankle_pitch = -0.23
- 17: left_ankle_roll = 0.0

**右腿**（策略索引）：
- 1: right_hip_pitch = -0.2 ✅ 对称
- 4: right_hip_roll = 0.0 ✅ 对称
- 7: right_hip_yaw = 0.0 ✅ 对称
- 10: right_knee = 0.42 ✅ 对称
- 14: right_ankle_pitch = -0.23 ✅ 对称
- 18: right_ankle_roll = 0.0 ✅ 对称

**结论**：`default_joint_pos` 本身是对称的！

## 问题可能在于

1. **初始状态设置后，由于物理模拟，左右腿位置变得不对称**
   - 即使初始设置是对称的，由于重力、碰撞等因素，位置会偏移
   - 这可能导致后续的观察向量不对称

2. **观察向量构建时的状态读取**
   - `JointPosRel` 使用 `(q - q0)` 计算相对位置
   - 如果 `q`（当前关节位置）不对称，即使 `q0`（default_joint_pos）对称，结果也会不对称

3. **策略输出的动作本身不对称**
   - 即使观察向量对称，策略网络本身可能输出不对称的动作
   - 这可能是策略训练的问题，而不是代码实现的问题

## 下一步检查

请运行以下脚本检查观察向量的对称性：

```javascript
// 检查观察向量对称性
const demo = window.demo;
const runner = demo.policyRunners[0];
if (runner) {
  runner._obsLogged = false; // 强制重新记录
  const state = demo.readPolicyState();
  runner.buildObservation(state);
}
```

查看输出的观察向量对称性日志，特别关注：
- `JointPosRel` 左右腿的值是否对称？
- `JointVel` 左右腿的值是否对称？
- `PrevActions` 左右腿的值是否对称？
