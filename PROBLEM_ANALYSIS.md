# 问题分析：为什么Tracking策略能站，Loco策略不能站？

## 🔍 关键发现

### 1. default_joint_pos 的对比

**Loco策略**：
```json
"default_joint_pos": [
  -0.2, -0.2, 0.0,    // hip_pitch (left, right, waist_yaw)
  0.0, 0.0, 0.0,      // hip_roll (left, right, waist_roll)
  0.0, 0.0, 0.0,      // hip_yaw (left, right, waist_pitch)
  0.42, 0.42,         // knee (left, right)
  0.35, 0.35,         // shoulder_pitch (left, right)
  -0.23, -0.23,       // ankle_pitch (left, right)
  0.18, -0.18,        // shoulder_roll (left, right)
  0.0, 0.0,           // ankle_roll (left, right)
  0.0, 0.0,           // shoulder_yaw (left, right)
  0.87, 0.87,         // elbow (left, right)
  0.0, 0.0, 0.0, 0.0, // wrist joints
  0.0, 0.0, 0.0, 0.0
]
```

**Tracking策略**：
```json
"default_joint_pos": [
  -0.28, -0.28, 0.0,  // hip_pitch (left, right, waist_yaw)
  0.0, 0.0, 0.0,      // hip_roll (left, right, waist_roll)
  0.0, 0.0, 0.0,      // hip_yaw (left, right, waist_pitch)
  0.5, 0.5,           // knee (left, right) ⚠️ 不同！
  0.35, 0.35,         // shoulder_pitch (left, right)
  -0.23, -0.23,       // ankle_pitch (left, right)
  0.16, -0.16,        // shoulder_roll (left, right) ⚠️ 不同！
  0.0, 0.0,           // ankle_roll (left, right)
  0.0, 0.0,           // shoulder_yaw (left, right)
  0.87, 0.87,         // elbow (left, right)
  0.0, 0.0, 0.0, 0.0, // wrist joints
  0.0, 0.0, 0.0, 0.0
]
```

**差异**：
- **knee**: Loco=0.42, Tracking=0.5（Tracking更大，更弯曲）
- **hip_pitch**: Loco=-0.2, Tracking=-0.28（Tracking更向后）
- **shoulder_roll**: Loco=0.18/-0.18, Tracking=0.16/-0.16（略有不同）

---

### 2. 工作机制的根本差异

#### Tracking策略的工作机制：

1. **使用TrackingHelper**：
   - 有 `tracking` 配置
   - 加载 `motions.json` 中的 `default` motion
   - `default` motion 是一个**完整的动作序列**（多帧数据）

2. **策略输入**：
   - 策略**不直接输出关节位置**
   - 策略输出的是**相对于目标动作的调整量**
   - 目标动作来自 `TrackingHelper.getFrame()`，从 `motions.json` 的 `default` motion 中获取

3. **最终目标位置**：
   ```
   最终目标 = default_motion中的关节位置 + 策略输出的调整量
   ```

4. **为什么稳定**：
   - `default` motion 是一个**经过训练的稳定站立序列**
   - 策略只需要做**微调**，而不是直接输出整个姿态
   - 即使策略输出不稳定，`default` motion 提供了稳定的基础

#### Loco策略的工作机制：

1. **没有TrackingHelper**：
   - 没有 `tracking` 配置
   - 没有 `motions.json`
   - 没有 `default` motion 序列

2. **策略输入**：
   - 策略**直接输出关节位置**（相对于 `default_joint_pos`）
   - 策略输出的是**完整的动作值**

3. **最终目标位置**：
   ```
   最终目标 = default_joint_pos + action_scale * 策略输出
   ```

4. **为什么不稳定**：
   - 策略需要**直接输出整个姿态**
   - 策略是为**行走**设计的，不是为**站立**设计的
   - 零命令时策略输出不稳定（即使对称化后）

---

## 💡 关键洞察

### 为什么Tracking策略能站？

**不是因为 `default_joint_pos` 不同**，而是因为：

1. **Tracking策略使用 `default` motion序列**：
   - `default` motion 是一个**多帧的稳定站立序列**
   - 策略只需要跟踪这个序列，做微调

2. **策略输出是调整量，不是完整姿态**：
   - 策略输出的是相对于目标动作的**增量**
   - 即使策略输出不稳定，`default` motion 提供了稳定的基础

