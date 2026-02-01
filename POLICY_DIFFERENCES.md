# Loco Mode vs Tracking Policy 详细对比

## 1. 配置文件结构对比

### Loco Mode (`loco_policy_29dof.json`)
- **观察向量大小**: 96维
- **ONNX输入形状**: `[1, 96]`
- **策略类型**: 命令驱动（command-driven）
- **特殊配置**: `cmd_range`, `cmd_scale`, `joint2motor_idx`

### Tracking Policy (`tracking_policy_amass.json`)
- **观察向量大小**: 475维
- **ONNX输入形状**: `[1, 475]`
- **策略类型**: 动作跟踪（motion tracking）
- **特殊配置**: `tracking` 配置块

---

## 2. 观察向量配置对比

### Loco Mode 观察配置
```json
"obs_config": {
  "policy": [
    { "name": "RootAngVelB" },           // 3维
    { "name": "ProjectedGravityB" },    // 3维
    { "name": "Command" },              // 3维
    { "name": "JointPosRel" },          // 29维（相对位置）
    { "name": "JointVel" },             // 29维
    { "name": "PrevActions", "history_steps": 1 }  // 29维
  ]
}
```
**总计**: 3 + 3 + 3 + 29 + 29 + 29 = 96维

### Tracking Policy 观察配置
```json
"obs_config": {
  "policy": [
    { "name": "BootIndicator" },        // 1维
    { "name": "TrackingCommandObsRaw", "future_steps": [0,2,4,8,16] },  // 5维
    { "name": "TargetRootZObs", "future_steps": [0,2,4,8,16] },         // 5维
    { "name": "TargetJointPosObs", "future_steps": [0,2,4,8,16] },      // 29*5=145维
    { "name": "TargetProjectedGravityBObs", "future_steps": [0,2,4,8,16] }, // 3*5=15维
    { "name": "RootAngVelB" },          // 3维
    { "name": "ProjectedGravityB" },    // 3维
    { "name": "JointPos", "pos_steps": [0,1,2,3,4,8] },  // 29*6=174维
    { "name": "PrevActions", "history_steps": 3 }  // 29*3=87维
  ]
}
```
**总计**: 1 + 5 + 5 + 145 + 15 + 3 + 3 + 174 + 87 = 438维（实际475维，可能有其他组件）

---

## 3. 动作处理对比

### Loco Mode
```javascript
// action_scale: 0.25 (标量，所有关节相同)
// action_clip: 100.0
// action_squash: null

// 处理流程：
// 1. 策略输出 -> clip到[-100, 100]
// 2. 应用 action_scale: action * 0.25
// 3. 计算目标位置: default_joint_pos + action_scale * action
// 4. 使用 joint2motor_idx 重新排序
```

### Tracking Policy
```javascript
// action_scale: [0.5, 0.5, ..., 1.0, ...] (数组，每个关节不同)
// action_clip: 无（或使用默认值）
// action_squash: 无

// 处理流程：
// 1. 策略输出（可能已经经过处理）
// 2. 应用 action_scale（每个关节不同）
// 3. 计算目标位置: default_joint_pos + action_scale[i] * action[i]
// 4. 直接应用（无重新排序）
```

---

## 4. 命令处理对比

### Loco Mode
- **有命令输入**: `cmd_range`, `cmd_scale`
- **命令缩放**: 使用 `scale_values` 线性映射 + `cmd_scale` 乘法
- **命令范围**: 
  - `lin_vel_x`: [-0.4, 0.7]
  - `lin_vel_y`: [-0.4, 0.4]
  - `ang_vel_z`: [-1.57, 1.57]

### Tracking Policy
- **无命令输入**: 使用 motion tracking
- **使用 TrackingHelper**: 管理动作序列和插值

---

## 5. 关节映射对比

### Loco Mode
- **使用 `joint2motor_idx`**: 重新排序动作和观察
- **映射逻辑**: 
  ```python
  # Python代码
  for i in range(len(self.joint2motor_idx)):
      motor_idx = self.joint2motor_idx[i]
      action_reorder[motor_idx] = loco_action[i]
  ```

### Tracking Policy
- **无 `joint2motor_idx`**: 直接使用名称映射
- **映射逻辑**: 直接通过 `policy_joint_names` 映射到 MuJoCo 关节

