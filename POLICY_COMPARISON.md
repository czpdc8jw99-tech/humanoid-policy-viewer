# 策略配置对比：当前 vs 原始

## 📋 配置文件对比

### 1. action_scale（动作缩放）

**原始配置 (LocoMode.yaml):**
```yaml
action_scale: 0.25
```

**当前配置 (loco_policy_29dof.json):**
```json
"action_scale": 0.25
```
✅ **一致**

---

### 2. default_joint_pos / default_angles（默认关节位置）

**原始配置 (LocoMode.yaml):**
```yaml
default_angles: [-0.2, -0.2, 0.0,
                 0.0, 0.0, 0.0,
                 0.0, 0.0, 0.0,
                 0.42, 0.42, 0.35, 0.35,
                 -0.23, -0.23, 0.18, -0.18,
                 0.0, 0.0, 0.0, 0.0,
                 0.87, 0.87,
                 0.0, 0.0,
                 0.0, 0.0,
                 0.0, 0.0]
```

**当前配置 (loco_policy_29dof.json):**
```json
"default_joint_pos": [
  -0.2, -0.2, 0.0,
  0.0, 0.0, 0.0,
  0.0, 0.0, 0.0,
  0.42, 0.42,
  0.35, 0.35,
  -0.23, -0.23,
  0.18, -0.18,
  0.0, 0.0,
  0.0, 0.0,
  0.87, 0.87,
  0.0, 0.0,
  0.0, 0.0,
  0.0, 0.0
]
```
✅ **一致**

---

### 3. stiffness / kps（刚度/PD增益）

**原始配置 (LocoMode.yaml):**
```yaml
kps: [200, 200, 200,
      150, 150, 200,
      150, 150, 200,
      200, 200, 100, 100,
      20, 20, 100, 100,
      20, 20, 50, 50,
      50, 50,
      40, 40,
      40, 40,
      40, 40]
```

**当前配置 (loco_policy_29dof.json):**
```json
"stiffness": [
  200, 200, 200,
  150, 150, 200,
  150, 150, 200,
  200, 200,
  100, 100,
  20, 20,
  100, 100,
  20, 20,
  50, 50,
  50, 50,
  40, 40,
  40, 40,
  40, 40
]
```
✅ **一致**

---

### 4. damping / kds（阻尼）

**原始配置 (LocoMode.yaml):**
```yaml
kds: [5, 5, 5,
      5, 5, 5,
      5, 5, 5,
      5, 5, 2, 2,
      2, 2, 2, 2,
      2, 2, 2, 2,
      2, 2,
      2, 2,
      2, 2,
      2, 2]
```

**当前配置 (loco_policy_29dof.json):**
```json
"damping": [
  5, 5, 5,
  5, 5, 5,
  5, 5, 5,
  5, 5,
  2, 2,
  2, 2,
  2, 2,
  2, 2,
  2, 2,
  2, 2,
  2, 2,
  2, 2,
  2, 2
]
```
✅ **一致**

---

### 5. cmd_range（命令范围）

**原始配置 (LocoMode.yaml):**
```yaml
cmd_range: {lin_vel_x: [-0.4, 0.7], lin_vel_y: [-0.4, 0.4], ang_vel_z: [-1.57, 1.57]}
```

**当前配置 (loco_policy_29dof.json):**
```json
"cmd_range": {
  "lin_vel_x": [-0.4, 0.7],
  "lin_vel_y": [-0.4, 0.4],
  "ang_vel_z": [-1.57, 1.57]
}
```
✅ **一致**

---

## 🔧 代码逻辑对比

### 1. 观察向量构建

**原始代码 (LocoMode.py 第87-92行):**
```python
self.obs[:3] = self.ang_vel.copy()                    # RootAngVelB (3)
self.obs[3:6] = self.gravity_orientation.copy()      # ProjectedGravityB (3)
self.obs[6:9] = self.cmd.copy()                      # Command (3)
self.obs[9: 9 + self.num_actions] = self.qj_obs.copy()                    # JointPosRel (29)
self.obs[9 + self.num_actions: 9 + self.num_actions * 2] = self.dqj_obs.copy()  # JointVel (29)
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()  # PrevActions (29)
```

**当前代码 (policyRunner.js):**
- 通过 `obsModules` 构建，顺序取决于配置顺序
- 配置顺序：RootAngVelB, ProjectedGravityB, Command, JointPosRel, JointVel, PrevActions
- ✅ **顺序一致**

---

### 2. 观察向量缩放

**原始代码 (LocoMode.py 第82-85行):**
```python
self.qj_obs = (self.qj_obs - self.default_angles) * self.dof_pos_scale  # dof_pos_scale = 1.0
self.dqj_obs = self.dqj_obs * self.dof_vel_scale                        # dof_vel_scale = 1.0
self.ang_vel = self.ang_vel * self.ang_vel_scale                        # ang_vel_scale = 1.0
self.cmd = self.cmd * self.cmd_scale                                    # cmd_scale = [1.0, 1.0, 1.0]
```

**当前代码 (observationHelpers.js):**
- `JointPosRel`: `scale * (q - q0)`，默认 scale = 1.0 ✅
- `JointVel`: `scale * dq`，默认 scale = 1.0 ✅
- `RootAngVelB`: `scale * angVel`，默认 scale = 1.0 ✅
- `Command`: 直接使用，无缩放 ✅

---

### 3. 观察向量 Clip

**原始代码 (LocoMode.py 第96行):**
```python
obs_tensor = self.obs.reshape(1, -1)
obs_tensor = obs_tensor.astype(np.float32)
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100)
```

