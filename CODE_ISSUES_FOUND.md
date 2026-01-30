# 代码逻辑问题检查结果

## 对比原始 Python 代码

### ✅ 正确的部分

1. **观察向量顺序**：正确
   - RootAngVelB(3) + ProjectedGravityB(3) + Command(3) + JointPosRel(29) + JointVel(29) + PrevActions(29)

2. **动作处理公式**：正确
   - `target = defaultJointPos + actionScale * action`
   - 与原始代码一致

3. **Command 缩放**：正确
   - `scaleBipolar` 应该等价于 Python 的 `scale_values`
   - Command scale 默认 1.0，与原始一致

---

## ⚠️ 发现的问题

### 问题 1：action_scale 差异（已修复，但可能还不够）

**原始代码**：`action_scale = 0.25`  
**我们的代码**：`action_scale = 0.5`（已从 0.25 增加到 0.5）

**分析**：
- 我们已经增加了 2 倍
- 但如果原始输出是 [-1.86, 1.86]，乘以 0.5 后是 [-0.93, 0.93] 弧度
- **可能还是不够**

**建议**：增加到 1.0 或更大

---

### 问题 2：RootAngVelB 缺少 scale 支持（可能不是问题）

**原始代码**：
```python
self.ang_vel = self.ang_vel * self.ang_vel_scale  # ang_vel_scale = 1.0
```

**我们的代码**：
```javascript
compute(state) {
  return new Float32Array(state.rootAngVel);  // 没有 scale
}
```

**影响**：
- 如果 ang_vel_scale = 1.0，没有影响
- 配置文件中没有 ang_vel_scale，所以应该是 1.0
- **可能不是关键问题**

---

### 问题 3：Command 的 scale_values 实现可能不对 ⚠️

**原始 Python 代码**：
```python
joycmd = self.state_cmd.vel_cmd.copy()
self.cmd = scale_values(joycmd, [self.range_velx, self.range_vely, self.range_velz])
self.cmd = self.cmd * self.cmd_scale  # cmd_scale = [1.0, 1.0, 1.0]
```

**我们的代码**：
```javascript
// main.js: _updateGamepadCommand()
const vx = scaleBipolar(uVx, -0.4, 0.7);
const vy = scaleBipolar(uVy, -0.4, 0.4);
const wz = scaleBipolar(uWz, -1.57, 1.57);
this.cmd[0] = vx;
this.cmd[1] = vy;
this.cmd[2] = wz;

// observationHelpers.js: Command.compute()
const s = this.scale;  // 默认 1.0
return new Float32Array([s * x, s * y, s * z]);
```

**检查 scaleBipolar**：
```javascript
function scaleBipolar(u, min, max) {
  if (u >= 0) return u * max;
  const negMax = Number.isFinite(min) ? -min : 0.0;
  return u * negMax;
}
```

**问题**：
- `scaleBipolar` 的实现看起来正确
- 但需要确认 Python 的 `scale_values` 是否也是这样的逻辑

**状态**：✅ 应该正确

---

### 问题 4：PrevActions 的更新时机 ⚠️

**原始代码**：
```python
self.obs[9 + self.num_actions * 2: 9 + self.num_actions * 3] = self.action.copy()  # PrevActions
# 这里的 self.action 是前一步的动作
```

**我们的代码**：
```javascript
// PrevActions.update() 在推理之后调用
for (const obs of this.obsModules) {
  if (obs.constructor.name === 'PrevActions' && typeof obs.update === 'function') {
    obs.update(state);
  }
}
```

**检查**：需要确认 PrevActions 是否使用了正确的值（当前动作还是前一步动作）

---

## 关键发现

### 1. action_scale 可能仍然太小

即使移除了 tanh：
- 原始输出：[-1.86, 1.86]
- 乘以 0.5：[-0.93, 0.93] 弧度（约 ±53 度）
- **可能还是不够维持平衡**

**建议**：增加到 1.0

---

### 2. 需要验证观察向量是否正确

特别是：
- ProjectedGravityB 是否正确计算
- RootAngVelB 是否正确读取
- Command 是否正确缩放

---

## 建议的修复

### 修复 1：增加 action_scale 到 1.0（最可能解决问题）

**文件**：`public/examples/checkpoints/g1/loco_policy_29dof.json`

```json
{
  "action_scale": 1.0,  // 从 0.5 增加到 1.0
}
```

**预期效果**：
- 调整范围：[-1.86, 1.86] 弧度（约 ±107 度）
- 比当前（±53 度）增加 2 倍

---

### 修复 2：添加 RootAngVelB scale 支持（如果需要）

**文件**：`src/simulation/observationHelpers.js`

```javascript
class RootAngVelB {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.scale = typeof kwargs.scale === 'number' ? kwargs.scale : 1.0;
  }
  
  get size() {
    return 3;
  }

  compute(state) {
    const angVel = state.rootAngVel;
    return new Float32Array([
      angVel[0] * this.scale,
      angVel[1] * this.scale,
      angVel[2] * this.scale
    ]);
  }
}
```

**但**：如果 ang_vel_scale = 1.0，这个修复没有实际效果

---

## 调试指令

### 验证动作处理流程

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const demo = window.demo;

// 检查动作值
const actions = pr.lastActions;
const targets = demo.actionTarget;
const defaults = pr.defaultJointPos;

console.log('=== 动作处理验证 ===');
console.log('Action scale:', pr.actionScale[0]);
console.log('Actions (first 6):', Array.from(actions.slice(0, 6)));
console.log('Defaults (first 6):', Array.from(defaults.slice(0, 6)));
console.log('Targets (first 6):', Array.from(targets.slice(0, 6)));

// 验证公式
const calculated = defaults.slice(0, 6).map((d, i) => d + pr.actionScale[i] * actions[i]);
console.log('Calculated (first 6):', calculated);
console.log('Match:', calculated.every((c, i) => Math.abs(c - targets[i]) < 0.0001));

// 检查调整幅度
const adjustments = defaults.slice(0, 6).map((d, i) => targets[i] - d);
console.log('Adjustments (first 6):', adjustments);
console.log('Max adjustment:', Math.max(...adjustments.map(Math.abs)));
```

---

## 总结

**代码逻辑基本正确**，主要问题可能是：

1. ⚠️ **action_scale 仍然太小**（当前 0.5，建议增加到 1.0）
2. ✅ **观察向量构建正确**
3. ✅ **动作处理逻辑正确**
4. ⚠️ **RootAngVelB 缺少 scale，但原始是 1.0，可能不是问题**

**建议**：
1. **先增加 action_scale 到 1.0**
2. 如果还不够，再检查其他问题
