import * as THREE from 'three';
import {
  normalizeQuat,
  quatMultiply,
  quatInverse,
  quatApplyInv,
  quatToRot6d,
  clampFutureIndices
} from './utils/math.js';

class BootIndicator {
  get size() {
    return 1;
  }

  compute() {
    return new Float32Array([0.0]);
  }
}

class RootAngVelB {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.scale = kwargs.ang_vel_scale ?? policy?.config?.ang_vel_scale ?? 1.0;
    // v9.0.24: 判断是否是 LocoMode（通过 joint2motorIdx 判断）
    this.isLocoMode = policy?.joint2motorIdx != null && policy.joint2motorIdx.length > 0;
  }
  get size() {
    return 3;
  }
  compute(state) {
    const omegaWorld = state.rootAngVel;
    const quat = state.rootQuat;
    
    // v9.0.25: 只对 LocoMode 应用世界系→机体系转换，其他策略直接使用原始值
    if (this.isLocoMode) {
      // LocoMode 左倾修复：MuJoCo qvel 角速度为世界系，训练用机体系(B)；转为 body 后再输出
      // 使用重排序后的四元数，与重力保持一致
      const quatReordered = [quat[1], quat[2], quat[3], quat[0]]; // [x,y,z,w] 顺序
      const omegaBody = quatApplyInv(
        quatReordered,
        [omegaWorld[0], omegaWorld[1], omegaWorld[2]]
      );
      return new Float32Array([
        omegaBody[0] * this.scale,
        omegaBody[1] * this.scale,
        omegaBody[2] * this.scale
      ]);
    } else {
      // 其他策略：直接使用原始角速度（可能是世界系，但训练时也是世界系）
      return new Float32Array([
        omegaWorld[0] * this.scale,
        omegaWorld[1] * this.scale,
        omegaWorld[2] * this.scale
      ]);
    }
  }
}

class ProjectedGravityB {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    // v9.0.24: 判断是否是 LocoMode（通过 joint2motorIdx 判断）
    this.isLocoMode = policy?.joint2motorIdx != null && policy.joint2motorIdx.length > 0;
  }
  
  get size() {
    return 3;
  }

  compute(state) {
    // 世界重力向量 [0, 0, -1]（向下），通过四元数逆变换到 body frame
    const quat = state.rootQuat;
    const gravityWorld = [0.0, 0.0, -1.0];
    
    // v9.0.25: 只对 LocoMode 应用特殊修复，其他策略使用标准计算
    if (this.isLocoMode) {
      // LocoMode 左倾修复：四元数重排序 [x,y,z,w] + 只取反 Y 轴
      // v9.0.22-23 显示重排序后变右倾，说明方向对但需要配合 Y 轴取反
      const quatReordered = [quat[1], quat[2], quat[3], quat[0]]; // [x,y,z,w] 顺序
      const gravityBody = quatApplyInv(
        quatReordered,
        gravityWorld
      );
      // v9.0.25: 重排序四元数 + 只取反 Y 轴（测试组合效果）
      return new Float32Array([gravityBody[0], -gravityBody[1], gravityBody[2]]);
    } else {
      // 其他策略：标准计算
      const gravityBody = quatApplyInv(
        [quat[0], quat[1], quat[2], quat[3]],
        gravityWorld
      );
      return new Float32Array([gravityBody[0], gravityBody[1], gravityBody[2]]);
    }
  }
}

class JointPos {
  constructor(policy, kwargs = {}) {
    const { pos_steps = [0, 1, 2, 3, 4, 8] } = kwargs;
    this.posSteps = pos_steps.slice();
    this.numJoints = policy.numActions;

    this.maxStep = Math.max(...this.posSteps);
    this.history = Array.from({ length: this.maxStep + 1 }, () => new Float32Array(this.numJoints));
  }

  get size() {
    return this.posSteps.length * this.numJoints;
  }

  reset(state) {
    const source = state?.jointPos ?? new Float32Array(this.numJoints);
    this.history[0].set(source);
    for (let i = 1; i < this.history.length; i++) {
      this.history[i].set(this.history[0]);
    }
  }

  update(state) {
    for (let i = this.history.length - 1; i > 0; i--) {
      this.history[i].set(this.history[i - 1]);
    }
    this.history[0].set(state.jointPos);
  }

  compute() {
    const out = new Float32Array(this.posSteps.length * this.numJoints);
    let offset = 0;
    for (const step of this.posSteps) {
      const idx = Math.min(step, this.history.length - 1);
      out.set(this.history[idx], offset);
      offset += this.numJoints;
    }
    return out;
  }
}

/**
 * 相对关节位置观测 - 相对于default_joint_pos的相对位置
 * 用于loco_mode等策略
 */
