import ctypes
import sys
from ctypes import wintypes

TARGET = 'HersPruebaDropper/Cloudflare/v1'


class CredentialStore:
    def __init__(self, target=TARGET):
        self.target = target

    @staticmethod
    def api():
        if sys.platform != 'win32':
            raise OSError('El guardado de acceso requiere Windows')
        class Credential(ctypes.Structure):
            _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD),
                        ('TargetName', wintypes.LPWSTR), ('Comment', wintypes.LPWSTR),
                        ('LastWritten', wintypes.FILETIME), ('CredentialBlobSize', wintypes.DWORD),
                        ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)), ('Persist', wintypes.DWORD),
                        ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p),
                        ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR)]
        library = ctypes.WinDLL('Advapi32.dll', use_last_error=True)
        library.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                     ctypes.POINTER(ctypes.POINTER(Credential))]
        library.CredReadW.restype = wintypes.BOOL
        library.CredWriteW.argtypes = [ctypes.POINTER(Credential), wintypes.DWORD]
        library.CredWriteW.restype = wintypes.BOOL
        library.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        library.CredDeleteW.restype = wintypes.BOOL
        library.CredFree.argtypes = [ctypes.c_void_p]
        library.CredFree.restype = None
        return library, Credential

    def read(self):
        library, kind = self.api()
        pointer = ctypes.POINTER(kind)()
        if not library.CredReadW(self.target, 1, 0, ctypes.byref(pointer)):
            error = ctypes.get_last_error()
            if error == 1168:
                return None
            raise ctypes.WinError(error)
        try:
            item = pointer.contents
            return ctypes.string_at(item.CredentialBlob, item.CredentialBlobSize).decode('utf-8')
        finally:
            library.CredFree(pointer)

    def write(self, value):
        library, kind = self.api()
        raw = value.encode('utf-8')
        buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
        item = kind(Type=1, TargetName=self.target, UserName='Dropper', CredentialBlobSize=len(raw),
                    CredentialBlob=buffer, Persist=2)
        if not library.CredWriteW(ctypes.byref(item), 0):
            raise ctypes.WinError(ctypes.get_last_error())

    def delete(self):
        library, _ = self.api()
        if not library.CredDeleteW(self.target, 1, 0) and ctypes.get_last_error() != 1168:
            raise ctypes.WinError(ctypes.get_last_error())
