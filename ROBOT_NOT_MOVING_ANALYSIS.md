# 机器人完全不动问题分析

## 问题描述
输入forward命令后，机器人完全不动。

## 系统性检查

### 1. 命令传递检查

#### 1.1 命令是否被正确设置？
**位置**: `main.js:698` - `policyRunner.setCommand(this.cmd)`

**可能问题**:
- `this.cmd` 可能为 `[0, 0, 0]`
- `setCommand` 可能没有被调用（`policyRunner` 为 `null`）

**检查点**:
```javascript
// 在控制台检查
window.demo.cmd  // 应该是 [0.3, 0, 0] 或类似值
window.demo.policyRunner.command  // 应该与 demo.cmd 匹配
```

#### 1.2 零命令检查（关键问题！）
**位置**: `policyRunner.js:395-423`

**代码逻辑**:
```javascript
if (hasCommandObs) {
  const cmdMagnitude = Math.sqrt(
    this.command[0]**2 + 
    this.command[1]**2 + 
    this.command[2]**2
  );
  
  if (cmdMagnitude < 0.01) {
    // 直接返回 default_joint_pos，不调用策略推理！
    return target; // 这是 default_joint_pos
  }
}
```

**问题**:
- 如果命令幅度 < 0.01，策略**不会推理**，直接返回 `default_joint_pos`
- 这会导致机器人保持默认姿态，**完全不动**

**检查点**:
```javascript
// 检查命令幅度
const cmd = window.demo.policyRunner.command;
const mag = Math.sqrt(cmd[0]**2 + cmd[1]**2 + cmd[2]**2);
console.log('命令幅度:', mag); // 如果 < 0.01，会直接返回 default_joint_pos
```

---

### 2. 策略推理检查

#### 2.1 策略是否被调用？
**位置**: `main.js:712` - `this.actionTarget = await this.policyRunner.step(state)`

**可能问题**:
- `policyRunner` 为 `null`
- `step()` 抛出异常
- 返回 `null` 或 `undefined`

**检查点**:
```javascript
// 检查策略是否存在
window.demo.policyRunner  // 应该存在
window.demo.actionTarget  // 应该是一个数组
```

#### 2.2 策略输出是否有效？
**位置**: `policyRunner.js:570-901`

**可能问题**:
- ONNX推理失败
- 动作输出全零
- 动作被错误裁剪

**检查点**:
```javascript
// 检查策略输出
const pr = window.demo.policyRunner;
console.log('最后动作值:', Array.from(pr.lastActions));
console.log('动作目标:', Array.from(window.demo.actionTarget));
```

---

### 3. 动作应用检查（关键！）

#### 3.1 joint2motor_idx 重新排序
**位置**: `main.js:957-974`

**代码逻辑**:
```javascript
let actionReordered = null;
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions && this.actionTarget) {
  actionReordered = new Float32Array(this.numActions);
  for (let i = 0; i < this.numActions; i++) {
    const motorIdx = this.joint2motorIdx[i];
    if (motorIdx >= 0 && motorIdx < this.numActions) {
      actionReordered[motorIdx] = this.actionTarget[i];
    }
  }
}
```

**潜在问题**:
1. **如果 `joint2motorIdx` 不存在**:
   - `actionReordered` 为 `null`
   - 会使用 `this.actionTarget[motorIdx]`（**错误！**）
   - `actionTarget` 是按策略顺序的，不是按电机顺序的

2. **如果 `motorIdx` 无效**:
   - 某些 `actionReordered[motorIdx]` 可能为 `undefined`（默认0）
   - 导致某些关节不动

**检查点**:
```javascript
// 检查 joint2motorIdx
window.demo.joint2motorIdx  // 应该存在且长度为29
window.demo.actionTarget  // 策略顺序的动作
// 需要检查重新排序后的动作是否正确
```

#### 3.2 PD增益重新排序
**位置**: `main.js:988-993`

**代码逻辑**:
```javascript
const kp = (this.kpPolicyReorder && this.kpPolicyReorder[motorIdx] !== undefined) 
  ? this.kpPolicyReorder[motorIdx] 
  : (this.kpPolicy ? this.kpPolicy[motorIdx] : 0.0);
```

**潜在问题**:
1. **如果 `kpPolicyReorder` 不存在或全零**:
   - `kp` 会回退到 `kpPolicy[motorIdx]`
   - 但如果 `kpPolicy` 也是按策略顺序的，而 `motorIdx` 是电机顺序，**索引不匹配！**

2. **如果 `kp` 为 0**:
   - `torque = kp * (targetJpos - currentJpos) + kd * (0 - qvel)`
   - 如果 `kp = 0`，只有阻尼项，关节不会移动到目标位置

**检查点**:
```javascript
// 检查PD增益
window.demo.kpPolicyReorder  // 应该存在且长度为29
window.demo.kpPolicy  // 原始PD增益（策略顺序）
// 需要检查重新排序后的PD增益是否正确
```

#### 3.3 动作应用到关节
**位置**: `main.js:995-1004`

