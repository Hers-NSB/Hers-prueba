"""Exercise the frozen app, installed Chrome, and its bundled encoder."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile


def check_embedded_icon(executable):
    from pefile import DIRECTORY_ENTRY, PE, RESOURCE_TYPE

    path = Path(__file__).resolve().parents[1] / 'assets' / 'hers-dropper.ico'
    data = path.read_bytes()
    _, _, count = struct.unpack_from('<HHH', data)
    entries = struct.iter_unpack('<BBBBHHII', data[6:6 + count * 16])
    expected = {data[offset:offset + size] for *_, size, offset in entries}
    assert expected, 'Expected HERS icon images'

    with PE(str(executable), fast_load=True) as program:
        program.parse_data_directories(directories=[DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])
        actual = {
            program.get_data(language.data.struct.OffsetToData, language.data.struct.Size)
            for resource in program.DIRECTORY_ENTRY_RESOURCE.entries if resource.id == RESOURCE_TYPE['RT_ICON']
            for icon in resource.directory.entries
            for language in icon.directory.entries
        }
    assert expected <= actual, 'The executable does not contain all HERS icon sizes'


def main():
    source = Path(sys.argv[1]).resolve()
    check_embedded_icon(source)
    with tempfile.TemporaryDirectory(prefix='recorder-exe-') as directory:
        root = Path(directory)
        folder = root / 'Aplicación con espacios ñ'
        folder.mkdir()
        exe = folder / source.name
        shutil.copy2(source, exe)
        data = root / 'Datos persistentes ñ'
        environment = dict(os.environ, AGENCYKEY_RECORDER_DATA_DIR=str(data), PYTHONUTF8='1')
        # Avoid relying on a separately installed FFmpeg in the runner's PATH.
        # Frozen mode always chooses the bundled imageio-ffmpeg encoder.
        subprocess.run([str(exe), 'check-chrome'], env=environment, cwd=root, check=True, timeout=180)
        subprocess.run([str(exe), '--check-telegram-support'], env=environment, cwd=root, check=True, timeout=180)
        subprocess.run([str(exe), 'demo', '--headless'], env=environment, cwd=root, check=True, timeout=900)
        reports = list((data / 'output').glob('*/report.json'))
        assert len(reports) == 1, 'Expected one standalone demo'
        report = json.loads(reports[0].read_text(encoding='utf-8'))
        assert report['status'] == 'complete' and report['seen'] == ['200', '100'], report
        assert report['resolution'] == '854x480'
        assert report['headless'] is True and report['post_hold_seconds'] == 0
        assert report['first_post_id'] == '200'
        assert report['duration_seconds'] < 8, 'Unexpected pauses in a two-post recording'
        video = reports[0].parent / 'comprobante.mp4'
        assert hashlib.sha256(video.read_bytes()).hexdigest() == report['sha256']
        assert video.stat().st_size > 1000
        # The blue post 300 is above the chosen start. The first frame must show green post 200.
        import imageio_ffmpeg
        decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error',
                                  '-i', str(video), '-frames:v', '1', '-threads', '1', '-pix_fmt', 'rgb24',
                                  '-f', 'rawvideo', 'pipe:1'], check=True, capture_output=True).stdout
        offset = (250 * 854 + 400) * 3
        red, green, blue = decoded[offset:offset+3]
        assert green > red + 40 and green > blue + 12, f'Wrong first post color: {(red,green,blue)}'
        assert not (data / 'browsers').exists(), 'The app must not download a browser'
        assert exe.stat().st_size < 87_121_379, 'The executable must be smaller than the original release'
        subprocess.run([str(exe), '--smoke-test'], env=environment, cwd=root, check=True, timeout=180)
        assert video.exists()
        if destination := os.environ.get('AGENCYKEY_RECORDER_DEMO_EXPORT'):
            exported = Path(destination).resolve()
            exported.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(video, exported)
        print('EXE verificado: menú, configuración persistente, Chrome instalado sin descargas y MP4 480p completos.')


if __name__ == '__main__':
    main()
