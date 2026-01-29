# 潜在问题发现

## 关键代码逻辑分析

### configureJointMappings 函数

```javascript
// 1. 构建 actuator2joint 映射
const actuator2joint = [];
for (let i = 0; i < model.nu; i++) {
  if (model.actuator_trntype[i] !== jointTransmission) {
    throw new Error(`Actuator ${i} transmission type is not mjTRN_JOINT`);
  }
  actuator2joint.push(model.actuator_trnid[2 * i]);
}
// actuator2joint[i] = 执行器 i 对应的关节索引

// 2. 为每个策略关节查找执行器
for (const name of jointNames) {
  const jointIdx = demo.jointNamesMJC.indexOf(name);  // 关节在 MuJoCo 模型中的索引
  const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);  // 查找执行器
  demo.ctrl_adr_policy.push(actuatorIdx);
}
```

### 潜在问题

**`actuator2joint.findIndex` 会返回第一个匹配的执行器索引。**

如果 MuJoCo 模型中的执行器顺序和策略中的关节顺序不一致，可能会导致：

1. **左右腿执行器索引不对称**
   - 例如：策略中 left_hip_pitch 是 [0]，right_hip_pitch 是 [1]
   - 但如果 MuJoCo 执行器顺序是：left_hip_pitch, left_hip_roll, right_hip_pitch, right_hip_roll
   - 那么 `findIndex` 可能会找到错误的执行器

2. **动作被应用到错误的执行器**
   - 如果 `ctrl_adr_policy[0]`（left_hip_pitch）指向了错误的执行器
   - 那么左腿的动作就会被应用到错误的关节

### 验证方法

需要检查：
1. **MuJoCo 模型中的执行器顺序**（通过 `actuator2joint` 日志）
2. **策略中的关节顺序**（通过 `policy_joint_names`）
3. **左右腿的执行器索引是否对称**

如果发现：
- 左腿的执行器索引：0, 2, 4, 6, 8, 10
- 右腿的执行器索引：1, 3, 5, 7, 9, 11

那么映射是正确的。

但如果发现：
- 左腿的执行器索引：0, 1, 2, 3, 4, 5
- 右腿的执行器索引：6, 7, 8, 9, 10, 11

那么映射也是正确的（只要左右腿的执行器是连续的）。

**关键是要检查左右腿对应关节的执行器索引是否对称。**

例如：
- left_hip_pitch 的执行器索引应该是 0
- right_hip_pitch 的执行器索引应该是 1（或者是对应的右腿执行器）

如果发现不对称，那就是问题所在。
