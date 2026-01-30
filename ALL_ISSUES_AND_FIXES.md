# 所有问题及修复方案

## 问题汇总

### ❌ 问题 1：Warmup 时观察向量不一致（最严重）

**原始 Python**：
```python
self.obs = np.zeros(self.num_obs)  # 全零观察向量
for _ in range(50):
    self.policy(torch.from_numpy(self.obs))
```

**我们的代码**：
- 使用 identity quaternion，导致 ProjectedGravityB = `[0, 0, -1]` 而不是 `[0, 0, 0]`
- 观察向量不是全零

**影响**：LSTM 状态初始化不正确，可能导致策略行为完全错误

**修复**：在 warmup 时直接使用全零观察向量

---

### ⚠️ 问题 2：ProjectedGravityB 计算方法需要验证

**我们的代码**：
```javascript
const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
```

**其他代码（TargetProjectedGravityBObs）**：
```javascript
const gLocal = quatApplyInv(quat, g);
```

**验证**：
- `applyQuaternion(q.invert())` 应该等价于 `quatApplyInv(q, vec)`
- 两者都是将世界坐标系向量转换到局部坐标系
- 但需要实际测试确认

**建议**：统一使用 `quatApplyInv` 方法，确保一致性

---

### ✅ 问题 3：关节顺序验证

**验证结果**：
- 我们的 `policy_joint_names` 顺序与原始 Python 的策略关节顺序一致 ✅
- `joint2motor_idx` 映射方向正确 ✅

**结论**：关节映射正确，不需要修改

---

## 修复方案

### 修复 1：Warmup 时使用全零观察向量

**文件**：`src/simulation/policyRunner.js`

**修改**：
```javascript
async _warmupLSTMState() {
  // ... 现有代码 ...
  
  // CRITICAL FIX: Use all-zero observation vector (matching original Python)
  // Original Python: self.obs = np.zeros(self.num_obs)
  const obsVec = new Float32Array(this.numObs).fill(0);
  
  // CRITICAL: Clip observation vector to [-100, 100] as in original Python code
  for (let i = 0; i < obsVec.length; i++) {
    obsVec[i] = Math.max(-100, Math.min(100, obsVec[i]));
  }
  
  // Run 50 warmup inferences
  // ... 现有代码 ...
}
```

---

### 修复 2：统一 ProjectedGravityB 计算方法

**文件**：`src/simulation/observationHelpers.js`

**修改**：
```javascript
class ProjectedGravityB {
  constructor() {
    this.gravity = [0.0, 0.0, -1.0];  // 改为数组，匹配 quatApplyInv
  }
  
  compute(state) {
    const quat = state.rootQuat;
    // 使用 quatApplyInv 方法，与 TargetProjectedGravityBObs 一致
    const gLocal = quatApplyInv(quat, this.gravity);
    return new Float32Array(gLocal);
  }
}
```

**需要导入**：
```javascript
import { quatApplyInv } from './utils/math.js';
```

---

## 修复优先级

1. **最高优先级**：修复 Warmup 观察向量（问题 1）
2. **高优先级**：统一 ProjectedGravityB 计算方法（问题 2）

---

## 验证计划

修复后需要验证：
1. Warmup 时的观察向量是否全零
2. ProjectedGravityB 计算结果是否正确
3. 机器人是否能正常站立和平衡
