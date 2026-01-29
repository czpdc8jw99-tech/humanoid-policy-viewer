# 关节映射检查清单

## 需要验证的关键点

### 1. 策略关节顺序（policy_joint_names）
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

### 2. 动作应用逻辑
```javascript
for (let i = 0; i < this.numActions; i++) {
  const ctrl_adr = this.ctrl_adr_policy[i];
  this.simulation.ctrl[ctrl_adr] = ctrlValue;
}
```

**关键问题**：`action[i]` 被应用到执行器 `ctrl_adr_policy[i]`

### 3. 需要检查的映射关系

对于左右腿的对应关节，检查：
- `ctrl_adr_policy[left_idx]` 和 `ctrl_adr_policy[right_idx]` 是否对应正确的左右腿执行器
- `qpos_adr_policy[left_idx]` 和 `qpos_adr_policy[right_idx]` 是否对应正确的左右腿关节
- `qvel_adr_policy[left_idx]` 和 `qvel_adr_policy[right_idx]` 是否对应正确的左右腿关节

### 4. 可能的问题

如果 `actuator2joint.findIndex` 找到的执行器索引不对，或者 MuJoCo 模型中的执行器顺序和策略中的关节顺序不一致，就会导致：
- 左腿的动作被应用到右腿的执行器
- 右腿的动作被应用到左腿的执行器
- 或者动作被应用到错误的关节
