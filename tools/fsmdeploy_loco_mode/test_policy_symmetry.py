"""
Test script to verify if the original Python policy outputs symmetric actions
when given symmetric (all-zero) observations.

This script will:
1. Load the TorchScript policy
2. Run 50 warmup steps with all-zero observations
3. Run inference with all-zero observations
4. Check if the output actions are symmetric (left vs right leg)
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add torch lib to DLL path (for Windows)
import site
import os

for p in reversed(site.getsitepackages()):
    torch_lib = Path(p) / "torch" / "lib"
    if torch_lib.exists():
        os.add_dll_directory(str(torch_lib))
        break

import numpy as np
import torch


def test_policy_symmetry(pt_path: Path):
    """Test if the policy outputs symmetric actions with symmetric inputs."""
    
    print("=" * 80)
    print("Testing Policy Symmetry")
    print("=" * 80)
    
    # Load policy
    print(f"\n1. Loading policy from: {pt_path}")
    if not pt_path.exists():
        print(f"ERROR: Policy file not found: {pt_path}")
        return False
    
    model = torch.jit.load(str(pt_path), map_location="cpu")
    model.eval()
    print("   [OK] Policy loaded successfully")
    
    # Create all-zero observation (96 dims, matching LocoMode.yaml)
    print("\n2. Creating all-zero observation vector (96 dims)")
    obs = torch.zeros((1, 96), dtype=torch.float32)
    print(f"   [OK] Observation shape: {obs.shape}")
    print(f"   [OK] Observation range: [{obs.min():.4f}, {obs.max():.4f}]")
    
    # Warmup (50 steps, matching original implementation)
    print("\n3. Running warmup (50 steps)...")
    with torch.no_grad():
        for i in range(50):
            _ = model(obs)
    print("   [OK] Warmup completed")
    
    # Run inference
    print("\n4. Running inference with all-zero observation...")
    with torch.no_grad():
        action = model(obs).detach().cpu().numpy()
    
    print(f"   [OK] Action shape: {action.shape}")
    print(f"   [OK] Action range: [{action.min():.4f}, {action.max():.4f}]")
    
    # Define left and right leg joint indices
    # Based on policy_joint_names order:
    # 0: left_hip_pitch_joint
    # 1: right_hip_pitch_joint
    # 3: left_hip_roll_joint
    # 4: right_hip_roll_joint
    # 6: left_hip_yaw_joint
    # 7: right_hip_yaw_joint
    # 9: left_knee_joint
    # 10: right_knee_joint
    # 13: left_ankle_pitch_joint
    # 14: right_ankle_pitch_joint
    # 17: left_ankle_roll_joint
    # 18: right_ankle_roll_joint
    
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
    
    # Extract left and right leg actions
    left_leg_actions = action[0, left_leg_indices]
    right_leg_actions = action[0, right_leg_indices]
    
    # Calculate averages
    left_avg = np.mean(np.abs(left_leg_actions))
    right_avg = np.mean(np.abs(right_leg_actions))
    ratio = min(left_avg, right_avg) / max(left_avg, right_avg) if max(left_avg, right_avg) > 0 else 1.0
    
    # Print detailed results
    print("\n5. Analyzing action symmetry...")
    print("\n   Left leg actions:")
    for idx, val in zip(left_leg_indices, left_leg_actions):
        print(f"      [{idx:2d}] {joint_names[idx]:25s}: {val:8.4f}")
    
    print("\n   Right leg actions:")
    for idx, val in zip(right_leg_indices, right_leg_actions):
        print(f"      [{idx:2d}] {joint_names[idx]:25s}: {val:8.4f}")
    
    print("\n   Symmetry analysis:")
    print(f"      Left leg average magnitude:  {left_avg:.4f}")
    print(f"      Right leg average magnitude:  {right_avg:.4f}")
    print(f"      Symmetry ratio:               {ratio:.4f}")
    
    # Check for abnormal values
    max_action = np.max(np.abs(action[0]))
    right_ankle_pitch = action[0, 14]
    
    print(f"\n   Additional checks:")
    print(f"      Maximum action magnitude:     {max_action:.4f}")
    print(f"      Right ankle_pitch value:     {right_ankle_pitch:.4f}")
    
    # Conclusion
    print("\n" + "=" * 80)
    print("CONCLUSION")
    print("=" * 80)
    
    if ratio < 0.7:
        print("[FAIL] POLICY OUTPUT IS ASYMMETRIC")
        print(f"   Symmetry ratio ({ratio:.4f}) is below threshold (0.7)")
        print("   This suggests the policy model itself has a problem.")
        if abs(right_ankle_pitch) > 2.0:
            print(f"   [WARNING] Right ankle_pitch ({right_ankle_pitch:.4f}) is abnormally large!")
        return False
    else:
        print("[PASS] POLICY OUTPUT IS SYMMETRIC")
        print(f"   Symmetry ratio ({ratio:.4f}) is above threshold (0.7)")
        print("   The policy model appears to be working correctly.")
        return True


if __name__ == "__main__":
    # Default path
    script_dir = Path(__file__).parent
    pt_path = script_dir / "policy_29dof.pt"
    
    # Allow override via command line
    if len(sys.argv) > 1:
        pt_path = Path(sys.argv[1])
    
    success = test_policy_symmetry(pt_path)
    sys.exit(0 if success else 1)
