# 动作缩放问题深度分析

## 当前状态分析

### 调试数据显示：

1. **动作值范围**（经过 tanh 后）：
   - min: -0.986
   - max: 0.999
   - avg: 0.509
   - **范围：[-1, 1]**

2. **实际调整幅度**：
   - Left leg avg adjustment: 0.159 弧度
   - Right leg avg adjustment: 0.194 弧度
   - **平均调整：约 0.18 弧度（约 10 度）**

3. **位置误差**：
   - Left leg avg error: 0.008 弧度
   - Right leg avg error: 0.010 弧度
   - **误差很小，PD 控制正常工作**

### 问题诊断：

**关键发现**：
- 动作值经过 tanh 后，范围被压缩到 [-1, 1]
- 乘以 actionScale (0.25) 后，实际调整只有 ±0.25 弧度
- **这个调整幅度可能太小，不足以维持平衡！**

## 原始 Python 代码分析

### 原始代码的动作处理：

```python
# 1. 策略输出（没有 tanh）
self.action = self.policy(...).clip(-100, 100)

# 2. 动作处理
loco_action = self.action * self.action_scale + self.default_angles
# action_scale = 0.25
# 所以：loco_action = default_angles + action * 0.25
```

### 关键差异：

1. **原始代码**：
   - 动作值范围：[-100, 100]（clip 后）
   - 实际调整：[-25, 25] 弧度（乘以 0.25）
   - **调整幅度：±25 弧度（约 ±1430 度）** ❌ 这显然不对！

2. **等等，让我重新理解**：
   - 原始代码中，策略输出的是**相对调整量**
   - `action * action_scale` 是相对于 `default_angles` 的调整
   - 如果 action 在 [-4, 4] 范围内，调整就是 [-1, 1] 弧度

3. **我们的代码**：
   - 动作值经过 tanh：[-1, 1]
   - 乘以 actionScale (0.25)：调整 [-0.25, 0.25] 弧度
   - **调整幅度：±0.25 弧度（约 ±14 度）**

## 问题根源

### 假设 1：tanh 压缩了动作范围

**原始策略输出**可能是 [-4, 4] 或更大范围，但：
- 原始代码直接 clip 到 [-100, 100]
- 我们的代码先 tanh 到 [-1, 1]，再 clip

**解决方案**：
- 移除 tanh，让动作值保持原始范围
- 但用户说之前移除 tanh 失败了

### 假设 2：actionScale 太小

如果动作值在 [-1, 1] 范围内，0.25 的缩放可能太小。

**解决方案**：
- 增加 actionScale（比如 0.5 或 1.0）
- 但这会改变策略的行为

### 假设 3：策略输出本身就有问题

ONNX 转换可能改变了策略的输出分布。

**需要验证**：
- 原始 .pt 文件的输出范围
- ONNX 转换后的输出范围

## 可能的解决方案

### 方案 1：调整 actionScale（不改变 tanh）

**思路**：
- 保持 tanh，但增加 actionScale
- 例如：从 0.25 增加到 0.5 或 1.0

**优点**：
- 简单，只需要改配置
- 不改变动作值的分布

**缺点**：
- 可能改变策略的预期行为
- 需要测试不同的值

### 方案 2：移除 tanh，调整 clip 范围

**思路**：
- 移除 tanh
- 调整 clip 范围（比如 [-4, 4] 而不是 [-100, 100]）
- 保持 actionScale = 0.25

**优点**：
- 更接近原始代码的行为

**缺点**：
- 用户说之前移除 tanh 失败了
- 需要找到失败的原因

### 方案 3：检查原始策略的输出范围

**思路**：
- 运行原始 Python 代码，检查策略输出的实际范围
- 对比 ONNX 转换后的输出范围
- 找出差异

**优点**：
- 找到根本原因

**缺点**：
- 需要运行 Python 代码

### 方案 4：渐进式调整

**思路**：
- 先尝试 actionScale = 0.5（保持 tanh）
- 如果还不够，尝试 actionScale = 1.0
- 如果还是不够，再考虑移除 tanh

**优点**：
- 渐进式，风险小
- 每一步都可以验证

## 建议的验证步骤

### 步骤 1：检查原始策略的输出范围

**在 Python 环境中运行**：
```python
import torch
policy = torch.jit.load("policy_29dof.pt")
# 创建零观察向量
obs = torch.zeros((1, 96), dtype=torch.float32)
# 运行多次，收集输出范围
actions = []
for _ in range(100):
    with torch.no_grad():
        action = policy(obs).clip(-100, 100)
        actions.append(action.numpy())
actions = np.concatenate(actions, axis=0)
print("Action range:", actions.min(), actions.max())
print("Action mean:", actions.mean())
print("Action std:", actions.std())
```

### 步骤 2：检查 ONNX 模型的输出范围

**在浏览器控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
// 创建零观察向量
const zeroObs = new Float32Array(96);
const inputDict = { ...pr.inputDict };
inputDict["policy"] = new ort.Tensor('float32', zeroObs, [1, 96]);

// 运行多次，收集原始输出（不经过 tanh）
const rawActions = [];
for (let i = 0; i < 100; i++) {
  const [result] = await pr.module.runInference(inputDict);
  const action = result["action"];
  rawActions.push(Array.from(action.data));
}

// 分析范围
const allActions = rawActions.flat();
console.log("Raw action range:", Math.min(...allActions), Math.max(...allActions));
console.log("Raw action mean:", allActions.reduce((a, b) => a + b, 0) / allActions.length);
```

### 步骤 3：尝试不同的 actionScale

**修改配置**：
```json
{
  "action_scale": 0.5,  // 从 0.25 增加到 0.5
  // 或
  "action_scale": 1.0,  // 增加到 1.0
}
```

**然后测试机器人是否能站住**

## 我的建议

基于当前的分析，我建议：

1. **先尝试增加 actionScale**（保持 tanh）
   - 从 0.25 增加到 0.5
   - 测试机器人行为
   - 如果还不够，增加到 1.0

2. **如果增加 actionScale 还不够**：
   - 检查原始策略的输出范围
   - 对比 ONNX 转换后的输出范围
   - 找出差异的根本原因

3. **最后考虑移除 tanh**：
   - 但要先理解为什么之前移除 tanh 失败了
   - 可能需要同时调整 clip 范围

## 下一步

请先运行"步骤 2"的代码，检查 ONNX 模型的原始输出范围，这样我们就能知道：
- 策略输出的原始范围是多少
- tanh 是否真的压缩了范围
- 应该使用多大的 actionScale
