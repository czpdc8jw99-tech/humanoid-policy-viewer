# 回归问题分析

## 问题描述

用户反馈：v9.0.10 已经解决了"一只脚动一只脚不动"的问题，但 v9.0.11 移除了 tanh 后，问题又出现了。

## 版本对比

### v9.0.10（工作正常）
- ✅ 设置了初始关节位置到 default_joint_pos
- ✅ 有 tanh squash（把动作压到 [-1, 1]）
- ✅ 然后乘以 action_scale (0.25)
- ✅ 结果：动作范围 [-0.25, 0.25]

### v9.0.11（问题重现）
- ✅ 设置了初始关节位置到 default_joint_pos
- ❌ 移除了 tanh squash
- ✅ 策略输出直接 clip 到 [-100, 100]
- ✅ 然后乘以 action_scale (0.25)
- ❌ 结果：动作范围可能很大（如果策略输出是 2，就是 0.5）

## 可能的原因

### 原因 A：策略输出范围问题

如果策略输出的原始值很大（比如 [-5, 5]），即使 clip 到 [-100, 100]，乘以 0.25 后仍然是 [-1.25, 1.25]，这可能太大了。

但原始代码中也是这样的处理，所以这应该不是问题。

### 原因 B：tanh 实际上是有用的

虽然原始代码中没有 tanh，但可能：
1. 原始策略训练时，输出已经被限制在合理范围内
2. 或者原始代码在别的地方有处理
3. 或者我们的 ONNX 转换有问题，导致输出范围不对

### 原因 C：clip 的顺序问题

原始代码：
```python
self.action = self.policy(...).clip(-100, 100)
loco_action = self.action * self.action_scale + self.default_angles
```

我们的代码：
```javascript
value = action[i];  // 策略输出
if (tanh) value = Math.tanh(value);
clamped = clip(value, -100, 100);  // clip
target = defaultJointPos[i] + actionScale[i] * clamped;  // 乘以 scale 并加到 default
```

顺序应该是对的。

## 解决方案

### 方案 1：恢复 tanh（如果 v9.0.10 工作正常）

如果 v9.0.10 工作正常，说明 tanh 实际上是有用的，即使原始代码中没有。

### 方案 2：检查策略输出的实际范围

添加调试日志，看看策略输出的原始值范围是多少。

### 方案 3：调整 action_scale

如果策略输出范围很大，可能需要减小 action_scale。

## 建议

**先恢复 tanh**，因为 v9.0.10 工作正常。然后我们可以：
1. 检查策略输出的原始值范围
2. 看看是否需要调整 action_scale
3. 或者找到其他原因
