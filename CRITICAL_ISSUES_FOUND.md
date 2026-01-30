# 关键问题发现

## 问题 1：Warmup 时观察向量不一致 ❌❌❌

### 原始 Python 代码
```python
self.obs = np.zeros(self.num_obs)  # 全零观察向量
for _ in range(50):
    self.policy(torch.from_numpy(self.obs))  # 使用全零观察向量
```

### 我们的代码
```javascript
const warmupState = {
  rootQuat: new Float32Array([0, 0, 0, 1]),  // identity quaternion
  // ...
};

// ProjectedGravityB.compute(warmupState)
const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
// quat = [0, 0, 0, 1] = [w=1, x=0, y=0, z=0]
// quatObj = THREE.Quaternion(0, 0, 1, 0) = (x=0, y=0, z=1, w=0) ❌ 错误！

const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
// gravity = (0, 0, -1)
// 结果：gravityLocal = (0, 0, -1) 而不是 (0, 0, 0)！
```

### 问题分析
1. **四元数转换错误**：
   - MuJoCo: `[w, x, y, z]` = `[1, 0, 0, 0]` (identity)
   - THREE.js: `(x, y, z, w)` = `(0, 0, 0, 1)`
   - 我们的转换：`new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0])`
   - 对于 `[1, 0, 0, 0]`：`new THREE.Quaternion(0, 0, 0, 1)` ✅ 正确

2. **但 ProjectedGravityB 不应该在 warmup 时计算**：
   - 原始 Python 使用全零观察向量
   - 我们的代码会计算 ProjectedGravityB，得到 `[0, 0, -1]` 而不是 `[0, 0, 0]`

### 影响
- LSTM 状态初始化不正确
- 可能导致策略行为异常

---

## 问题 2：ProjectedGravityB 计算方法不一致 ⚠️

### 我们的代码（ProjectedGravityB）
```javascript
const quatObj = new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
const gravityLocal = this.gravity.clone().applyQuaternion(quatObj.clone().invert());
```

### 其他代码（TargetProjectedGravityBObs）
```javascript
const gLocal = quatApplyInv(quat, g);
```

### 问题
- 两种方法应该等价，但需要验证
- `quatApplyInv` 是自定义函数，`applyQuaternion` 是 THREE.js 方法

---

## 问题 3：Warmup 时应该使用全零观察向量 ❌

### 修复方案
在 warmup 时，直接构建全零观察向量，而不是通过 `compute()` 方法：

```javascript
// 直接构建全零观察向量（匹配原始 Python）
const obsVec = new Float32Array(this.numObs).fill(0);
```

---

## 验证结果总结

### ✅ 正确的部分
1. 四元数顺序：MuJoCo `[w, x, y, z]` → THREE.js `(x, y, z, w)` 转换正确
2. 输入观察向量 clip：已正确实现
3. 动作处理公式：与原始 Python 一致
4. 输出动作 clip：已正确实现（虽然顺序可能不同，但当前配置下没问题）

### ❌ 错误的部分
1. **Warmup 时观察向量不一致**：应该使用全零，但我们计算了 ProjectedGravityB
2. **ProjectedGravityB 计算方法**：需要验证是否与 `quatApplyInv` 等价

### ⚠️ 需要进一步验证
1. 关节映射方向：需要确认 `policy_joint_names` 顺序
2. ProjectedGravityB 计算：需要验证 `applyQuaternion` 与 `quatApplyInv` 是否等价

---

## 最优先修复

**问题 1：Warmup 时使用全零观察向量**

这是最严重的问题，可能导致策略行为完全错误。
