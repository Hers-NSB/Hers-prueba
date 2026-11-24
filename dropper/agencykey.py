import asyncio
import json
import re
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from secrets import randbelow
from time import monotonic, time
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from config import log
from app_paths import resource_path


API_URL = "https://app.agencykey.com/api"
STORAGE_HOST = "of2transcoder.s3-accelerate.amazonaws.com"
CONVERTER_URL = "https://convert.onlyfans.com/file/upload"
PUBLISH_INTERVAL_SECONDS = 11.0
SLOW_PUBLISH_INTERVAL_SECONDS = 2 * PUBLISH_INTERVAL_SECONDS


@dataclass(frozen=True)
class Creator:
    external_id: int
    name: str
    username: str | None


class AgencyKeyError(Exception):
    pass


class PublishRateLimited(AgencyKeyError):
    def __init__(self, retry_after: str = "", *, retry_at: float | None = None):
        try:
            seconds = int(retry_after)
        except ValueError:
            try:
                seconds = parsedate_to_datetime(retry_after).timestamp() - time()
            except (ValueError, OverflowError):
                seconds = 60
        self.retry_at = retry_at if retry_at is not None else monotonic() + max(1, seconds)
        super().__init__("El servicio limitó temporalmente las publicaciones. El lote quedó en pausa.")


class UnconfirmedPost(AgencyKeyError):
    pass


