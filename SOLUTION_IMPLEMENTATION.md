# 解决方案实施计划

## 🔴 问题确认

**验证结果**：原始 Python 策略也输出不对称的动作
- 对称性比例：0.3590（严重不对称）
- 右腿 ankle_pitch：4.5077（异常大）

**结论**：策略模型本身有问题，不是转换过程或 JavaScript 实现的问题。

---

## 🔧 解决方案

### 方案1：强制动作对称化（推荐 - 临时修复）

**实现方法**：
在 `policyRunner.js` 的 `step()` 方法中，在策略输出后强制左右腿对称。

**代码位置**：`src/simulation/policyRunner.js`，在 `step()` 方法中，策略推理后。

**实现逻辑**：
```javascript
// 在策略输出后，检查对称性
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(action[i]), 0) / leftLegIndices.length;
const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(action[i]), 0) / rightLegIndices.length;
const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);

if (ratio < 0.7) {
  // 强制对称：使用左右腿的平均值
  const avgMagnitude = (leftAvg + rightAvg) / 2;
  
  // 调整右腿动作值使其与左腿对称
  for (let i = 0; i < leftLegIndices.length; i++) {
    const leftIdx = leftLegIndices[i];
    const rightIdx = rightLegIndices[i];
    
    // 保持左腿动作不变，调整右腿动作使其幅度与左腿相同
    const leftMag = Math.abs(action[leftIdx]);
    const rightMag = Math.abs(action[rightIdx]);
    
    if (rightMag > 0) {
      const scale = leftMag / rightMag;
      action[rightIdx] *= scale;
    }
  }
}
```

**优点**：
- 可以立即打破恶性循环
- 简单易实现
- 不影响策略的正常学习（只是后处理）

**缺点**：
- 可能会掩盖真正的问题
- 不是根本解决方案

---

### 方案2：进一步降低 action_clip（临时修复）

**当前**：`action_clip: 5.0`
**建议**：降低到 `3.0` 或 `2.0`

**实现**：修改 `public/examples/checkpoints/g1/loco_policy_29dof.json`

**优点**：
- 简单易实现
- 可以限制异常大的动作值

**缺点**：
- 可能会限制正常动作的范围
- 不是根本解决方案

---

### 方案3：镜像左腿动作到右腿（临时修复）

**实现方法**：
在策略输出后，将左腿的动作镜像到右腿。

**实现逻辑**：
```javascript
// 镜像左腿动作到右腿
for (let i = 0; i < leftLegIndices.length; i++) {
  const leftIdx = leftLegIndices[i];
  const rightIdx = rightLegIndices[i];
  
  // 镜像：hip_pitch 和 ankle_pitch 需要取反
  if (i === 0 || i === 4) { // hip_pitch or ankle_pitch
    action[rightIdx] = -action[leftIdx];
  } else {
    action[rightIdx] = action[leftIdx];
  }
}
```

**优点**：
- 强制完全对称
- 简单易实现

**缺点**：
- 可能会过度限制策略的灵活性
- 不是根本解决方案

---

## 📋 推荐实施方案

### 第一步：实施方案1（强制动作对称化）

**理由**：
- 可以立即打破恶性循环
- 不影响策略的正常学习
- 简单易实现

### 第二步：如果方案1不够，实施方案2（降低 action_clip）

**理由**：
- 进一步限制异常大的动作值
- 与方案1配合使用

---

## 🎯 实施步骤

### 步骤1：实施方案1

1. 修改 `src/simulation/policyRunner.js`
2. 在 `step()` 方法中，策略推理后添加对称化逻辑
3. 测试效果

### 步骤2：如果不够，实施方案2

1. 修改 `public/examples/checkpoints/g1/loco_policy_29dof.json`
2. 将 `action_clip` 从 5.0 降低到 3.0
3. 测试效果

---

## 📊 预期效果

### 方案1实施后

- ✅ 动作对称性应该显著改善
- ✅ 右腿 ankle_pitch 应该不再异常大
- ✅ 机器人应该能够稳定站立

### 方案2实施后

- ✅ 进一步限制异常大的动作值
- ✅ 动作范围更加合理

---

## 🎓 长期方案

### 方案4：重新训练策略（根本修复）

**方法**：
- 在训练时强制对称性约束
- 使用对称的训练数据
- 添加对称性损失函数

**优点**：
- 从根本上解决问题
- 策略会学习对称性

**缺点**：
- 需要重新训练，耗时较长
- 需要访问训练代码和数据

---

## 📝 注意事项

1. **不要过度限制**：强制对称化应该只在检测到严重不对称时应用
2. **保留灵活性**：不要完全镜像动作，保留策略的灵活性
3. **监控效果**：实施后需要监控机器人的行为表现

---

## 🔄 实施顺序

1. ✅ **验证完成**：确认问题在策略模型本身
2. ⏳ **实施方案1**：强制动作对称化
3. ⏳ **测试效果**：检查机器人是否能够稳定站立
4. ⏳ **如果不够，实施方案2**：进一步降低 action_clip
5. ⏳ **长期方案**：考虑重新训练策略