3. **有平滑过渡**：
   - `TrackingHelper` 有 `transition_steps`，提供平滑过渡
   - 动作变化是渐进的，不是突变的

### 为什么Loco策略不能站？

**不是因为 `default_joint_pos` 不同**，而是因为：

1. **Loco策略直接输出完整姿态**：
   - 策略输出的是**完整的动作值**
   - 没有稳定的基础序列可以依赖

2. **策略是为行走设计的**：
   - 策略在零命令时输出不稳定
   - 即使有强制对称化，策略输出仍然可能导致不稳定

3. **没有平滑机制**：
   - 动作变化可能是突变的
   - 没有过渡机制

---

## 🎯 问题根源

### 核心问题：

**Loco策略在零命令时，即使使用 `default_joint_pos`，策略输出仍然不稳定**

可能的原因：
1. **策略输出值过大**：即使使用 `default_joint_pos`，策略输出的调整量仍然过大
2. **PD增益不合适**：stiffness/damping 可能不适合稳定站立
3. **default_joint_pos 本身不稳定**：这个姿态可能不是稳定的站立姿态
4. **初始状态设置问题**：机器人初始状态可能不正确

---

## 🔍 需要检查的点

### 1. 检查策略输出是否真的使用了default_joint_pos

**验证方法**：
- 在零命令时，检查 `actionTarget` 是否等于 `default_joint_pos`
- 如果不等，说明策略仍然在输出非零的动作值

### 2. 检查default_joint_pos是否合理

**对比**：
- Tracking策略的 `default_joint_pos`：knee=0.5, hip_pitch=-0.28
- Loco策略的 `default_joint_pos`：knee=0.42, hip_pitch=-0.2

**可能的问题**：
- Loco策略的knee角度可能太小（0.42 vs 0.5）
- 可能需要调整使其更接近tracking策略

### 3. 检查PD增益

**对比**：
- Tracking策略：stiffness较小（14-99），damping较小（0.9-6.3）
- Loco策略：stiffness较大（20-200），damping较大（2-5）

**可能的问题**：
- Loco策略的PD增益可能太大，导致过度响应
- 可能需要降低PD增益

### 4. 检查初始状态

**验证方法**：
- 检查机器人初始位置（qpos[2]）是否正确（应该是0.8）
- 检查初始关节位置是否正确设置
- 检查初始速度是否为零

---

## 📋 下一步检查步骤

### 步骤1：验证零命令时是否真的使用了default_joint_pos

**在控制台运行**：
```javascript
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
  console.log('actionTarget:', demo.actionTarget ? Array.from(demo.actionTarget).slice(0, 6) : 'null');
  console.log('default_joint_pos:', Array.from(pr.defaultJointPos).slice(0, 6));
  
  if (demo.actionTarget && pr.defaultJointPos) {
    const match = Array.from(demo.actionTarget).slice(0, 6).every((val, idx) => 
      Math.abs(val - pr.defaultJointPos[idx]) < 0.001
    );
    console.log('actionTarget是否等于default_joint_pos:', match ? '✅ 是' : '❌ 否');
    
    if (!match) {
      console.log('差异:', Array.from(demo.actionTarget).slice(0, 6).map((val, idx) => 
        val - pr.defaultJointPos[idx]
      ));
    }
  }
}, 500);
```

### 步骤2：对比default_joint_pos

**在控制台运行**：
```javascript
const demo = window.demo;
const pr = demo.policyRunner;

console.log('=== default_joint_pos 对比 ===');
console.log('Loco策略的default_joint_pos (前6个):', Array.from(pr.defaultJointPos).slice(0, 6));

// 对比Tracking策略的default_joint_pos
const trackingDefault = [
  -0.28, -0.28, 0.0,  // hip_pitch
  0.0, 0.0, 0.0       // hip_roll
];
console.log('Tracking策略的default_joint_pos (前6个):', trackingDefault);

console.log('差异:');
console.log('hip_pitch (left):', pr.defaultJointPos[0], 'vs', trackingDefault[0], 'diff:', pr.defaultJointPos[0] - trackingDefault[0]);
console.log('hip_pitch (right):', pr.defaultJointPos[1], 'vs', trackingDefault[1], 'diff:', pr.defaultJointPos[1] - trackingDefault[1]);
console.log('knee (left):', pr.defaultJointPos[9], 'vs', 0.5, 'diff:', pr.defaultJointPos[9] - 0.5);
console.log('knee (right):', pr.defaultJointPos[10], 'vs', 0.5, 'diff:', pr.defaultJointPos[10] - 0.5);
```

