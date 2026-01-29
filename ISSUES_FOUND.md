# 策略问题诊断报告

## 问题描述
- 机器人站不住，会摔倒
- 摔倒后左腿一直在动

## 发现的问题

### 🔴 问题 1：PrevActions 更新时机错误（严重）

**位置**：`src/simulation/policyRunner.js`

**问题**：
- `PrevActions.update()` 在推理**之前**被调用（第 105-107 行）
- 但 `this.lastActions` 是在推理**之后**才更新的（第 144-148 行）
- 这导致 `PrevActions` 读取的是**上一次**的动作，这是正确的
- **但是**，`PrevActions.update()` 应该在推理**之后**调用，以便将**当前**推理得到的动作保存到历史缓冲区中，供**下一次**推理使用

**当前流程**：
```
1. obs.update(state)  // 更新 PrevActions（读取上一次的 lastActions）
2. obs.compute(state)  // 构建观察向量（包含 PrevActions）
3. 推理
4. 更新 this.lastActions  // 当前动作保存到 lastActions
```

**正确流程应该是**：
```
1. obs.compute(state)  // 构建观察向量（包含上一次的 PrevActions）
2. 推理
3. 更新 this.lastActions  // 当前动作保存到 lastActions
4. obs.update(state)  // 更新 PrevActions（将当前动作保存到历史缓冲区）
```

**影响**：
- 第一次推理：PrevActions 是零（正确）
- 第二次推理：PrevActions 读取的是第一次推理的动作（正确）
- 第三次推理：PrevActions 读取的是第二次推理的动作（正确）
- **但是**，如果 `update()` 在推理前调用，那么第一次推理后，PrevActions 没有被更新，导致第二次推理时 PrevActions 仍然是零

**修复方法**：
在 `policyRunner.js` 的 `step()` 方法中，将 `obs.update(state)` 的调用移到推理**之后**，在更新 `this.lastActions` **之后**。

---

### 🟡 问题 2：观察向量维度验证

**位置**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**检查**：
- RootAngVelB: 3 维
- ProjectedGravityB: 3 维
- Command: 3 维
- JointPosRel: 29 维
- JointVel: 29 维
- PrevActions: 29 维（history_steps=1）
- **总计**：3+3+3+29+29+29 = 96 ✓

**状态**：✅ 维度正确

---

### 🟡 问题 3：关节名称顺序验证

**位置**：
- `public/examples/checkpoints/g1/loco_policy_29dof.json` 的 `policy_joint_names`
- `public/examples/scenes/g1/g1.json` 的 `joint_names_isaac`

**检查**：
两个文件中的关节名称顺序**完全一致**，顺序正确。

**状态**：✅ 关节顺序正确

---

### 🟡 问题 4：PrevActions 的 history_steps 配置

**位置**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**配置**：
```json
{ "name": "PrevActions", "history_steps": 1 }
```

**检查**：
- `history_steps: 1` 意味着只使用前一步的动作
- 观察向量中 PrevActions 应该是 29 维（1 * 29）
- 这与原始配置 `LocoMode.yaml` 中的 `num_obs: 96` 一致

**状态**：✅ 配置正确

---

### 🟡 问题 5：PD 控制参数验证

**位置**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**检查**：
- `stiffness` 和 `damping` 数组长度都是 29，与 `policy_joint_names` 长度一致 ✓
- 数值范围合理（stiffness: 20-200, damping: 2-5）✓

**状态**：✅ PD 参数正确

---

### 🟡 问题 6：默认关节位置验证

**位置**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

**检查**：
- `default_joint_pos` 数组长度是 29，与 `policy_joint_names` 长度一致 ✓
- 数值与 `LocoMode.yaml` 中的 `default_angles` 一致 ✓

**状态**：✅ 默认位置正确

---

## 总结

### 最可能的问题
**问题 1：PrevActions 更新时机错误** 是最可能导致机器人站不住的原因。

### 修复优先级
1. **高优先级**：修复 PrevActions 更新时机
2. **中优先级**：添加更多调试日志，验证观察向量和动作值
3. **低优先级**：检查是否有其他潜在问题

### 建议的修复步骤
1. 修复 `policyRunner.js` 中 `PrevActions.update()` 的调用时机
2. 添加调试日志，输出：
   - 每次推理时的 PrevActions 值
   - 每次推理后的 lastActions 值
   - 观察向量的完整内容（前几次推理）
3. 重新测试，观察机器人是否能站稳

---

## 其他可能的问题（需要进一步检查）

### 可能问题 A：关节映射错误
虽然关节名称顺序正确，但需要确认 MuJoCo 模型中的关节索引映射是否正确。

**检查方法**：
- 在浏览器控制台输出 `jointNamesMJC` 和 `policyJointNames`，确认映射关系
- 检查 `ctrl_adr_policy`、`qpos_adr_policy`、`qvel_adr_policy` 是否正确

### 可能问题 B：观察向量构建顺序
虽然维度正确，但需要确认观察向量的构建顺序是否与策略期望的一致。

**检查方法**：
- 在浏览器控制台输出完整的观察向量
- 与原始 Python 实现（`LocoMode.py`）对比

### 可能问题 C：动作缩放和应用
需要确认 `action_scale` 和 `action_clip` 是否正确应用。

**检查方法**：
- 在浏览器控制台输出原始动作值、缩放后的动作值、最终目标关节位置
- 确认数值范围是否合理
