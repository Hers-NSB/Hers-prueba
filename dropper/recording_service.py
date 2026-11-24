"""Publish-to-proof workflow. No credentials are persisted with recording jobs."""
import asyncio
import json
from contextlib import AsyncExitStack
from pathlib import Path
import logging
import queue
from types import SimpleNamespace
from time import time, monotonic
from urllib.parse import urlparse

from telegram import ReplyKeyboardMarkup, ReplyKeyboardRemove
from telegram.error import BadRequest, Forbidden, RetryAfter, TelegramError

import recorder
from config import log
from cloud_client import CloudError, AccessDenied

web_log = logging.getLogger('agencykey-web-verification')


AGENCYKEY_SIGN_IN = 'https://app.agencykey.com/auth/signin'
RETRY_RECORDING = '🔄 Reintentar'
CANCEL_RECORDING = '⏹️ Cancelar grabación'
RETRY_DELIVERY = '🎥 Reintentar video'
RESEND_PROOF = '📤 Reenviar video'
RECORDING_STEPS = {
    'preparando comprobante': 'Preparando el comprobante',
    'cargando sesión de AgencyKey': 'Abriendo la sesión guardada de AgencyKey',
    'iniciando Chrome': 'Iniciando Chrome',
    'abrir perfil': 'Abriendo el perfil de la modelo',
    'verificando identidad de la modelo': 'Verificando la cuenta abierta de AgencyKey',
    'reintentando abrir el perfil por un fallo de conexión': 'La conexión se interrumpió. Intentando abrir el perfil otra vez',
    'cargando feed e imágenes': 'Buscando las publicaciones de la modelo y cargando sus fotos',
    'marcar inicio del video': 'Preparando el inicio del video',
    'recorrer posts / cargar imágenes': 'Grabando las publicaciones y sus fotos',
    'grabando': 'Grabando las publicaciones',
    'marcar fin del video': 'Terminando la grabación',
    'convertir video a MP4': 'Preparando el archivo de video',
    'video listo': 'Video listo',
    'enviando video': 'Enviando el video a Telegram',
    'enviado': 'Video enviado a Telegram',
}


def recording_step(stage):
    return RECORDING_STEPS.get(stage, stage)


def session_path(creator_id):
    return recorder.ROOT / 'private' / 'sessions' / f'{int(creator_id)}.json'


async def agencykey_login_complete(page):
    from playwright.async_api import Error as PlaywrightError

    current = urlparse(page.url)
    if (current.scheme, current.netloc) != ('https', 'app.agencykey.com'):
        return False
    try:
        return not await recorder.agencykey_sign_in_visible(page) and await page.locator('body').is_visible()
    except PlaywrightError:
        return False


async def verify_profile_route(page, url, username):
    from diagnostics import capture_web_failure
    try:
        result = await _verify_profile_route(page, url, username)
    except Exception as error:
        diagnostic = await capture_web_failure(page, profile_url=url, username=username,
                                              error=error, stage='abrir/verificar Mi perfil')
        return {'status': 'connection_error', 'diagnostic': diagnostic}
    if result['status'] != 'ready':
        http_status = result.pop('_http_status', None)
        error = result.pop('_diagnostic_error', None) or recorder.FeedAccessError(
            result['status'], PROFILE_ERRORS[result['status']], observed=result.get('observed_username'))
        result['diagnostic'] = await capture_web_failure(page, profile_url=url, username=username,
            error=error, status=result['status'], stage='verificar Mi perfil', http_status=http_status)
    return result


async def _verify_profile_route(page, url, username):
    response = await page.goto(url, wait_until='domcontentloaded', timeout=30000)
    if response is None:
        return {'status': 'connection_error'}
    if response.status == 401:
        return {'status': 'login_required', '_http_status': response.status}
    if response.status in (403, 404):
        return {'status': 'unavailable', '_http_status': response.status}
    if not response.ok:
        return {'status': 'connection_error', '_http_status': response.status}

    try:
        observed = await recorder.wait_for_model_identity(page, url, username, deadline=monotonic() + 35)
    except recorder.FeedAccessError as error:
        return {'status': error.status, 'observed_username': error.observed, '_diagnostic_error': error}
    return {'status': 'ready', 'observed_username': observed}