class AgencyKey:
    def __init__(self, api_key: str):
        self.stop_requested = lambda: False
        self._publish_locks: dict[int, asyncio.Lock] = {}
        self._last_publish_finished: dict[int, float] = {}
        self._retry_at: dict[int, float] = {}
        self.headers = {
            "x-public-api-key": api_key,
            "Accept": "application/json",
        }

    async def list_creators(self, search: str = "") -> list[Creator]:
        creators: dict[int, Creator] = {}
        page = 1
        async with httpx.AsyncClient(
            base_url=API_URL, headers=self.headers, timeout=30
        ) as client:
            while True:
                params = {"page": page, "limit": 100}
                if search:
                    params["search"] = search
                try:
                    response = await client.get("/v1/onlyfans/creators", params=params)
                    response.raise_for_status()
                    data = response.json()
                    for item in data["data"]:
                        account = item.get("account") or {}
                        external_id = account.get("externalId")
                        if type(external_id) is int and external_id > 0:
                            creators[external_id] = Creator(
                                external_id, item["name"], account.get("username")
                            )
                    if page >= data.get("pagination", {}).get("pages", 1):
                        break
                except httpx.HTTPStatusError as error:
                    raise AgencyKeyError(self._http_message(error.response.status_code)) from error
                except (httpx.RequestError, ValueError, KeyError, TypeError, AttributeError) as error:
                    raise AgencyKeyError("No se pudo leer la lista de modelos de AgencyKey.") from error
                page += 1
        return list(creators.values())

    async def publish_photo(self, external_id: int, text: str, photo: bytes, *, slow: bool = False) -> int:
        if self.stop_requested():
            raise AgencyKeyError("Parada solicitada desde la ventana. No se envió este post.")
        if photo.startswith(b"\xff\xd8\xff"):
            extension, content_type = "jpg", "image/jpeg"
        elif photo.startswith(b"\x89PNG\r\n\x1a\n"):
            extension, content_type = "png", "image/png"
        else:
            raise AgencyKeyError("La foto descargada debe ser JPEG o PNG.")

        self._check_rate_limit(external_id)
        try:
            attachment = await self._upload_photo(external_id, photo, extension, content_type)
        except PublishRateLimited as error:
            self._remember_rate_limit(external_id, error)
            raise
        return await self._publish(external_id, {
            "text": text, "mediaFiles": [attachment], "expireDays": 1,
        }, slow=slow)

    async def _upload_photo(
        self, external_id: int, photo: bytes, extension: str, content_type: str
    ) -> dict[str, str]:
        base = f"/v1/onlyfans/{external_id}/api2/v2"
        filename = f"dropper-{uuid4().hex}.{extension}"
        key = f"upload/{uuid4()}/{randbelow(10**12):012d}/{filename}"
        step = "Configuración de la modelo"
        try:
            async with (
                httpx.AsyncClient(base_url=API_URL, headers=self.headers, timeout=30) as api,
                httpx.AsyncClient(timeout=60) as media,
            ):
                response = await api.get(f"{base}/users/me")
                if response.status_code == 400:
                    profile = self._saved_upload_profile(external_id)
                    log.warning(
                        "AgencyKey | Modelo %s | Configuración HTTP 400%s. Usando los ajustes guardados de esta modelo.",
                        external_id,
                        self._error_detail(response),
                    )
                else:
                    response.raise_for_status()
                    profile = response.json()
                settings = profile["upload"]["geoUploadArgs"]
                if (
                    str(profile["id"]) != str(external_id)
                    or str(settings["additional"]["user"]) != str(external_id)
                ):
                    raise AgencyKeyError("AgencyKey devolvió ajustes de otra modelo.")
                fields = {
                    "preset": settings["preset"],
                    "isDelay": str(settings["isDelay"]).lower(),
                    "needThumbs": str(settings["needThumbs"]).lower(),
                    "additional[user]": str(external_id),
                }
                if profile.get("hasWatermarkPhoto"):
                    fields["watermark[text]"] = profile["watermarkText"]
                    fields["watermark[position]"] = profile["watermarkPosition"]

                step = "Carga firmada"
                response = await api.post(f"{base}/upload/signed/create", json={
                    "key": key,
                    "parts": 1,
                    "contentType": content_type,
                    "secure": False,
                    "userPrefix": "upload",
                })
                response.raise_for_status()
                signed = response.json()
                put_url = signed["putUrl"]
                destination = urlsplit(put_url)
                if (
                    destination.scheme != "https" or destination.netloc != STORAGE_HOST
                    or not destination.path or not destination.query
                ):
                    raise AgencyKeyError("La carga firmada devolvió un destino de almacenamiento inesperado.")
                log.info("AgencyKey | Modelo %s | %s | HTTP %d.", external_id, step, response.status_code)

                step = "Subida a S3"
                response = await media.put(put_url, content=photo, headers={"Content-Type": content_type})
                response.raise_for_status()
                etag = response.headers["ETag"]
                log.info("AgencyKey | Modelo %s | %s | HTTP %d.", external_id, step, response.status_code)

                step = "Procesamiento de la foto"
                fields.update({
                    "file[ETag]": etag,
                    "file[Location]": destination._replace(query="", fragment="").geturl(),
                    "file[Key]": signed["key"],
                    "file[Bucket]": "of2transcoder",
                    "file[name]": filename,
                    "file[uploadToken]": signed["uploadToken"],
                })
                response = await media.post(
                    CONVERTER_URL,
                    headers={"Accept": "application/json"},
                    files={name: (None, value) for name, value in fields.items()},
                )
                response.raise_for_status()
                processed = response.json()
                attachment = {field: processed[field] for field in ("processId", "host", "extra")}
                if not all(isinstance(value, str) and value for value in attachment.values()):
                    raise ValueError("Adjunto incompleto")
                log.info("AgencyKey | Modelo %s | %s | HTTP %d.", external_id, step, response.status_code)
                return {**attachment, "name": filename}
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            if status == 429:
                raise PublishRateLimited(error.response.headers.get("Retry-After", "")) from error
            if step == "Configuración de la modelo":
                raise AgencyKeyError(f"{step}: la consulta de perfil respondió HTTP {status}.") from error
            if step in {"Carga firmada", "Procesamiento de la foto"}:
                detail = self._error_detail(error.response)
                log.error("AgencyKey | Modelo %s | %s | HTTP %d%s.", external_id, step, status, detail)
                raise AgencyKeyError(
                    f"{step}: HTTP {status}. Revisa el detalle en la consola."
                ) from error
            raise AgencyKeyError(f"{step}: HTTP {status}.") from error
        except httpx.RequestError as error:
            raise AgencyKeyError(f"{step}: error de red ({type(error).__name__}).") from error
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise AgencyKeyError(f"{step}: respuesta incompleta o inesperada de AgencyKey.") from error

    @staticmethod
    def _error_detail(response: httpx.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return " | Sin detalle JSON"
        if not isinstance(body, dict):
            return " | Sin detalle JSON"

        details = body.get("details")
        upstream = body.get("error")
        code = details.get("errorCode") if isinstance(details, dict) else None
        message = body.get("message")
        if isinstance(details, dict):
            message = message or details.get("message")
        if isinstance(upstream, str):
            message = message or upstream
        if isinstance(upstream, dict):
            code = code or upstream.get("code")
            message = message or upstream.get("message")
        if isinstance(message, list):
            message = " | ".join(item for item in message[:3] if isinstance(item, str))

        result = ""
        if isinstance(code, (str, int)) and re.fullmatch(r"[A-Za-z0-9_-]{1,48}", str(code)):
            result += f" | Código {code}"
        if isinstance(message, str) and message.strip():
            message = " ".join(message.split())
            message = re.sub(r"https?://[^\s]+", "[URL oculta]", message, flags=re.IGNORECASE)
            message = re.sub(
                r"(?i)\b(?:authorization|cookie|token|signature|secret|password|credential|api[-_ ]?key)"
                r"\s*[:=].*",
                "[credencial oculta]",
                message,
            )
            message = re.sub(r"\bagk_[A-Za-z0-9_-]+", "[clave oculta]", message)
            message = re.sub(r"\b\d{6,16}:[A-Za-z0-9_-]{20,}\b", "[token oculto]", message)
            result += f" | Detalle: {message[:240]}"
        return result or " | Sin código ni mensaje en la respuesta"

    @staticmethod
    def _saved_upload_profile(external_id: int) -> dict:
        path = resource_path("agencykey-perfiles.json")
        try:
            profiles = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise AgencyKeyError(
                "Configuración de la modelo: HTTP 400 y no se pudo leer agencykey-perfiles.json."
            ) from error
        profile = profiles.get(str(external_id)) if isinstance(profiles, dict) else None
        if not isinstance(profile, dict):
            raise AgencyKeyError(
                "Configuración de la modelo: HTTP 400 y no hay ajustes guardados para esta modelo."
            )
        return profile

    async def publish_text(self, external_id: int, text: str, *, expire: bool = False, slow: bool = False) -> int:
        payload = {"text": text}
        if expire:
            payload["expireDays"] = 1
        return await self._publish(external_id, payload, slow=slow)

    def _check_rate_limit(self, external_id: int) -> None:
        retry_at = self._retry_at.get(external_id)
        if retry_at is not None and retry_at > monotonic():
            raise PublishRateLimited(retry_at=retry_at)

    def _remember_rate_limit(self, external_id: int, error: PublishRateLimited) -> None:
        self._retry_at[external_id] = max(self._retry_at.get(external_id, 0), error.retry_at)

    async def _publish(self, external_id: int, payload: dict, *, slow: bool = False) -> int:
        lock = self._publish_locks.setdefault(external_id, asyncio.Lock())
        async with lock:
            self._check_rate_limit(external_id)
            if self.stop_requested():
                raise AgencyKeyError("Parada solicitada desde la ventana. No se envió este post.")
            last_finished = self._last_publish_finished.get(external_id)
            if last_finished is not None:
                interval = SLOW_PUBLISH_INTERVAL_SECONDS if slow else PUBLISH_INTERVAL_SECONDS
                remaining = interval - (monotonic() - last_finished)
                if remaining > 0:
                    log.info("AgencyKey | Modelo %s | Esperando %.1f segundos entre publicaciones.",
                             external_id, remaining)
                    await asyncio.sleep(remaining)
            if self.stop_requested():
                raise AgencyKeyError("Parada solicitada desde la ventana. No se envió este post.")
            self._check_rate_limit(external_id)
            try:
                return await self._publish_once(external_id, payload)
            except PublishRateLimited as error:
                self._remember_rate_limit(external_id, error)
                raise
            finally:
                self._last_publish_finished[external_id] = monotonic()

    async def _publish_once(self, external_id: int, payload: dict) -> int:
        log.info("AgencyKey | Modelo %s | Creando post | Foto: %s.", external_id, "mediaFiles" in payload)
        try:
            async with httpx.AsyncClient(
                base_url=API_URL, headers=self.headers, timeout=60
            ) as client:
                response = await client.post(
                    f"/v1/onlyfans/{external_id}/api2/v2/posts", json=payload
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            detail = self._error_detail(error.response)
            api_key = self.headers.get("x-public-api-key", "")
            if api_key:
                detail = detail.replace(api_key, "[clave oculta]")
            message = f"{self._http_message(status)}{detail}"
            log.error(
                "AgencyKey | Modelo %s | Creando post | HTTP %d | Texto: %d caracteres | Adjuntos: %d%s",
                external_id, status, len(payload.get("text", "")),
                len(payload.get("mediaFiles", [])), detail,
            )
            if status == 429:
                raise PublishRateLimited(error.response.headers.get("Retry-After", "")) from error
            if status in {400, 401, 403, 404, 422}:
                raise AgencyKeyError(message) from error
            raise UnconfirmedPost(message) from error
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as error:
            raise AgencyKeyError("No se pudo conectar con AgencyKey. Revisa tu conexión.") from error
        except httpx.RequestError as error:
            raise UnconfirmedPost("La conexión se interrumpió durante la publicación.") from error

        try:
            data = response.json()
            post_id = data["id"]
            if "mediaFiles" in payload and data.get("mediaCount") == 0:
                raise UnconfirmedPost("AgencyKey creó un post sin confirmar la foto. Revisa el feed.")
            if type(post_id) is int and post_id > 0:
                return post_id
            if isinstance(post_id, str) and post_id.isascii() and post_id.isdecimal():
                if int(post_id) > 0:
                    return int(post_id)
        except (ValueError, KeyError, TypeError):
            pass
        raise UnconfirmedPost("AgencyKey respondió sin un ID de publicación válido.")

    @staticmethod
    def _http_message(status: int) -> str:
        actions = {
            400: "La solicitud de publicación fue rechazada.",
            401: "Revisa la clave de API.",
            403: "Revisa los permisos de la clave para esta cuenta.",
            404: "Verifica que la cuenta y la ruta estén disponibles.",
            422: "La solicitud no pasó la validación del servicio.",
            429: "Espera unos minutos antes de reintentar.",
        }
        return f"AgencyKey respondió HTTP {status}. {actions.get(status, 'Revisa el servicio.')}"
