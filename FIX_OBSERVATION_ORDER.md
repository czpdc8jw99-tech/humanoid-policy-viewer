# 修复观察向量顺序问题

## Python 代码逻辑

```python
for i in range(len(self.joint2motor_idx)):
    self.qj_obs[i] = self.qj[self.joint2motor_idx[i]]
```

这意味着：
- `qj` 是电机顺序的数组（29个元素，索引0-28是电机索引）
- `qj_obs` 是策略顺序的数组（29个元素，索引0-28是策略索引）
- `qj_obs[i]`（策略索引 i）= `qj[joint2motor_idx[i]]`（电机索引 joint2motor_idx[i]）

## JavaScript 当前实现

在 `readPolicyState()` 中：
```javascript
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = this.joint2motorIdx[i];
  const qposAdr = this.qpos_adr_motor[motorIdx];
  jointPos[i] = qpos[qposAdr];
}
```

问题：`qpos_adr_motor[motorIdx]` 是从 `qpos_adr_policy[i]` 映射来的，其中 `motorIdx = joint2motorIdx[i]`。

但是，`qpos` 是 MuJoCo 的原始数组，不是电机顺序的！

## 正确的理解

在 Python 中：
- `qj` 是电机顺序的数组（从状态读取后重新排序）
- `qj[joint2motor_idx[i]]` 是从电机顺序数组读取

在 JavaScript 中：
- `qpos` 是 MuJoCo 的原始数组（包含根位置、四元数等）
- `qpos_adr_policy[i]` 是策略索引 i 对应的 MuJoCo 地址
- `qpos_adr_motor[motorIdx]` 是电机索引 motorIdx 对应的 MuJoCo 地址

关键：`qpos_adr_motor[motorIdx]` 应该等于 `qpos_adr_policy[i]`，其中 `motorIdx = joint2motorIdx[i]`。

但是，如果 `qpos_adr_motor[motorIdx] = qpos_adr_policy[i]`，那么：
- `jointPos[i] = qpos[qpos_adr_motor[motorIdx]]` = `qpos[qpos_adr_policy[i]]`

这看起来是对的，但是让我检查一下 `qpos_adr_motor` 的构建逻辑是否正确。

## 检查 qpos_adr_motor 的构建

在 `mujocoUtils.js` 中：
```javascript
for (let i = 0; i < this.numActions; i++) {
  const motorIdx = joint2motorIdx[i];
  this.qpos_adr_motor[motorIdx] = this.qpos_adr_policy[i];
}
```

这意味着：
- `qpos_adr_motor[motorIdx] = qpos_adr_policy[i]`，其中 `motorIdx = joint2motorIdx[i]`

所以：
- `jointPos[i] = qpos[qpos_adr_motor[motorIdx]]` = `qpos[qpos_adr_policy[i]]`

这应该是正确的！

## 但是，问题可能在于

Python 代码中，`qj` 可能是从某个地方读取的电机顺序数组，而不是直接从 MuJoCo 读取的。

让我检查一下 Python 代码中 `qj` 的来源...
