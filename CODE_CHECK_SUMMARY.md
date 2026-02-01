# 代码检查总结 - v9.0.22

## 已修复的问题

### ✅ 1. Warmup 观察向量
- **修复**：使用全零观察向量 `new Float32Array(this.numObs).fill(0)`
- **验证**：添加了日志 `[PolicyRunner] Warmup observation vector: { isAllZero: "✅ YES" }`

### ✅ 2. ProjectedGravityB 计算
- **修复**：统一使用 `quatApplyInv` 方法
- **验证**：添加了日志 `[ProjectedGravityB] Gravity direction`

---

## 代码逻辑检查

### ✅ 观察向量构建顺序
```javascript
// 顺序：RootAngVelB(3) + ProjectedGravityB(3) + Command(3) + JointPosRel(29) + JointVel(29) + PrevActions(29)
// 总计：3 + 3 + 3 + 29 + 29 + 29 = 96 ✅
```

### ✅ 动作处理流程
```javascript
// 1. 策略输出原始动作
const action = result['action']?.data;

// 2. Clip 到 [-100, 100]
const clamped = Math.max(-clip, Math.min(clip, value));

// 3. 计算目标位置
target[i] = defaultJointPos[i] + actionScale[i] * lastActions[i];
// ✅ 公式正确
```

### ✅ 观察向量 clip
```javascript
// 在推理前 clip 到 [-100, 100]
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}
// ✅ 已实现
```

---

## 潜在问题检查

### ⚠️ 检查 1：PrevActions 的值

**问题**：PrevActions 存储的是什么值？
- 原始动作（clip 前）？
- 处理后的动作（clip 后）？

**原始 Python**：
```python
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()
# self.action 是 clip 后的值
```

**我们的代码**：
```javascript
// PrevActions.update() 在推理之后调用
const source = this.policy?.lastActions ?? new Float32Array(this.numActions);
this.actionBuffer[0].set(source);
// lastActions 是 clip 后的值 ✅ 正确
```

**结论**：✅ PrevActions 使用 clip 后的动作，正确

---

### ⚠️ 检查 2：动作 clip 的顺序

**原始 Python**：
```python
self.action = self.policy(...).clip(-100, 100)
# 直接 clip 原始输出
```

**我们的代码**：
```javascript
let value = action[i];
if (this.actionSquash === 'tanh') {
  value = Math.tanh(value);  // 当前配置为 null，不会执行
}
const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
// ✅ 顺序正确（虽然当前配置下 tanh 不会执行）
```

**结论**：✅ 顺序正确

---

### ⚠️ 检查 3：初始关节位置设置

**我们的代码**：
```javascript
// reloadPolicy 中
for (let i = 0; i < this.numActions; i++) {
  const qposAdr = this.qpos_adr_policy[i];
  qpos[qposAdr] = this.defaultJposPolicy[i];
}
// ✅ 正确设置初始关节位置
```

**结论**：✅ 正确

---

## 需要进一步检查的问题

### 问题 1：动作符号

如果机器人往后倒，可能是：
1. 动作符号错误（策略输出正动作，但实际应用时方向相反）
2. 关节定义方向错误

**检查方法**：
- 观察策略输出的动作值
- 检查目标位置是否正确计算
- 验证关节是否按预期方向移动

---

### 问题 2：重力方向计算

如果机器人往后倒，可能是：
1. 重力方向计算错误（导致策略认为机器人前倾，实际是后倾）
2. 四元数顺序错误

**检查方法**：
- 验证 ProjectedGravityB 的计算结果
- 检查机器人站立时重力方向是否为 `[0, 0, -1]`

---

## 建议的调试步骤

1. **刷新页面，加载策略**
2. **检查控制台日志**：
   - Warmup 观察向量是否为全零
   - ProjectedGravityB 重力方向
   - 观察向量范围
3. **运行控制台检查命令**（见 CONSOLE_COMMANDS_V9.0.22.md）
4. **观察机器人行为**
