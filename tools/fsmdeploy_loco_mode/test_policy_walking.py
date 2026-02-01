"""
Test policy symmetry in walking state (non-zero observations).
The policy is designed for locomotion (walking), not standing still.
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


def test_policy_in_walking_state(pt_path: Path):
    """Test policy with walking-like observations (non-zero)."""
    
    print("=" * 80)
    print("Testing Policy Symmetry in Walking State")
    print("=" * 80)
    
    # Load policy
    print(f"\n1. Loading policy from: {pt_path}")
    if not pt_path.exists():
        print(f"ERROR: Policy file not found: {pt_path}")
        return False
    
    model = torch.jit.load(str(pt_path), map_location="cpu")
    model.eval()
    print("[OK] Policy loaded successfully")
    
    num_obs = 96
    num_actions = 29
    
    # Warmup with zeros (as in initialization)
    print("\n2. Warmup (50 steps with zeros)...")
    obs_warmup = np.zeros(num_obs, dtype=np.float32)
    with torch.inference_mode():
        for i in range(50):
            obs_tensor = obs_warmup.reshape(1, -1).astype(np.float32)
            obs_tensor_clipped = np.clip(obs_tensor, -100, 100)
            _ = model(torch.from_numpy(obs_tensor_clipped))
    print("[OK] Warmup completed")
    
    # Test Case 1: Standing still (all zeros) - current test
    print("\n" + "=" * 80)
    print("Test Case 1: Standing Still (All Zeros)")
    print("=" * 80)
    
    obs_standing = np.zeros(num_obs, dtype=np.float32)
    with torch.inference_mode():
        obs_tensor = obs_standing.reshape(1, -1).astype(np.float32)
        obs_tensor_clipped = np.clip(obs_tensor, -100, 100)
        action_standing = model(torch.from_numpy(obs_tensor_clipped)).clip(-100, 100).detach().numpy().squeeze()
    
    left_indices = [0, 3, 6, 9, 13, 17]
    right_indices = [1, 4, 7, 10, 14, 18]
    
    left_avg_standing = np.mean(np.abs(action_standing[left_indices]))
    right_avg_standing = np.mean(np.abs(action_standing[right_indices]))
    ratio_standing = min(left_avg_standing, right_avg_standing) / max(left_avg_standing, right_avg_standing) if max(left_avg_standing, right_avg_standing) > 0 else 1.0
    
    print(f"   Left leg avg: {left_avg_standing:.4f}")
    print(f"   Right leg avg: {right_avg_standing:.4f}")
    print(f"   Symmetry ratio: {ratio_standing:.4f}")
    print(f"   Right ankle_pitch: {action_standing[14]:.4f}")
    
    # Test Case 2: Walking forward (simulated)
    print("\n" + "=" * 80)
    print("Test Case 2: Walking Forward (Simulated)")
    print("=" * 80)
    
    # Simulate walking: small forward velocity, symmetric joint positions
    obs_walking = np.zeros(num_obs, dtype=np.float32)
    
    # RootAngVelB [0:3]: small forward rotation
    obs_walking[0:3] = [0.0, 0.0, 0.1]  # Small yaw rotation
    
    # ProjectedGravityB [3:6]: robot slightly tilted forward (walking posture)
    obs_walking[3:6] = [0.0, 0.0, -0.95]  # Slightly tilted forward
    
    # Command [6:9]: forward velocity command
    obs_walking[6:9] = [0.3, 0.0, 0.0]  # Forward velocity
    
    # JointPosRel [9:38]: symmetric walking pose (left and right legs symmetric)
    # Left leg: hip_pitch=-0.2, hip_roll=0.0, hip_yaw=0.0, knee=0.4, ankle_pitch=-0.2, ankle_roll=0.0
    # Right leg: same values (symmetric)
    left_leg_pos = [-0.2, 0.0, 0.0, 0.4, -0.2, 0.0]
    right_leg_pos = [-0.2, 0.0, 0.0, 0.4, -0.2, 0.0]  # Same as left (symmetric)
    obs_walking[9:15] = left_leg_pos  # left_hip_pitch, left_hip_roll, left_hip_yaw, left_knee, left_ankle_pitch, left_ankle_roll
    obs_walking[15:21] = right_leg_pos[:6]  # right_hip_pitch, right_hip_roll, right_hip_yaw, right_knee, right_ankle_pitch, right_ankle_roll
    # Other joints (waist, arms) remain zero
    
    # JointVel [38:67]: symmetric velocities (walking motion)
    left_leg_vel = [0.1, 0.0, 0.0, -0.2, 0.1, 0.0]
    right_leg_vel = [0.1, 0.0, 0.0, -0.2, 0.1, 0.0]  # Same as left (symmetric)
    obs_walking[38:44] = left_leg_vel
    obs_walking[44:50] = right_leg_vel[:6]
    
    # PrevActions [67:96]: symmetric previous actions
    left_leg_prev = [0.1, 0.0, 0.0, 0.2, -0.1, 0.0]
    right_leg_prev = [0.1, 0.0, 0.0, 0.2, -0.1, 0.0]  # Same as left (symmetric)
    obs_walking[67:73] = left_leg_prev
    obs_walking[73:79] = right_leg_prev[:6]
    
    print(f"   Observation vector:")
    print(f"     RootAngVelB: {obs_walking[0:3]}")
    print(f"     ProjectedGravityB: {obs_walking[3:6]}")
    print(f"     Command: {obs_walking[6:9]}")
    print(f"     JointPosRel (left leg): {obs_walking[9:15]}")
    print(f"     JointPosRel (right leg): {obs_walking[15:21]}")
    print(f"     JointVel (left leg): {obs_walking[38:44]}")
    print(f"     JointVel (right leg): {obs_walking[44:50]}")
    print(f"     PrevActions (left leg): {obs_walking[67:73]}")
    print(f"     PrevActions (right leg): {obs_walking[73:79]}")
    
    # Check if observations are symmetric
    left_pos = obs_walking[9:15]
    right_pos = obs_walking[15:21]
    pos_symmetric = np.allclose(left_pos, right_pos)
    
    left_vel = obs_walking[38:44]
    right_vel = obs_walking[44:50]
    vel_symmetric = np.allclose(left_vel, right_vel)
    
    left_prev = obs_walking[67:73]
    right_prev = obs_walking[73:79]
    prev_symmetric = np.allclose(left_prev, right_prev)
    
    print(f"\n   Observation symmetry check:")
    print(f"     JointPosRel symmetric: {pos_symmetric}")
    print(f"     JointVel symmetric: {vel_symmetric}")
    print(f"     PrevActions symmetric: {prev_symmetric}")
    
    # Run inference
    with torch.inference_mode():
        obs_tensor = obs_walking.reshape(1, -1).astype(np.float32)
        obs_tensor_clipped = np.clip(obs_tensor, -100, 100)
        action_walking = model(torch.from_numpy(obs_tensor_clipped)).clip(-100, 100).detach().numpy().squeeze()
    
    left_avg_walking = np.mean(np.abs(action_walking[left_indices]))
    right_avg_walking = np.mean(np.abs(action_walking[right_indices]))
    ratio_walking = min(left_avg_walking, right_avg_walking) / max(left_avg_walking, right_avg_walking) if max(left_avg_walking, right_avg_walking) > 0 else 1.0
    
    print(f"\n   Action output:")
    print(f"     Left leg avg: {left_avg_walking:.4f}")
    print(f"     Right leg avg: {right_avg_walking:.4f}")
    print(f"     Symmetry ratio: {ratio_walking:.4f}")
    print(f"     Right ankle_pitch: {action_walking[14]:.4f}")
    
    # Test Case 3: Multiple steps of walking (to see if asymmetry develops)
    print("\n" + "=" * 80)
    print("Test Case 3: Multiple Steps of Walking")
    print("=" * 80)
    
    # Start with symmetric walking state
    obs_current = obs_walking.copy()
    prev_action = np.zeros(num_actions, dtype=np.float32)
    
    print("   Running 10 steps of walking simulation...")
    ratios = []
    for step in range(10):
        # Update PrevActions
        obs_current[67:96] = prev_action.copy()
        
        # Run inference
        with torch.inference_mode():
            obs_tensor = obs_current.reshape(1, -1).astype(np.float32)
            obs_tensor_clipped = np.clip(obs_tensor, -100, 100)
            action = model(torch.from_numpy(obs_tensor_clipped)).clip(-100, 100).detach().numpy().squeeze()
        
        # Update prev_action for next step
        prev_action = action.copy()
        
        # Calculate symmetry
        left_avg = np.mean(np.abs(action[left_indices]))
        right_avg = np.mean(np.abs(action[right_indices]))
        ratio = min(left_avg, right_avg) / max(left_avg, right_avg) if max(left_avg, right_avg) > 0 else 1.0
        ratios.append(ratio)
        
        if step < 3 or step == 9:
            print(f"     Step {step+1}: ratio={ratio:.4f}, left_avg={left_avg:.4f}, right_avg={right_avg:.4f}")
    
    avg_ratio = np.mean(ratios)
    print(f"\n   Average symmetry ratio over 10 steps: {avg_ratio:.4f}")
    
    # Conclusion
    print("\n" + "=" * 80)
    print("CONCLUSION")
    print("=" * 80)
    
    print(f"\nStanding still (all zeros):")
    print(f"  Symmetry ratio: {ratio_standing:.4f}")
    print(f"  Status: {'SYMMETRIC' if ratio_standing >= 0.7 else 'ASYMMETRIC'}")
    
    print(f"\nWalking state (symmetric observations):")
    print(f"  Symmetry ratio: {ratio_walking:.4f}")
    print(f"  Status: {'SYMMETRIC' if ratio_walking >= 0.7 else 'ASYMMETRIC'}")
    
    print(f"\nMultiple steps average:")
    print(f"  Average symmetry ratio: {avg_ratio:.4f}")
    print(f"  Status: {'SYMMETRIC' if avg_ratio >= 0.7 else 'ASYMMETRIC'}")
    
    if ratio_walking >= 0.7 and avg_ratio >= 0.7:
        print(f"\n[PASS] Policy is SYMMETRIC in walking state")
        print(f"   The policy is designed for walking, not standing still.")
        print(f"   Asymmetry in standing state may be expected behavior.")
        return True
    else:
        print(f"\n[FAIL] Policy is ASYMMETRIC even in walking state")
        print(f"   The policy model itself has a problem.")
        return False


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    pt_path = script_dir / "policy_29dof.pt"
    
    if len(sys.argv) > 1:
        pt_path = Path(sys.argv[1])
    
    success = test_policy_in_walking_state(pt_path)
    sys.exit(0 if success else 1)
