# 机器人平稳站立 - 系统性检查计划

## 目标
让机器人能够**平稳站立**，不摔倒，不左右摇摆。

---

## 核心问题分析

### 1. 策略本身的特性
**问题**：`loco_mode` 策略可能本身就不是设计用来"静止站立"的，而是设计用来"在运动中保持平衡"的。

**检查方法**：
- 查看原始 Python 代码中策略的训练目标
- 检查策略是否期望有持续的微小运动来保持平衡
- 验证零速度命令（`cmd = [0, 0, 0]`）时策略的输出

**可能的结果**：
- 如果策略确实需要微小运动，我们需要：
  - 接受机器人会有微小的"呼吸"运动
  - 或者使用专门的"站立"策略

---

## 系统性检查清单

### ✅ 已完成的修复
1. ✅ LSTM warmup 使用全零观察向量
2. ✅ 输入观察向量裁剪到 [-100, 100]
3. ✅ ProjectedGravityB 计算统一
4. ✅ 初始姿态设置（default_joint_pos）
5. ✅ 初始高度设置（qpos[2] = 0.8）
6. ✅ PrevActions 更新时机修复
7. ✅ action_scale 调整（0.55）

### 🔍 需要验证的关键点

#### A. 观察向量准确性（最重要）

**1.1 重力方向（ProjectedGravityB）**
- **检查**：机器人站立时，重力方向应该是 `[0, 0, -1]`（机器人坐标系）
- **验证方法**：
  ```javascript
  const pr = window.demo.policyRunner;
  const demo = window.demo;
  const state = demo.readPolicyState();
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  const gravity = gravityObs.compute(state);
  console.log('Gravity:', Array.from(gravity)); // 应该是 [0, 0, -1] 或接近
  ```
- **问题**：如果重力方向不对，策略会认为机器人在倾斜，导致错误补偿

**1.2 根角速度（RootAngVelB）**
- **检查**：机器人静止时，根角速度应该是 `[0, 0, 0]`
- **验证方法**：
  ```javascript
  const state = demo.readPolicyState();
  console.log('RootAngVel:', state.rootAngVel); // 应该是 [0, 0, 0]
  ```
- **问题**：如果有非零角速度，策略会认为机器人在旋转，导致错误补偿

**1.3 命令（Command）**
- **检查**：零速度命令应该是 `[0, 0, 0]`
- **验证方法**：
  ```javascript
  const pr = window.demo.policyRunner;
  console.log('Command:', Array.from(pr.command)); // 应该是 [0, 0, 0]
  ```
- **问题**：如果命令非零，策略会尝试移动，导致不稳定

**1.4 关节位置相对值（JointPosRel）**
- **检查**：初始时应该是 `[0, 0, 0, ...]`（所有关节都在默认位置）
- **验证方法**：
  ```javascript
  const pr = window.demo.policyRunner;
  const state = demo.readPolicyState();
  const jointPosRelObs = pr.obsModules.find(obs => obs.constructor.name === 'JointPosRel');
  const jointPosRel = jointPosRelObs.compute(state);
  console.log('JointPosRel (first 6):', Array.from(jointPosRel.slice(0, 6)));
  ```
- **问题**：如果初始关节位置不对，策略会尝试调整，导致不稳定

**1.5 关节速度（JointVel）**
- **检查**：初始时应该是 `[0, 0, 0, ...]`
- **验证方法**：
  ```javascript
  const state = demo.readPolicyState();
  console.log('JointVel (first 6):', state.jointVel.slice(0, 6));
  ```
- **问题**：如果有初始速度，策略会认为机器人在运动

**1.6 前一步动作（PrevActions）**
- **检查**：初始时应该是 `[0, 0, 0, ...]`
- **验证方法**：
  ```javascript
  const pr = window.demo.policyRunner;
  console.log('PrevActions (first 6):', Array.from(pr.lastActions.slice(0, 6)));
  ```
- **问题**：如果前一步动作非零，会影响当前动作

---

#### B. 动作映射正确性

**2.1 动作到关节的映射**
- **检查**：策略输出的动作是否正确映射到对应的关节
- **验证方法**：
  ```javascript
  // 检查左右腿动作是否对称（零速度命令时）
  const pr = window.demo.policyRunner;
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
  const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
  console.log('Left leg avg:', leftAvg, 'Right leg avg:', rightAvg);
  console.log('Symmetry ratio:', Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg));
  ```
- **问题**：如果映射错误，左右腿动作不对称，会导致摔倒

**2.2 动作方向**
- **检查**：动作的方向是否正确（例如，正动作是否真的让关节向前/向上）
- **验证方法**：
  - 手动设置一个小的正动作，观察关节是否按预期方向移动
  - 检查 `action_scale` 的符号是否正确

