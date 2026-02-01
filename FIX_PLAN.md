# 三个问题的解决方案

## 问题1：关节映射（joint2motor_idx vs 当前映射方式）

### 问题分析：

**原始代码逻辑：**
```python
# LocoMode.py 第78-80行：读取关节状态
for i in range(len(self.joint2motor_idx)):
    self.qj_obs[i] = self.qj[self.joint2motor_idx[i]]  # 从电机索引读取
    self.dqj_obs[i] = self.dqj[self.joint2motor_idx[i]]

# 第99-101行：应用动作
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    action_reorder[motor_idx] = loco_action[i]  # 重新排序到电机索引
```

**关键点：**
- `joint2motor_idx` 将策略关节索引 `i` 映射到电机索引 `motor_idx`
- 策略输出是按策略关节顺序的，需要重新排序到电机顺序

**当前代码逻辑：**
```javascript
// mujocoUtils.js configureJointMappings
for (const name of jointNames) {
  const jointIdx = demo.jointNamesMJC.indexOf(name);
  const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);
  demo.ctrl_adr_policy.push(actuatorIdx);  // 直接映射到actuator
}
```

**差异：**
- 原始代码：策略索引 → 电机索引（通过 `joint2motor_idx`）
- 当前代码：策略索引 → actuator索引（通过名称查找）

### 解决思路：

**方案A：验证当前映射是否正确**
1. 检查 `policy_joint_names` 的顺序是否与原始代码中策略关节顺序一致
2. 检查 `joint2motor_idx` 是否只是重新排序，还是改变了映射关系
3. 如果只是重新排序，当前映射应该是正确的

**方案B：添加 joint2motor_idx 支持（如果需要）**
1. 在配置文件中添加 `joint2motor_idx` 字段
2. 在应用动作时，使用 `joint2motor_idx` 重新排序
3. 但这可能会破坏现有的映射逻辑

**建议：**
- 先验证当前映射是否正确
- 如果 `joint2motor_idx` 只是重新排序（策略顺序 → 电机顺序），当前实现应该没问题
- 需要检查：策略输出的动作是否按正确的顺序应用到电机上

---

## 问题2：命令缩放（scale_values + cmd_scale）

### 问题分析：

**原始代码逻辑：**
```python
# LocoMode.py 第76行
self.cmd = scale_values(joycmd, [self.range_velx, self.range_vely, self.range_velz])
# 第85行
self.cmd = self.cmd * self.cmd_scale  # cmd_scale = [1.0, 1.0, 1.0]
```

**原始 scale_values 函数：**
```python
def scale_values(values, target_ranges):
    scaled = []
    for val, (new_min, new_max) in zip(values, target_ranges):
        scaled_val = (val + 1) * (new_max - new_min) / 2 + new_min
        scaled.append(scaled_val)
    return np.array(scaled)
```
- 将 `[-1, 1]` 线性映射到 `[new_min, new_max]`

**当前代码逻辑：**
```javascript
// main.js 第1078-1080行
const vx = scaleBipolar(uVx, -0.4, 0.7);
const vy = scaleBipolar(uVy, -0.4, 0.4);
const wz = scaleBipolar(uWz, -1.57, 1.57);

// scaleBipolar 函数（第16-23行）
function scaleBipolar(u, min, max) {
  if (u >= 0) return u * max;
  const negMax = Number.isFinite(min) ? -min : 0.0;
  return u * negMax;
}
```

**差异：**
1. `scale_values` 是线性映射：`[-1, 1]` → `[min, max]`
2. `scaleBipolar` 是分段映射：`[-1, 0]` → `[min, 0]`，`[0, 1]` → `[0, max]`
3. **缺少 `cmd_scale` 乘法**：虽然 `cmd_scale = [1.0, 1.0, 1.0]`，但为了完全一致应该加上

### 解决思路：

