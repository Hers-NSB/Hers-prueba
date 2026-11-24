import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from time import monotonic, time
from uuid import uuid4

from agencykey import AgencyKey, AgencyKeyError, Creator, PublishRateLimited, UnconfirmedPost
from config import log


@dataclass(frozen=True)
class Post:
    text: str
    photo_id: str | None


@dataclass
class SessionStats:
    automatic: int = 0
    manual: int = 0

    @property
    def total(self) -> int:
        return self.automatic + self.manual


@dataclass
class Batch:
    creator: Creator
    id: str = field(default_factory=lambda: uuid4().hex)
    rejected: set[int] = field(default_factory=set)
    cleanup_ids: set[int] = field(default_factory=set)
    received: dict[int, Post] = field(default_factory=dict)
    order: list[int] = field(default_factory=list)
    cursor: int = 0
    attempt: int = 0
    status: str = "collecting"
    error: str = ""
    uncertain: bool = False
    manual: list[int] = field(default_factory=list)
    skipped: list[int] = field(default_factory=list)
    published_ids: dict[int, str] = field(default_factory=dict)
    failed: bool = False
    recovery_delivered: bool = False
    started_at: float | None = None
    finished_at: float | None = None
    started_wall_at: float | None = None
    session_total: int = 0
    slow: bool = False
    retry_at: float | None = None
    awaiting_confirmation: bool = False

    def start_timer(self) -> None:
        if self.started_at is None:
            self.started_at = monotonic()
            self.started_wall_at = time()

    @property
    def elapsed_text(self) -> str:
        if self.started_at is None:
            return "0 min 00 s"
        end = self.finished_at if self.finished_at is not None else monotonic()
        total = max(0, int(end - self.started_at))
        minutes, seconds = divmod(total, 60)
        hours, minutes = divmod(minutes, 60)
        prefix = f"{hours} h " if hours else ""
        return f"{prefix}{minutes} min {seconds:02d} s"

    @property
    def confirmed(self) -> int:
        return self.cursor - len(self.manual) - len(self.skipped)

    @property
    def rejected_mention(self) -> str | None:
        if self.error.startswith("AgencyKey respondió HTTP 400"):
            match = re.search(r"You cannot tag (@[a-zA-Z0-9_]+)", self.error, re.IGNORECASE)
            if match:
                return match[1]
        return None

    def confirm_manual(self) -> None:
        self.resolve_failed_post(self.manual)

    def skip_failed_post(self) -> None:
        self.resolve_failed_post(self.skipped)

    def resolve_failed_post(self, positions: list[int]) -> None:
        if self.status != "paused" or not self.failed or self.cursor >= len(self.order):
            raise ValueError("No hay una publicación fallida pendiente.")
        positions.append(self.cursor + 1)
        self.cursor += 1
        self.failed = False
        self.awaiting_confirmation = False
        self.recovery_delivered = False
        self.uncertain = False
        self.error = ""

    async def publish(
        self, agencykey: AgencyKey, download_photo: Callable[[str], Awaitable[bytes]],
        notify: Callable[[str], Awaitable[None]] | None = None,
        session: SessionStats | None = None,
        on_stage: Callable[[str], None] | None = None,
        checkpoint: Callable[[], None] = lambda: None,
    ) -> None:
        self.start_timer()
        self.retry_at = None
        self.attempt += 1
        self.status = "publishing"
        checkpoint()
        self.error = ""
        self.uncertain = False
        self.failed = False
        self.recovery_delivered = False
        log.info("Drop %s | Intento %d | %d automáticos | %d manuales | %d en total.",
                 self.id, self.attempt, self.confirmed, len(self.manual), len(self.order))
        if on_stage:
            on_stage("Preparando publicación")
        while self.cursor < len(self.order):
            if getattr(agencykey, "stop_requested", lambda: False)():
                self.status = "paused"
                self.error = "Parada solicitada desde la ventana. Los posts pendientes no se enviarán."
                log.warning("Drop %s | %s", self.id, self.error)
                checkpoint()
                return
            post = self.received[self.order[self.cursor]]
            if notify:
                await notify(f"📤 Publicando post #{self.cursor + 1} de {len(self.order)} · {self.creator.name}")
            try:
                if post.photo_id:
                    log.info("Drop %s | Post #%d | Descargando foto de Telegram.", self.id, self.cursor + 1)
                    if on_stage:
                        on_stage("Descargando foto de Telegram")
                    photo = await download_photo(post.photo_id)
                    if on_stage:
                        on_stage("Subiendo foto a AgencyKey")
                    self.awaiting_confirmation = True
                    checkpoint()
                    post_id = await agencykey.publish_photo(self.creator.external_id, post.text, photo, slow=self.slow)
                else:
                    if on_stage:
                        on_stage("Creando post en AgencyKey")
                    self.awaiting_confirmation = True
                    checkpoint()
                    post_id = await agencykey.publish_text(self.creator.external_id, post.text,
                                                           expire=True, slow=self.slow)
            except PublishRateLimited as error:
                self.status = "paused"
                self.error = str(error)
                self.retry_at = error.retry_at
                self.awaiting_confirmation = False
                checkpoint()
                log.warning("Drop %s | %s", self.id, self.error)
                return
            except AgencyKeyError as error:
                self.status = "paused"
                self.failed = True
                self.error = str(error)
                self.uncertain = isinstance(error, UnconfirmedPost)
                self.awaiting_confirmation = self.uncertain
                checkpoint()
                log.error("Drop %s | Post #%d | %s", self.id, self.cursor + 1, self.error)
                if self.uncertain:
                    log.warning("Drop %s | Resultado sin confirmar: revisa el feed antes de continuar.", self.id)
                return
            except Exception as error:
                self.status = "paused"
                self.failed = True
                self.error = f"Error inesperado ({type(error).__name__}). Revisa la consola."
                self.uncertain = True
                checkpoint()
                log.exception("Drop %s | Post #%d | Error inesperado.", self.id, self.cursor + 1)
                return
            self.published_ids[self.cursor + 1] = str(post_id)
            self.cursor += 1
            self.awaiting_confirmation = False
            checkpoint()
            if session is not None:
                session.automatic += 1
            log.info("Drop %s | Post #%d confirmado | ID %s.", self.id, self.cursor, post_id)
            if on_stage:
                on_stage("Publicación confirmada")
            if notify:
                await notify(f"✅ Post #{self.cursor} confirmado")
        self.status = "done"
        self.finished_at = monotonic()
        checkpoint()
        log.info("Drop %s completado | %d automáticas | %d manuales | Tiempo total: %s.",
                 self.id, self.confirmed, len(self.manual), self.elapsed_text)