---

## 6. 默认关节位置对比

### Loco Mode
```json
"default_joint_pos": [
  -0.2, -0.2, 0.0,    // left/right hip_pitch, waist_yaw
  0.0, 0.0, 0.0,      // left/right hip_roll, waist_roll
  0.0, 0.0, 0.0,      // left/right hip_yaw, waist_pitch
  0.42, 0.42,         // left/right knee
  0.35, 0.35,         // left/right shoulder_pitch
  -0.23, -0.23,       // left/right ankle_pitch
  0.18, -0.18,        // left/right shoulder_roll
  0.0, 0.0,           // left/right shoulder_yaw
  0.0, 0.0,           // left/right ankle_roll
  0.87, 0.87,         // left/right elbow
  0.0, 0.0,           // left/right wrist_roll
  0.0, 0.0,           // left/right wrist_pitch
  0.0, 0.0            // left/right wrist_yaw
]
```

### Tracking Policy
```json
"default_joint_pos": [
  -0.28, -0.28, 0.0,  // left/right hip_pitch, waist_yaw
  0.0, 0.0, 0.0,      // left/right hip_roll, waist_roll
  0.0, 0.0, 0.0,      // left/right hip_yaw, waist_pitch
  0.5, 0.5,           // left/right knee (不同！)
  0.35, 0.35,         // left/right shoulder_pitch
  -0.23, -0.23,       // left/right ankle_pitch
  0.16, -0.16,        // left/right shoulder_roll (不同！)
  0.0, 0.0,           // left/right shoulder_yaw
  0.0, 0.0,           // left/right ankle_roll
  0.87, 0.87,         // left/right elbow
  0.0, 0.0,           // left/right wrist_roll
  0.0, 0.0,           // left/right wrist_pitch
  0.0, 0.0            // left/right wrist_yaw
]
```

**关键差异**:
- Loco: `hip_pitch = -0.2`, `knee = 0.42`, `shoulder_roll = 0.18/-0.18`
- Tracking: `hip_pitch = -0.28`, `knee = 0.5`, `shoulder_roll = 0.16/-0.16`

---

## 7. PD增益对比

### Loco Mode
```json
"stiffness": [200, 200, 200, 150, 150, 200, 150, 150, 200, 200, 200, 100, 100, 20, 20, 100, 100, 20, 20, 50, 50, 50, 50, 40, 40, 40, 40, 40, 40]
"damping": [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
```
- **高刚度**: 腿部关节 150-200
- **低刚度**: 脚踝关节 20

### Tracking Policy
```json
"stiffness": [40.18, 40.18, 40.18, 99.10, 99.10, 28.50, 40.18, 40.18, 28.50, 99.10, 99.10, 14.25, 14.25, 28.50, 28.50, 14.25, 14.25, 28.50, 28.50, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 16.78, 16.78, 16.78, 16.78]
"damping": [2.56, 2.56, 2.56, 6.31, 6.31, 1.81, 2.56, 2.56, 1.81, 6.31, 6.31, 0.91, 0.91, 1.81, 1.81, 0.91, 0.91, 1.81, 1.81, 0.91, 0.91, 0.91, 0.91, 0.91, 0.91, 1.07, 1.07, 1.07, 1.07]
```
- **中等刚度**: 大部分关节 14-99
- **更平滑**: 整体刚度较低，更适合动作跟踪

---

## 8. 代码实现差异

### Loco Mode 特殊处理
1. **命令缩放**: `scale_values` + `cmd_scale`
2. **关节重新排序**: `joint2motor_idx` 用于读取状态和应用动作
3. **动作裁剪**: 策略输出 clip 到 [-100, 100]
4. **观察向量**: 使用 `JointPosRel`（相对位置）而不是 `JointPos`（绝对位置）

### Tracking Policy 特殊处理
1. **Motion Tracking**: 使用 `TrackingHelper` 管理动作序列
2. **未来步骤**: 观察向量包含未来多个时间步的目标
3. **动作缩放**: 每个关节使用不同的 `action_scale`
4. **无命令输入**: 完全基于 motion 序列

---

## 9. 潜在问题分析

### ⚠️ 可能遗漏的差异