class JointPosRel {
  constructor(policy, kwargs = {}) {
    const { pos_steps = [0] } = kwargs;
    this.policy = policy;
    this.posSteps = pos_steps.slice();
    this.numJoints = policy.numActions;
    this.defaultJointPos = policy.defaultJointPos ?? new Float32Array(this.numJoints);
    
    this.maxStep = Math.max(...this.posSteps);
    this.history = Array.from({ length: this.maxStep + 1 }, () => new Float32Array(this.numJoints));
  }

  get size() {
    return this.posSteps.length * this.numJoints;
  }

  reset(state) {
    const source = state?.jointPos ?? new Float32Array(this.numJoints);
    for (let i = 0; i < this.numJoints; i++) {
      this.history[0][i] = source[i] - this.defaultJointPos[i];
    }
    for (let i = 1; i < this.history.length; i++) {
      this.history[i].set(this.history[0]);
    }
  }

  update(state) {
    for (let i = this.history.length - 1; i > 0; i--) {
      this.history[i].set(this.history[i - 1]);
    }
    const source = state?.jointPos ?? new Float32Array(this.numJoints);
    for (let i = 0; i < this.numJoints; i++) {
      this.history[0][i] = source[i] - this.defaultJointPos[i];
    }
  }

  compute() {
    const out = new Float32Array(this.posSteps.length * this.numJoints);
    const dofPosScale = this.policy?.config?.dof_pos_scale != null ? this.policy.config.dof_pos_scale : 1.0;
    let offset = 0;
    for (const step of this.posSteps) {
      const idx = Math.min(step, this.history.length - 1);
      for (let i = 0; i < this.numJoints; i++) {
        out[offset + i] = this.history[idx][i] * dofPosScale;
      }
      offset += this.numJoints;
    }
    return out;
  }
}

/**
 * 关节速度观测 - 用于loco_mode等策略
 */
class JointVel {
  constructor(policy, kwargs = {}) {
    const { vel_steps = [0] } = kwargs;
    this.policy = policy;
    this.velSteps = vel_steps.slice();
    this.numJoints = policy.numActions;
    this.velScale = kwargs.vel_scale ?? (policy?.config?.dof_vel_scale != null ? policy.config.dof_vel_scale : 1.0);
    
    this.maxStep = Math.max(...this.velSteps);
    this.history = Array.from({ length: this.maxStep + 1 }, () => new Float32Array(this.numJoints));
  }

  get size() {
    return this.velSteps.length * this.numJoints;
  }

  reset(state) {
    const source = state?.jointVel ?? new Float32Array(this.numJoints);
    for (let i = 0; i < this.numJoints; i++) {
      this.history[0][i] = source[i] * this.velScale;
    }
    for (let i = 1; i < this.history.length; i++) {
      this.history[i].set(this.history[0]);
    }
  }

  update(state) {
    for (let i = this.history.length - 1; i > 0; i--) {
      this.history[i].set(this.history[i - 1]);
    }
    const source = state?.jointVel ?? new Float32Array(this.numJoints);
    for (let i = 0; i < this.numJoints; i++) {
      this.history[0][i] = source[i] * this.velScale;
    }
  }

  compute() {
    const out = new Float32Array(this.velSteps.length * this.numJoints);
    let offset = 0;
    for (const step of this.velSteps) {
      const idx = Math.min(step, this.history.length - 1);
      out.set(this.history[idx], offset);
      offset += this.numJoints;
    }
    return out;
  }
}

class TrackingCommandObsRaw {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.futureSteps = kwargs.future_steps ?? [0, 2, 4, 8, 16];
    const nFut = this.futureSteps.length;
    this.outputLength = (nFut - 1) * 3 + nFut * 6;
  }

  get size() {
    return this.outputLength;
  }

  compute(state) {
    const tracking = this.policy.tracking;
    if (!tracking || !tracking.isReady()) {
      return new Float32Array(this.outputLength);
    }

    const baseIdx = tracking.refIdx;
    const refLen = tracking.refLen;
    const indices = clampFutureIndices(baseIdx, this.futureSteps, refLen);

    const basePos = tracking.refRootPos[indices[0]];
    const baseQuat = normalizeQuat(tracking.refRootQuat[indices[0]]);

    const posDiff = [];
    for (let i = 1; i < indices.length; i++) {
      const pos = tracking.refRootPos[indices[i]];
      const diff = [pos[0] - basePos[0], pos[1] - basePos[1], pos[2] - basePos[2]];
      const diffB = quatApplyInv(baseQuat, diff);
      posDiff.push(diffB[0], diffB[1], diffB[2]);
    }

    const qCur = normalizeQuat(state.rootQuat);
    const qCurInv = quatInverse(qCur);

    const rot6d = [];
    for (let i = 0; i < indices.length; i++) {
      const refQuat = normalizeQuat(tracking.refRootQuat[indices[i]]);
      const rel = quatMultiply(qCurInv, refQuat);
      const r6 = quatToRot6d(rel);
      rot6d.push(r6[0], r6[1], r6[2], r6[3], r6[4], r6[5]);
    }

    return Float32Array.from([...posDiff, ...rot6d]);
  }
}

