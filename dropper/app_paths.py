import sys
from pathlib import Path


def application_dir() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_path(name: str) -> Path:
    external = application_dir() / name
    if external.is_file():
        return external
    return Path(__file__).resolve().parent / name
