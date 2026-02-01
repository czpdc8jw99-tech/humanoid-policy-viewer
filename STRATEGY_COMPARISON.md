# 策略对比分析：为什么Tracking能站，Loco不能站？

## 🔍 关键问题回答

### 问题1：default_joint_pos有区别吗？

**答案：有区别，但差异不大**

| 关节 | Loco策略 | Tracking策略 | 差异 |
|------|---------|-------------|------|
| **hip_pitch (left)** | -0.2 | -0.28 | -0.08 |
| **hip_pitch (right)** | -0.2 | -0.28 | -0.08 |
| **knee (left)** | 0.42 | 0.5 | +0.08 |
| **knee (right)** | 0.42 | 0.5 | +0.08 |
| **ankle_pitch (left)** | -0.23 | -0.23 | 0.0 |
| **ankle_pitch (right)** | -0.23 | -0.23 | 0.0 |
| **shoulder_roll (left)** | 0.18 | 0.16 | -0.02 |
| **shoulder_roll (right)** | -0.18 | -0.16 | +0.02 |

**结论**：差异不大，主要差异在knee角度（0.42 vs 0.5）和hip_pitch（-0.2 vs -0.28）

---

### 问题2：如果没有区别，为什么一个能站，另一个不能？

**答案：不是因为default_joint_pos不同，而是因为工作机制根本不同！**

---

## 💡 工作机制的根本差异

### Tracking策略的工作机制：

```
1. 有TrackingHelper
   ↓
2. 加载motions.json中的"default" motion（多帧序列）
   ↓
3. 策略输入包含TargetJointPosObs（目标关节位置，来自default motion）
   ↓
4. 策略输出的是"调整量"（相对于目标动作的增量）
   ↓
5. 最终目标 = default motion中的关节位置 + 策略输出的调整量
```

**关键点**：
- ✅ 策略**不直接输出完整姿态**
- ✅ 策略输出的是**相对于目标动作的调整量**
- ✅ `default` motion提供了**稳定的基础序列**
- ✅ 即使策略输出不稳定，`default` motion提供了稳定的基础

---

### Loco策略的工作机制：

```
1. 没有TrackingHelper
   ↓
2. 没有default motion序列
   ↓
3. 策略输入包含Command（速度命令）
   ↓
4. 策略输出的是"完整的动作值"（相对于default_joint_pos）
   ↓
5. 最终目标 = default_joint_pos + action_scale * 策略输出
```

**关键点**：
- ❌ 策略**直接输出完整姿态**
- ❌ 策略输出的是**完整的动作值**
- ❌ 没有稳定的基础序列可以依赖
- ❌ 策略是为**行走**设计的，零命令时输出不稳定

---

## 🎯 核心差异总结

| 特性 | Tracking策略 | Loco策略 |
|------|-------------|----------|
| **是否有TrackingHelper** | ✅ 有 | ❌ 无 |
| **是否有default motion序列** | ✅ 有（motions.json） | ❌ 无 |
| **策略输出类型** | 调整量（增量） | 完整动作值 |
| **目标位置计算** | default motion + 调整量 | default_joint_pos + action_scale * 输出 |
| **稳定性来源** | default motion序列 | 策略本身（不稳定） |

---

## 🔍 为什么Loco策略站不起来？

### 根本原因：

1. **策略是为行走设计的**：
   - 策略在零命令时输出不稳定
   - 即使使用 `default_joint_pos`，策略仍然在输出非零的动作值

2. **没有稳定的基础序列**：
   - Tracking策略有 `default` motion序列作为稳定基础
   - Loco策略只有单个 `default_joint_pos`，没有序列

3. **PD增益可能不合适**：
   - Loco策略的stiffness较大（20-200）
   - Tracking策略的stiffness较小（14-99）
   - 可能导致过度响应

---

## 📋 需要验证的问题

### 问题1：零命令时是否真的使用了default_joint_pos？

