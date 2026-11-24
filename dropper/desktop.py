import argparse
import asyncio
import json
import os
import tempfile
import logging
import math
import queue
import sys
import threading
from time import monotonic
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk

from PIL import Image, ImageTk

from app_paths import resource_path
from cloud_client import CloudClient, CloudError, AccessDenied
from credential_store import CredentialStore
from desktop_runtime import BotController
from config import ConsoleFormatter

BG = '#0b0b0a'
SURFACE = '#171614'
PANEL = '#2a2420'
BORDER = '#493a30'
TEXT = '#f2ede7'
MUTED = '#b3a49a'
ACCENT = '#c7a78d'
ACCENT_HOVER = '#dfc8b4'
HOVER = '#392f28'
DISABLED = '#211e1b'
DISABLED_TEXT = '#8f8379'
SELECTION = '#5e4839'
GREEN = '#a0c6a7'
WARNING = '#e3bd82'
ERROR = '#df9f8c'
MAX_LOG_LINES = 2000


def initial_geometry(screen_width, screen_height, work_area=None):
    left, top, right, bottom = work_area or (0, 0, screen_width, screen_height)
    available_width, available_height = right - left, bottom - top
    width = max(320, min(1040, available_width - 96))
    height = max(300, min(680, available_height - 120))
    x = left + max(0, (available_width - width) // 2)
    y = top + max(0, (available_height - height - 32) // 2)
    return width, height, x, y


def work_area():
    if sys.platform != 'win32':
        return None
    import ctypes
    from ctypes import wintypes
    rectangle = wintypes.RECT()
    if ctypes.windll.user32.SystemParametersInfoW(48, 0, ctypes.byref(rectangle), 0):
        return rectangle.left, rectangle.top, rectangle.right, rectangle.bottom
    return None


class WindowLogHandler(logging.Handler):
    def __init__(self, events, thread_name=None):
        super().__init__()
        self.events = events
        self.thread_name = thread_name
        self.setFormatter(ConsoleFormatter('%(asctime)s  %(levelname)s  %(message)s', datefmt='%H:%M:%S'))

    def emit(self, record):
        if self.thread_name and record.threadName != self.thread_name:
            return
        try:
            self.events.put_nowait(('log', (record.levelname, self.format(record))))
        except queue.Full:
            pass


def label(parent, text='', color=TEXT, size=10, bold=False, bg=SURFACE, **kwargs):
    return tk.Label(parent, text=text, bg=bg, fg=color, font=('Segoe UI', size, 'bold' if bold else 'normal'), **kwargs)


class StatusBadge(tk.Canvas):
    def __init__(self, parent, background=SURFACE):
        super().__init__(parent, width=142, height=34, bg=background, highlightthickness=0)
        self.mode = 'stopped'
        self.phase = 0
        self.timer = None
        self.tick()

    def set(self, mode):
        self.mode = mode

    def tick(self):
        if not self.winfo_exists():
            return
        self.delete('all')
        modes = {'stopped': ('Detenido', MUTED), 'starting': ('Conectando', ACCENT),
                 'running': ('En línea', GREEN), 'stopping': ('Deteniendo', WARNING), 'error': ('Revisar error', ERROR)}
        text, color = modes[self.mode]
        if self.mode == 'running':
            intensity = (math.sin(self.phase / 10) + 1) / 2
            halo = '#%02x%02x%02x' % (28, int(48 + 12 * intensity), int(48 + 8 * intensity))
            self.create_oval(6, 7, 26, 27, fill=halo, outline='')
            self.create_oval(12, 13, 20, 21, fill=color, outline='')
        elif self.mode in {'starting', 'stopping'}:
            self.create_oval(9, 10, 23, 24, outline=BORDER, width=2)
            self.create_arc(9, 10, 23, 24, start=self.phase * 12 % 360, extent=100, outline=color, width=2, style='arc')
        else:
            self.create_oval(12, 13, 20, 21, fill=color, outline='')
        self.create_text(34, 17, text=text, fill=color, anchor='w', font=('Segoe UI', 10, 'bold'))
        self.phase += 1
        self.timer = self.after(80, self.tick)

    def destroy(self):
        if self.timer:
            self.after_cancel(self.timer)
        super().destroy()


class LoadingTrack(tk.Canvas):
    def __init__(self, parent, bg=SURFACE, color=ACCENT):
        super().__init__(parent, height=8, bg=bg, highlightthickness=0)
        self.track = self.create_line(0, 4, 0, 4, fill=BORDER, width=4, capstyle='round')
        self.marker = self.create_line(0, 4, 0, 4, fill=color, width=4, capstyle='round')
        self.phase = 0
        self.timer = None
        self.bind('<Map>', self.animate)
        self.bind('<Unmap>', self.stop_animation)
        self.bind('<Destroy>', self.stop_animation)

    def animate(self, event=None):
        width = max(8, self.winfo_width())
        self.coords(self.track, 3, 4, width - 3, 4)
        span = max(1, (width - 6) * .28)
        offset = 3 + (width - 6 - span) * (1 - math.cos(self.phase)) / 2
        self.coords(self.marker, offset, 4, offset + span, 4)
        self.phase = (self.phase + .08) % math.tau
        self.timer = self.after(24, self.animate)

    def stop_animation(self, event=None):
        if self.timer is not None:
            self.after_cancel(self.timer)
            self.timer = None


def cached_profile(profile):
    return {
        'id': profile['id'], 'name': profile['name'], 'bot_id': profile['bot_id'],
        'revision': profile['revision'], 'updated_at': profile.get('updated_at'),
        'creator': {key: profile['creator'].get(key) for key in ('external_id', 'name', 'username')},
    }


class BotPanel:
    def __init__(self, manager, profile, runner=None):
        self.manager = manager
        self.profile = profile
        self.events = queue.Queue(maxsize=5000)
        self.controller = BotController(self.events, runner, credential_loader=self.load_credentials, session_client=manager.client)
        self.mode = 'stopped'
        self.pending_profile = None
        self.publication_id = None
        self.removed = False
        self.frame = tk.Frame(manager.content, bg=SURFACE)
        self.canvas = tk.Canvas(self.frame, bg=SURFACE, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self.frame, orient='vertical', command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')
        self.canvas.pack(side='left', fill='both', expand=True)
        body = tk.Frame(self.canvas, bg=SURFACE)
        body.grid_columnconfigure(0, weight=1)
        body_window = self.canvas.create_window((0, 0), window=body, anchor='nw')
        self.canvas.bind('<Configure>', lambda event: self.canvas.itemconfigure(body_window, width=event.width))
        body.bind('<Configure>', lambda event: self.canvas.configure(scrollregion=self.canvas.bbox(body_window)))
        header = tk.Frame(body, bg=SURFACE)
        header.grid(row=0, column=0, sticky='ew', padx=28, pady=(24, 4))
        self.title = label(header, profile['name'], size=23, bold=True)
        self.title.pack(side='left')
        header.bind('<Configure>', lambda event: self.title.configure(wraplength=max(160, event.width - 170), justify='left'))
        self.badge = StatusBadge(header)
        self.badge.pack(side='right')
        self.subtitle = label(body, color=MUTED)
        self.subtitle.grid(row=1, column=0, sticky='w', padx=28, pady=(0, 22))
        actions = tk.Frame(body, bg=SURFACE)
        actions.grid(row=2, column=0, sticky='ew', padx=28, pady=(0, 14))
        self.start_button = ttk.Button(actions, text='Iniciar bot', style='Accent.TButton', command=self.start)
        self.start_button.pack(side='left')
        self.stop_button = ttk.Button(actions, text='Detener', command=self.stop, state='disabled')
        self.stop_button.pack(side='left', padx=8)
        publication = tk.Frame(body, bg=PANEL, padx=14, pady=10)
        publication.grid(row=3, column=0, sticky='ew', padx=28, pady=(0, 12))
        self.publication_title = label(publication, 'Bot detenido', bold=True, bg=PANEL)
        self.publication_title.pack(anchor='w')
        self.publication_detail = label(publication, color=MUTED, bg=PANEL, justify='left', anchor='w')
        self.publication_detail.pack(fill='x', pady=(4, 0))
        publication.bind('<Configure>', lambda event: self.publication_detail.configure(
            wraplength=max(120, event.width - 28)))
        self.loading_track = LoadingTrack(publication, bg=PANEL, color=GREEN)
        self.publication_progress = ttk.Progressbar(publication, maximum=1, style='Publication.Horizontal.TProgressbar')
        self.publication_progress.pack(fill='x', pady=(6, 2))
        self.publication_progress.pack_forget()
        self.publication_order = label(publication, color=MUTED, bg=PANEL, justify='left', anchor='w')
        self.publication_order.pack(fill='x')
        self.publication_order.pack_forget()
        self.proof = tk.Frame(body, bg=PANEL, padx=14, pady=10)
        self.proof.grid(row=4, column=0, sticky='ew', padx=28, pady=(0, 10))
        self.proof.grid_columnconfigure(0, weight=1)
        self.recording_text = tk.StringVar()
        proof = self.proof
        label(proof, 'Comprobante en video', bold=True, bg=PANEL).grid(row=0, column=0, sticky='w', pady=(0, 4))
        self.recording_label = tk.Label(proof, textvariable=self.recording_text, bg=PANEL, fg=ACCENT, anchor='w',
                 wraplength=230, justify='left', font=('Segoe UI', 10))
        self.recording_label.grid(row=1, column=0, sticky='ew', padx=(0, 12))
        proof.bind('<Configure>', lambda event: self.recording_label.configure(wraplength=max(120, event.width-16)))
        self.proof.grid_remove()
        log_title = tk.Frame(body, bg=SURFACE)
        log_title.grid(row=6, column=0, sticky='ew', padx=28, pady=(0, 8))
        label(log_title, 'ACTIVIDAD DEL BOT', color=MUTED, size=9, bold=True).pack(side='left')
        self.log_toggle = ttk.Button(log_title, text='Ver registro', style='Small.TButton', command=self.toggle_log)
        self.log_toggle.pack(side='right')
        self.save_log_button = ttk.Button(log_title, text='Guardar registro', style='Small.TButton', command=self.save_log)
        self.activity = scrolledtext.ScrolledText(body, wrap='word', state='disabled', font=('Consolas', 9),
            bg=BG, fg=TEXT, insertbackground=TEXT, relief='flat', padx=16, pady=14,
            selectbackground=SELECTION, selectforeground=TEXT, borderwidth=0, height=7)
        self.activity.vbar.pack_forget()
        activity_scroll = ttk.Scrollbar(self.activity.frame, orient='vertical', command=self.activity.yview)
        activity_scroll.pack(side='right', fill='y')
        self.activity.configure(yscrollcommand=activity_scroll.set)
        self.activity.grid(row=7, column=0, sticky='nsew', padx=28, pady=(0, 22))
        self.activity.grid_remove()
        self.log_visible = False
        self.activity.tag_config('ERROR', foreground=ERROR)
        self.activity.tag_config('WARNING', foreground=WARNING)
        self.handler = WindowLogHandler(self.events, self.controller.thread_name)
        logging.getLogger().addHandler(self.handler)
        self.refresh_profile(profile)
        self.append('INFO', 'Listo para iniciar')

    def scroll_panel(self, event):
        if self.manager.panels.get(self.manager.selected) is not self:
            return
        widget = event.widget
        while widget is not self.canvas and widget is not self.activity and widget is not None:
            widget = getattr(widget, 'master', None)
        if widget is self.canvas:
            steps = abs(event.delta) // 120 or 1
            self.canvas.yview_scroll(-steps if event.delta > 0 else steps, 'units')

    def load_credentials(self):
        self.controller.session_client = self.manager.client
        try:
            data = self.manager.client.credentials(self.profile['id'])
        except CloudError as error:
            self.manager.events.put((self.manager.cloud_failed, error))
            raise
        if self.manager.revisions([data]) != self.manager.revisions([self.profile]):
            self.manager.events.put((self.manager.flag_updates, None))
            raise CloudError('El perfil cambió en la web · Pulsa Actualizar antes de iniciar el bot')
        self.manager.events.put((self.manager.mark_online, None))
        metadata = {key: value for key, value in data.items() if key not in {'telegram_token', 'api_key'}}
        self.manager.events.put((self.apply_loaded_profile, metadata))
        return data

    def apply_loaded_profile(self, profile):
        if self.pending_profile is None and self.manager.revisions([profile]) == self.manager.revisions([self.profile]):
            self.refresh_profile(profile)
        self.manager.refresh_sidebar()

    def refresh_profile(self, profile):
        self.profile = profile
        self.title.configure(text=profile['name'])
        username = profile['creator'].get('username')
        self.subtitle.configure(text=f'@{username}' if username else '')
    def set_mode(self, mode):
        self.mode = mode
        self.badge.set(mode)
        active = mode in {'starting', 'running', 'stopping'}
        self.start_button.configure(state='disabled' if active or self.manager.closing or self.removed else 'normal')
        self.stop_button.configure(state='normal' if mode in {'starting', 'running'} else 'disabled')
        if mode == 'starting':
            self.publication_id = None
            self.show_publication('Cargando configuración', 'Obteniendo la configuración del bot…')
            self.loading_track.pack(fill='x', pady=(8, 2))
            self.proof.grid_remove()
        elif mode == 'running':
            self.show_publication('Bot listo', 'Esperando mensajes reenviados en Telegram', color=GREEN)
        elif mode == 'error':
            self.show_publication('No se pudo iniciar o continuar el bot', 'Abre el registro para ver el detalle',
                                  color=ERROR)
        elif mode == 'stopped':
            self.show_publication('Bot detenido')
        self.manager.refresh_sidebar()

    def show_publication(self, title, detail='', color=TEXT):
        self.loading_track.pack_forget()
        self.publication_progress.stop()
        self.publication_progress.pack_forget()
        self.publication_order.pack_forget()
        self.publication_title.configure(text=title, fg=color)
        self.publication_detail.configure(text=detail)

    def update_publication(self, data):
        self.publication_id = data['id']
        status = data['status']
        total, completed = data['total'], data['completed']
        processed = data.get('processed', completed)
        skipped = data.get('skipped', ())
        if status == 'collecting':
            detail = f'{total} en cola' if total else 'Esperando mensajes reenviados en Telegram'
            self.show_publication('Drop abierto', detail)
            return
        if status == 'cancelled':
            self.show_publication('Drop cancelado', 'Esperando un nuevo Drop en Telegram')
            return
        if status == 'done':
            detail = data['stage'] or 'Confirmación pendiente en Telegram'
            self.show_publication(f'{completed} de {total} publicados', detail, GREEN)
        elif status == 'paused':
            mention = data['mention']
            if data.get('rate_limited'):
                detail = 'El servicio pidió una pausa. Consulta en Telegram cuándo puedes continuar.'
            elif mention:
                detail = f'AgencyKey rechazó la mención {mention}\nUsa Enviar enlace u Omitir post en Telegram'
            elif data['uncertain']:
                detail = 'Revisa el muro y elige Enviar enlace u Omitir post en Telegram'
            elif data['failed']:
                detail = 'Usa Enviar enlace u Omitir post en Telegram · Ver detalle en el registro'
            else:
                detail = 'La publicación se detuvo antes de enviar el siguiente mensaje'
            self.show_publication(f'Drop pausado · {completed} de {total} publicados', detail, WARNING)
        else:
            stage = data['stage']
            if processed < total and stage != 'Publicación confirmada':
                stage = f'{stage} · Mensaje #{total - processed}'
            self.show_publication(f'Drop en curso · {completed} de {total} publicados', stage, ACCENT)
        self.publication_progress.configure(mode='determinate', maximum=max(1, total), value=processed)
        self.publication_progress.pack(fill='x', pady=(6, 2))
        if total:
            start = max(0, min(processed - 1, total - 3))
            rows = ['Orden de publicación · Del último al primero']
            for index in range(start, min(total, start + 3)):
                if index + 1 in skipped:
                    state = 'Omitido'
                elif index < processed:
                    state = 'Publicado manualmente' if index + 1 in data['manual'] else 'Publicado'
                elif index == processed:
                    state = 'En pausa' if status == 'paused' else 'En curso'
                else:
                    state = 'Pendiente'
                rows.append(f'Turno {index + 1} · Mensaje #{total - index} · {state}')
            self.publication_order.configure(text='\n'.join(rows))
            self.publication_order.pack(fill='x', pady=(2, 0))

    def start(self):
        if self.controller.running or self.manager.closing:
            return
        if self.manager.client is None or self.manager.auth_required:
            self.manager.refresh()
            return
        for panel in self.manager.panels.values():
            if panel is not self and panel.controller.running and panel.profile['bot_id'] == self.profile['bot_id']:
                messagebox.showerror('Bot activo', 'Este bot ya está funcionando', parent=self.manager.root)
                return
        self.set_mode('starting')
        self.controller.start()

    def toggle_log(self):
        self.log_visible = not self.log_visible
        if self.log_visible:
            self.activity.grid()
            self.save_log_button.pack(side='right', padx=8)
        else:
            self.activity.grid_remove()
            self.save_log_button.pack_forget()
        self.log_toggle.configure(text='Ocultar registro' if self.log_visible else 'Ver registro')

    def stop(self):
        if not self.controller.running:
            return
        self.set_mode('stopping')
        self.show_publication('Deteniendo bot', 'Esperando el envío en curso')
        self.controller.stop()
        self.append('WARNING', 'Esperando el envío en curso · No se iniciarán nuevas publicaciones')

    def append(self, level, text):
        self.activity.configure(state='normal')
        self.activity.insert('end', text + '\n', level)
        lines = int(self.activity.index('end-1c').split('.')[0])
        if lines > MAX_LOG_LINES:
            self.activity.delete('1.0', f'{lines - MAX_LOG_LINES + 1}.0')
        self.activity.see('end')
        self.activity.configure(state='disabled')

    def poll(self):
        for _ in range(150):
            try:
                event, value = self.events.get_nowait()
            except queue.Empty:
                break
            if event == 'log':
                self.append(*value)
            elif event == 'recording':
                stage = value['stage']
                count = f' · {value["completed"]}/{value["total"]} posts' if value['total'] and not value.get('error') else ''
                self.recording_text.set(stage[:1].upper() + stage[1:] + count)
                self.recording_label.configure(fg=ERROR if value.get('error') else ACCENT)
                self.proof.grid()
            elif event == 'setup_stage' and self.mode == 'starting':
                self.publication_detail.configure(text=f'✓ Configuración cargada · {value}\nConectando el bot con Telegram…')
            elif event == 'publication' and self.mode in {'running', 'stopping'}:
                self.update_publication(value)
            elif event == 'publication_summary' and value and value == self.publication_id:
                self.publication_detail.configure(text='Confirmación enviada a Telegram')
            elif event == 'ready' and self.mode == 'starting':
                self.set_mode('running')
            elif event == 'stopped':
                self.set_mode('error' if value else 'stopped')
                self.append('ERROR' if value else 'INFO', 'El bot se detuvo con error' if value else 'Bot detenido')

    def save_log(self):
        path = filedialog.asksaveasfilename(parent=self.manager.root, title='Guardar registro',
                                          defaultextension='.zip', initialfile='recorder-diagnostico.zip',
                                          filetypes=[('Diagnóstico completo', '*.zip')])
        if path:
            try:
                from diagnostics import export_diagnostics
                count = export_diagnostics(path, self.activity.get('1.0', 'end-1c'))
                self.append('INFO', f'Registro exportado con {count} diagnósticos')
            except OSError as error:
                messagebox.showerror('No se pudo guardar', str(error), parent=self.manager.root)

    def destroy(self):
        logging.getLogger().removeHandler(self.handler)
        self.badge.destroy()
        self.frame.destroy()


class DropperWindow:
    def __init__(self, root, runner=None, client=None):
        self.root = root
        self.runner = runner
        self.client = client
        self.events = queue.Queue()
        self.panels = {}
        self.selected = None
        self.closing = False
        self.refreshing = False
        self.cloud_online = False
        self.next_sync = monotonic()
        self.access_dialog = None
        self.loading_panel = None
        self.auth_required = False
        self.connecting = False
        self.vault = CredentialStore()
        local = Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local' / 'share')
        self.profile_cache = local / 'HersPruebaDropper' / 'profiles.json' if client is None else None
        self.profile_snapshot = {}
        self.checking_updates = False
        self.next_recording_job = monotonic()
        self.recording_job_running = threading.Event()
        self.recording_job_error = None
        self.recording_job_stop = threading.Event()
        self.update_hint = tk.StringVar()
        root.title('HERS Dropper · Hers-prueba')
        logo = resource_path('assets/hers-dropper.png')
        header_size = min(128, round(root.winfo_fpixels('1i') * 40 / 96))
        with Image.open(logo) as image:
            self.app_icon = ImageTk.PhotoImage(image.resize((64, 64), Image.Resampling.LANCZOS), master=root)
            self.header_icon = ImageTk.PhotoImage(
                image.resize((header_size, header_size), Image.Resampling.LANCZOS), master=root)
        root.iconphoto(True, self.app_icon)
        root.configure(bg=BG)
        width, height, x, y = initial_geometry(root.winfo_screenwidth(), root.winfo_screenheight(), work_area())
        root.geometry(f'{width}x{height}+{x}+{y}')
        root.minsize(min(820, width), min(540, height))
        root.state('normal')
        root.protocol('WM_DELETE_WINDOW', self.close)
        self.styles()
        top = tk.Frame(root, bg=BG, padx=26, pady=22)
        top.pack(fill='x')
        tk.Label(top, image=self.header_icon, bg=BG, borderwidth=0).pack(side='left', padx=(0, 12))
        label(top, 'HERS Dropper', size=18, bold=True, bg=BG).pack(side='left')
        self.sync_button = ttk.Button(top, text='Actualizar', command=self.refresh)
        self.sync_button.pack(side='right')
        tk.Label(top, textvariable=self.update_hint, bg=BG, fg=ACCENT).pack(side='right', padx=12)
        root.bind('<MouseWheel>', self.scroll_selected)
        shell = tk.Frame(root, bg=BG)
        shell.pack(fill='both', expand=True, padx=22)
        sidebar = tk.Frame(shell, bg=BG, width=242)
        sidebar.pack(side='left', fill='y', padx=(0, 18))
        sidebar.pack_propagate(False)
        title = tk.Frame(sidebar, bg=BG)
        title.pack(fill='x', pady=(6, 14))
        label(title, 'TUS BOTS', size=9, color=MUTED, bold=True, bg=BG).pack(side='left')
        self.count = label(title, '0', color=MUTED, size=9, bg=BG)
        self.count.pack(side='right')
        canvas_holder = tk.Frame(sidebar, bg=BG)
        canvas_holder.pack(fill='both', expand=True)
        self.side_canvas = tk.Canvas(canvas_holder, bg=BG, highlightthickness=0, width=236)
        self.side_scroll = ttk.Scrollbar(canvas_holder, orient='vertical', command=self.side_canvas.yview)
        self.side_canvas.configure(yscrollcommand=self.side_scroll.set)
        self.side_canvas.pack(side='left', fill='both', expand=True)
        self.list_frame = tk.Frame(self.side_canvas, bg=BG)
        self.list_window = self.side_canvas.create_window((0, 0), window=self.list_frame, anchor='nw')
        self.list_frame.bind('<Configure>', self.layout_sidebar)
        self.side_canvas.bind('<Configure>', self.layout_sidebar)
        self.content = tk.Frame(shell, bg=SURFACE, highlightbackground=BORDER, highlightthickness=1)
        self.content.pack(side='left', fill='both', expand=True)
        self.empty = tk.Frame(self.content, bg=SURFACE)
        self.empty.pack(fill='both', expand=True)
        empty_inner = tk.Frame(self.empty, bg=SURFACE)
        empty_inner.place(relx=.5, rely=.45, anchor='center')
        label(empty_inner, 'Acceso a los bots', size=21, bold=True).pack()
        label(empty_inner, 'Pulsa Actualizar para cargar las configuraciones', color=MUTED).pack(pady=12)
        self.empty_note = label(empty_inner, '', color=ACCENT)
        self.empty_note.pack(pady=8)
        footer = tk.Frame(root, bg=BG, padx=26, pady=14)
        footer.pack(side='bottom', fill='x', before=shell)
        self.status = tk.StringVar(value='Sin configuraciones')
        tk.Label(footer, textvariable=self.status, bg=BG, fg=MUTED, font=('Segoe UI', 9)).pack(side='left')
        logging.getLogger().setLevel(logging.INFO)
        root.after(100, self.poll)
        self.restore_profiles()
        if client is None:
            self.auto_connect()

    def scroll_selected(self, event):
        panel = self.panels.get(self.selected)
        if panel:
            panel.scroll_panel(event)

    @staticmethod
    def revisions(profiles):
        return {p['id']: (p['revision'], p.get('updated_at')) for p in profiles}

    def restore_profiles(self):
        if self.profile_cache is None:
            return
        try:
            profiles = [cached_profile(p) for p in json.loads(self.profile_cache.read_text(encoding='utf-8'))]
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return
        self.profile_snapshot = self.revisions(profiles)
        self.apply_profiles(profiles)
        self.status.set('Configuración guardada en este equipo')

    def save_profiles(self, profiles):
        self.apply_profiles(profiles)
        self.profile_snapshot = self.revisions(profiles)
        self.update_hint.set('')
        if self.profile_cache is None:
            return
        try:
            self.profile_cache.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', delete=False,
                                             dir=self.profile_cache.parent) as stream:
                temporary = Path(stream.name)
                try:
                    json.dump([cached_profile(p) for p in profiles], stream, ensure_ascii=False)
                    stream.close()
                    temporary.replace(self.profile_cache)
                finally:
                    stream.close()
                    temporary.unlink(missing_ok=True)
        except OSError:
            self.status.set('Configuración actualizada · No se pudo guardar la copia local')

    def styles(self):
        style = ttk.Style(self.root)
        style.theme_use('clam')
        style.configure('.', font=('Segoe UI', 10), background=SURFACE, foreground=TEXT)
        style.configure('TButton', background=PANEL, foreground=TEXT, padding=(15, 10), borderwidth=0, focuscolor=PANEL)
        style.map('TButton', background=[('disabled', DISABLED), ('active', HOVER)],
                  foreground=[('disabled', DISABLED_TEXT)])
        style.configure('Accent.TButton', background=ACCENT, foreground=BG, font=('Segoe UI', 10, 'bold'))
        style.map('Accent.TButton', background=[('disabled', BORDER), ('active', ACCENT_HOVER)],
                  foreground=[('disabled', MUTED)])
        style.configure('Danger.TButton', foreground=ERROR)
        style.configure('Small.TButton', padding=(10, 5), font=('Segoe UI', 9))
        style.configure('TEntry', fieldbackground=PANEL, bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER,
                        foreground=TEXT, insertcolor=TEXT, padding=9)
        style.configure('TCombobox', fieldbackground=PANEL, background=PANEL, foreground=TEXT, padding=8, arrowcolor=MUTED)
        style.map('TCombobox', fieldbackground=[('readonly', PANEL)], selectbackground=[('readonly', PANEL)],
                  selectforeground=[('readonly', TEXT)], foreground=[('readonly', TEXT)])
        self.root.option_add('*TCombobox*Listbox.background', PANEL)
        self.root.option_add('*TCombobox*Listbox.foreground', TEXT)
        self.root.option_add('*TCombobox*Listbox.selectBackground', SELECTION)
        self.root.option_add('*TCombobox*Listbox.selectForeground', TEXT)
        style.layout('Vertical.TScrollbar', [('Vertical.Scrollbar.trough', {'sticky': 'ns', 'children': [
            ('Vertical.Scrollbar.thumb', {'sticky': 'nswe'})]})])
        style.configure('Publication.Horizontal.TProgressbar', background=GREEN, troughcolor=BORDER,
                        bordercolor=PANEL, lightcolor=GREEN, darkcolor=GREEN)
        style.configure('Vertical.TScrollbar', background=BORDER, troughcolor=BG, darkcolor=BORDER,
                        lightcolor=BORDER, bordercolor=BG, borderwidth=0, width=7, gripcount=0)
        style.map('Vertical.TScrollbar', background=[('active', SELECTION)])

    def background(self, work, complete, failed=None):
        def run():
            try:
                result = work()
            except Exception as error:
                self.events.put((failed or self.show_error, error))
            else:
                self.events.put((complete, result))
        threading.Thread(target=run, name='dropper-config', daemon=True).start()

    def show_error(self, error):
        messagebox.showerror('No se pudo completar', str(error), parent=self.root)

    def auto_connect(self):
        try:
            token = self.vault.read()
        except OSError:
            token = None
        if token:
            self.client = CloudClient(token)

    def connected(self):
        self.next_sync = monotonic() + 30
        self.sync_button.configure(state='normal')
        self.status.set('Configuraciones actualizadas')
        self.auth_required = False
        self.empty_note.configure(text='No hay bots configurados')
        self.cloud_online = True

    def try_connect(self, token, remember=False, dialog=None):
        if self.connecting or self.refreshing or self.closing:
            return
        token = token.strip()
        if not token:
            return
        self.connecting = True
        client = CloudClient(token)
        self.status.set('Descargando configuraciones…')
        self.show_loading()
        def done(profiles):
            self.connecting = False
            self.hide_loading()
            self.client = client
            if remember:
                try:
                    self.vault.write(token)
                except OSError:
                    messagebox.showinfo('Acceso conectado', 'No se pudo recordar el acceso en Windows', parent=self.root)
            elif dialog:
                try:
                    self.vault.delete()
                except OSError:
                    pass
            self.connected()
            self.save_profiles(profiles)
            self.close_access_dialog(dialog)
        def failed(error):
            self.connecting = False
            self.hide_loading()
            self.cloud_failed(error)
            if dialog and dialog.winfo_exists():
                self.show_error(error)
        self.background(client.list_profiles, done, failed)

    def close_access_dialog(self, dialog=None):
        current = self.access_dialog
        self.access_dialog = None
        for window in {item for item in (current, dialog) if item is not None}:
            if window.winfo_exists():
                window.grab_release()
                window.destroy()
        self.root.lift()
        self.root.focus_set()

    def connect_dialog(self):
        if self.access_dialog and self.access_dialog.winfo_exists():
            self.access_dialog.lift()
            return
        dialog = tk.Toplevel(self.root)
        self.access_dialog = dialog
        dialog.title('Acceso a los bots')
        dialog.configure(bg=SURFACE)
        dialog.transient(self.root)
        dialog.resizable(False, False)
        outer = tk.Frame(dialog, bg=SURFACE, padx=26, pady=24)
        outer.pack()
        label(outer, 'Contraseña nueva' if self.auth_required else 'Acceso a los bots', size=19, bold=True).pack(anchor='w')
        label(outer, 'Introduce la contraseña actual para descargar las configuraciones', color=MUTED, size=9).pack(anchor='w', pady=(6, 18))
        label(outer, 'Contraseña', bold=True).pack(anchor='w', pady=(8, 5))
        field = ttk.Entry(outer, width=48, show='•')
        field.pack(fill='x', pady=(0, 6))
        remember = tk.BooleanVar(value=sys.platform == 'win32')
        tk.Checkbutton(outer, text='Recordar acceso en este equipo', variable=remember, bg=SURFACE, fg=MUTED,
                       activebackground=SURFACE, activeforeground=TEXT, selectcolor=PANEL,
                       state='normal' if sys.platform == 'win32' else 'disabled').pack(anchor='w', pady=10)
        buttons = tk.Frame(outer, bg=SURFACE)
        buttons.pack(fill='x', pady=(10, 0))
        ttk.Button(buttons, text='Descargar configuraciones', style='Accent.TButton', command=lambda: self.try_connect(field.get(), remember.get(), dialog)).pack(side='right')
        field.bind('<Return>', lambda event: self.try_connect(field.get(), remember.get(), dialog))
        def forget():
            if any(panel.controller.running for panel in self.panels.values()):
                messagebox.showinfo('Bots activos', 'Detén los bots antes de olvidar el acceso', parent=dialog)
                return
            try:
                self.vault.delete()
            except OSError:
                pass
            if self.profile_cache is not None:
                try:
                    self.profile_cache.unlink(missing_ok=True)
                except OSError as error:
                    self.show_error(error)
                    return
            self.profile_snapshot = {}
            self.update_hint.set('')
            self.client = None
            self.cloud_online = False
            for panel in self.panels.values():
                panel.destroy()
            self.panels.clear()
            self.selected = None
            self.empty.pack(fill='both', expand=True)
            self.refresh_sidebar()
            self.sync_button.configure(state='normal')
            self.status.set('Acceso olvidado en este equipo')
            dialog.destroy()
        ttk.Button(buttons, text='Olvidar acceso', command=forget).pack(side='left')
        self.center_dialog(dialog)
        dialog.grab_set()
        field.focus_set()

    def center_dialog(self, dialog):
        dialog.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width()-dialog.winfo_reqwidth())//2
        y = self.root.winfo_y() + (self.root.winfo_height()-dialog.winfo_reqheight())//2
        dialog.geometry(f'+{max(0,x)}+{max(0,y)}')

    def show_loading(self):
        if self.loading_panel is not None:
            return
        parent = self.access_dialog if self.access_dialog and self.access_dialog.winfo_exists() else self.root
        panel = tk.Frame(parent, bg=SURFACE, highlightbackground=BORDER, highlightthickness=1, padx=28, pady=24)
        self.loading_panel = panel
        label(panel, 'Cargando configuración', size=17, bold=True).pack(anchor='w')
        label(panel, 'Obteniendo perfiles desde el panel web…', color=MUTED).pack(pady=(10, 16))
        LoadingTrack(panel).pack(fill='x')
        panel.place(relx=.5, rely=.5, anchor='center')
        panel.lift()

    def hide_loading(self):
        if self.loading_panel is not None:
            self.loading_panel.destroy()
            self.loading_panel = None

    def refresh(self):
        if self.refreshing or self.connecting or self.closing:
            return
        if not self.client or self.auth_required:
            self.connect_dialog()
            return
        self.refreshing = True
        self.show_loading()
        self.next_sync = monotonic()+30
        self.sync_button.configure(state='disabled')
        def complete(profiles):
            self.refreshing = False
            self.hide_loading()
            self.sync_button.configure(state='normal')
            self.cloud_online = True
            self.save_profiles(profiles)
        def failed(error):
            self.refreshing = False
            self.hide_loading()
            self.sync_button.configure(state='normal')
            self.cloud_failed(error)
        self.background(self.client.list_profiles, complete, failed)

    def flag_updates(self, _):
        self.update_hint.set('Hay cambios disponibles')

    def check_updates(self):
        if self.checking_updates or self.refreshing or self.connecting:
            return
        self.checking_updates = True
        self.next_sync = monotonic() + 30
        client = self.client
        snapshot = self.profile_snapshot

        def complete(profiles):
            self.checking_updates = False
            if self.client is client and self.profile_snapshot is snapshot and not self.refreshing and not self.auth_required:
                remote = self.revisions(profiles)
                self.update_hint.set('Hay cambios disponibles' if remote != snapshot else '')
                self.cloud_online = True
                if any(panel.controller.running and remote.get(key) != snapshot.get(key) for key, panel in self.panels.items()):
                    self.refresh()

        def failed(error):
            self.checking_updates = False
            if self.client is client and self.profile_snapshot is snapshot and not self.refreshing:
                self.cloud_online = False
                if isinstance(error, AccessDenied):
                    self.auth_required = True
                    for panel in self.panels.values():
                        if panel.controller.running:
                            panel.stop()
                    self.update_hint.set('Actualiza para volver a conectar')
                else:
                    self.status.set(str(error))

        active = [{'id': key, 'revision': snapshot[key][0]} for key, panel in self.panels.items()
                  if key in snapshot and panel.mode == 'running' and panel.controller.running]

        def check():
            if active:
                client.report_bot_activity(active)
            return client.profile_revisions()

        self.background(check, complete, failed)

    def apply_profiles(self, profiles):
        remote = {profile['id']: profile for profile in profiles}
        for key in list(self.panels):
            panel = self.panels[key]
            if key not in remote:
                if panel.controller.running:
                    panel.removed = True
                    panel.stop()
                    panel.append('WARNING', 'Configuración eliminada desde el panel privado')
                else:
                    panel.destroy()
                    del self.panels[key]
                    if self.selected == key:
                        self.selected = None
        for profile in profiles:
            self.upsert(profile)
        self.select_available()

    def select_available(self):
        if self.selected in self.panels:
            self.select(self.selected)
        elif self.panels:
            self.select(next(iter(self.panels)))
        else:
            self.empty.pack(fill='both', expand=True)
            self.refresh_sidebar()

    def upsert(self, profile):
        panel = self.panels.get(profile['id'])
        if panel:
            if panel.controller.running:
                model_changed = profile['creator']['external_id'] != panel.profile['creator']['external_id']
                if self.revisions([profile]) != self.revisions([panel.profile]) or model_changed or panel.pending_profile:
                    panel.pending_profile = profile
                    if (model_changed or profile.get('telegram_users', []) != panel.profile.get('telegram_users', [])) and panel.mode != 'stopping':
                        panel.stop()
                        panel.append('WARNING', 'Configuración cambiada en el panel · Reinicia el bot cuando se detenga')
            else:
                panel.pending_profile = None
                panel.refresh_profile(profile)
        else:
            self.panels[profile['id']] = BotPanel(self, profile, self.runner)
        self.refresh_sidebar()

    def select(self, key):
        self.empty.pack_forget()
        for profile_id, panel in self.panels.items():
            if profile_id == key:
                panel.frame.pack(fill='both', expand=True)
            else:
                panel.frame.pack_forget()
        self.selected = key
        self.refresh_sidebar()

    def refresh_sidebar(self):
        for item in self.list_frame.winfo_children():
            item.destroy()
        for key, panel in self.panels.items():
            active = key == self.selected
            background = PANEL if active else BG
            row = tk.Frame(self.list_frame, bg=background, padx=13, pady=12,
                           highlightbackground=ACCENT if active else BG, highlightthickness=1)
            row.pack(fill='x', pady=(0, 7))
            color = GREEN if panel.mode == 'running' else ACCENT if panel.mode in {'starting','stopping'} else ERROR if panel.mode == 'error' else MUTED
            name = label(row, f'●  {panel.profile["name"]}', color=color, bold=True, bg=background, anchor='w', wraplength=185)
            name.pack(fill='x')
            model = label(row, '@' + panel.profile['creator']['username'] if panel.profile['creator'].get('username') else '', color=MUTED, size=9, bg=background, anchor='w', wraplength=185)
            model.pack(fill='x', padx=(17,0), pady=(4,0))
            for widget in (row, name, model):
                widget.bind('<Button-1>', lambda event, selected=key: self.select(selected))
        self.count.configure(text=str(len(self.panels)))

    def layout_sidebar(self, event=None):
        self.side_canvas.itemconfigure(self.list_window, width=self.side_canvas.winfo_width())
        region = self.side_canvas.bbox('all')
        self.side_canvas.configure(scrollregion=region)
        overflow = bool(region and region[3] - region[1] > self.side_canvas.winfo_height() + 1)
        if overflow and not self.side_scroll.winfo_manager():
            self.side_scroll.pack(side='right', fill='y', before=self.side_canvas)
        elif not overflow and self.side_scroll.winfo_manager():
            self.side_scroll.pack_forget()
            self.side_canvas.yview_moveto(0)

    def mark_online(self, value=None):
        self.cloud_online = True

    def cloud_failed(self, error):
        self.cloud_online = False
        self.status.set(str(error))
        if isinstance(error, AccessDenied):
            self.auth_required = True
            try:
                self.vault.delete()
            except OSError:
                pass
            self.connect_dialog()

    def check_recording_job(self):
        if self.recording_job_running.is_set():
            return
        self.next_recording_job = monotonic() + 8
        self.recording_job_running.set()
        client = self.client

        def run():
            try:
                from recording_service import run_verification_engine
                def notify(error):
                    self.recording_job_error = error
                asyncio.run(run_verification_engine(client, self.recording_job_stop,
                    current=lambda: self.client is client and not self.auth_required,
                    notify=notify))
            except asyncio.CancelledError:
                pass
            except CloudError as error:
                detail = str(error)
                if detail != self.recording_job_error:
                    logging.getLogger('agencykey-recorder').warning('Solicitud web de Chrome: %s', detail)
                    self.recording_job_error = detail
            finally:
                self.recording_job_running.clear()

        threading.Thread(target=run, name='agencykey-web-job', daemon=True).start()

    def poll(self):
        for _ in range(50):
            try:
                callback, value = self.events.get_nowait()
            except queue.Empty:
                break
            if not self.closing:
                try:
                    callback(value)
                except Exception:
                    logging.getLogger('dropper').exception('No se pudo actualizar la interfaz')
                    messagebox.showerror('Error de interfaz', 'No se pudo actualizar la vista', parent=self.root)
        for key, panel in list(self.panels.items()):
            panel.poll()
            if not panel.controller.running:
                if panel.removed:
                    panel.destroy()
                    del self.panels[key]
                    if self.selected == key:
                        self.selected = None
                    self.select_available()
                elif panel.pending_profile:
                    panel.refresh_profile(panel.pending_profile)
                    panel.pending_profile = None
                    self.refresh_sidebar()
        active = sum(panel.controller.running for panel in self.panels.values())
        if self.client and self.cloud_online and not self.refreshing:
            self.status.set(f'Solicitud web: {self.recording_job_error}' if self.recording_job_error else f'{active} bots activos')
        if self.closing and not active:
            self.destroy()
            return
        if self.client and not self.auth_required and monotonic() >= self.next_sync and not self.closing:
            self.check_updates()
        if isinstance(self.client, CloudClient) and not self.auth_required and not self.closing:
            if monotonic() >= self.next_recording_job:
                self.check_recording_job()
        self.root.after(100, self.poll)

    def close(self):
        if any(panel.controller.running for panel in self.panels.values()):
            if not messagebox.askyesno('Cerrar HERS Dropper', '¿Detener los bots y cerrar? Los Drops pendientes se perderán', parent=self.root):
                return
            self.closing = True
            self.recording_job_stop.set()
            for panel in self.panels.values():
                panel.stop()
        else:
            self.destroy()

    def destroy(self):
        self.recording_job_stop.set()
        for panel in self.panels.values():
            panel.destroy()
        self.client = None
        self.root.destroy()


def smoke_test(screenshot=None):
    from uuid import uuid4
    failures = []
    class FakeCloud:
        def __init__(self):
            self.records = {str(i): dict(id=str(i), name=model, bot_id=str(i), revision=1,
                creator=dict(external_id=i, name=model, username=model.lower()))
                for i, model in [(1, 'Lilith'), (2, 'Lola')]}
        def report_bot_activity(self, profiles):
            pass

        def profile_revisions(self):
            return list(self.records.values())

        def list_profiles(self):
            from copy import deepcopy
            return deepcopy(list(self.records.values()))
    def fake_bot(stop_event, ready):
        logging.getLogger('dropper').info('Bot conectado · Modelo asignada desde el panel privado')
        ready()
        if not stop_event.wait(15):
            failures.append('No se recibió la orden de parada')
    root = tk.Tk()
    cloud = FakeCloud()
    window = DropperWindow(root, fake_bot, cloud)

    def finish():
        for panel in window.panels.values():
            if panel.controller.running:
                failures.append('No se detuvo el bot')
                panel.controller.stop()
        if sys.platform == 'win32':
            vault = CredentialStore('HersPruebaDropper/smoke/' + uuid4().hex)
            try:
                vault.write('smoke-test-access')
                if vault.read() != 'smoke-test-access':
                    failures.append('Windows no recuperó el acceso guardado')
            finally:
                vault.delete()
        window.destroy()

    def wait_for(condition, complete, failure):
        deadline = monotonic()+8
        def check():
            try:
                if condition():
                    complete()
                elif monotonic() < deadline:
                    root.after(100, check)
                else:
                    failures.append(failure)
                    finish()
            except Exception as error:
                failures.append(failure+': '+str(error))
                finish()
        root.after(100, check)

    def start():
        root.update_idletasks()
        window.layout_sidebar()
        if window.side_scroll.winfo_manager():
            failures.append('La lista de dos modelos no debe mostrar barra de desplazamiento')
        window.connect_dialog()
        dialog = window.access_dialog
        window.close_access_dialog()
        if dialog.winfo_exists():
            failures.append('No se cerró la ventana de contraseña')
        # Verify the scrollbar in the real Tk layout, then restore the two bots.
        profiles = cloud.list_profiles()
        extras = [dict(profiles[0], id=str(i), name=f'Modelo {i}') for i in range(3, 20)]
        window.apply_profiles(profiles + extras)
        root.update_idletasks()
        window.layout_sidebar()
        if not window.side_scroll.winfo_manager():
            failures.append('La lista extensa necesita barra de desplazamiento')
        window.apply_profiles(profiles)
        root.update_idletasks()
        window.layout_sidebar()
        if window.side_scroll.winfo_manager():
            failures.append('La barra no se ocultó al reducir la lista')
        if root.state() != 'normal':
            failures.append('La ventana debe abrirse en tamaño normal')
        for panel in window.panels.values():
            panel.start()
        window.select('1')
        wait_for(lambda: all(panel.mode == 'running' for panel in window.panels.values()),
                 lambda: root.after(200, check_parallel), 'Los dos bots deben estar activos')

    def check_parallel():
        panel = window.panels['1']
        if panel.publication_title.cget('text') != 'Bot listo' or panel.publication_progress.winfo_manager():
            failures.append('La carga del bot debe desaparecer al conectarse a Telegram')
        panel.events.put(('publication', {
            'id': 'demo', 'status': 'publishing', 'stage': 'Subiendo foto a AgencyKey',
            'total': 3, 'completed': 1, 'manual': (), 'mention': None, 'failed': False, 'uncertain': False,
        }))
        panel.events.put(('recording', {'stage':'grabando', 'completed':2, 'total':3, 'post_id':'102'}))
        panel.poll()
        root.update_idletasks()
        if 'Turno 1 · Mensaje #3 · Publicado' not in panel.publication_order.cget('text'):
            failures.append('El panel debe mostrar el orden inverso de publicación')
        if '2/3' not in panel.recording_text.get() or hasattr(panel, 'preview'):
            failures.append('El progreso debe mostrarse sin vista previa')
        if screenshot:
            capture_window(root, screenshot)
        window.panels['1'].stop()
        wait_for(lambda: not window.panels['1'].controller.running and window.panels['1'].mode == 'stopped',
                 stop_second, 'No se detuvo el primer bot')

    def stop_second():
        if not window.panels['2'].controller.running:
            failures.append('La parada debe afectar solo al bot seleccionado')
        window.panels['2'].stop()
        wait_for(lambda: not window.panels['2'].controller.running and window.panels['2'].mode == 'stopped',
                 check_session_controls, 'No se detuvo el segundo bot')

    def check_session_controls():
        panel = window.panels['1']
        if any(hasattr(panel, name) for name in ('connect_button', 'save_session_button', 'preview')):
            failures.append('La app no debe conectar cuentas ni mostrar vista previa')
        panel.toggle_log()
        panel.toggle_log()
        update_from_server()

    def update_from_server():
        cloud.records['1']['name'] = 'Lilith actualizada'
        cloud.records['1']['creator']['name'] = 'Lilith actualizada'
        cloud.records['1']['revision'] = 2
        del cloud.records['2']
        window.refresh()
        wait_for(lambda: len(window.panels) == 1 and window.panels['1'].profile['name'] == 'Lilith actualizada',
                 finish, 'La app no sincronizó los cambios del panel privado')

    window.refresh()
    wait_for(lambda: len(window.panels) == 2, start, 'No se cargaron las configuraciones')
    root.mainloop()
    for panel in window.panels.values():
        if panel.controller.thread:
            panel.controller.thread.join(timeout=1)
    if failures:
        raise RuntimeError('; '.join(failures))


def capture_window(root, target):
    if sys.platform != 'win32':
        return
    import subprocess
    x, y, width, height = root.winfo_rootx(), root.winfo_rooty(), root.winfo_width(), root.winfo_height()
    path = str(Path(target).resolve()).replace("'", "''")
    script = ("Add-Type -AssemblyName System.Drawing; "
              f"$b=New-Object System.Drawing.Bitmap({width},{height}); "
              "$g=[System.Drawing.Graphics]::FromImage($b); "
              f"$g.CopyFromScreen({x},{y},0,0,$b.Size); "
              f"$b.Save('{path}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()")
    subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], check=True, timeout=15,
                   creationflags=subprocess.CREATE_NO_WINDOW)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', action='version', version='Dropper 1.0')
    parser.add_argument('--smoke-test', action='store_true')
    parser.add_argument('--screenshot')
    parser.add_argument('--connection-test', metavar='REPORT')
    args = parser.parse_args()
    if args.connection_test:
        import json
        result = {'version':'4.0.1'}
        try:
            client = CloudClient('dropper-connectivity-check')
            health = client.request('GET','/health')
            if health.get('service') != 'dropper':
                raise CloudError('Respuesta de configuración inválida')
            try:
                client.list_profiles()
            except AccessDenied:
                pass
            else:
                raise CloudError('La descarga no está protegida por contraseña')
            result['status']='ok'
        except Exception as error:
            result['status']='error'
            result['error']=str(error) if isinstance(error,CloudError) else type(error).__name__
        Path(args.connection_test).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
        sys.exit(0 if result['status']=='ok' else 1)
    if args.smoke_test:
        smoke_test(args.screenshot)
    else:
        from recorder import ROOT
        from retention import prune_generated
        prune_generated(ROOT)
        root = tk.Tk()
        DropperWindow(root)
        root.mainloop()


if __name__ == '__main__':
    main()