PROFILE_ERRORS = {
    'login_required': 'AgencyKey pide iniciar sesión desde el panel web.',
    'unavailable': 'AgencyKey denegó el acceso o el perfil no existe.',
    'wrong_profile': 'Chrome abrió otra ruta.',
    'profile_menu_missing': 'Chrome no encontró la opción Mi perfil.',
    'profile_not_visible': 'Mi perfil no terminó de cargar.',
    'profile_unverified': 'No se pudo identificar la cuenta de Mi perfil.',
    'connection_error': 'Chrome no pudo cargar AgencyKey.',
}


async def recovery_pause(stop_event, seconds=3):
    for _ in range(int(seconds * 5)):
        if stop_event.is_set():
            raise asyncio.CancelledError
        await asyncio.sleep(.2)


async def cloud_retry(call, stop_event):
    while not stop_event.is_set():
        try:
            return await asyncio.to_thread(call)
        except CloudError as error:
            if not error.retryable:
                raise
            await recovery_pause(stop_event)
    raise asyncio.CancelledError


class VerificationBrowser:
    """Owned by one event loop; reuse the login tab across model checks."""
    def __init__(self):
        self.stack = AsyncExitStack()
        self.page = self.context = None
        self.connection = None

    async def close(self):
        await self.stack.aclose()
        self.page = self.context = None
        self.connection = None

    async def open(self, client, connect, stop_event):
        from playwright.async_api import async_playwright
        session = None if connect else await cloud_retry(client.recording_session, stop_event)
        connection = session.get('connection', session.get('revision')) if session else None
        if connect or (self.connection is not None and self.connection != connection):
            await self.close()
        if self.page is None or self.page.is_closed():
            await self.close()
            pw = await self.stack.enter_async_context(async_playwright())
            browser = await recorder.launch_browser(pw, headless=not connect)
            self.stack.push_async_callback(browser.close)
            options = {'viewport': {'width': 1280, 'height': 720}}
            if session:
                options['storage_state'] = session['state']
            self.context = await browser.new_context(**options)
            self.page = await self.context.new_page()
        self.connection = connection
        return self.page, self.context


async def run_verification_engine(client, stop_event, *, current=lambda: True, notify=lambda error: None):
    browser = VerificationBrowser()
    try:
        while not stop_event.is_set() and current():
            try:
                job = await asyncio.to_thread(client.claim_recording_job)
                notify(None)
                if job:
                    await run_desktop_recording_job(client, job, stop_event, browser_session=browser)
                else:
                    await recovery_pause(stop_event, 10)
            except AccessDenied:
                raise
            except CloudError as error:
                notify(str(error))
                await recovery_pause(stop_event, 3)
    finally:
        await browser.close()


