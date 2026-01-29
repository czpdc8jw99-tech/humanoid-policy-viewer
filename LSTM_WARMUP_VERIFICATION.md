# LSTM 状态初始化验证指南

## 修改内容 (v9.0.14)

我们实现了与原始 FSMDeploy_G1 LocoMode 策略一致的 LSTM 状态初始化逻辑：

1. **在策略初始化时运行 50 次预热推理**
   - 使用全零的观察向量
   - 匹配原始 Python 代码的行为：`for _ in range(50): self.policy(...)`

2. **目的**
   - 初始化 LSTM 的内部状态（hidden_state, cell_state）
   - 使策略输出更加稳定和可预测

## 如何验证修改是否正确

### 1. 检查控制台日志

打开浏览器控制台，选择 "G1 Locomotion (Gamepad)" 策略后，应该看到：

```
[PolicyRunner] Warming up LSTM/internal state (50 iterations)...
[PolicyRunner] LSTM warmup completed (50 iterations)
```

**验证命令**：
```javascript
// 检查 PolicyRunner 实例
const demo = window.mujocoDemo; // 如果全局暴露了
const policyRunner = demo?.policyRunner;

// 检查 warmup 是否完成
console.log('Warmup done:', policyRunner?._warmupDone);

// 检查 inputDict 状态
console.log('InputDict:', policyRunner?.inputDict);
```

### 2. 检查策略输出稳定性

在控制台运行以下命令，观察前几步的动作输出：

```javascript
// 获取策略运行器
const demo = window.mujocoDemo;
const policyRunner = demo?.policyRunner;

// 观察动作输出（需要在策略运行后）
console.log('Last actions:', policyRunner?.lastActions);

// 检查左右腿动作是否对称（前几步）
// 左腿索引: 0, 3, 6, 9, 13, 17
// 右腿索引: 1, 4, 7, 10, 14, 18
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

if (policyRunner?.lastActions) {
  const actions = policyRunner.lastActions;
  console.log('Left leg actions:', leftLegIndices.map(i => actions[i]));
  console.log('Right leg actions:', rightLegIndices.map(i => actions[i]));
  
  // 计算对称性
  const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
  const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
  console.log('Left leg avg magnitude:', leftAvg);
  console.log('Right leg avg magnitude:', rightAvg);
  console.log('Symmetry ratio:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
}
```

### 3. 检查机器人行为

**预期行为**：
- 机器人应该能够**稳定站立**（command=[0,0,0]）
- 左右腿动作应该**基本对称**
- 不应该出现"一只脚动一只脚不动"的问题

**如果仍然有问题**：
- 检查控制台是否有错误
- 验证 warmup 是否成功完成
- 检查观察向量是否正确构建

### 4. 对比修改前后的行为

**修改前（v9.0.10）**：
- 没有 LSTM 预热
- 策略可能输出不稳定的动作

**修改后（v9.0.14）**：
- 有 50 次 LSTM 预热
- 策略输出应该更加稳定

## 调试命令总结

```javascript
// 1. 检查 warmup 状态
console.log('Warmup done:', window.mujocoDemo?.policyRunner?._warmupDone);

// 2. 检查动作输出
const pr = window.mujocoDemo?.policyRunner;
if (pr) {
  console.log('Actions:', Array.from(pr.lastActions));
  console.log('Command:', Array.from(pr.command));
}

// 3. 检查观察向量大小
console.log('Num obs:', pr?.numObs);
console.log('Num actions:', pr?.numActions);

// 4. 检查模块状态
console.log('Module:', pr?.module);
console.log('Is recurrent:', pr?.module?.isRecurrent);
```

## 下一步

如果 warmup 成功但机器人仍然站不住，可能需要：
1. 检查 PrevActions 的更新时机
2. 验证动作处理逻辑（tanh, clip, scale）
3. 检查初始姿态设置是否正确
