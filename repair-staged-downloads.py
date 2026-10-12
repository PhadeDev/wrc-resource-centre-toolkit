"""Finish Toolkit recovery jobs using Windows long paths. No network access."""
import argparse
import json
import os
import shutil
import time
import uuid
from pathlib import Path


def native(path):
    absolute = os.path.abspath(path)
    if os.name != 'nt':
        return absolute
    return '\\\\?\\UNC\\' + absolute[2:] if absolute.startswith('\\\\') else '\\\\?\\' + absolute


def read_json(path):
    with open(native(path), encoding='utf-8-sig') as stream:
        return json.load(stream)


def write_json(path, data):
    temporary = str(path) + '.tmp'
    with open(native(temporary), 'w', encoding='utf-8') as stream:
        json.dump(data, stream, indent=2)
    os.replace(native(temporary), native(path))


def recover(root):
    root = Path(root).resolve(strict=True)
    stage = root / '.wrc-recovery'
    stage_resolved = stage.resolve(strict=True)
    if stage_resolved.parent != root:
        raise ValueError('Recovery staging must be inside the selected root.')
    manifest_path = root / '.wrc-download-manifest.json'
    manifest = read_json(manifest_path) if os.path.exists(native(manifest_path)) else {'schema': 1, 'copies': {}}
    if manifest.get('schema') != 1 or not isinstance(manifest.get('copies'), dict):
        raise ValueError('Invalid manifest.')
    results = []
    for name in sorted(os.listdir(native(stage))):
        if not name.endswith('.job.json'):
            continue
        job_path = stage / name
        job = read_json(job_path)
        if job.get('processed'):
            continue
        result = {'job': name, 'relativePath': job.get('relativePath'), 'id': job.get('id')}
        try:
            relative = job.get('relativePath', '')
            parts = relative.split('/')
            if job.get('schema') != 1 or not relative or any(p in ('', '.', '..') or p.endswith(('.', ' ')) or any(c in p for c in '\\:*?"<>|') for p in parts):
                raise ValueError('Unsafe relative destination.')
            target = root.joinpath(*parts).resolve()
            if not target.is_relative_to(root):
                raise ValueError('Destination escapes selected root.')
            data_name = job.get('dataName', '')
            if data_name != str(job.get('id')) + '.bin' or not str(job.get('id')).isdigit():
                raise ValueError('Unsafe staging filename.')
            source = (stage / data_name).resolve(strict=True)
            if source.parent != stage_resolved or not isinstance(job.get('size'), int) or job['size'] <= 0 or os.path.getsize(native(source)) != job['size']:
                raise ValueError('Staged file size or location does not match job.')
            if os.path.exists(native(target)) and os.path.getsize(native(target)) > 0:
                if os.path.getsize(native(target)) != job['size']:
                    raise ValueError('Non-empty destination has different size; preserved.')
                result['status'] = 'existing'
            else:
                os.makedirs(native(target.parent), exist_ok=True)
                # Atomic promotion in the destination folder; all paths use the extended namespace.
                temporary = target.parent / ('.wrc-' + str(job['id']) + '-' + uuid.uuid4().hex + '.tmp')
                with open(native(source), 'rb') as incoming, open(native(temporary), 'xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                if os.path.getsize(native(temporary)) != job['size']:
                    raise ValueError('Temporary copy size mismatch.')
                # Preserve any non-empty destination appearing while the copy was made.
                if os.path.exists(native(target)) and os.path.getsize(native(target)) > 0:
                    raise ValueError('Destination appeared during recovery; preserved.')
                os.replace(native(temporary), native(target))
                result['status'] = 'completed'
            manifest['copies'][relative] = {'id': str(job['id']), 'size': job['size'], 'status': 'completed', 'native': True, 'savedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            write_json(manifest_path, manifest)
            job['processed'] = True
            write_json(job_path, job)
        except Exception as error:
            result.update(status='failed', error=str(error))
        results.append(result)
    write_json(stage / 'recovery-results.json', {'results': results})
    if not any(item['status'] == 'failed' for item in results):
        ready = stage / 'run.ready.json'
        if os.path.exists(native(ready)):
            os.replace(native(ready), native(stage / 'run.processed.json'))
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--wait-seconds', type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.wait_seconds <= 3600:
        parser.error('wait-seconds must be between 0 and 3600')
    root = Path(args.root).resolve(strict=True)
    deadline = time.monotonic() + args.wait_seconds
    last_request = None
    last_ready = None
    print('Recovery helper active for selected root; bounded to requested duration.', flush=True)
    while True:
        stage = root / '.wrc-recovery'
        request_path = stage / 'verify.request.json'
        if os.path.exists(native(request_path)):
            request = read_json(request_path)
            if request.get('requestId') != last_request:
                manifest = read_json(root / '.wrc-download-manifest.json')
                copies = {}
                for label, entry in manifest.get('copies', {}).items():
                    parts = label.split('/')
                    if any(p in ('', '.', '..') or any(c in p for c in '\\:*?"<>|') for p in parts):
                        continue
                    target = root.joinpath(*parts).resolve()
                    if not target.is_relative_to(root):
                        continue
                    exists = os.path.isfile(native(target))
                    copies[label] = {'exists': exists, 'size': os.path.getsize(native(target)) if exists else 0}
                write_json(stage / 'verify.response.json', {'requestId': request.get('requestId'), 'copies': copies})
                last_request = request.get('requestId')
        ready = stage / 'run.ready.json'
        if os.path.exists(native(ready)):
            batch = read_json(ready)
            if batch.get('runId') != last_ready:
                results = recover(root)
                failed = sum(item['status'] == 'failed' for item in results)
                print(f'Recovery checked {len(results)} copies; {failed} failures. See .wrc-recovery/recovery-results.json.', flush=True)
                last_ready = batch.get('runId')
        if time.monotonic() >= deadline:
            print('Recovery helper finished at its time limit.', flush=True)
            return
        time.sleep(0.5)


if __name__ == '__main__':
    main()
