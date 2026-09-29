"""Guards that keep secrets out of git. Fail loudly if an ignore rule regresses."""

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def is_ignored(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "-q", path], cwd=REPO, capture_output=True, check=False
    )
    return result.returncode == 0


def test_env_files_are_ignored_everywhere():
    for path in ["ml/.env", ".env", "apps/web/.env", "apps/mobile/.env", "ml/.env.local"]:
        assert is_ignored(path), f"{path} must be git-ignored"


def test_env_example_is_committable():
    assert not is_ignored("ml/.env.example"), "ml/.env.example should be tracked"


def test_model_weights_are_ignored():
    for path in ["ml/model.gguf", "ml/checkpoints/step-100/model.safetensors"]:
        assert is_ignored(path), f"{path} must be git-ignored (weights go to Hugging Face)"
