import importlib.util
import json
import tempfile
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('repair', Path(__file__).with_name('repair-staged-downloads.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    stage = root / '.wrc-recovery'
    stage.mkdir()
    (stage / '1.bin').write_bytes(b'valid-data')
    paths = ['ACS21/' + ('Long folder ' * 8).rstrip() + '/' + ('Another folder ' * 6).rstrip() + '/file.pdf', 'ACS21/empty.pdf', '../escape.pdf', 'ACS21/preserved.pdf']
    for i, path in enumerate(paths):
        repair.write_json(stage / f'1-{i}.job.json', dict(schema=1, id='1', relativePath=path, dataName='1.bin', size=10))
    (root / 'ACS21').mkdir()
    (root / 'ACS21' / 'empty.pdf').touch()
    (root / 'ACS21' / 'preserved.pdf').write_bytes(b'keep')
    results = repair.recover(root)
    assert sum(item['status'] == 'completed' for item in results) == 2, results
    assert sum(item['status'] == 'failed' for item in results) == 2, results
    assert (root / 'ACS21' / 'preserved.pdf').read_bytes() == b'keep'
    assert not (root.parent / 'escape.pdf').exists()
    assert repair.read_json(root / '.wrc-download-manifest.json')['copies']['ACS21/empty.pdf']['size'] == 10
    with open(repair.native(root / paths[0]), 'rb') as stream:
        assert stream.read() == b'valid-data'
    repair.write_json(stage / 'verify.request.json', {'requestId': 'test-audit'})
    sys.argv=['repair-staged-downloads.py','--root',str(root),'--wait-seconds','0']
    repair.main()
    audit=repair.read_json(stage / 'verify.response.json')
    assert audit['requestId']=='test-audit'
    assert audit['copies'][paths[0]]=={'exists':True,'size':10}
print('Native recovery checks passed: long paths, zero placeholders, manifest, traversal rejection, positive-file preservation.')