### 步骤3：检查PD增益

**在控制台运行**：
```javascript
const demo = window.demo;
console.log('=== PD增益对比 ===');
console.log('Loco策略的stiffness (前6个):', Array.from(demo.kpPolicy).slice(0, 6));
console.log('Loco策略的damping (前6个):', Array.from(demo.kdPolicy).slice(0, 6));

// Tracking策略的PD增益（参考值）
const trackingKp = [40.18, 40.18, 40.18, 99.10, 99.10, 28.50];
const trackingKd = [2.56, 2.56, 2.56, 6.31, 6.31, 1.81];
console.log('Tracking策略的stiffness (前6个):', trackingKp);
console.log('Tracking策略的damping (前6个):', trackingKd);

console.log('差异:');
for (let i = 0; i < 6; i++) {
  console.log(`关节${i}: kp ${demo.kpPolicy[i]} vs ${trackingKp[i]} (diff: ${demo.kpPolicy[i] - trackingKp[i]}), kd ${demo.kdPolicy[i]} vs ${trackingKd[i]} (diff: ${demo.kdPolicy[i] - trackingKd[i]})`);
}
```

### 步骤4：检查初始状态

**在控制台运行**：
```javascript
const demo = window.demo;
if (demo.simulation) {
  console.log('=== 初始状态检查 ===');
  console.log('根位置Z:', demo.simulation.qpos[2]);
  console.log('前6个关节位置:', demo.qpos_adr_policy ? 
    demo.qpos_adr_policy.slice(0, 6).map(adr => demo.simulation.qpos[adr]) : 'null'
  );
  console.log('前6个关节速度:', demo.qvel_adr_policy ? 
    demo.qvel_adr_policy.slice(0, 6).map(adr => demo.simulation.qvel[adr]) : 'null'
  );
  console.log('default_joint_pos (前6个):', demo.defaultJposPolicy ? 
    Array.from(demo.defaultJposPolicy).slice(0, 6) : 'null'
  );
}
```

---

## 🎯 可能的问题和解决方案

### 问题1：策略输出仍然非零

**如果发现**：即使命令为零，`actionTarget` 不等于 `default_joint_pos`

**可能原因**：
- 零命令检测逻辑有问题
- 策略仍然在输出非零的动作值

**解决方案**：
- 检查零命令检测逻辑
- 确保策略输出被正确跳过

---

### 问题2：default_joint_pos不合理

**如果发现**：`default_joint_pos` 与tracking策略差异较大

**可能原因**：
- Loco策略的 `default_joint_pos` 可能不是稳定的站立姿态

**解决方案**：
- 调整 `default_joint_pos` 使其更接近tracking策略
- 特别是knee角度（0.42 → 0.5）和hip_pitch（-0.2 → -0.28）

---

### 问题3：PD增益不合适

**如果发现**：PD增益差异很大

**可能原因**：
- Loco策略的PD增益可能太大，导致过度响应

**解决方案**：
- 降低PD增益，特别是腿部关节
- 参考tracking策略的PD增益值

---

### 问题4：初始状态设置问题

**如果发现**：初始状态不正确

**可能原因**：
- 初始位置或关节位置设置不正确

**解决方案**：
- 检查并修复初始状态设置

---

## 📝 总结

### 关键发现：

1. **default_joint_pos有差异**：
   - Knee: Loco=0.42, Tracking=0.5
   - Hip_pitch: Loco=-0.2, Tracking=-0.28

2. **工作机制根本不同**：
   - Tracking策略：使用 `default` motion序列，策略输出调整量
   - Loco策略：直接输出完整姿态，没有稳定的基础序列

3. **PD增益差异很大**：
   - Tracking策略：较小的PD增益
   - Loco策略：较大的PD增益

### 需要验证：

1. ✅ 零命令时是否真的使用了 `default_joint_pos`？
2. ✅ `default_joint_pos` 是否合理？
3. ✅ PD增益是否合适？
4. ✅ 初始状态是否正确？

---

## 🚀 下一步

请运行上面的检查命令，告诉我结果，我会根据结果确定问题所在并给出修复方案。