**方案A：修改 scaleBipolar 使其与 scale_values 一致**
```javascript
function scaleValues(values, targetRanges) {
  // 匹配原始 Python scale_values 函数
  const scaled = [];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    const [newMin, newMax] = targetRanges[i];
    const scaledVal = (val + 1) * (newMax - newMin) / 2 + newMin;
    scaled.push(scaledVal);
  }
  return scaled;
}
```

**方案B：在 policyRunner.setCommand 中应用 cmd_scale**
```javascript
setCommand(cmd) {
  if (!cmd) return;
  // 应用 cmd_scale（虽然都是1.0，但为了完全一致）
  const cmdScale = this.config.cmd_scale || [1.0, 1.0, 1.0];
  this.command[0] = (cmd[0] ?? 0.0) * cmdScale[0];
  this.command[1] = (cmd[1] ?? 0.0) * cmdScale[1];
  this.command[2] = (cmd[2] ?? 0.0) * cmdScale[2];
}
```

**建议：**
- 修改 `scaleBipolar` 为 `scaleValues`，使其与原始函数一致
- 在 `policyRunner.setCommand` 中应用 `cmd_scale`
- 在配置文件中添加 `cmd_scale` 字段

---

## 问题3：初始状态设置

### 问题分析：

**原始代码：**
- 没有显式设置初始关节位置（由仿真器/控制器管理）
- 初始命令：`cmd_init: [0, 0, 0]`

**当前代码：**
```javascript
// mujocoUtils.js 第261-286行
// 设置初始高度
qpos[2] = 0.8;

// 设置初始关节位置
if (this.defaultJposPolicy && this.qpos_adr_policy) {
  for (let i = 0; i < this.numActions; i++) {
    qpos[qpos_adr_policy[i]] = defaultJposPolicy[i];
  }
  // 重置速度为0
  for (let i = 0; i < this.numActions; i++) {
    qvel[qvel_adr_policy[i]] = 0.0;
  }
}
```

**可能的问题：**
1. 初始高度设置时机：是在 `reloadPolicy` 时设置，但可能被后续操作覆盖
2. 关节位置设置：是否正确应用到了所有关节
3. 初始速度：是否真的为零
4. 初始姿态：根节点的旋转（quaternion）是否正确

### 解决思路：

**方案A：确保初始状态设置时机正确**
1. 在 `reloadPolicy` 后立即设置
2. 在 `reset()` 时也设置
3. 确保 `simulation.forward()` 在设置后调用

**方案B：添加初始状态验证**
```javascript
// 在设置后验证
console.log('Initial state check:', {
  rootZ: qpos[2],
  firstJointPos: qpos[qpos_adr_policy[0]],
  firstJointVel: qvel[qvel_adr_policy[0]],
  defaultJointPos: defaultJposPolicy[0]
});
```

**方案C：检查 XML 中的初始位置**
- 检查 `g1.xml` 中是否有初始位置设置
- 确保代码设置不会与 XML 冲突

**建议：**
- 在 `reloadPolicy` 中确保初始状态设置
- 在 `reset()` 中也设置初始状态
- 添加验证日志确认设置成功

---

## 总结

### 优先级排序：

1. **问题2：命令缩放**（高优先级）
   - 影响策略输入，可能导致策略行为不一致
   - 修复相对简单，风险低

2. **问题3：初始状态**（中优先级）
   - 影响机器人启动状态
   - 需要验证但修复相对简单

3. **问题1：关节映射**（需要验证）
   - 如果当前映射正确，可能不需要修改
   - 需要先验证映射是否正确

### 实施步骤：

1. **第一步：修复命令缩放**
   - 修改 `scaleBipolar` 为 `scaleValues`（匹配原始函数）
   - 添加 `cmd_scale` 配置和应用

2. **第二步：验证和修复初始状态**
   - 添加初始状态验证日志
   - 确保初始状态设置正确

3. **第三步：验证关节映射**
   - 添加映射验证日志
   - 对比原始代码的映射结果
