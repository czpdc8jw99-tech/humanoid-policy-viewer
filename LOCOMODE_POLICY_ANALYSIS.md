# LocoMode 策略深度分析

## 原始策略的设计目标

根据 `FSMDeploy_G1` 的 README 和代码，`LocoMode` 是一个**稳定的行走策略**（"Stable walking"），设计用于：
- **手柄控制的行走**：通过游戏手柄输入速度命令（vx, vy, wz）
- **保持平衡**：策略应该能够维持机器人站立和行走
- **响应命令**：根据速度命令调整行走方向和速度

## 原始代码的关键逻辑

### 1. 观察向量构建（96维）

```python
self.obs[:3] = self.ang_vel.copy()  # RootAngVelB (3)
self.obs[3:6] = self.gravity_orientation.copy()  # ProjectedGravityB (3)
self.obs[6:9] = self.cmd.copy()  # Command (3)
self.obs[9: 9 + self.num_actions] = self.qj_obs.copy()  # JointPosRel (29)
self.obs[9 + self.num_actions: 9 + self.num_actions * 2] = self.dqj_obs.copy()  # JointVel (29)
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()  # PrevActions (29)
```

**关键点**：
- `qj_obs = (qj - default_angles) * dof_pos_scale`：相对关节位置
- `dqj_obs = dqj * dof_vel_scale`：关节速度
- `action`：**前一步的动作**（用于历史信息）

### 2. 策略推理

```python
self.action = self.policy(torch.from_numpy(obs_tensor).clip(-100, 100)).clip(-100, 100).detach().numpy().squeeze()
```

**关键点**：
- 输入 obs 被 clip 到 [-100, 100]
- 输出 action 也被 clip 到 [-100, 100]
- **没有 tanh**，直接输出

### 3. 动作处理

```python
loco_action = self.action * self.action_scale + self.default_angles
```

**关键点**：
- `action_scale = 0.25`
- 最终目标位置 = `default_angles + action * 0.25`
- 这意味着 action 的范围如果是 [-4, 4]，最终调整就是 [-1, 1] 弧度

### 4. 初始化

```python
for _ in range(50):
    with torch.inference_mode():
        obs_tensor = self.obs.reshape(1, -1)
        obs_tensor = obs_tensor.astype(np.float32)
        self.policy(torch.from_numpy(obs_tensor))
```

**关键点**：
- 策略初始化时，**运行 50 次推理**，用全零的 obs
- 这是为了**初始化 LSTM 的内部状态**
- 我们的代码可能**没有做这个初始化**！

## 我们的实现 vs 原始实现

### ✅ 我们已经做对的

1. **观察向量构建**：顺序和内容基本正确
2. **动作处理**：`target = defaultJointPos + actionScale * action`
3. **初始姿态设置**：v9.0.10 添加了设置初始关节位置

### ❌ 我们可能遗漏的

1. **LSTM 状态初始化**：
   - 原始代码在初始化时运行 50 次推理来初始化 LSTM 状态
   - 我们的代码可能没有做这个，导致 LSTM 状态不正确

2. **PrevActions 的更新时机**：
   - 原始代码中，`self.action` 是前一步的动作
   - 我们的代码中，`PrevActions` 的更新时机可能不对

3. **动作的 clip 范围**：
   - 原始代码 clip 到 [-100, 100]
   - 我们的代码也 clip 到 [-100, 100]，但可能时机不对

## 关键问题：机器人应该站得住吗？

### 答案：**应该站得住！**

根据原始代码的设计：
1. **策略训练时**：应该能够从 `default_angles` 姿态开始，在 `command=[0,0,0]` 时**保持站立**
2. **策略输出**：即使 command=0，策略也应该输出微小的调整动作来维持平衡
3. **动作范围**：通过 `action_scale=0.25`，动作被限制在合理范围内

### 如果站不住，可能的原因

1. **LSTM 状态未初始化**：
   - 如果 LSTM 的内部状态（hidden_state, cell_state）没有正确初始化，策略的输出会不稳定
   - 这可能导致"一只脚动一只脚不动"的问题

2. **PrevActions 不正确**：
   - 如果前一步动作的更新时机不对，或者初始值不对，会导致观察向量错误
   - 策略基于错误的观察向量，输出错误的动作

3. **初始姿态不完全匹配**：
   - 即使设置了 `default_joint_pos`，如果机器人的初始状态（速度、加速度）不对，策略可能需要时间适应

## 下一步应该做什么

### 优先级 1：检查 LSTM 状态初始化

原始代码在初始化时运行 50 次推理来初始化 LSTM 状态。我们需要：
1. 检查我们的 ONNX 模型是否包含 LSTM 状态
2. 如果包含，需要在初始化时运行多次推理来初始化状态
3. 如果不包含，可能需要检查 ONNX 转换是否正确

### 优先级 2：检查 PrevActions 的更新

确保 `PrevActions` 在正确的时机更新，并且初始值正确。

### 优先级 3：验证动作输出范围

检查策略输出的原始值范围，看看是否在合理范围内（比如 [-4, 4]）。

## 结论

**原始策略应该能够站得住**，如果站不住，说明我们的实现有问题，需要：
1. 正确初始化 LSTM 状态
2. 确保 PrevActions 正确更新
3. 验证所有参数和逻辑与原始代码一致
