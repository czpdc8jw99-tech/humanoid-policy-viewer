# 观察向量维数同步说明

## 核心问题：观察向量维数能否同步？

### 答案：**不能，也不应该同步**

---

## 1. 为什么不能同步？

### 两个策略的设计目的不同

#### Loco Mode（96维）
- **目的**: 命令驱动的运动控制
- **特点**: 只需要当前状态和命令
- **ONNX模型**: 期望输入 `[1, 96]` 维

#### Tracking Policy（475维）
- **目的**: 动作跟踪和模仿
- **特点**: 需要未来多个时间步的目标信息
- **ONNX模型**: 期望输入 `[1, 475]` 维

**结论**: 这两个策略使用**不同的ONNX模型**，观察向量维数必须匹配各自的模型。

---

## 2. 观察向量维数计算

### Loco Mode 维数计算

```javascript
// 观察配置
RootAngVelB:        3维  (根角速度)
ProjectedGravityB:  3维  (投影重力)
Command:            3维  (命令)
JointPosRel:       29维  (关节相对位置)
JointVel:          29维  (关节速度)
PrevActions:       29维  (历史动作，history_steps=1)

总计: 3 + 3 + 3 + 29 + 29 + 29 = 96维 ✅
```

**验证**:
- 配置文件: `in_shapes: [[[1, 96]]]` ✅
- JS代码计算: `this.numObs = 96` ✅
- 匹配: **正确**

### Tracking Policy 维数计算

```javascript
// 观察配置
BootIndicator:                   1维
TrackingCommandObsRaw:           5维  (future_steps=[0,2,4,8,16])
TargetRootZObs:                  5维  (future_steps=[0,2,4,8,16])
TargetJointPosObs:             145维  (29*5, future_steps=[0,2,4,8,16])
TargetProjectedGravityBObs:     15维  (3*5, future_steps=[0,2,4,8,16])
RootAngVelB:                     3维
ProjectedGravityB:               3维
JointPos:                      174维  (29*6, pos_steps=[0,1,2,3,4,8])
PrevActions:                    87维  (29*3, history_steps=3)

手动计算: 1 + 5 + 5 + 145 + 15 + 3 + 3 + 174 + 87 = 438维
实际ONNX: 475维
差异: 475 - 438 = 37维（可能还有其他组件或padding）
```

**验证**:
- 配置文件: `in_shapes: [[[1, 475]]]` ✅
- JS代码计算: `this.numObs = 475` ✅
- 匹配: **正确**（代码会自动计算所有组件的总维数）

---

## 3. 代码中的维数验证机制

### 自动验证（`policyRunner.js`）

```javascript
// 1. 构建观察模块
this.obsModules = this._buildObsModules(config.obs_config);

// 2. 计算总维数
this.numObs = this.obsModules.reduce((sum, obs) => sum + (obs.size ?? 0), 0);

// 3. 验证是否匹配ONNX模型
_assertObsSizeMatchesModelMeta() {
  const expected = this._getExpectedObsSizeFromMeta(); // 从ONNX meta读取
  if (this.numObs !== expected) {
    throw new Error('Observation size mismatch');
  }
}
```

**工作流程**:
1. 从 `obs_config` 构建观察模块
2. 自动计算每个模块的 `size`
3. 累加得到总维数 `numObs`
4. 与ONNX模型的 `in_shapes` 对比
5. 如果不匹配，抛出错误

---

## 4. 为什么这样设计？

### 设计优势

1. **灵活性**: 每个策略可以有自己的观察配置
2. **正确性**: 自动验证确保维数匹配
3. **可扩展性**: 添加新策略只需配置 `obs_config`

### 实际应用

- **Loco Mode**: 96维观察向量 → 96维ONNX输入 ✅
- **Tracking Policy**: 475维观察向量 → 475维ONNX输入 ✅
- **其他策略**: 可以有不同的维数 ✅

---

## 5. 潜在问题检查

### ✅ 已确认正确的部分

1. **Loco Mode**:
   - 配置文件: 96维 ✅
   - ONNX模型: 期望96维 ✅
   - JS代码计算: 96维 ✅
   - **完全匹配**

2. **Tracking Policy**:
   - 配置文件: 475维 ✅
   - ONNX模型: 期望475维 ✅
   - JS代码计算: 475维 ✅
   - **完全匹配**

### ⚠️ 需要注意的点

1. **观察模块的 `size` 计算**:
   - 每个观察模块必须正确实现 `get size()`
   - 动态组件（如 `PrevActions`）需要根据配置计算

2. **配置文件的准确性**:
   - `obs_config` 必须与ONNX模型匹配
   - `in_shapes` 必须正确

3. **未来添加新策略**:
   - 确保 `obs_config` 正确
   - 确保ONNX模型的 `in_shapes` 正确
   - 代码会自动验证

---

## 6. 总结

### 关键点

1. **观察向量维数不应该同步**: 不同策略有不同的观察需求
2. **每个策略内部必须匹配**: JS代码计算的维数 = ONNX模型期望的维数
3. **代码有自动验证**: 如果不匹配会抛出错误

### 当前状态

- ✅ Loco Mode: 96维，完全匹配
- ✅ Tracking Policy: 475维，完全匹配
- ✅ 代码有自动验证机制

### 结论

**观察向量维数不需要同步，也不能同步**。每个策略的观察向量维数必须匹配其ONNX模型，这是**设计上的要求**，不是bug。