---

#### C. PD控制参数

**3.1 刚度（kp）**
- **检查**：kp 值是否合理（通常 100-200）
- **当前值**：查看 `loco_policy_29dof.json` 中的 `stiffness`
- **问题**：
  - kp 太小：关节响应慢，跟不上目标
  - kp 太大：关节响应过快，可能震荡

**3.2 阻尼（kd）**
- **检查**：kd 值是否合理（通常 2-10）
- **当前值**：查看 `loco_policy_29dof.json` 中的 `damping`
- **问题**：
  - kd 太小：关节震荡
  - kd 太大：关节响应过慢

**3.3 PD参数对称性**
- **检查**：左右腿的 kp/kd 是否对称
- **验证方法**：
  ```javascript
  const demo = window.demo;
  const kp = demo.kpPolicy;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  const leftKP = leftLegIndices.map(i => kp[i]);
  const rightKP = rightLegIndices.map(i => kp[i]);
  console.log('Left leg KP:', leftKP);
  console.log('Right leg KP:', rightKP);
  ```

---

#### D. 策略输出范围

**4.1 原始输出范围**
- **检查**：策略的原始输出（在 tanh/clip 之前）是否在合理范围内
- **验证方法**：
  - 查看控制台中的 `[PolicyRunner] Raw policy output range` 日志
  - 或者手动检查（需要修改代码）

**4.2 动作缩放**
- **检查**：`action_scale` 是否合适
- **当前值**：0.55
- **问题**：
  - 太小：动作幅度太小，无法保持平衡
  - 太大：动作幅度太大，导致过度调整

---

#### E. 初始状态

**5.1 初始姿态**
- **检查**：机器人是否在正确的初始姿态
- **验证方法**：
  ```javascript
  const demo = window.demo;
  const qpos = demo.simulation.qpos;
  const pr = window.demo.policyRunner;
  
  // 检查根位置
  console.log('Root position:', qpos[0], qpos[1], qpos[2]); // z 应该是 0.8
  
  // 检查根四元数（应该是 [1, 0, 0, 0] 或接近）
  const rootQuat = [qpos[3], qpos[4], qpos[5], qpos[6]];
  console.log('Root quaternion:', rootQuat);
  
  // 检查关节位置是否匹配 default_joint_pos
  for (let i = 0; i < 6; i++) {
    const qposAdr = demo.qpos_adr_policy[i];
    const currentPos = qpos[qposAdr];
    const defaultPos = pr.defaultJointPos[i];
    console.log(`Joint ${i}: current=${currentPos.toFixed(3)}, default=${defaultPos.toFixed(3)}`);
  }
  ```

**5.2 初始速度**
- **检查**：所有速度（根速度、角速度、关节速度）是否为零
- **验证方法**：
  ```javascript
  const demo = window.demo;
  const qvel = demo.simulation.qvel;
  console.log('Root linear vel:', qvel[0], qvel[1], qvel[2]); // 应该是 [0, 0, 0]
  console.log('Root angular vel:', qvel[3], qvel[4], qvel[5]); // 应该是 [0, 0, 0]
  ```

---

#### F. 物理仿真参数

**6.1 时间步长（timestep）**
- **检查**：MuJoCo 的时间步长是否合理（通常 0.002-0.01）
- **问题**：时间步长太大可能导致数值不稳定

**6.2 重力**
- **检查**：重力是否设置为 `[0, 0, -9.81]` 或类似值
- **验证方法**：查看 `g1.xml` 中的重力设置

---

## 诊断步骤（按优先级）

### 第一步：验证观察向量（最重要）
运行以下命令，检查所有观察组件：

