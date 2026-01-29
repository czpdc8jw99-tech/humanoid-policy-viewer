import * as ort from 'onnxruntime-web';
import { ONNXModule } from './onnxHelper.js';
import { Observations } from './observationHelpers.js';
import { TrackingHelper } from './trackingHelper.js';
import { toFloatArray } from './utils/math.js';

export class PolicyRunner {
  constructor(config, options = {}) {
    this.config = config;
    this.policyJointNames = (options.policyJointNames ?? config.policy_joint_names ?? []).slice();
    if (this.policyJointNames.length === 0) {
      throw new Error('PolicyRunner requires policy_joint_names in config');
    }
    this.numActions = this.policyJointNames.length;
    this.command = new Float32Array(3);

    this.actionScale = toFloatArray(options.actionScale ?? config.action_scale, this.numActions, 1.0);
    this.defaultJointPos = toFloatArray(options.defaultJointPos ?? [], this.numActions, 0.0);
    this.actionClip = typeof config.action_clip === 'number' ? config.action_clip : 10.0;
    this.actionSquash = config.action_squash ?? null; // "tanh" or null

    this.module = new ONNXModule(config.onnx);
    this.inputDict = {};
    this.isInferencing = false;
    this.lastActions = new Float32Array(this.numActions);
    this._warmupDone = false; // Track if LSTM warmup has been completed

    this.tracking = null;
    if (config.tracking) {
      this.tracking = new TrackingHelper({
        ...config.tracking,
        policy_joint_names: this.policyJointNames
      });
    }

    this.obsModules = this._buildObsModules(config.obs_config);
    this.numObs = this.obsModules.reduce((sum, obs) => sum + (obs.size ?? 0), 0);
  }

  _getExpectedObsSizeFromMeta() {
    const shapes = this.config?.onnx?.meta?.in_shapes;
    if (!Array.isArray(shapes) || shapes.length === 0) return null;
    // Expect something like: [[[1, 96]]]
    const first = shapes[0];
    const inner = Array.isArray(first) ? first[0] : null;
    if (!Array.isArray(inner) || inner.length === 0) return null;
    const lastDim = inner[inner.length - 1];
    return Number.isFinite(lastDim) ? lastDim : null;
  }

  _assertObsSizeMatchesModelMeta() {
    const expected = this._getExpectedObsSizeFromMeta();
    if (expected == null) return;
    if (this.numObs !== expected) {
      const moduleSummary = this.obsModules.map((m) => `${m.constructor.name}(${m.size ?? 0})`).join(' + ');
      throw new Error(
        [
          '[PolicyRunner] Observation size mismatch.',
          `- Built numObs=${this.numObs} from obs_config: ${moduleSummary}`,
          `- ONNX meta expects last dim=${expected} (from onnx.meta.in_shapes)`,
          'This usually means the wrong policy JSON was loaded, or obs_config does not match the ONNX model.'
        ].join('\n')
      );
    }
  }

  async init() {
    await this.module.init();
    // Fail fast if obs_config does not match ONNX model input shape.
    this._assertObsSizeMatchesModelMeta();
    console.log('%c[PolicyRunner] Policy initialized - Debug logs will appear below', 'color: green; font-weight: bold; font-size: 14px;');
    console.log('[PolicyRunner] Policy initialized:', {
      numActions: this.numActions,
      numObs: this.numObs,
      obsModules: this.obsModules.map(m => ({ name: m.constructor.name, size: m.size }))
    });
    this.reset();
    
    // Initialize LSTM/internal state by running multiple warmup inferences
    // This matches the original FSMDeploy_G1 LocoMode initialization:
    //   for _ in range(50):
    //       self.policy(torch.from_numpy(self.obs))
    await this._warmupLSTMState();
  }
  
  async _warmupLSTMState() {
    // Create a dummy state with zeros for warmup
    // This initializes internal LSTM state (if present) to a stable value
    const warmupState = {
      rootAngVel: new Float32Array(3),
      rootQuat: new Float32Array([0, 0, 0, 1]), // identity quaternion
      rootPos: new Float32Array(3),
      jointPos: new Float32Array(this.numActions),
      jointVel: new Float32Array(this.numActions)
    };
    
    // Reset observations to use zero state
    for (const obs of this.obsModules) {
      if (typeof obs.reset === 'function') {
        obs.reset(warmupState);
      }
    }
    
    // Build observation vector from zero state
    const obsVec = new Float32Array(this.numObs);
    let offset = 0;
    for (const obs of this.obsModules) {
      const obsValue = obs.compute(warmupState);
      if (obsValue instanceof Float32Array || Array.isArray(obsValue)) {
        const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
        obsVec.set(obsArray, offset);
        offset += obsArray.length;
      }
    }
    
    // Run 50 warmup inferences (matching original Python code)
    console.log('%c[PolicyRunner] Warming up LSTM/internal state (50 iterations)...', 'color: cyan; font-weight: bold;');
    const warmupCount = 50;
    for (let i = 0; i < warmupCount; i++) {
      // Prepare input dict with zero observation
      const inputDict = { ...this.inputDict };
      inputDict["policy"] = new ort.Tensor('float32', obsVec, [1, this.numObs]);
      
      try {
        const [result, carry] = await this.module.runInference(inputDict);
        // Update inputDict with carry (for recurrent models)
        if (carry && Object.keys(carry).length > 0) {
          Object.assign(this.inputDict, carry);
        }
      } catch (err) {
        console.warn(`[PolicyRunner] Warmup inference ${i + 1}/${warmupCount} failed:`, err);
      }
    }
    console.log(`%c[PolicyRunner] LSTM warmup completed (${warmupCount} iterations)`, 'color: cyan; font-weight: bold;');
    this._warmupDone = true;
  }

