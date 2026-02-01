# 左右腿不对称问题根本原因分析

## 诊断结果总结

1. **actionReordered 对称性**: 94.44% ✅ (相对对称)
2. **当前位置对称性**: 86.97% ⚠️ (不太对称)
3. **Kp 对称性**: 100% ✅ (完全对称)
4. **控制值对称性**: 48.42% ❌ (严重不对称)

## 关键发现

### 1. 目标位置差值（targetJpos - currentJpos）相反

**左腿差值**: [-0.1264, 0.0376, -0.0126, -0.0363, -0.1379, 0.0450]
**右腿差值**: [0.1067, -0.0015, 0.0179, 0.1439, 0.0295, -0.1150]

**第一个关节（hip_pitch）**：
- 左腿: -0.1264（目标 < 当前位置，需要向后）
- 右腿: 0.1067（目标 > 当前位置，需要向前）

**这是相反的！** 导致：
- 左腿扭矩: -23.13（负值，向后）
- 右腿扭矩: 25.03（正值，向前）

### 2. 当前位置不对称（87%）

**左腿当前位置**: [-0.2543, 0.2974, -0.1044, 0.2842, -0.6376, -0.0419]
**右腿当前位置**: [-0.4350, -0.0795, -0.0207, 0.7037, -0.3608, -0.2628]

关键差异：
- **hip_pitch**: 左 -0.2543 vs 右 -0.4350（差异 0.18）
- **hip_roll**: 左 0.2974 vs 右 -0.0795（差异 0.38，符号相反！）
- **knee**: 左 0.2842 vs 右 0.7037（差异 0.42）

### 3. actionReordered 虽然对称，但差值计算后产生相反方向

**左腿 actionReordered**: [-0.3807, 0.3350, -0.1170, 0.2479, -0.7756, 0.0031]
**右腿 actionReordered**: [-0.3282, -0.0810, -0.0029, 0.8475, -0.3313, -0.3778]

虽然绝对值相对对称（94%），但由于当前位置不对称，差值计算后：
- 左腿 hip_pitch 差值: -0.1264（负）
- 右腿 hip_pitch 差值: 0.1067（正）

## 问题根源

### 根本原因：初始状态不对称

1. **初始关节位置设置可能不对称**
   - 在 `reloadPolicy` 中设置 `default_joint_pos` 时，可能左右腿的初始位置不一致
   - 或者初始状态设置后，由于重力或其他因素导致左右腿位置偏移

2. **当前位置不对称导致差值相反**
   - 即使 `actionReordered` 相对对称（94%）
   - 但由于当前位置不对称（87%）
   - 差值计算后产生了相反的方向

3. **PD 控制放大不对称**
   - Kp = 200（hip_pitch 和 knee）
   - 差值差异 0.23（-0.1264 vs 0.1067）
   - 扭矩差异 = 200 * 0.23 = 46（与实际观察的 48 差异一致）

## 需要检查的代码位置

### 1. 初始状态设置 (`mujocoUtils.js:412-428`)

```javascript
// Set initial joint positions to default_joint_pos if available (for loco policy)
if (this.defaultJposPolicy && this.qpos_adr_policy && this.qpos_adr_policy.length > 0) {
  for (let i = 0; i < this.numActions; i++) {
    const qposAdr = this.qpos_adr_policy[i];
    if (qposAdr >= 0 && qposAdr < qpos.length) {
      qpos[qposAdr] = this.defaultJposPolicy[i];
    }
  }
}
```

**问题**：这里使用的是 `qpos_adr_policy`（策略顺序），但应该使用 `qpos_adr_motor`（电机顺序）吗？

### 2. default_joint_pos 的对称性

需要检查 `loco_policy_29dof.json` 中的 `default_joint_pos` 是否左右对称。

### 3. 观察向量构建时的状态读取

在 `readPolicyState()` 中，如果使用 `joint2motorIdx` 重新排序，需要确保读取的状态是正确的。

## 可能的问题

1. **初始状态设置顺序错误**
   - 使用 `qpos_adr_policy` 设置初始位置，但实际应该使用 `qpos_adr_motor`？
   - 或者 `default_joint_pos` 本身就是策略顺序的，但需要重新排序？

2. **default_joint_pos 不对称**
   - 配置文件中的 `default_joint_pos` 可能本身就不对称

3. **状态读取顺序错误**
   - `readPolicyState()` 中读取状态时，可能顺序不对

## 下一步检查

1. 检查 `loco_policy_29dof.json` 中的 `default_joint_pos` 是否对称
2. 检查初始状态设置时是否使用了正确的地址数组
3. 检查 `readPolicyState()` 中状态读取的顺序是否正确