```javascript
function checkObservations() {
  const pr = window.demo.policyRunner;
  const demo = window.demo;
  const state = demo.readPolicyState();
  
  console.log('=== 观察向量检查 ===');
  
  // 1. 重力方向
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  const gravity = gravityObs.compute(state);
  console.log('1. ProjectedGravityB:', Array.from(gravity).map(v => v.toFixed(4)));
  console.log('   预期: [0, 0, -1] (机器人站立时)');
  
  // 2. 根角速度
  console.log('2. RootAngVelB:', state.rootAngVel.map(v => v.toFixed(4)));
  console.log('   预期: [0, 0, 0]');
  
  // 3. 命令
  console.log('3. Command:', Array.from(pr.command).map(v => v.toFixed(4)));
  console.log('   预期: [0, 0, 0] (零速度)');
  
  // 4. 关节位置相对值
  const jointPosRelObs = pr.obsModules.find(obs => obs.constructor.name === 'JointPosRel');
  const jointPosRel = jointPosRelObs.compute(state);
  console.log('4. JointPosRel (first 6):', Array.from(jointPosRel.slice(0, 6)).map(v => v.toFixed(4)));
  console.log('   预期: [0, 0, 0, 0, 0, 0] (初始时)');
  
  // 5. 关节速度
  console.log('5. JointVel (first 6):', state.jointVel.slice(0, 6).map(v => v.toFixed(4)));
  console.log('   预期: [0, 0, 0, 0, 0, 0]');
  
  // 6. 前一步动作
  console.log('6. PrevActions (first 6):', Array.from(pr.lastActions.slice(0, 6)).map(v => v.toFixed(4)));
  console.log('   预期: [0, 0, 0, 0, 0, 0] (初始时)');
  
  // 7. 完整观察向量
  const obsVec = new Float32Array(pr.numObs);
  let offset = 0;
  for (const obs of pr.obsModules) {
    if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
      obs.update(state);
    }
    const obsValue = obs.compute(state);
    const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
    obsVec.set(obsArray, offset);
    offset += obsArray.length;
  }
  console.log('7. 完整观察向量范围:', {
    min: Math.min(...Array.from(obsVec)).toFixed(2),
    max: Math.max(...Array.from(obsVec)).toFixed(2),
    size: obsVec.length
  });
}

checkObservations();
```

### 第二步：验证动作对称性
```javascript
function checkActionSymmetry() {
  const pr = window.demo.policyRunner;
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  
  const leftActions = leftLegIndices.map(i => actions[i]);
  const rightActions = rightLegIndices.map(i => actions[i]);
  
  console.log('=== 动作对称性检查 ===');
  console.log('左腿动作:', leftActions.map(v => v.toFixed(4)));
  console.log('右腿动作:', rightActions.map(v => v.toFixed(4)));
  
  const leftAvg = leftActions.reduce((sum, a) => sum + Math.abs(a), 0) / leftActions.length;
  const rightAvg = rightActions.reduce((sum, a) => sum + Math.abs(a), 0) / rightActions.length;
  const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
  
  console.log('左腿平均幅度:', leftAvg.toFixed(4));
  console.log('右腿平均幅度:', rightAvg.toFixed(4));
  console.log('对称性比例:', ratio.toFixed(4), ratio > 0.7 ? '✅' : '❌');
}

checkActionSymmetry();
```

### 第三步：验证初始状态
```javascript
function checkInitialState() {
  const demo = window.demo;
  const pr = window.demo.policyRunner;
  const qpos = demo.simulation.qpos;
  const qvel = demo.simulation.qvel;
  
  console.log('=== 初始状态检查 ===');
  console.log('根位置 Z:', qpos[2].toFixed(3), qpos[2] === 0.8 ? '✅' : '❌');
  console.log('根线性速度:', [qvel[0], qvel[1], qvel[2]].map(v => v.toFixed(4)));
  console.log('根角速度:', [qvel[3], qvel[4], qvel[5]].map(v => v.toFixed(4)));
  
  console.log('\n关节位置（前6个）:');
  for (let i = 0; i < 6; i++) {
    const qposAdr = demo.qpos_adr_policy[i];
    const currentPos = qpos[qposAdr];
    const defaultPos = pr.defaultJointPos[i];
    const diff = Math.abs(currentPos - defaultPos);
    console.log(`  Joint ${i}: current=${currentPos.toFixed(3)}, default=${defaultPos.toFixed(3)}, diff=${diff.toFixed(3)} ${diff < 0.001 ? '✅' : '❌'}`);
  }
}

checkInitialState();
```

---

## 可能的问题和解决方案

### 问题1：观察向量不正确
**症状**：重力方向、角速度、关节位置等观察值不正确
**解决**：修复对应的观察计算代码

### 问题2：动作不对称
**症状**：左右腿动作幅度差异大
**解决**：
- 检查关节映射
- 检查观察向量中的左右腿数据是否对称
- 检查策略输出本身是否对称

### 问题3：PD参数不合适
**症状**：关节响应过慢或过快，震荡
**解决**：调整 `stiffness` 和 `damping` 参数

### 问题4：策略本身需要运动
**症状**：即使所有观察都正确，策略仍然输出非零动作
**解决**：
- 接受微小的"呼吸"运动
- 或者寻找专门的"站立"策略

### 问题5：初始状态不正确
**症状**：机器人一开始就不在正确的姿态
**解决**：确保 `reloadPolicy()` 正确设置初始姿态和速度

---

## 下一步行动

1. **立即执行**：运行上述三个诊断函数，收集数据
2. **分析结果**：根据诊断结果，确定问题所在
3. **针对性修复**：修复发现的问题
4. **迭代验证**：修复后重新运行诊断，确认改进
