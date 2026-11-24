# Keep the Chrome driver and only the video encoders actually used by this app.
from pathlib import Path

encoder = Path('vendor/encoder/ffmpeg.exe')
if not encoder.is_file():
    raise RuntimeError('Prepare the minimal Windows encoder before building.')

a = Analysis(
    ['app.py'], pathex=[], binaries=[],
    datas=[('tests/feed.html', 'tests'), ('agencykey-perfiles.json', '.'), (str(encoder), 'encoder'),
           ('assets/hers-dropper.png', 'assets')],
    hiddenimports=[], hookspath=[], runtime_hooks=[],
    excludes=['imageio_ffmpeg', 'playwright.sync_api', 'playwright.__main__'], noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='Dropper',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=True,
          hide_console='hide-early', icon='assets/hers-dropper.ico')