**代码逻辑**:
```javascript
const torque = kp * (targetJpos - this.simulation.qpos[qpos_adr]) + kd * (0 - this.simulation.qvel[qvel_adr]);
let ctrlValue = torque;
// ... 裁剪 ...
this.simulation.ctrl[ctrl_adr] = ctrlValue;
```

**潜在问题**:
1. **如果 `targetJpos` 等于当前 `qpos[qpos_adr]`**:
   - `torque = kp * 0 + kd * (-qvel)`
   - 只有阻尼，关节不会动

2. **如果 `kp` 为 0**:
   - 关节不会移动到目标位置

3. **如果 `ctrl_adr` 错误**:
   - 动作应用到错误的执行器

**检查点**:
```javascript
// 检查控制值
const demo = window.demo;
const ctrlValues = demo.ctrl_adr_policy.map(adr => demo.simulation.ctrl[adr]);
console.log('控制值:', ctrlValues);
console.log('前6个关节:', ctrlValues.slice(0, 6));
```

---

### 4. 关键问题总结

#### 问题1: 零命令检查导致不推理
**位置**: `policyRunner.js:403`
**影响**: 如果命令幅度 < 0.01，直接返回 `default_joint_pos`，不调用策略

#### 问题2: joint2motor_idx 重新排序逻辑
**位置**: `main.js:957-974`
**影响**: 
- 如果 `joint2motorIdx` 不存在，使用 `actionTarget[motorIdx]`（**索引不匹配**）
- 如果 `motorIdx` 无效，某些关节的动作为 `undefined`（默认0）

#### 问题3: PD增益索引不匹配
**位置**: `main.js:988-993`
**影响**:
- 如果 `kpPolicyReorder` 不存在，回退到 `kpPolicy[motorIdx]`
- 但 `kpPolicy` 是按策略顺序的，`motorIdx` 是电机顺序，**索引不匹配！**

#### 问题4: qpos_adr_policy 和 ctrl_adr_policy 索引
**位置**: `main.js:980-982`
**影响**:
- 使用 `qpos_adr_policy[motorIdx]` 和 `ctrl_adr_policy[motorIdx]`
- 但这些数组是按策略顺序还是电机顺序？需要确认

---

### 5. 检查清单

#### 5.1 命令检查
- [ ] `demo.cmd` 不为 `[0, 0, 0]`
- [ ] `policyRunner.command` 与 `demo.cmd` 匹配
- [ ] 命令幅度 > 0.01

#### 5.2 策略推理检查
- [ ] `policyRunner` 存在
- [ ] `actionTarget` 存在且不为空
- [ ] `lastActions` 不全为零

#### 5.3 动作应用检查
- [ ] `joint2motorIdx` 存在且长度为29
- [ ] `actionReordered` 不为 `null`（如果使用重新排序）
- [ ] `kpPolicyReorder` 存在且不为全零
- [ ] `ctrl_adr_policy` 索引正确

#### 5.4 控制值检查
- [ ] `simulation.ctrl[ctrl_adr]` 不为全零
- [ ] 控制值在合理范围内

---

### 6. 最可能的问题

基于代码分析，**最可能的问题是**：

1. **零命令检查**：命令幅度 < 0.01，导致不调用策略推理
2. **PD增益索引不匹配**：如果 `kpPolicyReorder` 不存在，使用 `kpPolicy[motorIdx]` 但索引不匹配
3. **动作重新排序失败**：如果 `joint2motorIdx` 不存在，使用 `actionTarget[motorIdx]` 但索引不匹配

---

### 7. 建议的调试步骤

1. **检查命令**：
   ```javascript
   console.log('命令:', Array.from(window.demo.cmd));
   console.log('策略命令:', Array.from(window.demo.policyRunner.command));
   console.log('命令幅度:', Math.sqrt(window.demo.policyRunner.command[0]**2 + window.demo.policyRunner.command[1]**2 + window.demo.policyRunner.command[2]**2));
   ```

2. **检查动作**：
   ```javascript
   console.log('动作目标:', Array.from(window.demo.actionTarget));
   console.log('最后动作:', Array.from(window.demo.policyRunner.lastActions));
   ```

3. **检查重新排序**：
   ```javascript
   console.log('joint2motorIdx:', window.demo.joint2motorIdx);
   console.log('kpPolicyReorder:', window.demo.kpPolicyReorder);
   console.log('kdPolicyReorder:', window.demo.kdPolicyReorder);
   ```

4. **检查控制值**：
   ```javascript
   const demo = window.demo;
   const leftLeg = [0, 3, 6, 9, 13, 17];
   const rightLeg = [1, 4, 7, 10, 14, 18];
   leftLeg.forEach(i => {
     const motorIdx = demo.joint2motorIdx ? demo.joint2motorIdx[i] : i;
     const ctrlAdr = demo.ctrl_adr_policy[motorIdx];
     console.log(`左腿关节${i} (motorIdx=${motorIdx}):`, {
       targetJpos: demo.actionTarget[i],
       ctrlValue: demo.simulation.ctrl[ctrlAdr],
       kp: demo.kpPolicyReorder ? demo.kpPolicyReorder[motorIdx] : demo.kpPolicy[i]
     });
   });
   ```
