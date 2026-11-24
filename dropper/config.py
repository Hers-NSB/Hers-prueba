import logging
import os
import sys

SECRETS = set()

def register_secrets(*values):
    SECRETS.update(value for value in values if value)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        message = super().format(record)
        for variable in ("TELEGRAM_TOKEN", "AGENCYKEY_API_KEY"):
            secret = os.getenv(variable, "").strip()
            if secret:
                message = message.replace(secret, "[oculto]")
        for secret in tuple(SECRETS):
            message = message.replace(secret, "[oculto]")
        return "\n".join(line.rstrip(".") for line in message.split("\n"))


console = logging.StreamHandler() if sys.stderr is not None else logging.NullHandler()
console.setFormatter(ConsoleFormatter("%(asctime)s %(levelname)s %(name)s | %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[console])
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("agencykey-recorder")
