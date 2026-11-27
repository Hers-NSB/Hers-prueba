"""Save the current Drop per bot, model and Telegram chat before sending changes."""
import json
from time import monotonic, time

from cloud_client import CloudError
from config import log

from core import Batch, Post
import recorder


class BatchJournal:
    def __init__(self, bot_id):
        self.root = recorder.ROOT / 'private' / 'drops' / str(int(bot_id))

    def bind(self, username, user_id):
        path = self.root / 'telegram-users.json'
        users = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        if username not in users:
            users[username] = user_id
            recorder.save_json(path, users)
        return users[username] == user_id

    def path(self, chat_id, creator_id):
        return self.root / f'{int(creator_id)}-{int(chat_id)}.json'

    def save(self, chat_id, batch):
        if batch.status == 'cancelled':
            recorder.save_json(self.path(chat_id, batch.creator.external_id), {'status': 'cancelled'})
            return
        data = {
            'id': batch.id, 'status': batch.status, 'cursor': batch.cursor,
            'order': batch.order, 'manual': batch.manual, 'skipped': batch.skipped,
            'published_ids': batch.published_ids,
            'received': {str(k): [v.text, v.photo_id] for k, v in batch.received.items()},
            'rejected': sorted(batch.rejected), 'cleanup_ids': sorted(batch.cleanup_ids),
            'awaiting_confirmation': batch.awaiting_confirmation, 'failed': batch.failed,
            'uncertain': batch.uncertain, 'recovery_delivered': batch.recovery_delivered,
            'slow': batch.slow, 'started_wall_at': batch.started_wall_at,
            'session_total': batch.session_total,
            'retry_until': time() + max(0, batch.retry_at - monotonic()) if batch.retry_at else None,
        }
        recorder.save_json(self.path(chat_id, batch.creator.external_id), data)

    def queue_publication(self, batch, *, manual=False):
        position = batch.cursor
        path = self.root / 'publications' / f'{batch.id}-{position}.json'
        if not path.exists():
            recorder.save_json(path, {
                'drop_id': batch.id, 'position': position,
                'creator_id': int(batch.creator.external_id), 'creator_name': batch.creator.name[:256],
                'post_id': batch.published_ids[position], 'manual': manual,
                'confirmed_at': int(time()),
            })

    def queue_recording(self, batch, *, completed):
        state = 'complete' if completed else 'incomplete'
        path = self.root / 'recordings' / f'{batch.id}-{state}.json'
        recorder.save_json(path, {'creator_id': int(batch.creator.external_id),
                                  'drop_id': batch.id, 'completed': completed})

    def sync_publications(self, client, stop):
        directory = self.root / 'publications'
        recordings = self.root / 'recordings'
        while not stop.is_set():
            sent = False
            try:
                paths = sorted(directory.glob('*.json'))[:50]
                if paths:
                    records = [json.loads(path.read_text(encoding='utf-8')) for path in paths]
                    client.report_publications(records)
                    for path in paths:
                        path.unlink(missing_ok=True)
                    sent = True
            except (CloudError, OSError, ValueError) as error:
                log.warning('Resumen de Drops pendiente de sincronizar (%s)', type(error).__name__)
            try:
                path = next(iter(sorted(recordings.glob('*.json'))), None)
                if path:
                    record = json.loads(path.read_text(encoding='utf-8'))
                    client.report_drop_recording(**record)
                    path.unlink(missing_ok=True)
                    sent = True
            except (CloudError, OSError, ValueError) as error:
                log.warning('Grabación de Drop pendiente de sincronizar (%s)', type(error).__name__)
            if not sent:
                stop.wait(15)

    def load(self, chat_id, creator):
        path = self.path(chat_id, creator.external_id)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding='utf-8'))
        if data['status'] == 'cancelled':
            return None
        received = {int(k): Post(*v) for k, v in data['received'].items()}
        published_ids = {int(k): v for k, v in data['published_ids'].items()}
        retry_until = data.pop('retry_until', None)
        data.update(received=received, published_ids=published_ids,
                    rejected=set(data['rejected']), cleanup_ids=set(data['cleanup_ids']))
        if data['status'] == 'publishing':
            data['status'] = 'paused'
            data['failed'] = data['uncertain'] = data['awaiting_confirmation']
        if data['started_wall_at']:
            data['started_at'] = monotonic() - max(0, time() - data['started_wall_at'])
        if retry_until:
            data['retry_at'] = monotonic() + max(0, retry_until - time())
        return Batch(creator, **data)