1. **观察向量缩放**:
   - Loco Mode: `JointPosRel` 使用 `dof_pos_scale` (默认1.0)
   - Tracking Policy: `JointPos` 可能有不同的缩放
   - **需要检查**: `observationHelpers.js` 中的缩放逻辑

2. **动作处理顺序**:
   - Loco Mode: clip -> scale -> reorder
   - Tracking Policy: scale (可能已经处理过)
   - **需要检查**: `policyRunner.js` 中的动作处理流程

3. **初始状态设置**:
   - Loco Mode: 使用 `default_joint_pos` 设置初始位置
   - Tracking Policy: 可能使用 motion 的第一帧
   - **需要检查**: 初始状态设置逻辑

4. **关节速度处理**:
   - Loco Mode: `JointVel` 使用 `dof_vel_scale` (默认1.0)
   - Tracking Policy: 可能没有速度缩放
   - **需要检查**: 速度观察的处理

5. **PrevActions 历史**:
   - Loco Mode: `history_steps: 1` (29维)
   - Tracking Policy: `history_steps: 3` (87维)
   - **已确认**: 实现正确

---

## 10. 关键差异总结

### ✅ 已修复的差异
1. **`scale_values` 函数**: ✅ 已修复为线性映射
2. **`cmd_scale` 应用**: ✅ 已添加
3. **`joint2motor_idx` 重新排序**: ✅ 已实现（读取状态和应用动作时）
4. **初始状态设置**: ✅ 已修复（高度0.75m）

### ⚠️ 发现的潜在差异（需要修复）

#### 1. 观察向量缩放因子缺失
**问题**: 配置文件中缺少缩放因子，代码中也没有读取和应用

**Python代码**:
```python
self.qj_obs = (self.qj_obs - self.default_angles) * self.dof_pos_scale  # dof_pos_scale = 1.0
self.dqj_obs = self.dqj_obs * self.dof_vel_scale  # dof_vel_scale = 1.0
self.ang_vel = self.ang_vel * self.ang_vel_scale  # ang_vel_scale = 1.0
```

**当前JS代码**:
- `JointPosRel`: 有 `scale` 参数，但默认1.0，未从配置读取
- `JointVel`: 有 `scale` 参数，但默认1.0，未从配置读取
- `RootAngVelB`: **没有** `scale` 参数！

**影响**: 虽然默认值是1.0，但为了完全一致，应该：
1. 在 `loco_policy_29dof.json` 中添加 `dof_pos_scale`, `dof_vel_scale`, `ang_vel_scale`
2. 在 `policyRunner.js` 中读取这些值并传递给观察模块
3. 在 `RootAngVelB` 类中添加 `scale` 支持

#### 2. 观察向量 clip 逻辑
**Python代码**:
```python
obs_tensor = self.obs.reshape(1, -1)
obs_tensor = obs_tensor.astype(np.float32)
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100)
```

**当前JS代码**: 观察向量在输入ONNX前没有clip到[-100, 100]

**影响**: 可能影响策略行为（虽然观察值通常在这个范围内）

### ✅ 已确认正确的部分
1. **观察向量构建顺序**: ✅ 正确 (RootAngVelB, ProjectedGravityB, Command, JointPosRel, JointVel, PrevActions)
2. **动作处理流程**: ✅ 正确 (clip到[-100,100], action_scale应用, joint2motor_idx重新排序)
3. **LSTM warmup**: ✅ 正确 (50次迭代，全零观察向量)
4. **PrevActions历史**: ✅ 正确 (history_steps: 1)

---

## 11. 修复建议优先级

### 🔴 高优先级（可能影响功能）
1. **添加观察向量缩放因子支持**
   - 在配置文件中添加 `dof_pos_scale`, `dof_vel_scale`, `ang_vel_scale`
   - 在代码中读取并应用这些缩放因子
   - 为 `RootAngVelB` 添加 `scale` 支持

### 🟡 中优先级（为了完全一致）
2. **添加观察向量 clip**
   - 在输入ONNX前clip观察向量到[-100, 100]

### 🟢 低优先级（当前值已经是1.0，不影响功能）
3. **其他细节优化**
   - 虽然缩放因子默认是1.0，但为了完全匹配Python代码，应该添加支持