class TargetRootZObs {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.futureSteps = kwargs.future_steps ?? [0, 2, 4, 8, 16];
  }

  get size() {
    return this.futureSteps.length;
  }

  compute() {
    const tracking = this.policy.tracking;
    if (!tracking || !tracking.isReady()) {
      return new Float32Array(this.size);
    }
    const indices = clampFutureIndices(tracking.refIdx, this.futureSteps, tracking.refLen);
    const out = new Float32Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      out[i] = tracking.refRootPos[indices[i]][2] + 0.035;
    }
    return out;
  }
}

class TargetJointPosObs {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.futureSteps = kwargs.future_steps ?? [0, 2, 4, 8, 16];
  }

  get size() {
    const nJoints = this.policy.tracking?.nJoints ?? 0;
    return this.futureSteps.length * nJoints;
  }

  compute() {
    const tracking = this.policy.tracking;
    if (!tracking || !tracking.isReady()) {
      return new Float32Array(this.size);
    }
    const indices = clampFutureIndices(tracking.refIdx, this.futureSteps, tracking.refLen);
    const out = new Float32Array(indices.length * tracking.nJoints);
    let offset = 0;
    for (const idx of indices) {
      out.set(tracking.refJointPos[idx], offset);
      offset += tracking.nJoints;
    }
    return out;
  }
}

class TargetProjectedGravityBObs {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.futureSteps = kwargs.future_steps ?? [0, 2, 4, 8, 16];
  }

  get size() {
    return this.futureSteps.length * 3;
  }

  compute() {
    const tracking = this.policy.tracking;
    if (!tracking || !tracking.isReady()) {
      return new Float32Array(this.size);
    }
    const indices = clampFutureIndices(tracking.refIdx, this.futureSteps, tracking.refLen);
    const out = new Float32Array(indices.length * 3);
    const g = [0.0, 0.0, -1.0];
    let offset = 0;
    for (const idx of indices) {
      const quat = normalizeQuat(tracking.refRootQuat[idx]);
      const gLocal = quatApplyInv(quat, g);
      out[offset++] = gLocal[0];
      out[offset++] = gLocal[1];
      out[offset++] = gLocal[2];
    }
    return out;
  }
}


class PrevActions {
  /**
   * 
   * @param {mujoco.Model} model 
   * @param {mujoco.Simulation} simulation 
   * @param {MuJoCoDemo} demo
   * @param {number} steps 
   */
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    const { history_steps = 4 } = kwargs;
    this.steps = Math.max(1, Math.floor(history_steps));
    this.numActions = policy.numActions;
    this.actionBuffer = Array.from({ length: this.steps }, () => new Float32Array(this.numActions));
  }

  /**
   * 
   * @param {dict} extra_info
   * @returns {Float32Array}
   */
  compute() {
    const flattened = new Float32Array(this.steps * this.numActions);
    for (let i = 0; i < this.steps; i++) {
      for (let j = 0; j < this.numActions; j++) {
        flattened[i * this.numActions + j] = this.actionBuffer[i][j];
      }
    }
    return flattened;
  }

  reset() {
    for (const buffer of this.actionBuffer) {
      buffer.fill(0.0);
    }
  }

  update() {
    for (let i = this.actionBuffer.length - 1; i > 0; i--) {
      this.actionBuffer[i].set(this.actionBuffer[i - 1]);
    }
    const source = this.policy?.lastActions ?? new Float32Array(this.numActions);
    this.actionBuffer[0].set(source);
  }

  get size() {
    return this.steps * this.numActions;
  }
}

/**
 * Command观测类 - 用于loco_mode等需要速度命令的策略
 * 从policy.command读取速度命令 [vx, vy, vz] (线性速度x, y, 角速度z)
 */
class Command {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
  }

  get size() {
    return 3; // [vx, vy, vz]
  }

  compute() {
    // 从policy.command读取命令，如果没有则返回零命令
    const cmd = this.policy?.command ?? [0.0, 0.0, 0.0];
    return new Float32Array(cmd);
  }
}


// Export a dictionary of all observation classes
export const Observations = {
  PrevActions,
  BootIndicator,
  RootAngVelB,
  ProjectedGravityB,
  JointPos,
  JointPosRel,
  JointVel,
  TrackingCommandObsRaw,
  TargetRootZObs,
  TargetJointPosObs,
  TargetProjectedGravityBObs,
  Command
};
