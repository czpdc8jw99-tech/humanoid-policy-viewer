"""
Detailed test to verify the original Python policy behavior.
This script mimics the exact behavior of LocoMode.py
"""

from __future__ import annotations

import sys
from pathlib import Path
import site
import os

for p in reversed(site.getsitepackages()):
    torch_lib = Path(p) / "torch" / "lib"
    if torch_lib.exists():
        os.add_dll_directory(str(torch_lib))
        break

import numpy as np
import torch


def test_exact_locomode_behavior(pt_path: Path):
    """Test policy with exact same logic as LocoMode.py"""
    
    print("=" * 80)
    print("Testing Policy - Exact LocoMode.py Behavior")
    print("=" * 80)
    
    # Load policy (exactly as LocoMode.py does)
    print(f"\n1. Loading policy from: {pt_path}")
    if not pt_path.exists():
        print(f"ERROR: Policy file not found: {pt_path}")
        return False
    
    model = torch.jit.load(str(pt_path), map_location="cpu")
    model.eval()
    print("[OK] Policy loaded successfully")
    
    # Initialize exactly as LocoMode.py does
    num_obs = 96
    num_actions = 29
    
    # Initialize obs as zeros (exactly as LocoMode.py: self.obs = np.zeros(self.num_obs))
    obs = np.zeros(num_obs, dtype=np.float32)
    print(f"\n2. Initial observation (as LocoMode.py):")
    print(f"   Shape: {obs.shape}")
    print(f"   All zeros: {np.all(obs == 0)}")
    print(f"   Range: [{obs.min():.4f}, {obs.max():.4f}]")
    
    # Warmup exactly as LocoMode.py does
    print("\n3. Warmup (50 steps, exactly as LocoMode.py):")
    with torch.inference_mode():
        for i in range(50):
            obs_tensor = obs.reshape(1, -1)
            obs_tensor = obs_tensor.astype(np.float32)
            # Note: LocoMode.py clips obs_tensor: torch.from_numpy(obs_tensor).clip(-100, 100)
            obs_tensor_clipped = np.clip(obs_tensor, -100, 100)
            _ = model(torch.from_numpy(obs_tensor_clipped))
    print("[OK] Warmup completed")
    
    # Now simulate what happens in run() method
    # In LocoMode.py, the obs is rebuilt from actual state, but for testing,
    # we'll use all zeros to match Frame 1 condition
    
    print("\n4. Simulating run() method with all-zero state:")
    print("   (This simulates Frame 1: robot at default pose, zero velocity)")
    
    # Simulate all-zero state (as in Frame 1)
    ang_vel = np.zeros(3, dtype=np.float32)
    gravity_orientation = np.zeros(3, dtype=np.float32)  # Would be [0,0,-1] if upright, but we use [0,0,0] for test
    cmd = np.zeros(3, dtype=np.float32)
    qj_obs = np.zeros(num_actions, dtype=np.float32)  # Joint positions relative to default (all zero)
    dqj_obs = np.zeros(num_actions, dtype=np.float32)  # Joint velocities (all zero)
    prev_action = np.zeros(num_actions, dtype=np.float32)  # Previous action (all zero)
    
    # Build obs exactly as LocoMode.py does
    obs = np.zeros(num_obs, dtype=np.float32)
    obs[:3] = ang_vel.copy()
    obs[3:6] = gravity_orientation.copy()
    obs[6:9] = cmd.copy()
    obs[9:9 + num_actions] = qj_obs.copy()
    obs[9 + num_actions:9 + num_actions * 2] = dqj_obs.copy()
    obs[9 + num_actions * 2:9 + num_actions * 3] = prev_action.copy()
    
    print(f"   Observation vector built:")
    print(f"     RootAngVelB [0:3]: {obs[0:3]}")
    print(f"     ProjectedGravityB [3:6]: {obs[3:6]}")
    print(f"     Command [6:9]: {obs[6:9]}")
    print(f"     JointPosRel [9:38]: all zeros? {np.all(obs[9:38] == 0)}")
    print(f"     JointVel [38:67]: all zeros? {np.all(obs[38:67] == 0)}")
    print(f"     PrevActions [67:96]: all zeros? {np.all(obs[67:96] == 0)}")
    
    # Run inference exactly as LocoMode.py does
    print("\n5. Running inference (exactly as LocoMode.py):")
    with torch.inference_mode():
        obs_tensor = obs.reshape(1, -1)
        obs_tensor = obs_tensor.astype(np.float32)
        # LocoMode.py: torch.from_numpy(obs_tensor).clip(-100, 100)
        obs_tensor_clipped = np.clip(obs_tensor, -100, 100)
        # LocoMode.py: self.policy(...).clip(-100, 100)
        action_tensor = model(torch.from_numpy(obs_tensor_clipped))
        action = action_tensor.clip(-100, 100).detach().numpy().squeeze()
    
    print(f"   Action shape: {action.shape}")
    print(f"   Action range: [{action.min():.4f}, {action.max():.4f}]")
    
    # Analyze symmetry
    left_leg_indices = [0, 3, 6, 9, 13, 17]
    right_leg_indices = [1, 4, 7, 10, 14, 18]
    
    joint_names = [
        "left_hip_pitch_joint", "right_hip_pitch_joint", "waist_yaw_joint",
        "left_hip_roll_joint", "right_hip_roll_joint", "waist_roll_joint",
        "left_hip_yaw_joint", "right_hip_yaw_joint", "waist_pitch_joint",
        "left_knee_joint", "right_knee_joint",
        "left_shoulder_pitch_joint", "right_shoulder_pitch_joint",
        "left_ankle_pitch_joint", "right_ankle_pitch_joint",
        "left_shoulder_roll_joint", "right_shoulder_roll_joint",
        "left_ankle_roll_joint", "right_ankle_roll_joint",
        "left_shoulder_yaw_joint", "right_shoulder_yaw_joint",
        "left_elbow_joint", "right_elbow_joint",
        "left_wrist_roll_joint", "right_wrist_roll_joint",
        "left_wrist_pitch_joint", "right_wrist_pitch_joint",
        "left_wrist_yaw_joint", "right_wrist_yaw_joint"
    ]
    
    left_leg_actions = action[left_leg_indices]
    right_leg_actions = action[right_leg_indices]
    
    left_avg = np.mean(np.abs(left_leg_actions))
    right_avg = np.mean(np.abs(right_leg_actions))
    ratio = min(left_avg, right_avg) / max(left_avg, right_avg) if max(left_avg, right_avg) > 0 else 1.0
    
    print("\n6. Action symmetry analysis:")
    print("\n   Left leg actions:")
    for idx, val in zip(left_leg_indices, left_leg_actions):
        print(f"      [{idx:2d}] {joint_names[idx]:25s}: {val:8.4f}")
    
    print("\n   Right leg actions:")
    for idx, val in zip(right_leg_indices, right_leg_actions):
        print(f"      [{idx:2d}] {joint_names[idx]:25s}: {val:8.4f}")
    
    print("\n   Symmetry metrics:")
    print(f"      Left leg average magnitude:  {left_avg:.4f}")
    print(f"      Right leg average magnitude:  {right_avg:.4f}")
    print(f"      Symmetry ratio:               {ratio:.4f}")
    
    max_action = np.max(np.abs(action))
    right_ankle_pitch = action[14]
    
    print(f"\n   Additional checks:")
    print(f"      Maximum action magnitude:     {max_action:.4f}")
    print(f"      Right ankle_pitch value:      {right_ankle_pitch:.4f}")
    
    # Conclusion
    print("\n" + "=" * 80)
    print("CONCLUSION")
    print("=" * 80)
    
    print(f"\nTest conditions:")
    print(f"  - Input observation: All zeros (96 dims)")
    print(f"  - Warmup: 50 steps with all-zero obs")
    print(f"  - Inference: All-zero state (matching Frame 1)")
    
    print(f"\nResults:")
    print(f"  - Symmetry ratio: {ratio:.4f} (threshold: 0.7)")
    print(f"  - Right ankle_pitch: {right_ankle_pitch:.4f}")
    
    if ratio < 0.7:
        print(f"\n[FAIL] Policy output is ASYMMETRIC")
        print(f"   Evidence:")
        print(f"   1. Input observation is completely symmetric (all zeros)")
        print(f"   2. Output actions are asymmetric (ratio: {ratio:.4f} < 0.7)")
        print(f"   3. Right ankle_pitch ({right_ankle_pitch:.4f}) is abnormally large")
        print(f"\n   This suggests the policy model itself has a problem.")
        return False
    else:
        print(f"\n[PASS] Policy output is SYMMETRIC")
        print(f"   The policy model appears to be working correctly.")
        return True


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    pt_path = script_dir / "policy_29dof.pt"
    
    if len(sys.argv) > 1:
        pt_path = Path(sys.argv[1])
    
    success = test_exact_locomode_behavior(pt_path)
    sys.exit(0 if success else 1)
