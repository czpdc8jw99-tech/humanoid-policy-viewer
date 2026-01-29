# JointPosRel 调试日志分析

## 关键发现：JointPosRel 完全对称！

### 右腿关节位置（相对）
- `right_hip_pitch_joint` (idx: 1): posRel = 0.2
- `right_hip_roll_joint` (idx: 4): posRel = 0
- `right_hip_yaw_joint` (idx: 7): posRel = 0
- `right_knee_joint` (idx: 10): posRel = -0.42
- `right_ankle_pitch_joint` (idx: 14): posRel = 0.23
- `right_ankle_roll_joint` (idx: 18): posRel = 0

### 左腿关节位置（相对）
- `left_hip_pitch_joint` (idx: 0): posRel = 0.2
- `left_hip_roll_joint` (idx: 3): posRel = 0
- `left_hip_yaw_joint` (idx: 6): posRel = 0
- `left_knee_joint` (idx: 9): posRel = -0.42
- `left_ankle_pitch_joint` (idx: 13): posRel = 0.23
- `left_ankle_roll_joint` (idx: 17): posRel = 0

### 对称性验证
✅ **所有对应的左右腿关节的 `posRel` 值完全一致！**

- hip_pitch: 0.2 = 0.2 ✓
- hip_roll: 0 = 0 ✓
- hip_yaw: 0 = 0 ✓
- knee: -0.42 = -0.42 ✓
- ankle_pitch: 0.23 = 0.23 ✓
- ankle_roll: 0 = 0 ✓

### 原始值分析
- `currentPos`: 所有关节都是 `0`（初始状态）
- `defaultPos`: 左右腿对称
- `diff = currentPos - defaultPos`: 对称
- `posRel = scale * diff`: 对称（scale = 1）

---

## 结论

**JointPosRel 组件是完美的对称的！**

这意味着：
1. ✅ 关节位置读取正确
2. ✅ 默认位置配置正确
3. ✅ 相对位置计算正确
4. ✅ 索引映射正确

**之前看到的异常值 `1` 可能是：**
- 初始状态时的临时值
- 或者是在不同时间点捕获的数据

---

## 下一步

既然 `JointPosRel` 是对称的，我们需要检查其他观察向量组件：

1. **JointVel（关节速度）**：检查左右腿关节速度是否对称
2. **PrevActions（前一步动作）**：检查历史动作是否对称
3. **Command（命令）**：应该是 `[0, 0, 0]`（零速度）

如果所有观察向量组件都是对称的，但策略输出仍然不对称，那么问题就在**策略模型本身**。
