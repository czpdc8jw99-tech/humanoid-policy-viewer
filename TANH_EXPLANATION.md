# tanh 函数说明

## tanh 是什么？

`tanh` 是**双曲正切函数**（Hyperbolic Tangent），是一个数学函数。

### 数学定义

```
tanh(x) = (e^x - e^(-x)) / (e^x + e^(-x))
```

### 函数特性

- **输入范围**：(-∞, +∞)
- **输出范围**：(-1, +1)
- **函数形状**：S 形曲线（Sigmoid）
- **中心点**：tanh(0) = 0

### 函数图像

```
输出值
  1.0 |        ╱╲
      |       ╱  ╲
  0.5 |      ╱    ╲
      |     ╱      ╲
  0.0 |────╱────────╲──── 输入值
      |   ╱          ╲
 -0.5 |  ╱            ╲
      | ╱              ╲
 -1.0 |╱                ╲
      └───────────────────
      -3  -2  -1  0  1  2  3
```

### 关键特性

1. **压缩作用**：无论输入多大，输出都在 [-1, 1] 范围内
2. **平滑过渡**：在 0 附近线性，远离 0 时饱和
3. **对称性**：tanh(-x) = -tanh(x)

---

## 在我们的代码中的作用

### 代码位置

**文件**：`src/simulation/policyRunner.js`  
**位置**：第 334-344 行

### 代码实现

```javascript
const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
for (let i = 0; i < this.numActions; i++) {
  let value = action[i];  // 原始策略输出（可能是 [-4, 4] 或更大）
  
  // Apply squash (e.g., tanh) if configured
  if (this.actionSquash === 'tanh') {
    value = Math.tanh(value);  // ← 这里应用 tanh，压缩到 [-1, 1]
  }
  
  // Then apply clip
  const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
  this.lastActions[i] = clamped;
}
```

### 处理流程

```
策略原始输出
    ↓
例如：[-4, 4] 范围
    ↓
应用 tanh
    ↓
压缩到：[-1, 1] 范围
    ↓
应用 clip（通常不生效，因为已经在 [-1, 1] 内）
    ↓
最终动作值：[-1, 1]
    ↓
乘以 action_scale (0.5)
    ↓
实际调整：[-0.5, 0.5] 弧度
```

---

## 为什么使用 tanh？

### 优点

1. **限制动作范围**：确保动作值不会过大
2. **平滑控制**：避免突然的大幅动作
3. **训练稳定性**：在训练时有助于稳定学习

### 缺点（在我们的场景中）

1. **压缩动作范围**：
   - 如果策略原始输出是 [-4, 4]
   - tanh 后变成 [-1, 1]
   - **动作幅度减小了 4 倍！**

2. **可能太小**：
   - 即使乘以 action_scale (0.5)
   - 最终调整只有 [-0.5, 0.5] 弧度
   - **可能不足以维持平衡**

---

## 原始代码中的 tanh

### 原始 Python 代码

**文件**：`tools/fsmdeploy_loco_mode/LocoMode.py`  
**位置**：第 89 行

```python
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100).detach().numpy().squeeze()
```

**关键发现**：
- ❌ **原始代码没有 tanh！**
- ✅ 只有 clip 到 [-100, 100]
- ✅ 然后直接乘以 action_scale (0.25)

### 我们的代码

```javascript
// 1. 策略输出（假设是 [-4, 4]）
let value = action[i];

// 2. 应用 tanh（压缩到 [-1, 1]）
if (this.actionSquash === 'tanh') {
  value = Math.tanh(value);  // [-4, 4] → [-1, 1]
}

// 3. 应用 clip（通常不生效）
const clamped = Math.max(-clip, Math.min(clip, value));

// 4. 乘以 action_scale
target[i] = defaultJointPos[i] + actionScale[i] * clamped;
```

---

## 问题分析

### 如果策略原始输出是 [-4, 4]

**有 tanh**：
- tanh 后：[-1, 1]
- 乘以 0.5：[-0.5, 0.5] 弧度
- **调整幅度：±0.5 弧度（约 ±29 度）**

**没有 tanh**：
- 直接使用：[-4, 4]
- 乘以 0.25：[-1, 1] 弧度
- **调整幅度：±1 弧度（约 ±57 度）**

**差异**：没有 tanh 时，动作幅度是 2 倍！

---

## 配置位置

**文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`  
**位置**：第 53 行

```json
{
  "action_squash": "tanh",  // ← 这里控制是否使用 tanh
}
```

**可选值**：
- `"tanh"`：使用 tanh 压缩
- `null`：不使用 tanh（直接使用原始输出）

---

## 总结

1. **tanh 的作用**：将任意范围的输入压缩到 [-1, 1]
2. **在我们的代码中**：压缩策略输出，限制动作幅度
3. **问题**：可能压缩得太厉害，导致动作幅度太小
4. **解决方案**：移除 tanh，让动作幅度更大
