# qvel 调试日志分析

## 关键发现：初始状态所有关节速度为 0

### Raw qvel Values and Addresses

**左腿关节**：
- `left_hip_pitch_joint` (idx: 0): qvelAdr: 6, rawQvel: 0, jointVel: 0
- `left_hip_roll_joint` (idx: 3): qvelAdr: 7, rawQvel: 0, jointVel: 0
- `left_hip_yaw_joint` (idx: 6): qvelAdr: 8, rawQvel: 0, jointVel: 0
- `left_knee_joint` (idx: 9): qvelAdr: 9, rawQvel: 0, jointVel: 0
- `left_ankle_pitch_joint` (idx: 13): qvelAdr: 10, rawQvel: 0, jointVel: 0
- `left_ankle_roll_joint` (idx: 17): qvelAdr: 11, rawQvel: 0, jointVel: 0

**右腿关节**：
- `right_hip_pitch_joint` (idx: 1): qvelAdr: 12, rawQvel: 0, jointVel: 0
- `right_hip_roll_joint` (idx: 4): qvelAdr: 13, rawQvel: 0, jointVel: 0
- `right_hip_yaw_joint` (idx: 7): qvelAdr: 14, rawQvel: 0, jointVel: 0
- `right_knee_joint` (idx: 10): qvelAdr: 15, rawQvel: 0, jointVel: 0
- `right_ankle_pitch_joint` (idx: 14): qvelAdr: 16, rawQvel: 0, jointVel: 0
- `right_ankle_roll_joint` (idx: 18): qvelAdr: 17, rawQvel: 0, jointVel: 0

### 关键观察

1. ✅ **所有关节的 `rawQvel` 都是 `0`** - 这是初始状态
2. ✅ **qvelAdr 映射看起来是正确的** - 左右腿的地址是连续的（6-11 vs 12-17）
3. ⚠️ **这与之前看到的不对称速度不一致** - 之前看到 left_hip_roll: 1, left_knee: 0.83 等

### 可能的原因

1. **这是第一次调用 `readPolicyState()` 时的状态**：
   - 机器人还没有开始运动
   - 所有关节速度都是 0
   - 这是正常的初始状态

2. **之前看到的不对称速度是在后续步骤中产生的**：
   - 策略开始运行后，由于不对称的动作输出，导致关节速度变得不对称
   - 这形成了一个反馈循环：不对称动作 → 不对称速度 → 不对称观察 → 不对称动作

3. **需要查看后续步骤的日志**：
   - 第一次推理后的状态
   - 第二次、第三次推理时的关节速度
   - 观察速度是如何从不对称的

---

## 下一步

需要查看：
1. **展开 Observation Debug 中的速度数据** - 看看观察向量中的速度值
2. **查看后续步骤的日志** - 看看速度是如何变化的
3. **检查 PrevActions** - 看看前一步动作是否对称
