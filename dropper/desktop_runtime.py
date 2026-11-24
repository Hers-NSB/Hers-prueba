import asyncio
import logging
import threading
from uuid import uuid4
from collections.abc import Callable

log = logging.getLogger('agencykey-recorder')


async def run_application(application, startup, stop_event, on_ready):

    async with application:
        if stop_event.is_set():
            return
        await startup(application)
        if stop_event.is_set():
            return
        await application.start()
        try:
            def polling_error(error):
                application.create_task(application.process_error(update=None, error=error))

            await application.updater.start_polling(
                allowed_updates=['message'], error_callback=polling_error,
            )
            on_ready()
            while not stop_event.is_set():
                await asyncio.sleep(0.2)
        finally:
            if application.updater.running:
                await application.updater.stop()
            if application.running:
                await application.stop()


class BotController:
    def __init__(self, events, runner=None, credentials=None, credential_loader=None, creator=None, session_client=None):
        self.credentials = credentials
        self.credential_loader = credential_loader
        self.creator = creator
        self.session_client = session_client
        self.thread_name = f"dropper-{uuid4().hex[:10]}"
        self.events = events
        self.runner = runner or self._run_bot
        self.stop_event = threading.Event()
        self.thread = None

    @property
    def running(self):
        return self.thread is not None and self.thread.is_alive()

    def start(self):
        if self.running:
            return False
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._work, name=self.thread_name, daemon=True)
        self.thread.start()
        return True

    def stop(self):
        if self.running:
            self.stop_event.set()

    def _work(self):
        failed = False
        try:
            self.runner(self.stop_event, lambda: self.events.put(('ready', None)))
        except SystemExit as error:
            failed = bool(error.code)
        except Exception:
            failed = True
            log.exception('El bot terminó con un error inesperado.')
        finally:
            self.credentials = None
            self.events.put(('stopped', failed))

    def _run_bot(self, stop_event: threading.Event, on_ready: Callable[[], None]):
        from main import main
        from agencykey import Creator
        from config import register_secrets
        telegram_users = ()
        if self.credential_loader:
            profile = self.credential_loader()
            self.credentials = (profile['telegram_token'], profile['api_key'])
            self.creator = Creator(**profile['creator'])
            telegram_users = profile.get('telegram_users', ())
            register_secrets(*self.credentials)
            self.events.put(('setup_stage', self.creator.name))
        if not stop_event.is_set():
            main(stop_event=stop_event, on_ready=on_ready, credentials=self.credentials, creator=self.creator,
                 recording_events=self.events, recording_session_client=self.session_client,
                 telegram_users=telegram_users)
