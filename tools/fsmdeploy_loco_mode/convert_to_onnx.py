"""
Convert FSMDeploy_G1 loco_mode TorchScript policy to ONNX.

This repo is a web viewer; the conversion step is meant to be run locally with
Python 3.10/3.11/3.12 (PyTorch does not support Python 3.14 at the time of writing).
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--pt",
        type=Path,
        default=Path(__file__).with_name("policy_29dof.pt"),
        help="Path to TorchScript .pt file",
    )
    p.add_argument(
        "--onnx",
        type=Path,
        default=Path(__file__).with_name("policy_29dof.onnx"),
        help="Output ONNX path",
    )
    p.add_argument("--opset", type=int, default=17, help="ONNX opset version")
    p.add_argument(
        "--dynamic-batch",
        action="store_true",
        help="Export with dynamic batch axis (NOT recommended for this recurrent model)",
    )
    p.add_argument(
        "--with-state",
        action="store_true",
        help="Export a stateful ONNX with (obs,h,c)->(action,h1,c1) (recommended)",
    )
    p.add_argument(
        "--validate",
        action="store_true",
        help="Run an ONNXRuntime check vs PyTorch on random inputs",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # Heavy deps are imported here so the script can show a helpful message.
    try:
        # On some Windows setups, importing torch can fail with:
        # "ImportError: DLL load failed while importing _C"
        #
        # Pre-adding `.../site-packages/torch/lib` fixes it.
        import site

        for p in reversed(site.getsitepackages()):
            torch_lib = Path(p) / "torch" / "lib"
            if torch_lib.exists():
                os.add_dll_directory(str(torch_lib))
                break

        import numpy as np
        import torch
    except Exception as e:  # pragma: no cover
        raise SystemExit(
            "Missing dependencies. Create a Python 3.11 venv and install:\n"
            "  pip install numpy onnx onnxruntime\n"
            "  pip install torch --index-url https://download.pytorch.org/whl/cpu\n"
            f"\nOriginal error: {e}"
        )

    if not args.pt.exists():
        raise SystemExit(f"Input .pt not found: {args.pt}")

    model = torch.jit.load(str(args.pt), map_location="cpu")
    model.eval()

    # LocoMode.yaml says num_obs=96, num_actions=29
    dummy_obs = torch.zeros((1, 96), dtype=torch.float32)

    if args.with_state:
        # This TorchScript policy contains an internal LSTM state:
        #   hidden_state: (1, 1, 256)
        #   cell_state:   (1, 1, 256)
        #
        # Exposing (h, c) as explicit inputs/outputs lets a caller (like the web app)
        # preserve recurrence between timesteps.
        class StatefulWrap(torch.nn.Module):
            def __init__(self, inner):
                super().__init__()
                self.inner = inner

            def forward(self, obs, h, c):
                self.inner.hidden_state.copy_(h)
                self.inner.cell_state.copy_(c)
                y = self.inner(obs)
                return y, self.inner.hidden_state, self.inner.cell_state

        export_model = StatefulWrap(model).eval()
        dummy_h = model.hidden_state.clone()
        dummy_c = model.cell_state.clone()
        export_args = (dummy_obs, dummy_h, dummy_c)
        input_names = ["obs", "h", "c"]
        output_names = ["action", "h1", "c1"]
        dynamic_axes = None
        if args.dynamic_batch:
            print("NOTE: --dynamic-batch is not supported for --with-state; exporting fixed batch=1.")
    else:
        export_model = model
        export_args = dummy_obs
        input_names = ["obs"]
        output_names = ["action"]

    dynamic_axes = None
    if args.dynamic_batch and not args.with_state:
        dynamic_axes = {"obs": {0: "batch"}, "action": {0: "batch"}}

    args.onnx.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        export_model,
        export_args,
        str(args.onnx),
        export_params=True,
        opset_version=args.opset,
        do_constant_folding=True,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        dynamo=False,  # TorchScript export: use legacy exporter
    )

    print(f"Wrote ONNX: {args.onnx}")

    if args.validate:
        import onnxruntime as ort

        sess = ort.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
        in_names = [i.name for i in sess.get_inputs()]

        rng = np.random.default_rng(0)
        x_np = rng.standard_normal((1, 96), dtype=np.float32).clip(-3, 3)

        with torch.no_grad():
            if args.with_state:
                h0 = torch.zeros_like(model.hidden_state)
                c0 = torch.zeros_like(model.cell_state)
                y_pt, h1_pt, c1_pt = export_model(
                    torch.from_numpy(x_np),
                    h0,
                    c0,
                )
                y_pt = y_pt.detach().cpu().numpy()
                h1_pt = h1_pt.detach().cpu().numpy()
                c1_pt = c1_pt.detach().cpu().numpy()
            else:
                y_pt = export_model(torch.from_numpy(x_np)).detach().cpu().numpy()

        if args.with_state:
            h0_np = np.zeros((1, 1, 256), dtype=np.float32)
            c0_np = np.zeros((1, 1, 256), dtype=np.float32)
            outs = sess.run(None, {in_names[0]: x_np, in_names[1]: h0_np, in_names[2]: c0_np})
            y_ort, h1_ort, c1_ort = outs
            max_abs_y = float(np.max(np.abs(y_pt - y_ort)))
            max_abs_h = float(np.max(np.abs(h1_pt - h1_ort)))
            max_abs_c = float(np.max(np.abs(c1_pt - c1_ort)))
            print(f"Validation OK. max_abs_y={max_abs_y:.6g} max_abs_h={max_abs_h:.6g} max_abs_c={max_abs_c:.6g}")
            return
        else:
            y_ort = sess.run(None, {in_names[0]: x_np})[0]

        max_abs = float(np.max(np.abs(y_pt - y_ort)))
        mean_abs = float(np.mean(np.abs(y_pt - y_ort)))
        print(f"Validation OK. max_abs={max_abs:.6g} mean_abs={mean_abs:.6g}")


if __name__ == "__main__":
    main()

