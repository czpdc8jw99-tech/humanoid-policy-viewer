#!/usr/bin/env python3
"""
将 FSMDeploy_G1 的 LocoMode PyTorch 模型 (policy_29dof.pt) 导出为 ONNX，
供 humanoid-policy-viewer 网页版使用。

依赖: pip install torch
运行: 在项目根目录执行
  python scripts/export_loco_pt_to_onnx.py

或指定路径:
  python scripts/export_loco_pt_to_onnx.py --pt "C:/path/to/FSMDeploy_G1/policy/loco_mode/model/policy_29dof.pt"
"""

import argparse
import os
import sys

# Windows 下避免 ONNX 导出时 gbk 编码错误
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

def main():
    parser = argparse.ArgumentParser(description="Export LocoMode policy_29dof.pt to ONNX")
    parser.add_argument(
        "--pt",
        default=None,
        help="Path to policy_29dof.pt (default: ../FSMDeploy_G1/policy/loco_mode/model/policy_29dof.pt)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output ONNX path (default: public/examples/checkpoints/g1/policy_loco_29dof.onnx)",
    )
    args = parser.parse_args()

    try:
        import torch
    except ImportError:
        print("Error: PyTorch not installed. Run: pip install torch", file=sys.stderr)
        sys.exit(1)

    # 项目根目录 = 脚本所在目录的上一级
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_pt = os.path.join(
        repo_root, "..", "FSMDeploy_G1", "policy", "loco_mode", "model", "policy_29dof.pt"
    )
    default_pt = os.path.normpath(default_pt)
    pt_path = os.path.normpath(args.pt or default_pt)

    default_out = os.path.join(
        repo_root, "public", "examples", "checkpoints", "g1", "policy_loco_29dof.onnx"
    )
    out_path = os.path.normpath(args.out or default_out)

    if not os.path.isfile(pt_path):
        print(f"Error: PyTorch model not found: {pt_path}", file=sys.stderr)
        print("Use --pt /path/to/policy_29dof.pt if FSMDeploy_G1 is elsewhere.", file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.dirname(out_path)
    os.makedirs(out_dir, exist_ok=True)

    print(f"Loading: {pt_path}")
    policy = torch.jit.load(pt_path)
    policy.eval()

    # LocoMode: obs (1, 96) -> action (1, 29)；直接导出 JIT，单输出 "action"
    num_obs = 96
    dummy_obs = torch.randn(1, num_obs, dtype=torch.float32).clamp(-100, 100)

    with torch.no_grad():
        torch.onnx.export(
            policy,
            dummy_obs,
            out_path,
            input_names=["policy"],
            output_names=["action"],
            opset_version=14,
            dynamo=False,  # 使用旧版导出器，兼容 JIT 模型
        )

    print(f"Exported: {out_path}")
    print("You can now use 'G1 Locomotion Mode (手柄操控)' in the web viewer.")


if __name__ == "__main__":
    main()