  _buildObsModules(obsConfig) {
    const obsList = (obsConfig && Array.isArray(obsConfig.policy)) ? obsConfig.policy : [];
    return obsList.map((obsConfigEntry) => {
      const ObsClass = Observations[obsConfigEntry.name];
      if (!ObsClass) {
        throw new Error(`Unknown observation type: ${obsConfigEntry.name}`);
      }
      const kwargs = { ...obsConfigEntry };
      delete kwargs.name;
      return new ObsClass(this, kwargs);
    });
  }

  reset(state = null) {
    // Reset inputDict - warmup will be re-run if init() is called again
    // For now, we reset it to initial state
    // Note: If warmup was done, the LSTM state is internal to the ONNX model
    // and won't be lost by resetting inputDict (unless the model explicitly exposes it)
    this.inputDict = this.module.initInput() ?? {};
    this.lastActions.fill(0.0);
    this.command.fill(0.0);
    if (this.tracking) {
      this.tracking.reset(state);
    }
    for (const obs of this.obsModules) {
      if (typeof obs.reset === 'function') {
        obs.reset(state);
      }
    }
  }

  setCommand(cmd) {
    if (!cmd) return;
    this.command[0] = cmd[0] ?? 0.0;
    this.command[1] = cmd[1] ?? 0.0;
    this.command[2] = cmd[2] ?? 0.0;
    // Debug log for step 1 verification (will be removed later)
    if (Math.abs(this.command[0]) > 0.01 || Math.abs(this.command[1]) > 0.01 || Math.abs(this.command[2]) > 0.01) {
      console.log('[PolicyRunner] Command set:', [this.command[0], this.command[1], this.command[2]]);
    }
  }