**验证方法**：
```javascript
// 在控制台运行
const demo = window.demo;
const pr = demo.policyRunner;

// 确保命令为零
demo.cmd[0] = 0.0;
demo.cmd[1] = 0.0;
demo.cmd[2] = 0.0;
pr.setCommand([0.0, 0.0, 0.0]);

// 等待几帧后检查
setTimeout(() => {
  console.log('=== 检查零命令时的actionTarget ===');
  console.log('demo.cmd:', Array.from(demo.cmd));
  console.log('pr.command:', Array.from(pr.command));
  console.log('actionTarget (前6个):', demo.actionTarget ? Array.from(demo.actionTarget).slice(0, 6) : 'null');
  console.log('default_joint_pos (前6个):', Array.from(pr.defaultJointPos).slice(0, 6));
  
  if (demo.actionTarget && pr.defaultJointPos) {
    const match = Array.from(demo.actionTarget).slice(0, 6).every((val, idx) => 
      Math.abs(val - pr.defaultJointPos[idx]) < 0.001
    );
    console.log('actionTarget是否等于default_joint_pos:', match ? '✅ 是' : '❌ 否');
    
    if (!match) {
      console.log('差异:', Array.from(demo.actionTarget).slice(0, 6).map((val, idx) => 
        (val - pr.defaultJointPos[idx]).toFixed(4)
      ));
    }
  }
}, 500);
```

**如果发现actionTarget不等于default_joint_pos**：
- 说明零命令检测逻辑可能有问题
- 或者策略仍然在输出非零的动作值

---

### 问题2：default_joint_pos是否合理？

**对比分析**：
- Tracking策略：knee=0.5（更弯曲），hip_pitch=-0.28（更向后）
- Loco策略：knee=0.42（较直），hip_pitch=-0.2（较前）

**可能的问题**：
- Loco策略的knee角度可能太小，导致站立不稳定
- 可能需要调整使其更接近tracking策略

---

### 问题3：PD增益是否合适？

**对比**：
- Tracking策略：stiffness较小（14-99），damping较小（0.9-6.3）
- Loco策略：stiffness较大（20-200），damping较大（2-5）

**可能的问题**：
- Loco策略的PD增益可能太大，导致过度响应
- 可能需要降低PD增益

---

## 🎯 可能的问题和解决方案

### 问题A：零命令检测逻辑有问题

**如果发现**：即使命令为零，`actionTarget` 不等于 `default_joint_pos`

**可能原因**：
- 零命令检测的阈值（0.01）可能太小
- 或者检测逻辑有问题

**解决方案**：
- 检查零命令检测逻辑
- 可能需要调整阈值或修复逻辑

---

### 问题B：default_joint_pos不合理

**如果发现**：`default_joint_pos` 与tracking策略差异较大

**解决方案**：
- 调整 `default_joint_pos` 使其更接近tracking策略
- 特别是knee角度（0.42 → 0.5）和hip_pitch（-0.2 → -0.28）

---

### 问题C：PD增益不合适

**如果发现**：PD增益差异很大

**解决方案**：
- 降低PD增益，特别是腿部关节
- 参考tracking策略的PD增益值

---

### 问题D：初始状态设置问题

**如果发现**：初始状态不正确

**解决方案**：
- 检查并修复初始状态设置
- 确保初始位置和关节位置正确

---

## 📝 总结

### 关键发现：

1. **default_joint_pos有差异，但不大**：
   - 主要差异在knee角度和hip_pitch

2. **工作机制根本不同**：
   - Tracking策略：使用default motion序列，策略输出调整量
   - Loco策略：直接输出完整姿态，没有稳定的基础序列

3. **这才是关键**：
   - Tracking策略能站，是因为有default motion序列作为稳定基础
   - Loco策略不能站，是因为策略直接输出完整姿态，且策略是为行走设计的

### 需要验证：

1. ✅ 零命令时是否真的使用了 `default_joint_pos`？
2. ✅ `default_joint_pos` 是否合理？
3. ✅ PD增益是否合适？
4. ✅ 初始状态是否正确？

---

## 🚀 下一步

请运行上面的检查命令，告诉我结果，我会根据结果确定问题所在并给出修复方案。
