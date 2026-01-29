# 根本原因分析

## 🔴 关键发现：观察向量输入不对称

### 问题总结

通过调试日志分析，我们发现：

1. ✅ **JointPosRel（关节位置相对值）是对称的**
2. ❌ **JointVel（关节速度）是不对称的**
3. ❌ **PrevActions（前一步动作）是不对称的**

### 具体不对称性

#### 关节速度不对称
- `left_hip_roll_joint`: vel = 1
- `right_hip_roll_joint`: vel = 0 ❌

- `left_knee_joint`: vel = 0.8314
- `right_knee_joint`: vel = -0.0055 ❌

- `left_ankle_pitch_joint`: vel = 0.0099
- `right_ankle_pitch_joint`: vel = -0.0045 ❌

#### 前一步动作不对称
- `left_hip_roll_joint`: prevAction = 0.0069
- `right_hip_roll_joint`: prevAction = -0.0031 ❌

- `left_hip_yaw_joint`: prevAction = 0.0172
- `right_hip_yaw_joint`: prevAction = 0 ❌

- `left_knee_joint`: prevAction = 0
- `right_knee_joint`: prevAction = -0.0110 ❌

- `left_ankle_pitch_joint`: prevAction = 0.0198
- `right_ankle_pitch_joint`: prevAction = -0.0091 ❌

---

## 根本原因

**策略接收到的输入（观察向量）本身就是不对称的！**

这意味着：
1. 策略基于不对称输入产生不对称输出是**预期的行为**
2. 问题不在策略模型本身，而在**输入数据的构建过程**

### 可能的原因

#### 原因 A：机器人初始状态不对称（最可能）

如果机器人的初始状态（`qpos`, `qvel`）本身就不对称，那么：
- 读取出的关节速度会不对称
- 这会导致策略产生不对称的动作
- 不对称的动作会进一步加剧状态的不对称

#### 原因 B：PrevActions 更新时机问题

如果 `PrevActions.update()` 的调用时机不正确，或者 `lastActions` 的更新顺序有问题，就会导致左右腿的前一步动作不对称。

#### 原因 C：关节速度读取索引错误

如果 `qvel_adr_policy` 的索引映射错误，就会导致读取到错误的关节速度。

---

## 下一步调试

已添加调试日志来检查：
1. **实际读取的 `qvel` 值**（在 `readPolicyState()` 中）
2. **`qvel_adr_policy` 的映射**是否正确

需要用户运行代码并提供新的调试日志，以确定：
- 是 MuJoCo 的 `qvel` 数组本身就不对称？
- 还是 `qvel_adr_policy` 的映射有问题？