  async step(state) {
    if (this.isInferencing) {
      return null;
    }

    if (!state) {
      throw new Error('PolicyRunner.step requires a state object');
    }

    this.isInferencing = true;
    try {
      if (this.tracking) {
        this.tracking.advance();
      }

      // Build observation vector (PrevActions.update() will be called AFTER inference)
      const obsForPolicy = new Float32Array(this.numObs);
      let offset = 0;
      const obsDebug = [];
      for (const obs of this.obsModules) {
        // Note: PrevActions.update() is called AFTER inference to use current action
        // Only call update for non-PrevActions modules here
        if (typeof obs.update === 'function' && obs.constructor.name !== 'PrevActions') {
          obs.update(state);
        }
        const obsValue = obs.compute(state);
        const obsArray = ArrayBuffer.isView(obsValue) ? obsValue : Float32Array.from(obsValue);
        obsForPolicy.set(obsArray, offset);
        obsDebug.push({ name: obs.constructor.name, size: obsArray.length, offset });
        offset += obsArray.length;
      }
      // Debug log for step 1 verification (first few steps only)
      if (!this._obsLogged) {
        // Extract joint positions and velocities from observation vector
        // Observation order: RootAngVelB(3) + ProjectedGravityB(3) + Command(3) + JointPosRel(29) + JointVel(29) + PrevActions(29)
        const rootAngVel = obsForPolicy.slice(0, 3);
        const gravity = obsForPolicy.slice(3, 6);
        const command = obsForPolicy.slice(6, 9);
        const jointPosRel = obsForPolicy.slice(9, 38); // 29 joints
        const jointVel = obsForPolicy.slice(38, 67); // 29 joints
        const prevActions = obsForPolicy.slice(67, 96); // 29 joints
        
        // Left leg indices: 0, 3, 6, 9, 13, 17
        // Right leg indices: 1, 4, 7, 10, 14, 18
        const leftLegIndices = [0, 3, 6, 9, 13, 17];
        const rightLegIndices = [1, 4, 7, 10, 14, 18];
        
        console.log('[PolicyRunner] Observation vector built:', {
          totalSize: obsForPolicy.length,
          expectedSize: this.numObs,
          components: obsDebug,
          commandInObs: command
        });
        
        console.log('=== [Observation Debug] Left leg joint positions (relative) ===', 
          leftLegIndices.map(idx => ({
            idx,
            joint: this.policyJointNames[idx],
            posRel: jointPosRel[idx]
          }))
        );
        
        console.log('=== [Observation Debug] Right leg joint positions (relative) ===', 
          rightLegIndices.map(idx => ({
            idx,
            joint: this.policyJointNames[idx],
            posRel: jointPosRel[idx]
          }))
        );
        
        console.log('=== [Observation Debug] Left leg joint velocities ===', 
          leftLegIndices.map(idx => ({
            idx,
            joint: this.policyJointNames[idx],
            vel: jointVel[idx]
          }))
        );
        
        console.log('=== [Observation Debug] Right leg joint velocities ===', 
          rightLegIndices.map(idx => ({
            idx,
            joint: this.policyJointNames[idx],
            vel: jointVel[idx]
          }))
        );
        
        console.log('=== [Observation Debug] Left leg previous actions ===', 
          leftLegIndices.map(idx => ({
            idx,
            joint: this.policyJointNames[idx],
            prevAction: prevActions[idx]
          }))
        );
        
        console.log('=== [Observation Debug] Right leg previous actions ===', 
          rightLegIndices.map(idx => ({
            idx,
            joint: this.policyJointNames[idx],
            prevAction: prevActions[idx]
          }))
        );
        
        this._obsLogged = true;
      }

      this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);

      const [result, carry] = await this.module.runInference(this.inputDict);
      this.inputDict = { ...this.inputDict, ...carry };

      const action = result['action']?.data;
      if (!action || action.length !== this.numActions) {
        throw new Error('PolicyRunner received invalid action output');
      }
      
      // Simple debug: always log first action value to verify code is running
      if (this._firstActionLogged === undefined) {
        console.log('=== [PolicyRunner] First inference - action[0] =', action[0], 'action[1] =', action[1], '===');
        this._firstActionLogged = true;
      }
      // Debug log for step 1 verification (first inference only)
      if (!this._inferenceLogged) {
        console.log('[PolicyRunner] Inference successful:', {
          actionLength: action.length,
          actionRange: [Math.min(...action), Math.max(...action)],
          command: [this.command[0], this.command[1], this.command[2]]
        });
        this._inferenceLogged = true;
      }

      const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
      for (let i = 0; i < this.numActions; i++) {
        let value = action[i];
        // Apply squash (e.g., tanh) if configured
        if (this.actionSquash === 'tanh') {
          value = Math.tanh(value);
        }
        // Then apply clip
        const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
        this.lastActions[i] = clamped;
      }
      
      // Debug: Log raw action values for left/right leg comparison (first inference only)
      if (this._rawActionLogged === undefined) {
        this._rawActionLogged = false;
      }
      if (!this._rawActionLogged) {
        const leftLegIndices = [0, 3, 6, 9, 13, 17]; // left_hip_pitch, left_hip_roll, left_hip_yaw, left_knee, left_ankle_pitch, left_ankle_roll
        const rightLegIndices = [1, 4, 7, 10, 14, 18]; // right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll
        const leftLegRaw = leftLegIndices.map(idx => ({
          policyIdx: idx,
          jointName: this.policyJointNames[idx],
          rawAction: action[idx],
          clampedAction: this.lastActions[idx],
          scaledTarget: this.defaultJointPos[idx] + this.actionScale[idx] * this.lastActions[idx]
        }));
        const rightLegRaw = rightLegIndices.map(idx => ({
          policyIdx: idx,
          jointName: this.policyJointNames[idx],
          rawAction: action[idx],
          clampedAction: this.lastActions[idx],
          scaledTarget: this.defaultJointPos[idx] + this.actionScale[idx] * this.lastActions[idx]
        }));
        console.log('=== [PolicyRunner Debug] Raw action values - Left leg ===', leftLegRaw);
        console.log('=== [PolicyRunner Debug] Raw action values - Right leg ===', rightLegRaw);
        console.log('=== [PolicyRunner Debug] Full raw action array ===', Array.from(action));
        this._rawActionLogged = true;
      }

      // Update PrevActions AFTER inference and lastActions update
      // This ensures PrevActions uses the current action for the next inference
      for (const obs of this.obsModules) {
        if (obs.constructor.name === 'PrevActions' && typeof obs.update === 'function') {
          obs.update(state);
        }
      }

      const target = new Float32Array(this.numActions);
      for (let i = 0; i < this.numActions; i++) {
        target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];
      }

      return target;
    } finally {
      this.isInferencing = false;
    }
  }
}
