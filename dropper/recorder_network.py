"""HTTPS settings and safe Telegram errors for the Windows recorder."""
import os
import socket
import ssl
import sys
from urllib.parse import urlsplit
from urllib.request import getproxies, proxy_bypass

import httpx


def tls_context():
    if sys.platform != 'win32':
        return True
    import truststore
    context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if os.environ.get('SSL_CERT_FILE') or os.environ.get('SSL_CERT_DIR'):
        context.load_verify_locations(cafile=os.environ.get('SSL_CERT_FILE'),
                                      capath=os.environ.get('SSL_CERT_DIR'))
    return context


def system_proxy(url):
    if sys.platform != 'win32' or proxy_bypass(urlsplit(url).hostname):
        return None
    proxies = getproxies()
    proxy = proxies.get('https') or proxies.get('all') or proxies.get('http') or proxies.get('socks')
    if proxy and proxy.startswith('socks://'):
        proxy = 'socks5://' + proxy[len('socks://'):]
    return proxy


def telegram_connection_options():
    try:
        options = {'verify': tls_context()}
        proxy = system_proxy('https://api.telegram.org')
        if proxy:
            options['proxy'] = proxy
        return options
    except (ImportError, OSError, ValueError):
        raise ValueError('Telegram: no se pudieron preparar los certificados o el proxy de Windows. Usa el EXE actualizado.') from None


async def check_telegram_support():
    # Exercise native TLS and packaged SOCKS support without contacting any server.
    options = telegram_connection_options()
    async with httpx.AsyncClient(**options):
        pass
    async with httpx.AsyncClient(verify=options['verify'], proxy='socks5://127.0.0.1:9'):
        pass
    print('Certificados del sistema y soporte de proxy de Telegram disponibles.')


STAGES = {'getMe': 'comprobar bot', 'getWebhookInfo': 'comprobar webhook',
          'getUpdates': 'buscar chat de destino', 'sendVideo': 'enviar video'}


class TelegramFailure(ValueError):
    def __init__(self, method, category, reason, *, uncertain=False):
        self.method, self.category, self.uncertain = method, category, uncertain
        message = f'Telegram · {STAGES[method]}: {reason}'
        if uncertain:
            message += ' La entrega no está confirmada; revisa el chat antes de reenviar.'
        super().__init__(message)


def network_failure(method, error):
    chain, current = [], error
    while current is not None and len(chain) < 8 and all(current is not old for old in chain):
        chain.append(current)
        current = current.__cause__ or current.__context__
    details = ' '.join(str(item).lower() for item in chain)
    if any(isinstance(item, ssl.SSLCertVerificationError) for item in chain) or 'certificate_verify_failed' in details or 'certificate verify failed' in details:
        return TelegramFailure(method, 'certificate', 'Windows no pudo validar el certificado HTTPS.')
    if any(isinstance(item, socket.gaierror) for item in chain) or any(word in details for word in ('getaddrinfo failed', 'name resolution', 'name or service not known')):
        return TelegramFailure(method, 'dns', 'no se pudo resolver api.telegram.org (DNS).')
    if isinstance(error, httpx.ProxyError):
        return TelegramFailure(method, 'proxy', 'el proxy configurado no pudo establecer la conexión.')
    if isinstance(error, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
        return TelegramFailure(method, 'connect', 'no se pudo establecer la conexión; la solicitud no se envió.')
    if isinstance(error, httpx.WriteTimeout):
        return TelegramFailure(method, 'write_timeout', 'se agotó el tiempo al subir el archivo.', uncertain=method == 'sendVideo')
    if isinstance(error, httpx.ReadTimeout):
        return TelegramFailure(method, 'read_timeout', 'se agotó el tiempo esperando la respuesta.', uncertain=method == 'sendVideo')
    return TelegramFailure(method, 'interrupted', 'la conexión HTTPS se interrumpió.', uncertain=method == 'sendVideo')


async def telegram_request(client, method, **kwargs):
    try:
        response = await client.post(method, **kwargs)
    except httpx.RequestError as error:
        raise network_failure(method, error) from None
    try:
        body = response.json()
    except ValueError:
        raise TelegramFailure(method, 'invalid_response', 'el servicio devolvió una respuesta inválida.',
                              uncertain=method == 'sendVideo') from None
    if not isinstance(body, dict):
        raise TelegramFailure(method, 'invalid_response', 'el servicio devolvió una respuesta inválida.',
                              uncertain=method == 'sendVideo')
    if not response.is_success or body.get('ok') is not True:
        status = response.status_code
        reason = {400: 'la solicitud fue rechazada; revisa el archivo y el chat.',
                  401: 'el token del bot no es válido.', 403: 'el bot no tiene permiso para escribir en ese chat.',
                  409: 'otro receptor está usando este bot; detén su otra instancia.',
                  413: 'el archivo supera el tamaño admitido.',
                  429: 'Telegram limitó temporalmente las solicitudes.'}.get(status, 'Telegram rechazó la solicitud.')
        raise TelegramFailure(method, f'http_{status}', f'HTTP {status}: {reason}',
                              uncertain=method == 'sendVideo' and status >= 500)
    result = body.get('result')
    valid = isinstance(result, list) if method == 'getUpdates' else isinstance(result, dict)
    if method == 'sendVideo':
        valid = valid and type(result.get('message_id')) is int and result['message_id'] > 0
    if method == 'getMe':
        valid = valid and isinstance(result.get('username'), str) and bool(result['username'])
    if not valid:
        raise TelegramFailure(method, 'invalid_result', 'la respuesta no contiene una confirmación válida.',
                              uncertain=method == 'sendVideo')
    return result
