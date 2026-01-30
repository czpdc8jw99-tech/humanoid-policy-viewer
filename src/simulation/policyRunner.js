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
    this._rawOutputRangeLogged = false; // Track if raw output range has been logged
    this._obsClipLogged = false; // Track if observation clip has been logged
    this._actionMonitorFrameCount = 0; // Track frames for action monitoring

    this.tracking = null;
    if (config.tracking) {
      this.tracking = new TrackingHelper({
        ...config.tracking,
        policy_joint_names: this.policyJointNames
      });
    }

    this.obsModules = this._buildObsModules(config.obs_config);
    this.numObs = this.obsModules.reduce((sum, obs) => sum + (obs.size ?? 0), 0);
    // Debug: Verify obsModules initialization
    if (!this.obsModules || this.obsModules.length === 0) {
      console.warn('[PolicyRunner] WARNING: obsModules is empty or undefined!');
      console.warn('[PolicyRunner] Config obs_config:', config.obs_config);
    } else {
      console.log(`[PolicyRunner] Initialized ${this.obsModules.length} observation modules, total obs size: ${this.numObs}`);
      console.log('[PolicyRunner] Module names:', this.obsModules.map(m => m.constructor.name));
    }
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
    
    // Auto-run diagnostics after initialization (while simulation is paused)
    this._runAutoDiagnostics();
  }
  
  _runAutoDiagnostics() {
    // Only run if we have access to demo and simulation
    if (typeof window === 'undefined' || !window.demo) {
      return;
    }
    
    const demo = window.demo;
    if (!demo.readPolicyState || !demo.simulation) {
      return;
    }
    
    // Run diagnostics automatically
    console.log('%c=== [自动诊断] 策略初始化完成，开始诊断 ===', 'color: blue; font-weight: bold; font-size: 14px;');
    
    try {
      const state = demo.readPolicyState();
      if (!state) {
        console.warn('[自动诊断] 无法读取策略状态');
        return;
      }
      
      // Use index-based lookup (works even if class names are minified)
      // Config order: RootAngVelB(0), ProjectedGravityB(1), Command(2), JointPosRel(3), JointVel(4), PrevActions(5)
      const gravityObs = this.obsModules[1]; // ProjectedGravityB
      const jointPosRelObs = this.obsModules[3]; // JointPosRel
      
      // 1. Check gravity direction
      if (gravityObs) {
        const gravity = gravityObs.compute(state);
        const mag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
        const expectedGravity = [0, 0, -1];
        const diff = Math.sqrt(
          (gravity[0] - expectedGravity[0])**2 +
          (gravity[1] - expectedGravity[1])**2 +
          (gravity[2] - expectedGravity[2])**2
        );
        console.log('[自动诊断] ProjectedGravityB:', {
          value: Array.from(gravity).map(v => v.toFixed(4)),
          magnitude: mag.toFixed(4),
          expected: '[0, 0, -1]',
          difference: diff.toFixed(4),
          status: diff < 0.1 ? '✅' : '❌'
        });
      }
      
      // 2. Check root angular velocity
      if (state.rootAngVel) {
        const angVelMag = Math.sqrt(state.rootAngVel[0]**2 + state.rootAngVel[1]**2 + state.rootAngVel[2]**2);
        console.log('[自动诊断] RootAngVelB:', {
          value: Array.from(state.rootAngVel).map(v => v.toFixed(4)),
          magnitude: angVelMag.toFixed(4),
          expected: '[0, 0, 0]',
          status: angVelMag < 0.01 ? '✅' : '❌'
        });
      }
      
      // 3. Check command
      if (this.command) {
        const cmdMag = Math.sqrt(this.command[0]**2 + this.command[1]**2 + this.command[2]**2);
        console.log('[自动诊断] Command:', {
          value: Array.from(this.command).map(v => v.toFixed(4)),
          magnitude: cmdMag.toFixed(4),
          expected: '[0, 0, 0]',
          status: cmdMag < 0.01 ? '✅' : '❌'
        });
      }
      
      // 4. Check joint positions relative
      if (jointPosRelObs) {
        const jointPosRel = jointPosRelObs.compute(state);
        const maxAbs = Math.max(...Array.from(jointPosRel.slice(0, 6)).map(Math.abs));
        console.log('[自动诊断] JointPosRel (前6个):', {
          values: Array.from(jointPosRel.slice(0, 6)).map(v => v.toFixed(4)),
          maxAbs: maxAbs.toFixed(4),
          expected: '[0, 0, 0, 0, 0, 0]',
          status: maxAbs < 0.01 ? '✅' : '❌'
        });
      }
      
      // 5. Check joint velocities
      if (state.jointVel) {
        const maxAbs = Math.max(...state.jointVel.slice(0, 6).map(Math.abs));
        console.log('[自动诊断] JointVel (前6个):', {
          values: Array.from(state.jointVel.slice(0, 6)).map(v => v.toFixed(4)),
          maxAbs: maxAbs.toFixed(4),
          expected: '[0, 0, 0, 0, 0, 0]',
          status: maxAbs < 0.01 ? '✅' : '❌'
        });
      }
      
      // 6. Check root position
      const qpos = demo.simulation.qpos;
      if (qpos && qpos.length >= 3) {
        const rootZ = qpos[2];
        console.log('[自动诊断] Root Position Z:', {
          value: rootZ.toFixed(3),
          expected: 0.8,
          status: rootZ === 0.8 ? '✅' : '❌',
          note: rootZ < 0.5 ? '⚠️ 机器人可能已倒下' : ''
        });
      }
      
      // 7. Check action symmetry
      if (this.lastActions) {
        const actions = this.lastActions;
        const leftLegIndices = [0, 3, 6, 9, 13, 17];
        const rightLegIndices = [1, 4, 7, 10, 14, 18];
        const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / leftLegIndices.length;
        const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(actions[i]), 0) / rightLegIndices.length;
        
        // Handle case where both averages are zero (initial state before inference)
        let ratio, status, note;
        if (leftAvg === 0 && rightAvg === 0) {
          ratio = 1.0; // Perfect symmetry when both are zero
          status = '✅';
          note = '初始状态（动作值全为0，策略尚未推理）';
        } else {
          ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
          status = ratio > 0.7 ? '✅' : '❌';
          note = ratio < 0.7 ? '⚠️ 动作严重不对称' : '';
        }
        
        console.log('[自动诊断] Action Symmetry:', {
          leftLegAvg: leftAvg.toFixed(4),
          rightLegAvg: rightAvg.toFixed(4),
          symmetryRatio: ratio.toFixed(4),
          status: status,
          note: note
        });
      }
      
      console.log('%c=== [自动诊断] 完成 ===', 'color: green; font-weight: bold; font-size: 14px;');
    } catch (e) {
      console.error('[自动诊断] 运行出错:', e);
    }
  }
  
  async _warmupLSTMState() {
    // Create a dummy state with zeros for warmup
    // This initializes internal LSTM state (if present) to a stable value
    // Note: Command observation will use this.command (which is [0,0,0] after reset)
    const warmupState = {
      rootAngVel: new Float32Array(3),
      rootQuat: new Float32Array([0, 0, 0, 1]), // identity quaternion
      rootPos: new Float32Array(3),
      jointPos: new Float32Array(this.numActions).fill(0),
      jointVel: new Float32Array(this.numActions).fill(0)
    };
    
    // Ensure command is zero for warmup (matching original Python: cmd_init = [0, 0, 0])
    this.command.fill(0.0);
    
    // Reset observations to use zero state
    for (const obs of this.obsModules) {
      if (typeof obs.reset === 'function') {
        obs.reset(warmupState);
      }
    }
    
    // CRITICAL FIX: Use all-zero observation vector (matching original Python)
    // Original Python: self.obs = np.zeros(self.num_obs)
    // We should NOT compute observations from warmupState, as that would give
    // non-zero values (e.g., ProjectedGravityB would be [0, 0, -1] instead of [0, 0, 0])
    const obsVec = new Float32Array(this.numObs).fill(0);
    
    // CRITICAL: Clip observation vector to [-100, 100] as in original Python code
    // (Although it's all zeros, we still clip for consistency)
    for (let i = 0; i < obsVec.length; i++) {
      obsVec[i] = Math.max(-100, Math.min(100, obsVec[i]));
    }
    
    // Verify warmup observation vector is all zeros
    const warmupObsMin = Math.min(...Array.from(obsVec));
    const warmupObsMax = Math.max(...Array.from(obsVec));
    console.log('%c[PolicyRunner] Warming up LSTM/internal state (50 iterations)...', 'color: cyan; font-weight: bold;');
    console.log('[PolicyRunner] Warmup observation vector:', {
      size: obsVec.length,
      range: `[${warmupObsMin.toFixed(3)}, ${warmupObsMax.toFixed(3)}]`,
      isAllZero: warmupObsMin === 0 && warmupObsMax === 0 ? '✅ YES' : '❌ NO'
    });
    const warmupCount = 50;
    let warmupRawOutputLogged = false;
    for (let i = 0; i < warmupCount; i++) {
      // Prepare input dict with zero observation
      const inputDict = { ...this.inputDict };
      inputDict["policy"] = new ort.Tensor('float32', obsVec, [1, this.numObs]);
      
      try {
        const [result, carry] = await this.module.runInference(inputDict);
        // Log raw output range from warmup (first inference only)
        if (!warmupRawOutputLogged && result['action']) {
          const warmupAction = result['action']?.data || result['action'];
          const warmupArray = Array.isArray(warmupAction) ? warmupAction : Array.from(warmupAction);
          const warmupMin = Math.min(...warmupArray);
          const warmupMax = Math.max(...warmupArray);
          const warmupMean = warmupArray.reduce((a, b) => a + b, 0) / warmupArray.length;
          console.log('%c=== [PolicyRunner] Raw output range from WARMUP (BEFORE tanh/clip) ===', 'color: magenta; font-weight: bold; font-size: 14px;');
          console.log('Min:', warmupMin.toFixed(4));
          console.log('Max:', warmupMax.toFixed(4));
          console.log('Mean:', warmupMean.toFixed(4));
          console.log('Range:', `[${warmupMin.toFixed(2)}, ${warmupMax.toFixed(2)}]`);
          warmupRawOutputLogged = true;
        }
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
    const modules = obsList.map((obsConfigEntry) => {
      const ObsClass = Observations[obsConfigEntry.name];
      if (!ObsClass) {
        throw new Error(`Unknown observation type: ${obsConfigEntry.name}`);
      }
      const kwargs = { ...obsConfigEntry };
      delete kwargs.name;
      return new ObsClass(this, kwargs);
    });
    // Debug: Log built observation modules
    console.log('[PolicyRunner] Built observation modules:', modules.map(m => ({
      name: m.constructor.name,
      size: m.size
    })));
    return modules;
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
      
      // Debug: Log observation values periodically (every 60 frames = ~1 second at 60fps)
      if (!this._obsFrameCount) {
        this._obsFrameCount = 0;
      }
      this._obsFrameCount++;
      if (this._obsFrameCount % 60 === 0) {
        const rootAngVel = obsForPolicy.slice(0, 3);
        const gravity = obsForPolicy.slice(3, 6);
        const command = obsForPolicy.slice(6, 9);
        const gravityMag = Math.sqrt(gravity[0]**2 + gravity[1]**2 + gravity[2]**2);
        const angVelMag = Math.sqrt(rootAngVel[0]**2 + rootAngVel[1]**2 + rootAngVel[2]**2);
        const obsMin = Math.min(...Array.from(obsForPolicy));
        const obsMax = Math.max(...Array.from(obsForPolicy));
        console.log(`[PolicyRunner] Obs update (frame ${this._obsFrameCount}):`, {
          gravity: Array.from(gravity).map(v => v.toFixed(3)),
          gravityMag: gravityMag.toFixed(3),
          angVel: Array.from(rootAngVel).map(v => v.toFixed(3)),
          angVelMag: angVelMag.toFixed(3),
          command: Array.from(command).map(v => v.toFixed(3)),
          obsRange: `[${obsMin.toFixed(2)}, ${obsMax.toFixed(2)}]`
        });
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

      // CRITICAL: Clip observation vector to [-100, 100] as in original Python code
      // Original: obs_tensor = torch.from_numpy(obs_tensor).clip(-100, 100)
      const obsBeforeClip = Array.from(obsForPolicy);
      for (let i = 0; i < obsForPolicy.length; i++) {
        obsForPolicy[i] = Math.max(-100, Math.min(100, obsForPolicy[i]));
      }
      
      // Debug: Log if any values were clipped (first time only)
      if (!this._obsClipLogged) {
        let clippedCount = 0;
        for (let i = 0; i < obsForPolicy.length; i++) {
          if (Math.abs(obsBeforeClip[i] - obsForPolicy[i]) > 0.001) {
            clippedCount++;
          }
        }
        if (clippedCount > 0) {
          console.warn(`[PolicyRunner] ${clippedCount} observation values were clipped to [-100, 100]`);
        }
        this._obsClipLogged = true;
      }

      this.inputDict['policy'] = new ort.Tensor('float32', obsForPolicy, [1, obsForPolicy.length]);

      const [result, carry] = await this.module.runInference(this.inputDict);
      this.inputDict = { ...this.inputDict, ...carry };

      const action = result['action']?.data;
      if (!action || action.length !== this.numActions) {
        throw new Error('PolicyRunner received invalid action output');
      }
      
      // Debug: Log raw policy output range (before tanh/clip) - first time only
      if (!this._rawOutputRangeLogged) {
        const rawArray = Array.isArray(action) ? action : Array.from(action);
        const rawMin = Math.min(...rawArray);
        const rawMax = Math.max(...rawArray);
        const rawMean = rawArray.reduce((a, b) => a + b, 0) / rawArray.length;
        const rawStd = Math.sqrt(rawArray.reduce((sum, x) => sum + Math.pow(x - rawMean, 2), 0) / rawArray.length);
        console.log('%c=== [PolicyRunner] Raw policy output range (BEFORE tanh/clip) ===', 'color: magenta; font-weight: bold; font-size: 14px;');
        console.log('Min:', rawMin.toFixed(4));
        console.log('Max:', rawMax.toFixed(4));
        console.log('Mean:', rawMean.toFixed(4));
        console.log('Std:', rawStd.toFixed(4));
        console.log('Range:', `[${rawMin.toFixed(2)}, ${rawMax.toFixed(2)}]`);
        // Also log first few values for verification
        console.log('First 6 raw values:', Array.from(rawArray.slice(0, 6)).map(v => v.toFixed(4)));
        this._rawOutputRangeLogged = true;
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

      // Store raw action before processing (for monitoring)
      const rawActionBeforeClip = new Float32Array(this.numActions);
      for (let i = 0; i < this.numActions; i++) {
        rawActionBeforeClip[i] = action[i];
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
      
      // Store raw action for monitoring (before clip, after tanh if applicable)
      this._lastRawActionBeforeClip = rawActionBeforeClip;
      
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

      // Monitor action symmetry periodically (every 30 frames = ~0.5 seconds at 60fps)
      // This helps detect if actions become asymmetric during runtime
      this._actionMonitorFrameCount++;
      if (this._actionMonitorFrameCount % 30 === 0) {
        const leftLegIndices = [0, 3, 6, 9, 13, 17];
        const rightLegIndices = [1, 4, 7, 10, 14, 18];
        const leftAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(this.lastActions[i]), 0) / leftLegIndices.length;
        const rightAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(this.lastActions[i]), 0) / rightLegIndices.length;
        
        if (leftAvg > 0 || rightAvg > 0) {
          const ratio = Math.min(leftAvg, rightAvg) / Math.max(leftAvg, rightAvg);
          const maxAction = Math.max(...Array.from(this.lastActions).map(Math.abs));
          
          // Only log if asymmetry detected or actions are very large
          if (ratio < 0.7 || maxAction > 2.0) {
            // Detailed breakdown for asymmetric actions
            const leftLegActions = leftLegIndices.map(i => ({
              idx: i,
              joint: this.policyJointNames[i],
              action: this.lastActions[i].toFixed(4),
              scale: this.actionScale[i].toFixed(4),
              defaultPos: this.defaultJointPos[i].toFixed(4),
              targetPos: (this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i]).toFixed(4)
            }));
            
            const rightLegActions = rightLegIndices.map(i => ({
              idx: i,
              joint: this.policyJointNames[i],
              action: this.lastActions[i].toFixed(4),
              scale: this.actionScale[i].toFixed(4),
              defaultPos: this.defaultJointPos[i].toFixed(4),
              targetPos: (this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i]).toFixed(4)
            }));
            
            // Check if action_scale is symmetric
            const leftScales = leftLegIndices.map(i => this.actionScale[i]);
            const rightScales = rightLegIndices.map(i => this.actionScale[i]);
            const scalesSymmetric = JSON.stringify(leftScales) === JSON.stringify(rightScales);
            
            console.warn(`%c[动作监控] Frame ${this._actionMonitorFrameCount} - 详细分析`, 'color: red; font-weight: bold; font-size: 14px;');
            console.warn('总体统计:', {
              leftLegAvg: leftAvg.toFixed(4),
              rightLegAvg: rightAvg.toFixed(4),
              symmetryRatio: ratio.toFixed(4),
              maxAction: maxAction.toFixed(4),
              status: ratio < 0.7 ? '❌ 动作不对称' : maxAction > 2.0 ? '⚠️ 动作过大' : '✅'
            });
            
            if (ratio < 0.7) {
              console.warn('左腿动作值（详细）:', leftLegActions);
              console.warn('右腿动作值（详细）:', rightLegActions);
              console.warn('action_scale 对称性:', scalesSymmetric ? '✅ 对称' : '❌ 不对称');
              if (!scalesSymmetric) {
                console.warn('左腿 action_scale:', leftScales.map(s => s.toFixed(4)));
                console.warn('右腿 action_scale:', rightScales.map(s => s.toFixed(4)));
              }
              
              // Also show raw action values (before clip) if available
              if (this._lastRawActionBeforeClip) {
                const leftLegRaw = leftLegIndices.map(i => ({
                  idx: i,
                  joint: this.policyJointNames[i],
                  rawAction: this._lastRawActionBeforeClip[i].toFixed(4),
                  clampedAction: this.lastActions[i].toFixed(4)
                }));
                const rightLegRaw = rightLegIndices.map(i => ({
                  idx: i,
                  joint: this.policyJointNames[i],
                  rawAction: this._lastRawActionBeforeClip[i].toFixed(4),
                  clampedAction: this.lastActions[i].toFixed(4)
                }));
                console.warn('左腿原始动作值（clip前）:', leftLegRaw);
                console.warn('右腿原始动作值（clip前）:', rightLegRaw);
                
                // Check if raw actions are also asymmetric
                const leftRawAvg = leftLegIndices.reduce((sum, i) => sum + Math.abs(this._lastRawActionBeforeClip[i]), 0) / leftLegIndices.length;
                const rightRawAvg = rightLegIndices.reduce((sum, i) => sum + Math.abs(this._lastRawActionBeforeClip[i]), 0) / rightLegIndices.length;
                const rawRatio = Math.min(leftRawAvg, rightRawAvg) / Math.max(leftRawAvg, rightRawAvg);
                console.warn('原始动作对称性:', {
                  leftRawAvg: leftRawAvg.toFixed(4),
                  rightRawAvg: rightRawAvg.toFixed(4),
                  rawRatio: rawRatio.toFixed(4),
                  note: rawRatio < 0.7 ? '❌ 策略输出本身就不对称' : '✅ 策略输出对称，问题在后续处理'
                });
              }
            }
          }
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
