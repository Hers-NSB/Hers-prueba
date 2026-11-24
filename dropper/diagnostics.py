"""Local, shareable failure reports. Never export browser storage or raw HTML."""
import asyncio
import base64
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
import tempfile
import traceback
from urllib.parse import urlsplit
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from config import ConsoleFormatter, log


def redact(text):
    record = logging.LogRecord('diagnostic', logging.ERROR, '', 0, str(text), (), None)
    text = ConsoleFormatter('%(message)s').format(record)
    text = re.sub(r'https?://[^\s<>\"\']+', lambda m: safe_url(m[0]), text)
    text = re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [oculto]', text)
    text = re.sub(r'\b\d{6,}:[A-Za-z0-9_-]{20,}\b', '[oculto]', text)
    return re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b', '[oculto]', text)


def safe_url(value):
    try:
        url = urlsplit(value)
        host = url.hostname or ''
        if url.scheme == 'https' and (host == 'app.agencykey.com'
                or re.fullmatch(r'of-\d+\.agencykey\.com', host)):
            path = url.path if (re.fullmatch(r'/models/\d+/?', url.path)
                                or re.fullmatch(r'/[a-zA-Z0-9_]{1,64}/?', url.path)) else '/[ruta omitida]'
            return 'https://' + host + path
    except ValueError:
        pass
    return '[URL omitida]'


async def capture_failure(page, *, kind, profile_url, username=None, error=None, status=None, post_ids=(), stage=None,
                          http_status=None, root=None, image_format='png', notify=True):
    """Bounded best-effort capture; a broken browser must not hide the original error."""
    import recorder
    folder = (root or recorder.ROOT / 'diagnostics') / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '-' + uuid4().hex[:8])
    try:
        folder.mkdir(parents=True)
        report = dict(kind=kind, created_at_utc=datetime.now(timezone.utc).isoformat(),
                      expected_url=safe_url(profile_url), expected_username=username,
                      stage=stage, status=status, http_status=http_status, post_ids=list(post_ids), frames=[])
        report['observed_username'] = getattr(error, 'observed', None)
        if error is not None:
            report.update(error_type=type(error).__name__, error=redact(error),
                          traceback=redact(''.join(traceback.format_exception(error))))
        def save_report():
            temporary = folder / 'diagnostic.tmp'
            recorder.save_json(temporary, report)
            temporary.replace(folder / 'diagnostic.json')
        save_report()
        try:
            async with asyncio.timeout(6):
                report['opened_url'] = safe_url(page.url)
                report['browser_closed'] = page.is_closed()
                if not report['browser_closed']:
                    report['frames'] = await recorder.failure_diagnostics(page)
                    for entry in report['frames']:
                        frame = page.frames[entry['frame_index']]
                        entry['url'] = safe_url(frame.url)
                        identity = recorder.profile_frame_identity(frame)
                        entry['identity'] = list(identity) if identity else None
                        entry['profile_header'] = await frame.locator(recorder.PROFILE_HEADER).first.is_visible()
                        entry['profile_menu'] = await frame.get_by_text(
                            re.compile(r'^\s*(?:Mi perfil|My profile)\s*$', re.IGNORECASE)).first.is_visible()
                        entry['viewport'] = await frame.evaluate('''() => ({width:innerWidth,height:innerHeight,
                            scrollTop:document.scrollingElement?.scrollTop,
                            scrollHeight:document.scrollingElement?.scrollHeight})''')
        except Exception as exc:
            report['inspection_error'] = type(exc).__name__
        try:
            async with asyncio.timeout(4):
                if not page.is_closed() and not await recorder.agencykey_sign_in_visible(page):
                    mask = [frame.locator('input, textarea, [contenteditable], pre, code, [data-sensitive]')
                            for frame in page.frames if not frame.is_detached()]
                    name = 'chrome.jpg' if image_format == 'jpeg' else 'chrome.png'
                    temporary = folder / ('tmp-' + name)
                    await page.screenshot(path=str(temporary), timeout=3000, mask=mask,
                                          **({'type': 'jpeg', 'quality': 55} if image_format == 'jpeg' else {}))
                    temporary.replace(folder / name)
                    report['screenshot'] = name
                else:
                    report['screenshot_omitted'] = 'login_or_closed'
        except Exception as exc:
            report['screenshot_error'] = type(exc).__name__
        save_report()
        if notify:
            log.error('Diagnóstico de %s guardado · Usa Guardar registro para exportarlo · %s', kind, folder.name)
        return folder
    except Exception as exc:
        if notify:
            log.warning('No se pudo guardar el diagnóstico (%s)', type(exc).__name__)
        return None


async def capture_web_failure(page, **context):
    """Return only this web request's evidence, without writing to app diagnostics."""
    try:
        with tempfile.TemporaryDirectory(prefix='recorder-web-') as directory:
            folder = await capture_failure(page, root=Path(directory), image_format='jpeg', notify=False,
                                           kind='verificacion_web', **context)
            if not folder:
                return {'stage': context.get('stage'), 'error': 'No se pudo recoger el diagnóstico de Chrome'}
            report = json.loads((folder / 'diagnostic.json').read_text(encoding='utf-8'))
            for name, limit in (('traceback', 12000), ('error', 2000)):
                if isinstance(report.get(name), str):
                    report[name] = report[name][:limit]
            report['frames'] = report.get('frames', [])[:16]
            for frame in report['frames']:
                frame['cards'] = frame.get('cards', [])[:40]
                frame['images'] = frame.get('images', [])[:60]
            image = folder / 'chrome.jpg'
            report.pop('screenshot', None)
            if image.is_file() and image.stat().st_size <= 180_000:
                report['screenshot'] = {'mime': 'image/jpeg', 'data': base64.b64encode(image.read_bytes()).decode('ascii')}
            elif image.is_file():
                report['screenshot_omitted'] = 'size_limit'
            if len(json.dumps(report).encode('utf-8')) > 420_000:
                report.pop('screenshot', None)
                report['frames'] = []
                report['inspection_error'] = 'payload_limit'
                report['screenshot_omitted'] = 'payload_limit'
            return report
    except Exception as error:
        return {'stage': context.get('stage'), 'error': 'No se pudo recoger el diagnóstico de Chrome',
                'inspection_error': type(error).__name__}


def export_diagnostics(destination, activity):
    import recorder
    root = recorder.ROOT / 'diagnostics'
    folders = sorted((p for p in root.glob('*') if p.is_dir() and not p.is_symlink()), reverse=True)[:20]
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED) as archive:
        archive.writestr('recorder-registro.txt', redact(activity))
        archive.writestr('LEEME.txt', 'Registro y últimos 20 diagnósticos locales de verificación y grabación.\n'
                          'Las capturas muestran la página en el momento del fallo.\n'
                          'No se incluyen archivos de sesión, cookies, configuración ni HTML.\n')
        for folder in folders:
            # Whitelist generated artifacts; never traverse session/output directories.
            for name in ('diagnostic.json', 'chrome.png'):
                source = folder / name
                if source.is_file() and not source.is_symlink():
                    target = f'diagnosticos/{folder.name}/{name}'
                    if name.endswith('.json'):
                        def clean(value):
                            if isinstance(value, str):
                                return redact(value)
                            if isinstance(value, dict):
                                return {key: clean(item) for key, item in value.items()}
                            if isinstance(value, list):
                                return [clean(item) for item in value]
                            return value
                        report = clean(json.loads(source.read_text(encoding='utf-8')))
                        archive.writestr(target, json.dumps(report, ensure_ascii=False, indent=2))
                    else:
                        archive.write(source, target)
    return len(folders)
