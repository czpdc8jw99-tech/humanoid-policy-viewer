# 原始策略测试说明

## 📋 目的

测试原始 Python 策略在相同输入（全零观察向量）下是否也输出不对称的动作。

这将帮助我们确定：
- **如果原始策略也输出不对称的动作** → 策略模型本身有问题
- **如果原始策略输出对称的动作** → 转换过程或 JavaScript 实现有问题

---

## 🔧 测试步骤

### 1. 准备 Python 环境

确保你已经安装了 Python 3.11 和必要的依赖：

```bash
# 如果还没有创建 venv
py -3.11 -m venv .venv-onnx
.\.venv-onnx\Scripts\python -m pip install --upgrade pip
.\.venv-onnx\Scripts\python -m pip install numpy torch --index-url https://download.pytorch.org/whl/cpu
```

### 2. 运行测试脚本

```bash
.\.venv-onnx\Scripts\python tools\fsmdeploy_loco_mode\test_policy_symmetry.py
```

### 3. 查看结果

测试脚本会输出：
- 左腿和右腿的动作值
- 对称性比例
- 最大动作值
- 右腿 ankle_pitch 的值
- **结论**：策略是否对称

---

## 📊 预期结果

### 情况1：原始策略也输出不对称的动作

**输出示例**：
```
❌ POLICY OUTPUT IS ASYMMETRIC
   Symmetry ratio (0.2675) is below threshold (0.7)
   This suggests the policy model itself has a problem.
   ⚠️  Right ankle_pitch (4.3863) is abnormally large!
```

**结论**：
- ✅ **策略模型本身有问题**
- 需要重新训练策略或调整训练过程

### 情况2：原始策略输出对称的动作

**输出示例**：
```
✅ POLICY OUTPUT IS SYMMETRIC
   Symmetry ratio (0.9500) is above threshold (0.7)
   The policy model appears to be working correctly.
```

**结论**：
- ⚠️ **转换过程或 JavaScript 实现有问题**
- 需要检查：
  - 观察向量构建逻辑
  - LSTM 状态传递
  - 数值精度问题

---

## 🔍 测试脚本功能

测试脚本 `test_policy_symmetry.py` 会：

1. **加载策略**：从 `policy_29dof.pt` 加载 TorchScript 模型
2. **创建全零观察向量**：96 维，全为 0（模拟 Frame 1 的状态）
3. **Warmup**：运行 50 步 warmup（与原始实现一致）
4. **推理**：使用全零观察向量进行推理
5. **分析对称性**：
   - 提取左腿和右腿的动作值
   - 计算平均幅度
   - 计算对称性比例
   - 检查异常值（如右腿 ankle_pitch）

---

## 📝 注意事项

1. **测试环境**：确保使用 Python 3.11 和正确的依赖版本
2. **策略文件**：确保 `policy_29dof.pt` 文件存在
3. **结果对比**：将测试结果与 JavaScript 实现的 Frame 1 数据对比

---

## 🎯 下一步

### 如果原始策略也输出不对称的动作

→ **策略模型本身有问题**
→ 需要：
- 检查策略训练过程
- 可能需要重新训练策略
- 或者使用强制对称化的临时修复

### 如果原始策略输出对称的动作

→ **转换过程或 JavaScript 实现有问题**
→ 需要：
- 检查观察向量构建逻辑
- 检查 LSTM 状态传递
- 检查数值精度问题

---

## 📚 相关文档

- `ORIGINAL_POLICY_ANALYSIS.md` - 原始策略分析报告
- `CRITICAL_ANALYSIS_FRAME1.md` - Frame 1 的关键分析
- `FINAL_CONCLUSION.md` - 最终结论
