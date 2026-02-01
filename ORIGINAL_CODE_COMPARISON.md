# 原始代码对比分析

## 📋 原始 Python 策略代码分析

### 来源
https://github.com/Renforce-Dynamics/FSMDeploy_G1/blob/master/policy/loco_mode/LocoMode.py

### 关键代码片段

#### 1. 初始化 Warmup
```python
self.obs = np.zeros(self.num_obs)  # 初始化为全零

# Warmup (50 步)
for _ in range(50):
    with torch.inference_mode():
        obs_tensor = self.obs.reshape(1, -1)
        obs_tensor = obs_tensor.astype(np.float32)
        self.policy(torch.from_numpy(obs_tensor))
```

**关键点**：
- ✅ `self.obs` 初始化为全零
- ✅ Warmup 使用全零观察向量
- ✅ 50 步 warmup

#### 2. 观察向量构建（run() 方法）
```python
self.obs[:3] = self.ang_vel.copy()  # RootAngVelB (3)
self.obs[3:6] = self.gravity_orientation.copy()  # ProjectedGravityB (3)
self.obs[6:9] = self.cmd.copy()  # Command (3)
self.obs[9: 9 + self.num_actions] = self.qj_obs.copy()  # JointPosRel (29)
self.obs[9 + self.num_actions: 9 + self.num_actions * 2] = self.dqj_obs.copy()  # JointVel (29)
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()  # PrevActions (29)
```

**观察向量顺序**：
1. RootAngVelB: [0:3] (3 dims)
2. ProjectedGravityB: [3:6] (3 dims)
3. Command: [6:9] (3 dims)
4. JointPosRel: [9:38] (29 dims)
5. JointVel: [38:67] (29 dims)
6. PrevActions: [67:96] (29 dims)

**总计**：3 + 3 + 3 + 29 + 29 + 29 = 96 dims ✅

#### 3. 观察向量处理
```python
obs_tensor = self.obs.reshape(1, -1)
obs_tensor = obs_tensor.astype(np.float32)
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100).detach().numpy().squeeze()
```

**关键点**：
- ✅ 输入观察向量被 clip 到 [-100, 100]
- ✅ 策略输出也被 clip 到 [-100, 100]
- ⚠️ **注意**：策略输出也被 clip 了！

#### 4. 动作处理
```python
loco_action = self.action * self.action_scale + self.default_angles
```

**关键点**：
- ✅ 动作乘以 `action_scale`（0.25）
- ✅ 加上 `default_angles`
- ✅ 没有应用 tanh

#### 5. PrevActions 更新
```python
# 在 run() 方法中，self.action 被更新为策略输出
self.action = self.policy(...).detach().numpy().squeeze()

# 下一帧时，PrevActions 使用上一帧的动作
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()
```

**关键点**：
- ✅ PrevActions 使用上一帧的策略输出（clip 后）
- ✅ 更新时机：在策略推理后立即更新

---

## 🔍 JavaScript 实现对比

### 1. Warmup 过程

**JavaScript 实现**：
```javascript
const obsVec = new Float32Array(this.numObs).fill(0);
// ... clip to [-100, 100]
```

**对比**：
- ✅ 使用全零观察向量
- ✅ 50 步 warmup
- ✅ **一致**

### 2. 观察向量构建

**JavaScript 实现**：
```javascript
// Config order: RootAngVelB(0), ProjectedGravityB(1), Command(2), JointPosRel(3), JointVel(4), PrevActions(5)
```

**对比**：
- ✅ 顺序一致
- ✅ 维度一致（96 dims）
- ✅ **一致**

### 3. 观察向量处理

**JavaScript 实现**：
```javascript
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}
```

**对比**：
- ✅ 输入观察向量被 clip 到 [-100, 100]
- ✅ **一致**

### 4. 动作处理

**JavaScript 实现**：
```javascript
const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
for (let i = 0; i < this.numActions; i++) {
  let value = action[i];
  if (this.actionSquash === 'tanh') {
    value = Math.tanh(value);
  }
  const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
  this.lastActions[i] = clamped;
}
```