async def run_desktop_recording_job(client, job, stop_event, *, browser_session=None):
    """Keep a claimed check and its result alive through temporary network failures."""
    session = browser_session or VerificationBrowser()
    progress = {'phase': 'opening', 'attempt': 1}
    updates = asyncio.Lock()

    async def report(**value):
        async with updates:
            return await cloud_retry(lambda: client.update_recording_job(job, **value), stop_event)

    async def check_cancelled():
        while not stop_event.is_set():
            await recovery_pause(stop_event, 3)
            status = await report(**progress)
            if not status.get('active'):
                return

    async def open_agencykey():
        connect = job['kind'] == 'connect'
        page, context = await session.open(client, connect, stop_event)
        if not connect:
            url = recorder.model_profile_url(job['creator_id'])
            while not stop_event.is_set():
                result = await verify_profile_route(page, url, job.get('creator_username'))
                if result['status'] not in {'connection_error', 'profile_unverified', 'profile_not_visible', 'profile_menu_missing'}:
                    return {**result, 'identity_checked': True}
                if page.is_closed():
                    return {**result, 'identity_checked': True}
                progress.update(phase='retrying', attempt=progress['attempt'] + 1)
                web_log.warning('Mi perfil no terminó de cargar · reintento %s · modelo %s',
                                progress['attempt'], job['creator_id'])
                await recovery_pause(stop_event, min(15, progress['attempt'] * 2))
        else:
            from playwright.async_api import Error as BrowserError
            while not stop_event.is_set():
                try:
                    response = await page.goto(AGENCYKEY_SIGN_IN, wait_until='domcontentloaded', timeout=30000)
                    if response is not None and response.status in (401, 403):
                        return {'status': 'unavailable'}
                    if response is not None and response.status >= 400:
                        await recovery_pause(stop_event)
                        continue
                    break
                except BrowserError:
                    if page.is_closed():
                        return {'status': 'cancelled'}
                    await recovery_pause(stop_event)
            while not page.is_closed() and not stop_event.is_set():
                if await agencykey_login_complete(page):
                    return {'status': 'ready', 'state': await context.storage_state(indexed_db=True)}
                await recovery_pause(stop_event, 1)
            return {'status': 'cancelled'}

    async def execute_and_deliver():
        try:
            result = await open_agencykey()
        except Exception as error:
            web_log.error('Solicitud web de Chrome | %s', recorder.recording_error_detail(error))
            result = {'status': 'connection_error'}
            if job['kind'] == 'feed':
                from diagnostics import redact
                result.update(identity_checked=True, diagnostic={'stage': 'preparar Chrome',
                    'error_type': type(error).__name__, 'error': redact(error),
                    'screenshot_omitted': 'browser_unavailable'})
        # A lost response must resend the same result, never rerun Chrome or create a new job.
        progress['phase'] = 'saving'
        await report(**result)

    running = asyncio.create_task(execute_and_deliver())
    cancelled = asyncio.create_task(check_cancelled())
    try:
        done, _ = await asyncio.wait((running, cancelled), return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in (running, cancelled):
            if not task.done():
                task.cancel()
        await asyncio.gather(running, cancelled, return_exceptions=True)
        if browser_session is None:
            await session.close()


class BrowserPreparation:
    def __init__(self, prepare):
        self.stack = AsyncExitStack()
        self.task = asyncio.create_task(prepare(self.stack))

    async def result(self, stop_event):
        if stop_event:
            while not self.task.done():
                if stop_event.is_set():
                    raise ValueError('Grabación detenida · Pulsa Reintentar para volver a grabar el comprobante')
                await asyncio.wait({self.task}, timeout=0.25)
        return await self.task

    async def close(self):
        self.task.cancel()
        try:
            await asyncio.gather(self.task, return_exceptions=True)
        finally:
            await self.stack.aclose()


class RecordingCoordinator:
    def __init__(self, creator, *, events=None, stop_event=None, session_client=None):
        self.creator, self.events, self.stop_event = creator, events, stop_event
        self.busy = False
        self.session_client = session_client
        self.completion_markup = None
        self.last_recording_step = None
        self.active_photo_wait = None

    def emit(self, event, value):
        if self.events is not None:
            try:
                self.events.put_nowait((event, value))
            except queue.Full:
                pass

    def progress(self, value):
        stage = recording_step(value['stage'])
        self.emit('recording', dict(value, stage=stage))
        if stage != self.last_recording_step:
            log.info('%s', stage)
            self.last_recording_step = stage

    def proof_keyboard(self, action):
        rows = [[action]]
        if self.completion_markup:
            rows.extend(self.completion_markup.keyboard)
        return ReplyKeyboardMarkup(rows, resize_keyboard=True, is_persistent=True)

    def photo_wait_keyboard(self, chat_id):
        if self.active_photo_wait and self.active_photo_wait[0] == chat_id:
            if self.active_photo_wait[1].pending_post is not None:
                return ReplyKeyboardMarkup([[RETRY_RECORDING, CANCEL_RECORDING]], resize_keyboard=True,
                                           is_persistent=True)
        return ReplyKeyboardRemove()

    def control_photo_wait(self, chat_id, *, cancel=False):
        if not self.active_photo_wait or self.active_photo_wait[0] != chat_id:
            return False
        return self.active_photo_wait[1].resume_check(cancel=cancel)

    def prepare_browser(self):
        if not self.session_client:
            return None

        async def prepare(stack):
            shared = await asyncio.to_thread(self.session_client.recording_session)
            page, context = await recorder.open_recording_page(stack, headless=True, storage_state=shared['state'])
            url = recorder.model_profile_url(self.creator.external_id)
            await recorder.navigate_recording_page(page, url, stop_event=self.stop_event)
            if recorder.same_profile_route(page.url, url):
                await recorder.open_my_profile(page)
            return (page, context), shared

        return BrowserPreparation(prepare)

    def job_path(self, chat_id):
        return recorder.ROOT / 'jobs' / f'{int(self.creator.external_id)}-{int(chat_id)}.json'

    @staticmethod
    def missing_ids(batch):
        skipped = set(getattr(batch, 'skipped', ()))
        return [number for number in range(1, len(batch.order) + 1)
                if number not in batch.published_ids and number not in skipped]

    async def start(self, batch, bot, chat_id, application, *, resend=False, preparation=None):
        if self.busy:
            await bot.send_message(chat_id, '🎥 Video en proceso…')
            return
        missing = self.missing_ids(batch)
        if missing:
            await bot.send_message(chat_id, 'Para grabar también los posts manuales, indica sus IDs: '
                                   + ', '.join(map(str, missing)))
            return
        if not batch.published_ids:
            await bot.send_message(chat_id, 'Este Drop no tiene posts publicados')
            return
        path = self.job_path(chat_id)
        previous = json.loads(path.read_text()) if path.exists() else {}
        if previous.get('batch_id') == batch.id:
            if previous.get('status') == 'sent':
                if previous.get('delivered_wall_at') and not previous.get('summary_status'):
                    await self.send_summary(previous, bot, chat_id, path)
                await bot.send_message(chat_id, '✅ Este comprobante ya fue enviado')
                return
            if previous.get('status') in {'sending', 'delivery_unknown'} and not resend:
                await bot.send_message(chat_id, 'Entrega anterior sin confirmar · Revisa el chat y, '
                                       'si no llegó, pulsa Reenviar video',
                                       reply_markup=self.proof_keyboard(RESEND_PROOF))
                return
        self.busy = True
        async def work():
            try:
                await self.run(batch, bot, chat_id, previous if previous.get('batch_id') == batch.id else {},
                               preparation=preparation)
            finally:
                try:
                    if preparation:
                        await preparation.close()
                finally:
                    self.busy = False
        application.create_task(work())
        return True

    def restore_batch(self, chat_id):
        path = self.job_path(chat_id)
        if not path.exists():
            return None
        job = json.loads(path.read_text())
        ids = job.get('post_ids_oldest_first')
        if not isinstance(ids, list) or not ids:
            return None
        return SimpleNamespace(id=job['batch_id'], status='done', creator=self.creator,
                               order=list(range(len(ids))), published_ids={i+1: value for i, value in enumerate(ids)},
                               photo_post_ids=job.get('photo_post_ids', []),
                               post_positions=job.get('post_positions'),
                               started_wall_at=job.get('started_wall_at'), session_total=job.get('session_total', len(ids)),
                               rejected=job.get('rejected', []))

    async def run(self, batch, bot, chat_id, previous=None, *, preparation=None):
        self.last_recording_step = None
        job = dict(previous or {})
        job.update(batch_id=batch.id, chat_id=chat_id, creator_id=int(self.creator.external_id))
        positions = sorted(batch.published_ids)
        job['post_ids_oldest_first'] = [batch.published_ids[n] for n in positions]
        job['post_positions'] = getattr(batch, 'post_positions', None) or positions
        total = len(positions)
        if hasattr(batch, 'received'):
            job['photo_post_ids'] = [batch.published_ids[n] for n, message_id in enumerate(batch.order, 1)
                                     if n in batch.published_ids and message_id in batch.received
                                     and batch.received[message_id].photo_id]
        else:
            job.setdefault('photo_post_ids', getattr(batch, 'photo_post_ids', []))
        job.setdefault('started_wall_at', getattr(batch, 'started_wall_at', None) or time())
        job.setdefault('session_total', getattr(batch, 'session_total', 0) or total)
        job.setdefault('rejected', list(getattr(batch, 'rejected', [])))
        path = self.job_path(chat_id)
        try:
            report_path = Path(job['report']) if job.get('report') else None
            if report_path is not None and not recorder.has_capture_validation(report_path):
                report_path = None
                job.pop('report', None)
            if report_path is None:
                self.progress({'stage': 'preparando comprobante', 'completed': 0, 'total': total})
                job['status'] = 'recording'
                recorder.save_json(path, job)
                try:
                    await bot.send_message(chat_id, '🎥 Preparando video…', reply_markup=ReplyKeyboardRemove())
                except TelegramError:
                    log.warning('Comprobante | No se pudo entregar el aviso inicial; la grabación continúa.')
                ids = [recorder.post_id(pid) for pid in reversed(job['post_ids_oldest_first'])]
                post_numbers = dict(zip(reversed(ids), job['post_positions']))
                config = recorder.validate_config({'profile_url': recorder.model_profile_url(self.creator.external_id),
                                                   'creator_username': self.creator.username,
                                                   'post_ids_newest_first': ids, 'photo_post_ids': job['photo_post_ids']})

                async def notify_photo_wait(post_id):
                    message = (f'⏳ Esperando la foto del post #{post_numbers[post_id]}' if post_id
                               else '▶️ Foto lista. Continuando la grabación')
                    try:
                        await bot.send_message(chat_id, message, reply_markup=self.photo_wait_keyboard(chat_id),
                                               read_timeout=10, write_timeout=10, connect_timeout=10, pool_timeout=10)
                    except TelegramError:
                        log.warning('Comprobante | No se pudo avisar del estado de carga en Telegram.')

                photo_wait = recorder.PhotoWaitControl(notify_photo_wait)
                self.active_photo_wait = (chat_id, photo_wait)
                options = {}
                if self.session_client:
                    self.progress({'stage': 'cargando sesión de AgencyKey', 'completed': 0, 'total': total})
                    shared = None
                    if preparation:
                        try:
                            options['prepared_page'], shared = await preparation.result(self.stop_event)
                        except Exception as error:
                            if self.stop_event and self.stop_event.is_set():
                                raise
                            log.info('No se pudo preparar Chrome (%s). Se abrirá otra sesión para el comprobante.',
                                     type(error).__name__)
                            await preparation.close()
                    if shared is None:
                        shared = await asyncio.to_thread(self.session_client.recording_session)
                    options['session_state'] = shared['state']

                    async def refresh(state):
                        await asyncio.to_thread(self.session_client.refresh_recording_session, state, shared['revision'])
                    options['on_session_saved'] = refresh
                report_path = await recorder.record(config, headless=True,
                    session_path=session_path(self.creator.external_id),
                    on_progress=self.progress, stop_event=self.stop_event, photo_wait=photo_wait, **options)
                job['report'] = str(report_path)
            report, video = recorder.verified_video(report_path)
            self.progress({'stage': 'enviando video', 'completed': len(report['seen']), 'total': len(report['seen'])})
            job['status'] = 'sending'
            recorder.save_json(path, job)
            caption = f'✅ Comprobante · {len(report["seen"])} posts · {self.creator.name}'
            if drm_ids := report.get('drm_photo_ids'):
                protected = set(drm_ids)
                display = [str(number) for number, pid in zip(job['post_positions'], job['post_ids_oldest_first'])
                           if recorder.post_id(pid) in protected]
                numbers = ', '.join(display)
                caption += ('\n🔒 Fotos sin verificar por DRM · Posts ' + numbers if len(numbers) < 800 else
                            f'\n🔒 {len(display)} fotos sin verificar por DRM')
            with video.open('rb') as stream:
                message = await bot.send_video(chat_id=chat_id, video=stream,
                    caption=caption,
                    supports_streaming=True, read_timeout=180, write_timeout=180, connect_timeout=30, pool_timeout=30)
            job.update(status='sent', message_id=message.message_id, delivered_wall_at=time())
            recorder.save_json(path, job)
            if hasattr(batch, 'finished_at'):
                batch.finished_at = monotonic()
            self.progress({'stage': 'enviado', 'completed': len(report['seen']), 'total': len(report['seen'])})
            await self.send_summary(job, bot, chat_id, path)
        except recorder.RecordingCancelled:
            job.update(status='cancelled')
            self.progress({'stage': 'Grabación cancelada', 'completed': 0, 'total': total})
            recorder.save_json(path, job)
            try:
                await bot.send_message(chat_id, '⏹️ Grabación cancelada. Puedes volver a grabar el mismo Drop',
                                       reply_markup=self.proof_keyboard(RETRY_RECORDING))
            except TelegramError:
                pass
        except TelegramError as error:
            uncertain = job.get('status') == 'sending' and not isinstance(error, (BadRequest, Forbidden, RetryAfter))
            detail = 'No se pudo enviar el video a Telegram.'
            import httpx
            from recorder_network import network_failure
            current = error
            for _ in range(8):
                if isinstance(current, httpx.RequestError):
                    diagnosed = network_failure('sendVideo', current)
                    detail = str(diagnosed)
                    uncertain = job.get('status') == 'sending' and diagnosed.uncertain
                    break
                current = current.__cause__ or current.__context__ if current is not None else None
                if current is None:
                    break
            job.update(status='delivery_unknown' if uncertain else 'error', error_type=type(error).__name__)
            if uncertain and 'La entrega no está confirmada' not in detail:
                detail += ' Comprueba si el video llegó antes de reenviarlo.'
            message = detail if uncertain else f'{detail} Pulsa Reintentar video.'
            self.emit('recording', {'stage': message, 'error': True, 'completed': 0, 'total': total})
            log.error('Comprobante | %s | Entrega incierta: %s', detail, uncertain)
            try:
                await bot.send_message(chat_id, '⚠️ Envío sin confirmar · Revisa el chat antes de reenviar'
                                       if uncertain else '❌ No se pudo enviar el video',
                                       reply_markup=self.proof_keyboard(RESEND_PROOF if uncertain else RETRY_DELIVERY))
            except TelegramError:
                pass
        except Exception as error:
            if job.get('status') == 'sent':
                log.exception('El video fue enviado, pero falló el cierre del comprobante.')
                return
            job.pop('report', None)
            job.update(status='error', error_type=type(error).__name__)
            detail = str(error) if isinstance(error, (ValueError, CloudError)) else type(error).__name__
            if detail.startswith('Etapa: '):
                stage, _, reason = detail.removeprefix('Etapa: ').partition('. ')
                message = f'{recording_step(stage)}. {reason}'
            elif isinstance(error, (ValueError, CloudError)):
                message = detail
            else:
                step = self.last_recording_step or 'Preparando el comprobante'
                message = f'{step}. {recorder.recording_error_detail(error)}'
            self.emit('recording', {'stage': message, 'error': True, 'completed': 0, 'total': total})
            log.error('%s', message)
            recorder.save_json(path, job)
            retry = self.proof_keyboard(RETRY_RECORDING)
            try:
                await bot.send_message(chat_id, '❌ ' + message.removesuffix('.'), reply_markup=retry)
            except TelegramError:
                pass
        finally:
            self.active_photo_wait = None
            recorder.save_json(path, job)

    async def send_summary(self, job, bot, chat_id, path):
        if job.get('summary_status') in {'sent', 'delivery_unknown'}:
            return
        seconds = max(0, int(job['delivered_wall_at'] - job['started_wall_at']))
        minutes, seconds = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        elapsed = (f'{hours} h ' if hours else '') + f'{minutes} min {seconds:02d} s'
        text = (f'✅ Drop finalizado · {self.creator.name}\n\n'
                f'📦 Total del Drop: {len(job["post_ids_oldest_first"])}\n\n'
                f'⏱ Tiempo total: {elapsed}\n\n'
                f'🔄 Bot · {self.creator.name}\n\n'
                f'🗂 Total de post: {job["session_total"]} posts')
        if job['rejected']:
            text += f'\n\n⚠️ Mensajes rechazados: {len(job["rejected"])}'
        job['summary_status'] = 'delivery_unknown'
        recorder.save_json(path, job)
        try:
            message = await bot.send_message(chat_id, text, reply_markup=self.completion_markup)
            job.update(summary_status='sent', summary_message_id=message.message_id)
            self.emit('publication_summary', job.get('batch_id'))
        except TelegramError:
            log.warning('Comprobante entregado; no se confirmó el resumen final. No se duplicará el video.')
        recorder.save_json(path, job)
