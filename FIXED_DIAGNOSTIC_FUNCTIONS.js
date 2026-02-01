// 修复后的诊断函数 - 带完整错误处理

function checkObservations() {
  console.log('=== 观察向量检查 ===');
  
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
  
  // 检查 obsModules
  if (!pr.obsModules || pr.obsModules.length === 0) {
    console.error('❌ obsModules 为空或未定义！');
    console.log('PolicyRunner 属性:', Object.keys(pr));
    return;
  }
  
  console.log('观察模块列表:', pr.obsModules.map(obs => obs.constructor.name));
  
  const state = demo.readPolicyState();
  if (!state) {
    console.error('❌ 无法读取策略状态。');
    return;
  }
  
  // 1. 重力方向
  console.log('\n1. ProjectedGravityB:');
  const gravityObs = pr.obsModules.find(obs => obs.constructor.name === 'ProjectedGravityB');
  if (!gravityObs) {
    console.error('   ❌ ProjectedGravityB 未找到！');
    console.log('   可用模块:', pr.obsModules.map(obs => obs.constructor.name));
  } else {
    try {
      const gravity = gravityObs.compute(state);
      console.log('   值:', Array.from(gravity).map(v => v.toFixed(4)));
      console.log('   预期: [0, 0, -1] (机器人站立时)');
      const mag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
      console.log('   大小:', mag.toFixed(4), mag > 0.9 && mag < 1.1 ? '✅' : '❌');
    } catch (e) {
      console.error('   ❌ 计算重力时出错:', e);
    }
  }
  
  // 2. 根角速度
  console.log('\n2. RootAngVelB:');
  if (state.rootAngVel) {
    console.log('   值:', state.rootAngVel.map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0]');
    const mag = Math.sqrt(state.rootAngVel[0]**2 + state.rootAngVel[1]**2 + state.rootAngVel[2]**2);
    console.log('   大小:', mag.toFixed(4), mag < 0.01 ? '✅' : '❌');
  } else {
    console.error('   ❌ rootAngVel 未找到！');
  }
  
  // 3. 命令
  console.log('\n3. Command:');
  if (pr.command) {
    console.log('   值:', Array.from(pr.command).map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0] (零速度)');
    const mag = Math.sqrt(pr.command[0]**2 + pr.command[1]**2 + pr.command[2]**2);
    console.log('   大小:', mag.toFixed(4), mag < 0.01 ? '✅' : '❌');
  } else {
    console.error('   ❌ command 未找到！');
  }
  
  // 4. 关节位置相对值
  console.log('\n4. JointPosRel:');
  const jointPosRelObs = pr.obsModules.find(obs => obs.constructor.name === 'JointPosRel');
  if (!jointPosRelObs) {
    console.error('   ❌ JointPosRel 未找到！');
  } else {
    try {
      const jointPosRel = jointPosRelObs.compute(state);
      console.log('   值 (前6个):', Array.from(jointPosRel.slice(0, 6)).map(v => v.toFixed(4)));
      console.log('   预期: [0, 0, 0, 0, 0, 0] (初始时)');
      const maxAbs = Math.max(...Array.from(jointPosRel.slice(0, 6)).map(Math.abs));
      console.log('   最大绝对值:', maxAbs.toFixed(4), maxAbs < 0.01 ? '✅' : '❌');
    } catch (e) {
      console.error('   ❌ 计算 JointPosRel 时出错:', e);
    }
  }
  
  // 5. 关节速度
  console.log('\n5. JointVel:');
  if (state.jointVel) {
    console.log('   值 (前6个):', state.jointVel.slice(0, 6).map(v => v.toFixed(4)));
    console.log('   预期: [0, 0, 0, 0, 0, 0]');
    const maxAbs = Math.max(...state.jointVel.slice(0, 6).map(Math.abs));
    console.log('   最大绝对值:', maxAbs.toFixed(4), maxAbs < 0.01 ? '✅' : '❌');
  } else {
    console.error('   ❌ jointVel 未找到！');
  }
  
  // 6. 前一步动作
  console.log('\n6. PrevActions:');
  if (pr.lastActions) {
    console.log('   值 (前6个):', Array.from(pr.lastActions.slice(0, 6)).map(v => v.toFixed(4)));
    const maxAbs = Math.max(...Array.from(pr.lastActions.slice(0, 6)).map(Math.abs));
    console.log('   最大绝对值:', maxAbs.toFixed(4));
  } else {
    console.error('   ❌ lastActions 未找到！');
  }
}

function checkActionSymmetry() {
  console.log('=== 动作对称性检查 ===');
  
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr || !pr.lastActions) {
    console.error('❌ PolicyRunner 或 lastActions 未找到！');
    return;
  }
  
  const actions = pr.lastActions;
  const leftLegIndices = [0, 3, 6, 9, 13, 17];
  const rightLegIndices = [1, 4, 7, 10, 14, 18];
  
  const leftActions = leftLegIndices.map(i => actions[i]);
  const rightActions = rightLegIndices.map(i => actions[i]);
  
  console.log('左腿动作:', leftActions.map(v => v.toFixed(4)));
  console.log('右腿动作:', rightActions.map(v => v.toFixed(4)));
  
  const leftAvg = leftActions.reduce((sum, a) => sum + Math.abs(a), 0) / leftActions.length;
  const rightAvg = rightActions.reduce((sum, a) => sum + Math.abs(a), 0) / rightActions.length;
  const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
  
  console.log('左腿平均幅度:', leftAvg.toFixed(4));
  console.log('右腿平均幅度:', rightAvg.toFixed(4));
  console.log('对称性比例:', ratio.toFixed(4), ratio > 0.7 ? '✅' : '❌');
}

function checkInitialState() {
  console.log('=== 初始状态检查 ===');
  
  const demo = window.demo;
  if (!demo || !demo.simulation) {
    console.error('❌ Demo 或 simulation 未找到！');
    return;
  }
  
  const pr = window.demo.policyRunner || window.demo.policyRunners?.[0];
  if (!pr) {
    console.error('❌ PolicyRunner 未找到！');
    return;
  }
  
  const qpos = demo.simulation.qpos;
  const qvel = demo.simulation.qvel;
  
  if (!qpos || qpos.length < 3) {
    console.error('❌ qpos 无效！');
    return;
  }
  
  console.log('根位置 Z:', qpos[2].toFixed(3), qpos[2] === 0.8 ? '✅' : '❌');
  
  if (qvel && qvel.length >= 6) {
    console.log('根线性速度:', [qvel[0], qvel[1], qvel[2]].map(v => v.toFixed(4)));
    console.log('根角速度:', [qvel[3], qvel[4], qvel[5]].map(v => v.toFixed(4)));
  }
  
  if (demo.qpos_adr_policy && pr.defaultJointPos) {
    console.log('\n关节位置（前6个）:');
    for (let i = 0; i < 6; i++) {
      const qposAdr = demo.qpos_adr_policy[i];
      if (qposAdr >= 0 && qposAdr < qpos.length) {
        const currentPos = qpos[qposAdr];
        const defaultPos = pr.defaultJointPos[i];
        const diff = Math.abs(currentPos - defaultPos);
        console.log(`  Joint ${i}: current=${currentPos.toFixed(3)}, default=${defaultPos.toFixed(3)}, diff=${diff.toFixed(3)} ${diff < 0.001 ? '✅' : '❌'}`);
      }
    }
  }
}

// 一键运行所有检查
function runAllChecks() {
  checkObservations();
  console.log('\n');
  checkActionSymmetry();
  console.log('\n');
  checkInitialState();
}