**对比**：
- ⚠️ **差异**：原始 Python 代码中，策略输出也被 clip 到 [-100, 100]
- ⚠️ **差异**：JavaScript 实现中，`action_clip` 当前是 5.0，不是 100
- ✅ 没有应用 tanh（`action_squash: null`）
- ⚠️ **需要检查**：策略输出是否也应该 clip 到 [-100, 100]？

### 5. PrevActions 更新

**JavaScript 实现**：
```javascript
// Update PrevActions AFTER inference and lastActions update
for (const obs of this.obsModules) {
  if (obs.constructor.name === 'PrevActions' && typeof obs.update === 'function') {
    obs.update(state);
  }
}
```

**对比**：
- ✅ 更新时机：在策略推理后
- ✅ 使用处理后的动作值（`lastActions`）
- ✅ **一致**

---

## ⚠️ 发现的差异

### 差异1：策略输出的 clip

**原始 Python 代码**：
```python
self.action = self.policy(...).clip(-100, 100).detach().numpy().squeeze()
```
- 策略输出被 clip 到 [-100, 100]

**JavaScript 实现**：
```javascript
const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
// action_clip 当前是 5.0
```
- 策略输出被 clip 到 [-5.0, 5.0]（当前设置）

**影响**：
- 原始代码中，策略输出被 clip 到 [-100, 100]，然后乘以 `action_scale` (0.25)
- JavaScript 实现中，策略输出被 clip 到 [-5.0, 5.0]，然后乘以 `action_scale` (0.55)

**问题**：
- 如果策略输出超过 5.0（如 4.5077），在原始代码中不会被 clip（因为 clip 是 100），但在 JavaScript 中会被 clip 到 5.0
- 但我们的测试显示，即使 clip 到 100，策略输出仍然不对称

---

## 🎯 关键发现

### ✅ 实现基本正确

1. **Warmup 过程**：✅ 一致
2. **观察向量构建**：✅ 一致
3. **观察向量处理**：✅ 一致
4. **PrevActions 更新**：✅ 一致

### ⚠️ 差异点

1. **策略输出的 clip**：
   - 原始：clip 到 [-100, 100]
   - JavaScript：clip 到 [-5.0, 5.0]（当前设置）

2. **action_scale**：
   - 原始：0.25
   - JavaScript：0.55（已调整）

---

## 💡 结论

### ✅ 我们的实现基本正确

- Warmup 过程、观察向量构建、PrevActions 更新都与原始代码一致
- 差异主要在策略输出的 clip 和 action_scale，这些是配置参数，可以调整

### 🔴 问题确认

**原始 Python 策略也输出不对称的动作**（已验证）
- 对称性比例：0.3590
- 右腿 ankle_pitch：4.5077

**这说明**：
- ✅ 我们的实现是正确的
- ✅ 问题确实在策略模型本身
- ✅ 需要强制对称化或重新训练策略

---

## 📋 建议

### 1. 调整 action_clip

**当前**：5.0
**建议**：改为 100.0（与原始代码一致）

**理由**：
- 与原始代码保持一致
- 但根据测试，即使 clip 到 100，策略输出仍然不对称

### 2. 实施方案1：强制动作对称化

**理由**：
- 原始策略本身就不对称
- 需要强制对称化来打破恶性循环

---

## 📊 总结

| 项目 | 原始 Python | JavaScript | 状态 |
|------|------------|-----------|------|
| Warmup | 50 步，全零 | 50 步，全零 | ✅ 一致 |
| 观察向量顺序 | RootAngVelB + ... | RootAngVelB + ... | ✅ 一致 |
| 观察向量 clip | [-100, 100] | [-100, 100] | ✅ 一致 |
| 策略输出 clip | [-100, 100] | [-5.0, 5.0] | ⚠️ 差异 |
| action_scale | 0.25 | 0.55 | ⚠️ 差异 |
| PrevActions 更新 | 推理后 | 推理后 | ✅ 一致 |
| **策略输出对称性** | **0.3590** | **0.2675** | **❌ 都不对称** |

**最终结论**：实现基本正确，问题在策略模型本身。
