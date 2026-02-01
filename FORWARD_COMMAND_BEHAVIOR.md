# Forward命令行为分析

## 问题：输入forward命令后，机器人的手和腿会持续运动吗？

### 答案：**是的，应该持续运动**

---

## 1. Loco Mode策略的设计

### 策略类型
- **命令驱动（Command-driven）**：策略根据速度命令产生动作
- **LSTM-based**：有内部状态，会产生连续的动作序列

### 工作原理
1. **输入命令**：例如 `cmd = [0.3, 0, 0]`（向前0.3 m/s）
2. **策略推理**：每次调用都会：
   - 读取当前状态（关节位置、速度、重力方向等）
   - 构建观察向量（包含命令）
   - 调用ONNX模型推理
   - 输出动作（目标关节位置）

3. **动作应用**：动作通过PD控制应用到关节

---

## 2. 预期行为

### 正常情况（应该发生）
- **腿部**：应该产生行走动作（交替迈步）
- **手臂**：可能会摆动以保持平衡（取决于策略训练）
- **持续运动**：只要命令存在，策略会持续产生动作

### 异常情况（可能的问题）
- **不动**：如果手和腿完全不动，可能是：
  1. 命令没有正确传递到策略
  2. 策略输出全零或很小
  3. 动作没有正确应用到关节
  4. PD增益问题导致动作无效

- **过度运动**：如果运动幅度过大或不稳定，可能是：
  1. 动作缩放问题
  2. PD增益过大
  3. 策略输出异常

---

## 3. 代码流程检查

### 命令传递流程
```
UI输入 → demo.cmd → policyRunner.setCommand() → policyRunner.command → 观察向量
```

### 动作生成流程
```
观察向量 → ONNX推理 → action → actionTarget → 应用到关节
```

### 关键检查点

#### 1. 命令是否正确传递？
```javascript
// main.js: 每帧调用
this.policyRunner.setCommand?.(this.cmd);

// policyRunner.js: setCommand方法
setCommand(cmd) {
  this.command[0] = cmd[0] ?? 0.0;
  this.command[1] = cmd[1] ?? 0.0;
  this.command[2] = cmd[2] ?? 0.0;
}
```

#### 2. 命令是否在观察向量中？
```javascript
// observationHelpers.js: Command类
compute() {
  const cmd = this.policy?.command ?? null;
  return new Float32Array([s * x, s * y, s * z]);
}
```

#### 3. 策略是否产生动作？
```javascript
// policyRunner.js: step方法
const action = result['action']?.data;
// action应该不是全零
```

#### 4. 动作是否应用到关节？
```javascript
// main.js: 应用动作
this.simulation.ctrl[ctrl_adr] = ctrlValue;
```

---

## 4. 可能的问题

### 问题1：命令没有持续传递
- **症状**：初始有动作，但很快停止
- **原因**：命令被重置为[0,0,0]
- **检查**：`_updateGamepadCommand()` 是否重置了命令

### 问题2：策略输出异常
- **症状**：命令存在，但动作很小或全零
- **原因**：策略推理有问题
- **检查**：观察向量是否正确，策略输出范围

### 问题3：动作没有应用
- **症状**：有动作输出，但关节不动
- **原因**：PD增益问题或动作映射错误
- **检查**：PD增益是否正确，动作是否应用到正确的关节

### 问题4：joint2motor_idx重新排序错误
- **症状**：动作应用到错误的关节
- **原因**：重新排序逻辑错误
- **检查**：动作和PD增益是否按正确的顺序应用

---

## 5. 调试建议

### 检查命令
```javascript
// 在控制台输入
const demo = window.demo;
console.log('当前命令:', Array.from(demo.cmd));
console.log('策略命令:', Array.from(demo.policyRunner.command));
```

### 检查动作输出
```javascript
// 在控制台输入
const pr = window.demo.policyRunner;
console.log('最后动作值:', Array.from(pr.lastActions));
console.log('动作目标:', Array.from(window.demo.actionTarget));
```

### 检查关节控制
```javascript
// 在控制台输入
const demo = window.demo;
const ctrlValues = demo.ctrl_adr_policy.map(adr => demo.simulation.ctrl[adr]);
console.log('控制值:', ctrlValues);
console.log('左腿控制值:', [ctrlValues[0], ctrlValues[3], ctrlValues[6], ctrlValues[9], ctrlValues[13], ctrlValues[17]]);
console.log('右腿控制值:', [ctrlValues[1], ctrlValues[4], ctrlValues[7], ctrlValues[10], ctrlValues[14], ctrlValues[18]]);
```

---

## 6. 总结

### 正常行为
- ✅ **应该持续运动**：forward命令应该导致机器人持续行走
- ✅ **腿部运动**：交替迈步
- ✅ **手臂可能摆动**：取决于策略训练

### 如果不动，可能的原因
1. 命令没有正确传递
2. 策略输出异常
3. 动作没有正确应用
4. joint2motor_idx重新排序错误（刚修复的问题）

### 如果过度运动，可能的原因
1. 动作缩放过大
2. PD增益过大
3. 策略输出异常
