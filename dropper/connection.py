import os
import socket
import ssl
import sys
from urllib.request import getproxies, proxy_bypass
from urllib.parse import urlsplit

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
    if sys.platform != 'win32':
        return None
    host = urlsplit(url).hostname
    if proxy_bypass(host):
        return None
    proxies = getproxies()
    proxy = proxies.get('https') or proxies.get('all') or proxies.get('http') or proxies.get('socks')
    if proxy and proxy.startswith('socks://'):
        proxy = 'socks5://' + proxy[len('socks://'):]
    return proxy


def network_message(error):
    chain, current = [], error
    while current is not None and len(chain) < 8:
        chain.append(current)
        current = current.__cause__ or current.__context__
    details = ' '.join(str(item).lower() for item in chain)
    prefix = 'No se pudo conectar para descargar las configuraciones'
    if any(isinstance(item, ssl.SSLCertVerificationError) for item in chain) or 'certificate verify failed' in details or 'certificate_verify_failed' in details:
        return prefix + ': Windows no pudo validar el certificado HTTPS. Revisa la fecha del equipo y los certificados de tu red.'
    if isinstance(error, httpx.TimeoutException):
        return prefix + ': se agotó el tiempo de espera. Revisa la conexión o el VPN.'
    if any(isinstance(item, socket.gaierror) for item in chain) or any(term in details for term in ('getaddrinfo failed', 'name resolution', 'name or service not known')):
        return prefix + ': no se pudo resolver la dirección (DNS).'
    if isinstance(error, httpx.ProxyError):
        return prefix + ': el proxy configurado no responde.'
    if isinstance(error, httpx.ConnectError):
        return prefix + ': la conexión fue rechazada o bloqueada por la red.'
    return prefix + ': la conexión HTTPS se interrumpió.'
