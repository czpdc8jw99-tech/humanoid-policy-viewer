## Convert `policy_29dof.pt` to ONNX

Your current system Python is **3.14**, and PyTorch does **not** ship wheels for that version, so the conversion must be done with **Python 3.11** (recommended) or 3.10/3.12.

### Option A (recommended): Python 3.11 + venv

1. Install Python 3.11 (64-bit).
2. From the repo root, create a venv and install deps:

```bash
py -3.11 -m venv .venv-onnx
.\.venv-onnx\Scripts\python -m pip install --upgrade pip
.\.venv-onnx\Scripts\python -m pip install numpy onnx onnxruntime
.\.venv-onnx\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

3. Export + validate:

```bash
.\.venv-onnx\Scripts\python tools\fsmdeploy_loco_mode\convert_to_onnx.py --dynamic-batch --validate
```

It will create:
- `tools/fsmdeploy_loco_mode/policy_29dof.onnx`

### Option B: Conda / Mamba

Create an environment with Python 3.11, then install `pytorch`, `onnx`, `onnxruntime` and run the same script.

### Using the ONNX in this web project

After export, copy the ONNX into the public checkpoints so the browser can fetch it:

```bash
copy tools\fsmdeploy_loco_mode\policy_29dof.onnx public\examples\checkpoints\g1\policy_loco_29dof.onnx
```

Next step (separate work): implement the **LocoMode observation (96 dims)** and correct **joint/action order mapping** in the web runtime, then hook the `cmd` from the Gamepad API.

