import asyncio
from threading import Event, Thread

from telegram.ext import ApplicationBuilder

import bot
from agencykey import AgencyKey, AgencyKeyError
from config import log


def main(stop_event=None, on_ready=None, credentials=None, creator=None, recording_events=None,
         recording_session_client=None, telegram_users=()) -> None:
    if not credentials or creator is None:
        raise ValueError("Configura el bot y su modelo desde la app de escritorio")
    if stop_event is not None and stop_event.is_set():
        return
    token, api_key = credentials
    from recorder_network import telegram_connection_options
    from recording_service import RecordingCoordinator
    from telegram.request import HTTPXRequest
    options = telegram_connection_options()
    proxy = options.pop('proxy', None)
    from batch_journal import BatchJournal
    journal = BatchJournal(token.split(':', 1)[0])
    recording = RecordingCoordinator(creator, events=recording_events, stop_event=stop_event,
                                     session_client=recording_session_client,
                                     journal=journal if recording_session_client is not None else None)
    agencykey = AgencyKey(api_key)
    if stop_event is not None:
        agencykey.stop_requested = stop_event.is_set

    async def on_startup(application):
        creators = await agencykey.list_creators()
        selected = next((item for item in creators if item.external_id == creator.external_id), None)
        if selected is None:
            raise AgencyKeyError("La modelo configurada ya no está disponible para esta clave")
        log.info("Bot conectado · Modelo fija: %s · Ejecución local", selected.name)

    sync_stop = Event()
    try:
        app = (
            ApplicationBuilder()
            .token(token)
            .request(HTTPXRequest(proxy=proxy, httpx_kwargs=options, read_timeout=180, write_timeout=180))
            .get_updates_request(HTTPXRequest(proxy=proxy, httpx_kwargs=options, read_timeout=45))
            .concurrent_updates(False)
            .post_init(on_startup)
            .build()
        )
        bot.register(app, agencykey, creator, recording, events=recording_events,
                     telegram_users=telegram_users, journal=journal,
                     publication_reporting=recording_session_client is not None)
        if recording_session_client is not None:
            Thread(target=journal.sync_publications, args=(recording_session_client, sync_stop),
                   name="dropper-publications", daemon=True).start()
        log.info("Iniciando Dropper.")
        if stop_event is None:
            app.run_polling(allowed_updates=["message"])
        else:
            from desktop_runtime import run_application
            asyncio.run(run_application(app, on_startup, stop_event, on_ready or (lambda: None)))
    except Exception:
        log.exception("Dropper se detuvo durante el arranque o la ejecución.")
        raise SystemExit(1) from None
    finally:
        sync_stop.set()
    log.info("Dropper detenido.")
