# 关节映射问题分析

## 问题描述
- **左腿太软**：根本立不住
- **右腿太硬**：即使输入运动指令也完全不动

## 关键发现：joint2motor_idx 重新排序逻辑错误

### Python代码的正确逻辑

#### 1. 初始化时重新排序 PD增益（`enter()` 方法）
```python
# LocoMode.py line 59-67
def enter(self):
    self.kps_reorder = np.zeros_like(self.kps)
    self.kds_reorder = np.zeros_like(self.kds)
    self.default_angles_reorder = np.zeros_like(self.default_angles)
    for i in range(len(self.joint2motor_idx)):
        motor_idx = self.joint2motor_idx[i]  # 策略索引i -> 电机索引motor_idx
        self.kps_reorder[motor_idx] = self.kps[i]
        self.kds_reorder[motor_idx] = self.kds[i]
        self.default_angles_reorder[motor_idx] = self.default_angles[i]
```

**关键点**：
- `joint2motor_idx[i]` 表示策略索引 `i` 对应的**电机索引**
- 重新排序后，`kps_reorder[motor_idx]` 存储策略索引 `i` 的kp值
- **输出时使用 `kps_reorder`，不是原始的 `kps`**

#### 2. 读取状态时（`run()` 方法）
```python
# LocoMode.py line 78-80
for i in range(len(self.joint2motor_idx)):
    self.qj_obs[i] = self.qj[self.joint2motor_idx[i]]
    self.dqj_obs[i] = self.dqj[self.joint2motor_idx[i]]
```

**关键点**：
- `self.qj` 是按**电机顺序**的数组
- `qj_obs[i]` 是策略索引 `i` 的观察值
- 从电机索引 `joint2motor_idx[i]` 读取到策略索引 `i`

#### 3. 应用动作时（`run()` 方法）
```python
# LocoMode.py line 97-101
loco_action = self.action * self.action_scale + self.default_angles
action_reorder = loco_action.copy()
for i in range(len(self.joint2motor_idx)):
    motor_idx = self.joint2motor_idx[i]
    action_reorder[motor_idx] = loco_action[i]

self.policy_output.actions = action_reorder.copy()
self.policy_output.kps = self.kps_reorder.copy()  # 使用重新排序后的kps
self.policy_output.kds = self.kds_reorder.copy()  # 使用重新排序后的kds
```

**关键点**：
- `loco_action[i]` 是策略索引 `i` 的动作值
- `action_reorder[motor_idx]` 是电机索引 `motor_idx` 的动作值
- **输出时使用重新排序后的 `action_reorder` 和 `kps_reorder`**

---

## JS代码中的问题

### 问题1：没有重新排序 PD增益

**当前JS代码**：
```javascript
// main.js line 987-988
const kp = this.kpPolicy ? this.kpPolicy[i] : 0.0;
const kd = this.kdPolicy ? this.kdPolicy[i] : 0.0;
```

**问题**：
- 直接使用 `this.kpPolicy[i]`，没有重新排序
- Python代码使用 `kps_reorder[motor_idx]`
- **导致PD增益应用到错误的关节！**

### 问题2：动作重新排序逻辑错误

**当前JS代码**：
```javascript
// main.js line 955-977
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
  const actionReordered = new Float32Array(this.numActions);
  for (let i = 0; i < this.numActions; i++) {
    const motorIdx = this.joint2motorIdx[i];
    // 错误：试图通过 ctrl_adr_policy 查找
    let policyIdxForMotor = -1;
    for (let j = 0; j < this.numActions; j++) {
      if (this.ctrl_adr_policy[j] === motorIdx) {  // 这是错误的！
        policyIdxForMotor = j;
        break;
      }
    }
    // ...
  }
}
```

**问题**：
- `ctrl_adr_policy[j]` 是actuator索引，不是电机索引
- `joint2motor_idx[i]` 是电机索引
- **两者不匹配！**

**正确逻辑应该是**：
```javascript
// Python: action_reorder[motor_idx] = loco_action[i]
const actionReordered = new Float32Array(this.numActions);
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = this.joint2motorIdx[i];
  actionReordered[motorIdx] = this.actionTarget[i];
}
// 然后需要将 actionReordered 映射回 ctrl_adr_policy
```

### 问题3：读取状态的逻辑错误

**当前JS代码**：
```javascript
// main.js line 1186-1210
if (this.joint2motorIdx && this.joint2motorIdx.length === this.numActions) {
  for (let i = 0; i < this.numActions; i++) {
    const motorIdx = this.joint2motorIdx[i];
    // 错误：试图通过 ctrl_adr_policy 查找
    let qposAdr = -1;
    for (let j = 0; j < this.numActions; j++) {
      if (this.ctrl_adr_policy[j] === motorIdx) {  // 这是错误的！
        qposAdr = this.qpos_adr_policy[j];
        break;
      }
    }
    // ...
  }
}
```

**问题**：
- 同样的错误：`ctrl_adr_policy[j]` 是actuator索引，不是电机索引
- 需要理解 `joint2motor_idx` 的真正含义

---

## 根本问题分析

### joint2motor_idx 的真正含义

`joint2motor_idx` 是一个映射：**策略关节顺序 → 电机顺序**

在Python代码中：
- `self.qj` 是按**电机顺序**的数组（29个电机）
- `self.kps` 是按**策略顺序**的数组（29个关节）
- `joint2motor_idx[i]` 表示策略索引 `i` 对应的电机索引

但在JS代码中：
- `qpos_adr_policy[i]` 是策略索引 `i` 对应的MuJoCo qpos地址
- `ctrl_adr_policy[i]` 是策略索引 `i` 对应的MuJoCo actuator索引
- **没有直接的"电机顺序"数组**

### 关键理解

**Python代码中的"电机顺序"可能对应JS中的actuator顺序**，但需要验证：
- `joint2motor_idx` 中的值（0-28）是否对应 `ctrl_adr_policy` 的索引？
- 还是对应MuJoCo的actuator索引？

---

## 解决方案思路

### 方案1：验证 joint2motor_idx 与 ctrl_adr_policy 的关系

需要检查：
1. `joint2motor_idx[i]` 的值是否等于某个 `ctrl_adr_policy[j]` 的值？
2. 或者 `joint2motor_idx[i]` 是否等于某个 `j`，使得 `ctrl_adr_policy[j]` 是我们想要的？

### 方案2：重新理解映射关系

可能需要：
1. 创建一个"电机顺序"到"策略顺序"的反向映射
2. 或者直接使用名称映射，不使用 `joint2motor_idx`

### 方案3：最可能的问题

**最可能的问题是**：
- JS代码中，`policy_joint_names` 的顺序可能已经与Python策略顺序一致
- `joint2motor_idx` 只是用来重新排序到"电机顺序"
- 但在JS中，我们直接使用名称映射，可能不需要 `joint2motor_idx`

**建议**：
1. **先禁用 `joint2motor_idx` 重新排序**，看看是否解决问题
2. 如果解决了，说明 `joint2motor_idx` 的实现有问题
3. 如果没解决，说明问题在其他地方

---

## 立即需要检查的点

1. **PD增益应用**：是否使用了重新排序后的kp/kd？
2. **动作应用**：动作是否应用到正确的actuator？
3. **读取状态**：状态是否从正确的关节读取？
