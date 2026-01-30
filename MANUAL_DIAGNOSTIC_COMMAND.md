# 手动诊断命令

## 快速使用

**直接复制下面的代码到控制台，按 Enter 运行：**

```javascript
function runDiagnostics() {
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr) {
    console.error('❌ PolicyRunner 未找到！请先加载策略。');
    return;
  }
  
  const demo = window.demo;
  if (!demo || !demo.readPolicyState) {
    console.error('❌ Demo 未找到或 readPolicyState 不可用。');
    return;
  }
  
  if (!pr.obsModules || pr.obsModules.length === 0) {
    console.error('❌ obsModules 为空或未定义！');
    return;
  }
  
  console.log('%c=== [手动诊断] 开始诊断 ===', 'color: blue; font-weight: bold; font-size: 14px;');
  
  try {
    const state = demo.readPolicyState();
    if (!state) {
      console.error('❌ 无法读取策略状态。');
      return;
    }
    
    // 使用索引查找模块（不依赖类名）
    const gravityObs = pr.obsModules[1]; // ProjectedGravityB
    const jointPosRelObs = pr.obsModules[3]; // JointPosRel
    
    // 1. 重力方向
    if (gravityObs) {
      const gravity = gravityObs.compute(state);
      const mag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
      const expectedGravity = [0, 0, -1];
      const diff = Math.sqrt(
        (gravity[0] - expectedGravity[0])**2 +
        (gravity[1] - expectedGravity[1])**2 +
        (gravity[2] - expectedGravity[2])**2
      );
      console.log('[手动诊断] ProjectedGravityB:', {
        value: Array.from(gravity).map(v => v.toFixed(4)),
        magnitude: mag.toFixed(4),
        expected: '[0, 0, -1]',
        difference: diff.toFixed(4),
        status: diff < 0.1 ? '✅' : '❌'
      });
    }
    
    // 2. 根角速度
    if (state.rootAngVel) {
      const angVelMag = Math.sqrt(state.rootAngVel[0]**2 + state.rootAngVel[1]**2 + state.rootAngVel[2]**2);
      console.log('[手动诊断] RootAngVelB:', {
        value: Array.from(state.rootAngVel).map(v => v.toFixed(4)),
        magnitude: angVelMag.toFixed(4),
        expected: '[0, 0, 0]',
        status: angVelMag < 0.01 ? '✅' : '❌'
      });
    }
    
    // 3. 命令
    if (pr.command) {
      const cmdMag = Math.sqrt(pr.command[0]**2 + pr.command[1]**2 + pr.command[2]**2);
      console.log('[手动诊断] Command:', {
        value: Array.from(pr.command).map(v => v.toFixed(4)),
        magnitude: cmdMag.toFixed(4),
        expected: '[0, 0, 0]',
        status: cmdMag < 0.01 ? '✅' : '❌'
      });
    }
    
    // 4. 关节位置相对值
    if (jointPosRelObs) {
      const jointPosRel = jointPosRelObs.compute(state);
      const maxAbs = Math.max(...Array.from(jointPosRel.slice(0, 6)).map(Math.abs));
      console.log('[手动诊断] JointPosRel (前6个):', {
        values: Array.from(jointPosRel.slice(0, 6)).map(v => v.toFixed(4)),
        maxAbs: maxAbs.toFixed(4),
        expected: '[0, 0, 0, 0, 0, 0]',
        status: maxAbs < 0.01 ? '✅' : '❌'
      });
    }
    
    // 5. 关节速度
    if (state.jointVel) {
      const maxAbs = Math.max(...state.jointVel.slice(0, 6).map(Math.abs));
      console.log('[手动诊断] JointVel (前6个):', {
        values: Array.from(state.jointVel.slice(0, 6)).map(v => v.toFixed(4)),
        maxAbs: maxAbs.toFixed(4),
        expected: '[0, 0, 0, 0, 0, 0]',
        status: maxAbs < 0.01 ? '✅' : '❌'
      });
    }
    
    // 6. 根位置
    const qpos = demo.simulation.qpos;
    if (qpos && qpos.length >= 3) {
      const rootZ = qpos[2];
      console.log('[手动诊断] Root Position Z:', {
        value: rootZ.toFixed(3),
        expected: 0.8,
        status: rootZ === 0.8 ? '✅' : '❌',
        note: rootZ < 0.5 ? '⚠️ 机器人可能已倒下' : ''
      });
    }
    
    // 7. 动作对称性
    if (pr.lastActions) {
      const actions = pr.lastActions;
      const leftLegIndices = [0, 3, 6, 9, 13, 17];
      const rightLegIndices = [1, 4, 7, 10, 14, 18];
      const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
      const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
      
      let ratio, status, note;
      if (leftAvg === 0 && rightAvg === 0) {
        ratio = 1.0;
        status = '✅';
        note = '初始状态（动作值全为0，策略尚未推理）';
      } else {
        ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
        status = ratio > 0.7 ? '✅' : '❌';
        note = ratio < 0.7 ? '⚠️ 动作严重不对称' : '';
      }
      
      console.log('[手动诊断] Action Symmetry:', {
        leftLegAvg: leftAvg.toFixed(4),
        rightLegAvg: rightAvg.toFixed(4),
        symmetryRatio: ratio.toFixed(4),
        status: status,
        note: note
      });
    }
    
    console.log('%c=== [手动诊断] 完成 ===', 'color: green; font-weight: bold; font-size: 14px;');
  } catch (e) {
    console.error('[手动诊断] 运行出错:', e);
  }
}

runDiagnostics();
```

---

## 使用方法

### 步骤1：打开控制台
按 `F12` 打开浏览器控制台

### 步骤2：确保策略已加载
- 选择 "G1 Locomotion (Gamepad)" 策略
- 等待策略加载完成

### 步骤3：复制并运行
- 复制上面的完整代码
- 粘贴到控制台
- 按 `Enter` 运行

---

## 使用场景

### 场景1：自动诊断（推荐）
- **时机**：策略加载完成后自动运行
- **优点**：无需手动操作
- **适用**：检查初始状态

### 场景2：手动诊断
- **时机**：任何时候都可以运行
- **优点**：可以在机器人运动后运行
- **适用**：
  - 机器人倒下后检查状态
  - 重新运行诊断
  - 检查运动中的动作值

---

## 诊断结果说明

每个项目都会显示：
- **value/values**: 实际值
- **expected**: 预期值
- **status**: ✅ 正常 / ❌ 异常
- **note**: 警告信息（如果有）

---

## 快速命令（简化版）

如果只想检查动作对称性：

```javascript
const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
const actions = pr.lastActions;
const leftLegIndices = [0, 3, 6, 9, 13, 17];
const rightLegIndices = [1, 4, 7, 10, 14, 18];
const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
const ratio = leftAvg === 0 && rightAvg === 0 ? 1.0 : Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
console.log('动作对称性:', {
  leftLegAvg: leftAvg.toFixed(4),
  rightLegAvg: rightAvg.toFixed(4),
  symmetryRatio: ratio.toFixed(4),
  status: ratio > 0.7 ? '✅' : '❌'
});
```

---

## 提示

- **自动诊断**：策略加载后会自动运行，无需手动操作
- **手动诊断**：如果需要重新运行或检查运动中的状态，使用上面的手动诊断函数
- **最佳时机**：在机器人倒下后立即运行诊断，查看动作值是否不对称
