# 诊断命令集合

## 问题：机器人站不住，看不出有抵抗趋势

## 诊断步骤

### 步骤 1：检查原始策略输出范围

**目的**：确认 tanh 是否压缩了动作范围

**操作**：刷新页面，选择策略，查看控制台

**预期输出**：
```
=== [PolicyRunner] Raw policy output range (BEFORE tanh/clip) ===
Min: -X.XXXX
Max: X.XXXX
Mean: X.XXXX
Std: X.XXXX
Range: [-X.XX, X.XX]
```

**分析**：
- 如果范围是 [-1, 1] 左右 → tanh 影响不大，需要增加 action_scale
- 如果范围是 [-4, 4] 或更大 → tanh 压缩了范围，应该移除 tanh

---

### 步骤 2：监控观察向量更新

**目的**：确认策略能够感知到机器人的倾斜和旋转

**在控制台运行**：
```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 持续监控观察向量（每 500ms）
const monitor = setInterval(() => {
  const state = demo.readPolicyState();
  
  // 检查重力投影
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (gravityObs) {
    const gravity = gravityObs.compute(state);
    const magnitude = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
    console.log('ProjectedGravityB:', Array.from(gravity).map(v => v.toFixed(3)), '|magnitude:', magnitude.toFixed(3));
    // 正常应该是 [0, 0, -1] 或接近，如果机器人倾斜会偏离
  }
  
  // 检查角速度
  const angVel = state.rootAngVel;
  const angVelMag = Math.sqrt(angVel[0]**2 + angVel[1]**2 + angVel[2]**2);
  console.log('RootAngVelB:', Array.from(angVel).map(v => v.toFixed(3)), '|magnitude:', angVelMag.toFixed(3));
  
  // 检查动作输出
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
  const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
  console.log('Action magnitude - Left:', leftAvg.toFixed(3), 'Right:', rightAvg.toFixed(3));
  
  // 检查目标位置
  const targets = demo.actionTarget;
  if (targets && targets.length >= 29) {
    const leftTargets = leftLegIndices.map(i => targets[i]);
    const rightTargets = rightLegIndices.map(i => targets[i]);
    const leftTargetAvg = leftTargets.reduce((sum, t) => sum + Math.abs(t), 0) / leftTargets.length;
    const rightTargetAvg = rightTargets.reduce((sum, t) => sum + Math.abs(t), 0) / rightTargets.length;
    console.log('Target magnitude - Left:', leftTargetAvg.toFixed(3), 'Right:', rightTargetAvg.toFixed(3));
  }
  
  console.log('---');
}, 500); // 每 500ms 输出一次

// 运行 10 秒后停止
setTimeout(() => {
  clearInterval(monitor);
  console.log('Monitoring stopped');
}, 10000);
```

**预期结果**：
- 如果机器人倾斜，ProjectedGravityB 应该偏离 [0, 0, -1]
- 如果机器人开始倒下，RootAngVelB 应该增加
- 策略应该输出相应的恢复动作（action magnitude 应该增加）

**如果观察向量没有变化**：
- 说明状态读取有问题
- 需要检查 `readPolicyState()` 的实现

**如果观察向量有变化，但动作没有响应**：
- 说明策略推理有问题
- 需要检查策略输出或 ONNX 模型

---

### 步骤 3：检查观察向量更新频率

**目的**：确认观察向量是否每帧都更新

**操作**：查看控制台，应该每 60 帧（约 1 秒）看到一次观察向量更新日志

**预期输出**：
```
[PolicyRunner] Obs update (frame 60): {gravity: [...], gravityMag: ..., angVel: [...], angVelMag: ..., command: [...]}
[PolicyRunner] Obs update (frame 120): {gravity: [...], gravityMag: ..., angVel: [...], angVelMag: ..., command: [...]}
```

**如果看不到这些日志**：
- 说明观察向量更新有问题
- 需要检查代码

---

## 根据诊断结果决定下一步

### 情况 1：原始输出范围是 [-1, 1] 左右

**问题**：tanh 影响不大，但动作幅度太小

**解决方案**：
1. 继续增加 action_scale 到 1.0
2. 如果还不够，增加到 1.5 或 2.0

---

### 情况 2：原始输出范围是 [-4, 4] 或更大

**问题**：tanh 压缩了动作范围

**解决方案**：
1. 移除 tanh（设置 `action_squash: null`）
2. 保持 action_scale = 0.5
3. 测试效果
4. 如果不行，再调整 action_scale

---

### 情况 3：观察向量没有变化

**问题**：状态读取或观察向量构建有问题

**解决方案**：
1. 检查 `readPolicyState()` 是否正确读取状态
2. 检查 `ProjectedGravityB.compute()` 是否正确计算
3. 检查 `RootAngVelB` 是否正确读取

---

### 情况 4：观察向量有变化，但动作没有响应

**问题**：策略推理有问题，或者策略本身没有学会平衡恢复

**解决方案**：
1. 检查策略输出是否正常
2. 检查 ONNX 转换是否正确
3. 可能需要检查原始策略的训练数据

---

## 快速测试方案

如果诊断太复杂，可以直接尝试：

### 方案 A：移除 tanh + 保持 action_scale = 0.5

修改 `loco_policy_29dof.json`：
```json
{
  "action_scale": 0.5,
  "action_squash": null,  // 移除 tanh
  // ... 其他配置
}
```

### 方案 B：保持 tanh + 增加 action_scale 到 1.0

修改 `loco_policy_29dof.json`：
```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
  "action_squash": "tanh",
  // ... 其他配置
}
```