**当前代码 (policyRunner.js 第525-530行):**
```javascript
// CRITICAL: Clip observation vector to [-100, 100] as in original Python code
for (let i = 0; i < obsForPolicy.length; i++) {
  obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
}
```
✅ **一致**

---

### 4. 动作值 Clip

**原始代码 (LocoMode.py 第96行):**
```python
self.action = self.policy(...).clip(-100, 100).detach().numpy().squeeze()
```
- 策略输出 clip 到 `[-100, 100]`

**当前代码 (policyRunner.js 第595-607行):**
```javascript
// CRITICAL: Clip action to [-100, 100] as in original Python code
for (let i = 0; i < this.numActions; i++) {
  let value = action[i];
  if (this.actionSquash === 'tanh') {
    value = Math.tanh(value);
  }
  value = Math.max(-100, Math.min(100, value));
  this.lastActions[i] = value;
}
```
✅ **一致**（已修复）

---

### 5. 目标位置计算

**原始代码 (LocoMode.py 第97行):**
```python
loco_action = self.action * self.action_scale + self.default_angles
```
- `self.action` 已经是 clip 后的值（范围 [-100, 100]）
- `action_scale = 0.25`
- 最终范围：`[-25, 25]` + `default_angles`

**当前代码 (policyRunner.js 第875-880行):**
```javascript
const target = new Float32Array(this.numActions);
for (let i = 0; i < this.numActions; i++) {
  target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];
}
```
- `this.lastActions[i]` 已经是 clip 后的值（范围 [-100, 100]）
- `actionScale = 0.25`
- 最终范围：`[-25, 25]` + `defaultJointPos`
✅ **一致**

---

## ⚠️ 需要注意的差异

### 1. joint2motor_idx（关节到电机索引映射）

**原始配置 (LocoMode.yaml):**
```yaml
joint2motor_idx: [0, 6, 12,
                  1, 7, 13,
                  2, 8, 14,
                  3, 9, 15, 22,
                  4, 10, 16, 23,
                  5, 11, 17, 24,
                  18, 25,
                  19, 26,
                  20, 27,
                  21, 28]
```

**当前配置:**
- 没有 `joint2motor_idx` 配置
- 使用 `policy_joint_names` 和 MuJoCo 关节名称直接映射
- ⚠️ **需要检查映射是否正确**

---

### 2. 命令缩放（scale_values）

**原始代码 (LocoMode.py 第76行):**
```python
self.cmd = scale_values(joycmd, [self.range_velx, self.range_vely, self.range_velz])
```

**原始 `scale_values` 函数 (utils.py 第55-60行):**
```python
def scale_values(values, target_ranges):
    scaled = []
    for val, (new_min, new_max) in zip(values, target_ranges):
        scaled_val = (val + 1) * (new_max - new_min) / 2 + new_min
        scaled.append(scaled_val)
    return np.array(scaled)
```
- 将输入值从 `[-1, 1]` **线性映射**到 `[new_min, new_max]`
- 公式：`scaled_val = (val + 1) * (new_max - new_min) / 2 + new_min`
- 例如：`val = -1` → `scaled_val = new_min`，`val = 1` → `scaled_val = new_max`

**当前代码 (main.js 第16-23行, 1078-1080行):**
```javascript
function scaleBipolar(u, min, max) {
  if (u >= 0) return u * max;
  const negMax = Number.isFinite(min) ? -min : 0.0;
  return u * negMax;
}

// 使用：
const vx = scaleBipolar(uVx, -0.4, 0.7);
const vy = scaleBipolar(uVy, -0.4, 0.4);
const wz = scaleBipolar(uWz, -1.57, 1.57);
```
- 分别处理正负值：
  - `u >= 0`: `u * max`（范围 `[0, max]`）
  - `u < 0`: `u * (-min)`（范围 `[min, 0]`）

**差异分析：**
- 原始：线性映射 `[-1, 1]` → `[new_min, new_max]`
- 当前：分段映射 `[-1, 0]` → `[min, 0]`，`[0, 1]` → `[0, max]`

**示例对比（vx，范围 [-0.4, 0.7]）：**
- 原始：`val = -1` → `(-1 + 1) * (0.7 - (-0.4)) / 2 + (-0.4) = -0.4` ✅
- 原始：`val = 1` → `(1 + 1) * (0.7 - (-0.4)) / 2 + (-0.4) = 0.7` ✅
- 当前：`val = -1` → `-1 * (-(-0.4)) = -0.4` ✅
- 当前：`val = 1` → `1 * 0.7 = 0.7` ✅

**结论：** 虽然实现方式不同，但结果一致 ✅

---

## 📊 总结

### ✅ 已匹配的部分：
1. `action_scale = 0.25` ✅
2. `default_joint_pos` ✅
3. `stiffness` / `damping` ✅
4. `cmd_range` ✅
5. 观察向量构建顺序 ✅
6. 观察向量 clip 到 [-100, 100] ✅
7. 动作值 clip 到 [-100, 100] ✅（已修复）
8. 目标位置计算公式 ✅

### ⚠️ 需要检查的部分：
1. **关节映射**：`joint2motor_idx` vs 当前映射方式
2. **命令缩放**：`scale_values` 函数的实现
3. **初始状态**：机器人初始位置和关节位置设置

### 🔍 建议检查：
1. 检查控制台日志，确认观察向量值是否正确
2. 检查动作值范围是否在 [-100, 100] 内
3. 检查目标位置计算是否正确
4. 检查关节映射是否正确（policy action index -> MuJoCo actuator index）
