"""Windows entry point: desktop by default, legacy recorder commands on demand."""
import sys


def main():
    # Frozen Python can otherwise use the Windows ANSI code page for redirected logs.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    if len(sys.argv) == 1 or sys.argv[1] in {'--smoke-test', '--screenshot', '--version', '--connection-test'}:
        from desktop import main as desktop_main
        desktop_main()
    else:
        if getattr(sys, 'frozen', False) and not (
            sys.argv[1] in {'demo', 'check-chrome', '--check-telegram-support'}
        ):
            raise SystemExit('Abre la aplicación para verificar y grabar desde el panel.')
        from recorder import main as recorder_main
        recorder_main()


if __name__ == '__main__':
    main()
