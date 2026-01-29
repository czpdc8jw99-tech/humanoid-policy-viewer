# LSTM 状态初始化验证指南

## 修改内容 (v9.0.14)

我们实现了与原始 FSMDeploy_G1 LocoMode 策略一致的 LSTM 状态初始化逻辑：

1. **在策略初始化时运行 50 次预热推理**
   - 使用全零的观察向量
   - 匹配原始 Python 代码的行为：`for _ in range(50): self.policy(...)`

2. **目的**
   - 初始化 LSTM 的内部状态（hidden_state, cell_state）
   - 使策略输出更加稳定和可预测

---

## 验证步骤（按顺序执行）

### 步骤 1：确认页面已加载完成

**在控制台输入：**
```javascript
window.demo
```

**预期结果**：应该看到一个 `MuJoCoDemo` 对象，而不是 `undefined`

**如果返回 `undefined`**：
- 等待页面完全加载（看到模拟界面）
- 刷新页面
- 检查控制台是否有错误

---

### 步骤 2：检查控制台日志

**操作**：在网页上选择 "G1 Locomotion (Gamepad)" 策略

**预期日志**：
```
[PolicyRunner] Warming up LSTM/internal state (50 iterations)...
[PolicyRunner] LSTM warmup completed (50 iterations)
```

**如果没看到日志**：说明策略还没加载，请等待策略加载完成

---

### 步骤 3：检查 PolicyRunner 实例

**在控制台输入：**
```javascript
window.demo.policyRunner
```

**或者（如果是多机器人模式）：**
```javascript
window.demo.policyRunners
```

**预期结果**：应该看到 `PolicyRunner` 实例，而不是 `null` 或 `undefined`

**如果返回 `null`**：
- 确认已选择 "G1 Locomotion (Gamepad)" 策略
- 等待策略加载完成（看到 warmup 日志）

---

### 步骤 4：检查 warmup 状态

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
pr
```

**然后输入：**
```javascript
pr._warmupDone
```

**预期结果**：应该是 `true`（如果 warmup 已完成）

---

### 步骤 5：检查策略基本信息

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('Num actions:', pr.numActions);
console.log('Num obs:', pr.numObs);
console.log('Warmup done:', pr._warmupDone);
```

**预期结果**：
- `Num actions: 29`
- `Num obs: 96`
- `Warmup done: true`

---

### 步骤 6：检查动作输出（需要策略运行后）

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
pr.lastActions
```

**预期结果**：应该看到一个 `Float32Array`，长度为 29

**如果返回空数组或 undefined**：
- 策略可能还没运行
- 等待几秒后重试

---

### 步骤 7：检查左右腿动作对称性

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const actions = pr.lastActions;
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];
console.log('Left leg actions:', leftLegIndices.map(i => actions[i]));
console.log('Right leg actions:', rightLegIndices.map(i => actions[i]));
```

**然后输入：**
```javascript
const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
console.log('Left leg avg magnitude:', leftAvg);
console.log('Right leg avg magnitude:', rightAvg);
const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
console.log('Symmetry ratio:', ratio);
console.log(ratio > 0.5 ? '✅ 对称性良好' : '⚠️ 对称性较差');
```

**预期结果**：
- 左右腿动作应该基本对称
- Symmetry ratio 应该接近 1.0（完全对称）或至少 > 0.5

---

### 步骤 8：检查模块状态

**在控制台输入：**
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
console.log('Module:', pr.module);
console.log('Is recurrent:', pr.module?.isRecurrent);
console.log('InputDict:', pr.inputDict);
```

**预期结果**：
- `Module` 应该是一个 `ONNXModule` 实例
- `Is recurrent` 可能是 `false`（如果模型没有显式暴露 LSTM 状态）

---

## 完整验证脚本（一次性运行）

**在控制台一次性输入以下代码：**

```javascript
// ============================================
// LSTM Warmup 验证脚本
// ============================================

console.log('=== 步骤 1: 检查 demo 对象 ===');
const demo = window.demo;
console.log('Demo exists:', !!demo);

if (!demo) {
  console.error('❌ Demo 对象不存在！请等待页面加载完成。');
} else {
  console.log('✅ Demo 对象存在');
  
  console.log('\n=== 步骤 2: 检查 PolicyRunner ===');
  const pr = demo.policyRunner || demo.policyRunners?.[0];
  console.log('PolicyRunner exists:', !!pr);
  
  if (!pr) {
    console.error('❌ PolicyRunner 不存在！请先选择策略。');
  } else {
    console.log('✅ PolicyRunner 存在');
    
    console.log('\n=== 步骤 3: 检查基本信息 ===');
    console.log('Num actions:', pr.numActions);
    console.log('Num obs:', pr.numObs);
    console.log('Warmup done:', pr._warmupDone);
    
    console.log('\n=== 步骤 4: 检查动作输出 ===');
    if (pr.lastActions && pr.lastActions.length > 0) {
      console.log('Last actions length:', pr.lastActions.length);
      console.log('First 5 actions:', Array.from(pr.lastActions.slice(0, 5)));
      
      console.log('\n=== 步骤 5: 检查左右腿对称性 ===');
      const leftLegIndices = [0, 3, 6, 9, 13, 17];
      const rightLegIndices = [1, 4, 7, 10, 14, 18];
      const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(pr.lastActions[i]), 0) / leftLegIndices.length;
      const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(pr.lastActions[i]), 0) / rightLegIndices.length;
      console.log('Left leg avg magnitude:', leftAvg);
      console.log('Right leg avg magnitude:', rightAvg);
      const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
      console.log('Symmetry ratio:', ratio);
      console.log(ratio > 0.5 ? '✅ 对称性良好' : '⚠️ 对称性较差');
    } else {
      console.log('⚠️ 动作输出为空，策略可能还没运行');
    }
    
    console.log('\n=== 步骤 6: 检查模块状态 ===');
    console.log('Is recurrent:', pr.module?.isRecurrent);
    console.log('InputDict keys:', Object.keys(pr.inputDict || {}));
  }
}

console.log('\n=== 验证完成 ===');
```

---

## 常见问题排查

### 问题 1：`window.demo` 返回 `undefined`

**原因**：页面还没加载完成

**解决方法**：
1. 等待页面完全加载（看到模拟界面）
2. 刷新页面
3. 检查控制台是否有错误

---

### 问题 2：`policyRunner` 返回 `null`

**原因**：策略还没加载

**解决方法**：
1. 在网页上选择 "G1 Locomotion (Gamepad)" 策略
2. 等待策略加载完成（看到 warmup 日志）
3. 然后再运行验证命令

---

### 问题 3：`_warmupDone` 返回 `undefined`

**原因**：可能是旧版本的代码

**解决方法**：
1. 确认已更新到 v9.0.14
2. 刷新页面
3. 检查控制台是否有 warmup 日志

---

## 预期行为

**修改后（v9.0.14）**：
- ✅ 控制台显示 warmup 完成日志
- ✅ `_warmupDone` 为 `true`
- ✅ 机器人能够稳定站立（command=[0,0,0]）
- ✅ 左右腿动作基本对称

**如果仍然有问题**：
- 检查控制台是否有错误
- 验证 warmup 是否成功完成
- 检查观察向量是否正确构建
- 检查 PrevActions 的更新时机
