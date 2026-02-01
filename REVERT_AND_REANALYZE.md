# 回退修复并重新分析

## 问题

修复后控制值对称性从 48% 降到 34%，说明修复方向错误。

## 重新分析

### Python 代码中的 default_angles

在 `LocoMode.py` 中：
- `default_angles` 是策略顺序的（从配置文件读取）
- `default_angles_reorder` 是电机顺序的（在 `enter()` 中重新排序）
- **但是，Python 代码中并没有直接设置初始关节位置到 `default_angles`**

### 初始状态设置

初始状态可能由以下方式设置：
1. MuJoCo XML/JSON 场景文件（`g1.json` 中的 `init_state`）
2. 其他机制

### default_joint_pos 的用途

`default_joint_pos` 在动作计算中使用：
```python
loco_action = self.action * self.action_scale + self.default_angles
```
这里的 `default_angles` 是**策略顺序**的，不应该重新排序！

### 问题可能不在初始状态设置

从诊断结果看：
- 当前位置对称性：89%（比之前的87%略有改善）
- 但控制值对称性：34%（比之前的48%更差）

这说明：
1. 初始状态设置可能有一些改善
2. 但问题可能在其他地方

## 需要检查

1. **readPolicyState() 中的状态读取逻辑是否正确？**
   - 使用 `qpos_adr_motor[motorIdx]` 读取状态
   - 但 `joint2motorIdx[i]` 映射是否正确？

2. **actionReordered 的创建是否正确？**
   - `actionReordered[motorIdx] = actionTarget[i]` 其中 `motorIdx = joint2motorIdx[i]`
   - 这个逻辑是否正确？

3. **qpos_adr_motor 的创建是否正确？**
   - `qpos_adr_motor[motorIdx] = qpos_adr_policy[i]` 其中 `motorIdx = joint2motorIdx[i]`
   - 这个逻辑是否正确？

## 建议

回退初始状态设置的修复，重新检查状态读取和动作应用的逻辑。
