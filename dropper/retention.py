"""Optional retention for generated reports and videos that no job still references."""
import json
import os
import re
import shutil
from pathlib import Path
from time import time

from config import log


def prune_generated(root):
    setting = os.environ.get('AGENCYKEY_RECORDER_RETENTION_DAYS', '')
    if not setting:
        return
    if not setting.isdecimal() or not 7 <= int(setting) <= 3650:
        log.warning('La retención de comprobantes debe estar entre 7 y 3650 días')
        return
    cutoff = time() - int(setting) * 86400
    try:
        keep = set()
        for job in (root / 'jobs').glob('*.json'):
            value = json.loads(job.read_text(encoding='utf-8'))
            if value.get('report'):
                keep.add(Path(value['report']).resolve().parent)
        patterns = {
            'output': r'\d{8}T\d{6}-[0-9a-f]{6}',
            'diagnostics': r'\d{8}T\d{12}-[0-9a-f]{8}',
        }
        for area, pattern in patterns.items():
            parent = root / area
            if parent.is_symlink():
                continue
            for folder in parent.glob('*'):
                if (re.fullmatch(pattern, folder.name) and not folder.is_symlink()
                        and folder.is_dir() and folder.stat().st_mtime < cutoff
                        and folder.resolve() not in keep):
                    shutil.rmtree(folder)
    except (OSError, ValueError, TypeError):
        log.warning('No se pudo completar la limpieza de archivos antiguos')
