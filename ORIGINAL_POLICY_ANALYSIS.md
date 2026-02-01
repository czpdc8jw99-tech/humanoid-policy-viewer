# 原始策略分析报告

## 📋 转换脚本分析

### convert_to_onnx.py 关键信息

1. **输入维度**：
   - `dummy_obs = torch.zeros((1, 96), dtype=torch.float32)`
   - 观察向量维度：96

2. **LSTM 状态**：
   - `hidden_state: (1, 1, 256)`
   - `cell_state: (1, 1, 256)`

3. **Warmup 过程**（注释中提到）：
   ```python
   # This matches the original FSMDeploy_G1 LocoMode initialization:
   #   for _ in range(50):
   #       self.policy(torch.from_numpy(self.obs))
   ```
   - 原始策略使用全零观察向量进行 50 步 warmup

4. **转换过程**：
   - 使用 `torch.onnx.export` 导出
   - `dynamo=False`：使用传统导出器（TorchScript）
   - 没有应用 `tanh` 或其他后处理

---

## 🔍 关键发现

### 1. Warmup 过程

**原始 Python 策略**：
- 使用全零观察向量进行 50 步 warmup
- 目的是初始化 LSTM 状态

**JavaScript 实现**：
- `_warmupLSTMState()` 也使用全零观察向量
- 进行 50 步 warmup
- **✅ 与原始策略一致**

### 2. 观察向量处理

**转换脚本中的验证**：
```python
x_np = rng.standard_normal((1, 96), dtype=np.float32).clip(-3, 3)
```
- 验证时使用了 `clip(-3, 3)`
- **但原始策略可能使用 `clip(-100, 100)`**

**JavaScript 实现**：
- 在 `policyRunner.js` 中已经实现了 `clip(-100, 100)`
- **✅ 与原始策略一致**

### 3. 动作处理

**转换脚本**：
- 直接导出策略输出，没有后处理
- 没有应用 `tanh` 或其他变换

**JavaScript 实现**：
- `action_squash: null`（不应用 tanh）
- `action_clip: 5.0`（当前设置）
- **✅ 与转换脚本一致**

---

## ⚠️ 潜在问题

### 问题1：LSTM 状态初始化

**可能的问题**：
- LSTM 状态在 warmup 后可能仍然不对称
- 即使使用全零观察向量，LSTM 的内部状态可能因为权重初始化而不对称

**验证方法**：
- 检查 warmup 后的 LSTM 状态是否对称
- 可能需要增加 warmup 步数

### 问题2：观察向量构建

**可能的问题**：
- JavaScript 实现的观察向量构建可能与原始 Python 实现不完全一致
- 特别是 `JointPosRel`、`JointVel`、`PrevActions` 的计算

**验证方法**：
- 对比 JavaScript 和 Python 实现的观察向量构建逻辑
- 检查是否有数值精度问题

### 问题3：策略模型本身

**可能的问题**：
- 策略模型在训练时可能没有充分学习对称性
- 或者模型权重初始化不对称

**验证方法**：
- 在 Python 环境中测试原始策略
- 使用相同的全零观察向量，检查输出是否对称

---

## 📋 需要验证的点

### 1. 原始 Python 策略测试

**测试方法**：
```python
import torch
import numpy as np

# 加载策略
model = torch.jit.load("policy_29dof.pt", map_location="cpu")
model.eval()

# 创建全零观察向量（模拟 Frame 1）
obs = torch.zeros((1, 96), dtype=torch.float32)

# Warmup（50 步）
for _ in range(50):
    _ = model(obs)

# 推理
with torch.no_grad():
    action = model(obs).detach().cpu().numpy()

# 检查对称性
left_leg_indices = [0, 3, 6, 9, 13, 17]  # left_hip_pitch, left_hip_roll, left_hip_yaw, left_knee, left_ankle_pitch, left_ankle_roll
right_leg_indices = [1, 4, 7, 10, 14, 18]  # right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll

left_avg = np.mean(np.abs(action[0, left_leg_indices]))
right_avg = np.mean(np.abs(action[0, right_leg_indices]))
ratio = min(left_avg, right_avg) / max(left_avg, right_avg)

print(f"Left leg avg: {left_avg:.4f}")
print(f"Right leg avg: {right_avg:.4f}")
print(f"Symmetry ratio: {ratio:.4f}")
print(f"Right ankle_pitch: {action[0, 14]:.4f}")
```

**预期结果**：
- 如果原始策略也输出不对称的动作 → 策略模型本身有问题
- 如果原始策略输出对称的动作 → 转换过程或 JavaScript 实现有问题

### 2. 观察向量构建验证

**需要检查**：
- `JointPosRel` 的计算是否正确
- `JointVel` 的计算是否正确
- `PrevActions` 的更新是否正确
- 观察向量的顺序是否正确

### 3. LSTM 状态验证

**需要检查**：
- Warmup 后的 LSTM 状态是否对称
- LSTM 状态是否正确传递到下一帧

---

## 🎯 下一步行动

### 立即执行

1. **测试原始 Python 策略**
   - 使用上述 Python 代码测试原始策略
   - 确认是否也输出不对称的动作

2. **检查观察向量构建**
   - 对比 JavaScript 和 Python 实现的观察向量构建逻辑
   - 确认是否有差异

3. **检查 LSTM 状态**
   - 检查 warmup 后的 LSTM 状态
   - 确认是否对称

---

## 📊 结论

### ✅ 已确认

1. **Warmup 过程**：与原始策略一致（50 步，全零观察向量）
2. **观察向量处理**：已实现 `clip(-100, 100)`
3. **动作处理**：不应用 tanh，与转换脚本一致

### ⚠️ 待验证

1. **原始 Python 策略**：需要测试是否也输出不对称的动作
2. **观察向量构建**：需要验证是否与原始实现一致
3. **LSTM 状态**：需要检查是否对称

---

## 💡 建议

### 如果原始 Python 策略也输出不对称的动作

→ **策略模型本身有问题**
→ 需要重新训练策略或调整训练过程

### 如果原始 Python 策略输出对称的动作

→ **转换过程或 JavaScript 实现有问题**
→ 需要检查：
- 观察向量构建逻辑
- LSTM 状态传递
- 数值精度问题
