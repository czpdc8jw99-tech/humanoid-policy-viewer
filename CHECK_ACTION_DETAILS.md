# 查看动作详细数值的命令

## 快速命令（查看当前动作值）

复制下面的代码到控制台运行：

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const actions = pr.lastActions;
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];

console.log('%c=== 左腿动作值（详细）===', 'color: blue; font-weight: bold;');
leftLegIndices.forEach(i => {
  const action = actions[i];
  const scale = pr.actionScale[i];
  const defaultPos = pr.defaultJointPos[i];
  const targetPos = defaultPos + scale * action;
  console.log(`  [${i}] ${pr.policyJointNames[i]}:`, {
    action: action.toFixed(4),
    actionScale: scale.toFixed(4),
    defaultPos: defaultPos.toFixed(4),
    targetPos: targetPos.toFixed(4),
    adjustment: (scale * action).toFixed(4)
  });
});

console.log('%c=== 右腿动作值（详细）===', 'color: red; font-weight: bold;');
rightLegIndices.forEach(i => {
  const action = actions[i];
  const scale = pr.actionScale[i];
  const defaultPos = pr.defaultJointPos[i];
  const targetPos = defaultPos + scale * action;
  console.log(`  [${i}] ${pr.policyJointNames[i]}:`, {
    action: action.toFixed(4),
    actionScale: scale.toFixed(4),
    defaultPos: defaultPos.toFixed(4),
    targetPos: targetPos.toFixed(4),
    adjustment: (scale * action).toFixed(4)
  });
});

// 对比左右腿
console.log('%c=== 左右腿对比 ===', 'color: green; font-weight: bold;');
const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
console.log('左腿平均幅度:', leftAvg.toFixed(4));
console.log('右腿平均幅度:', rightAvg.toFixed(4));
console.log('对称性比例:', (Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg)).toFixed(4));

// 检查 action_scale 是否对称
console.log('%c=== action_scale 检查 ===', 'color: orange; font-weight: bold;');
const leftScales = leftLegIndices.map(i => pr.actionScale[i]);
const rightScales = rightLegIndices.map(i => pr.actionScale[i]);
console.log('左腿 action_scale:', leftScales.map(s => s.toFixed(4)));
console.log('右腿 action_scale:', rightScales.map(s => s.toFixed(4)));
const scalesMatch = JSON.stringify(leftScales) === JSON.stringify(rightScales);
console.log('action_scale 是否对称:', scalesMatch ? '✅ 是' : '❌ 否');
```

---

## 关键检查点

运行上面的命令后，请告诉我：

1. **左右腿的 action 值**：是否右腿的动作值本身就比左腿大？
2. **action_scale 是否对称**：左右腿的 action_scale 是否相同？
3. **目标位置差异**：左右腿的目标位置差异有多大？

---

## 预期结果

### 如果 action_scale 对称
- 说明问题在策略输出的原始动作值
- 需要检查策略模型本身

### 如果 action_scale 不对称
- 说明配置有问题
- 需要检查 `loco_policy_29dof.json` 中的 `action_scale` 配置

---

## 根据当前配置

`loco_policy_29dof.json` 中 `action_scale` 是 `0.55`（标量），应该对所有关节都一样。

如果运行命令后发现 `action_scale` 不对称，说明代码处理有问题。
