# 关节速度和前一步动作分析

## 🔴 严重发现：观察向量输入不对称！

### 左腿关节速度
- `left_hip_pitch_joint`: vel: 0
- `left_hip_roll_joint`: vel: **1** ⚠️
- `left_hip_yaw_joint`: vel: **0.8342** ⚠️
- `left_knee_joint`: vel: **0.8314** ⚠️
- `left_ankle_pitch_joint`: vel: 0.0099
- `left_ankle_roll_joint`: vel: 0

### 右腿关节速度
- `right_hip_pitch_joint`: vel: 0
- `right_hip_roll_joint`: vel: **0** ❌ （左腿是 1）
- `right_hip_yaw_joint`: vel: **0.8338** ✓ （与左腿相似）
- `right_knee_joint`: vel: **-0.0055** ❌ （左腿是 0.8314）
- `right_ankle_pitch_joint`: vel: **-0.0045** ❌ （左腿是 0.0099）
- `right_ankle_roll_joint`: vel: 0

### 关键不对称性（关节速度）
1. **hip_roll**: 左腿 1 vs 右腿 0 ❌
2. **knee**: 左腿 0.8314 vs 右腿 -0.0055 ❌
3. **ankle_pitch**: 左腿 0.0099 vs 右腿 -0.0045 ❌

---

### 左腿前一步动作
- `left_hip_pitch_joint`: prevAction: 0
- `left_hip_roll_joint`: prevAction: **0.0069** ⚠️
- `left_hip_yaw_joint`: prevAction: **0.0172** ⚠️
- `left_knee_joint`: prevAction: 0
- `left_ankle_pitch_joint`: prevAction: **0.0198** ⚠️
- `left_ankle_roll_joint`: prevAction: 0

### 右腿前一步动作
- `right_hip_pitch_joint`: prevAction: 0
- `right_hip_roll_joint`: prevAction: **-0.0031** ❌ （左腿是 0.0069）
- `right_hip_yaw_joint`: prevAction: **0** ❌ （左腿是 0.0172）
- `right_knee_joint`: prevAction: **-0.0110** ❌ （左腿是 0）
- `right_ankle_pitch_joint`: prevAction: **-0.0091** ❌ （左腿是 0.0198）
- `right_ankle_roll_joint`: prevAction: 0

### 关键不对称性（前一步动作）
1. **hip_roll**: 左腿 0.0069 vs 右腿 -0.0031 ❌
2. **hip_yaw**: 左腿 0.0172 vs 右腿 0 ❌
3. **knee**: 左腿 0 vs 右腿 -0.0110 ❌
4. **ankle_pitch**: 左腿 0.0198 vs 右腿 -0.0091 ❌

---

## 根本原因分析

### 问题定位

**观察向量的输入（JointVel 和 PrevActions）已经不对称！**

这意味着：
1. ❌ 策略接收到的输入本身就是不对称的
2. ❌ 策略基于不对称输入产生不对称输出是**预期的行为**
3. ✅ 问题不在策略模型本身，而在**输入数据的构建过程**

### 可能的原因

#### 原因 A：关节速度读取错误（最可能）

在 `readPolicyState()` 中：
```javascript
const qvelAdr = this.qvel_adr_policy[i];
jointVel[i] = qvel[qvelAdr];
```

如果 `qvel_adr_policy` 的索引映射错误，或者 `qvel` 数组读取错误，就会导致左右腿速度不对称。

#### 原因 B：PrevActions 更新逻辑错误

在 `PrevActions.update()` 中：
```javascript
const source = this.policy?.lastActions ?? new Float32Array(this.numActions);
this.actionBuffer[0].set(source);
```

如果 `lastActions` 的更新时机或顺序有问题，就会导致左右腿的前一步动作不对称。

#### 原因 C：初始状态不对称

如果机器人的初始状态（qpos, qvel）本身就不对称，那么读取出的关节速度和位置也会不对称。

---

## 下一步行动

需要检查：
1. **`readPolicyState()` 中的 `qvel_adr_policy` 映射是否正确**
2. **`PrevActions.update()` 的调用时机和逻辑是否正确**
3. **机器人的初始状态是否对称**
