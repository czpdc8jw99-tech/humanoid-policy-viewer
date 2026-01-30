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
  get size() {
    return 3;
  }

  compute(state) {
    return new Float32Array(state.rootAngVel);
  }
}

class Command {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.scale = typeof kwargs.scale === 'number' ? kwargs.scale : 1.0;
  }

  get size() {
    return 3;
  }

  compute() {
    const cmd = this.policy?.command ?? null;
    const x = cmd?.[0] ?? 0.0;
    const y = cmd?.[1] ?? 0.0;
    const z = cmd?.[2] ?? 0.0;
    const s = this.scale;
    return new Float32Array([s * x, s * y, s * z]);
  }
}

class ProjectedGravityB {
  constructor() {
    this.gravity = [0.0, 0.0, -1.0];  // Use array format to match quatApplyInv
  }

  get size() {
    return 3;
  }

  compute(state) {
    const quat = state.rootQuat;
    // Use quatApplyInv method for consistency with TargetProjectedGravityBObs
    // This ensures the same calculation method is used throughout the codebase
    const gLocal = quatApplyInv(quat, this.gravity);
    return new Float32Array(gLocal);
  }
}

class JointPosRel {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.scale = typeof kwargs.scale === 'number' ? kwargs.scale : 1.0;
  }

  get size() {
    return this.policy?.numActions ?? 0;
  }

  compute(state) {
    const n = this.policy?.numActions ?? 0;
    const out = new Float32Array(n);
    const q = state?.jointPos ?? null;
    const q0 = this.policy?.defaultJointPos ?? null;
    const s = this.scale;
    
    // Debug: Log raw joint positions and default values for right leg joints
    if (!this._debugLogged && q && q0) {
      const rightLegIndices = [1, 4, 7, 10, 14, 18]; // right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll
      const policyJointNames = this.policy?.policyJointNames ?? [];
      console.log('=== [JointPosRel Debug] Raw joint positions and defaults ===');
      rightLegIndices.forEach(idx => {
        const qi = q[idx] ?? 0.0;
        const q0i = q0[idx] ?? 0.0;
        const posRel = s * (qi - q0i);
        console.log(`  [${idx}] ${policyJointNames[idx] || 'unknown'}:`, {
          currentPos: qi,
          defaultPos: q0i,
          diff: qi - q0i,
          posRel: posRel,
          scale: s
        });
      });
      // Also log left leg for comparison
      const leftLegIndices = [0, 3, 6, 9, 13, 17];
      console.log('=== [JointPosRel Debug] Left leg for comparison ===');
      leftLegIndices.forEach(idx => {
        const qi = q[idx] ?? 0.0;
        const q0i = q0[idx] ?? 0.0;
        const posRel = s * (qi - q0i);
        console.log(`  [${idx}] ${policyJointNames[idx] || 'unknown'}:`, {
          currentPos: qi,
          defaultPos: q0i,
          diff: qi - q0i,
          posRel: posRel,
          scale: s
        });
      });
      this._debugLogged = true;
    }
    
    for (let i = 0; i < n; i++) {
      const qi = q?.[i] ?? 0.0;
      const q0i = q0?.[i] ?? 0.0;
      out[i] = s * (qi - q0i);
    }
    return out;
  }
}

class JointVel {
  constructor(policy, kwargs = {}) {
    this.policy = policy;
    this.scale = typeof kwargs.scale === 'number' ? kwargs.scale : 1.0;
  }

  get size() {
    return this.policy?.numActions ?? 0;
  }

  compute(state) {
    const n = this.policy?.numActions ?? 0;
    const out = new Float32Array(n);
    const dq = state?.jointVel ?? null;
    const s = this.scale;
    for (let i = 0; i < n; i++) {
      out[i] = s * (dq?.[i] ?? 0.0);
    }
    return out;
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


// Export a dictionary of all observation classes
export const Observations = {
  PrevActions,
  BootIndicator,
  RootAngVelB,
  Command,
  ProjectedGravityB,
  JointPosRel,
  JointVel,
  JointPos,
  TrackingCommandObsRaw,
  TargetRootZObs,
  TargetJointPosObs,
  TargetProjectedGravityBObs
};
