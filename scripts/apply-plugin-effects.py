"""Host adapter: call the installed official plugin locally, without uploads/cloud saves."""
import json
import sys
from pathlib import Path

plugin, request_path, output_path = map(Path, sys.argv[1:4])
metadata = json.loads((plugin / '.codex-plugin' / 'plugin.json').read_text(encoding='utf-8'))
if metadata.get('name') != 'CapCut' or metadata.get('version') != '0.2.6':
    raise ValueError('Update the official CapCut builder adapter for this installed version.')
sys.path.insert(0, str(plugin / 'skills' / 'capcut-stdraft-builder' / 'scripts'))
from apply_materials import apply_video, apply_video_effect
from manage_materials import update_material

request = json.loads(request_path.read_text(encoding='utf-8-sig'))
# Local asset URI resolves only through the caller's source mapping. This working
# STDraft is never pushed to CapCut Web and does not claim a cloud asset exists.
draft = {'version': '0.1.0', 'segments': [{'id': 'draft', 'type': 'DRAFT', 'attributes': {
    'width': request['width'], 'height': request['height'], 'ratio_type': 'custom'}}]}
base = apply_video(draft, source='asset://ai-editor-local-source', start_ms=0, duration_ms=request['durationMs'])
draft = base['draft']
operations = []
for effect in request['effects']:
    result = apply_video_effect(draft, source=effect['source'], start_ms=effect['startMs'], duration_ms=effect['durationMs'])
    segment_id = result['added_segment_ids'][0]
    if effect['controls']:
        result = update_material(result['draft'], segment_id, **effect['controls'])
    if not result['check_result']['valid']:
        raise ValueError('Official builder did not validate this effect operation.')
    draft = result['draft']
    segment = next(item for item in draft['segments'] if item['id'] == segment_id)
    operations.append({'index': effect['index'], 'segment': segment, 'warnings': result['warnings'], 'check_result': result['check_result']})
output_path.write_text(json.dumps({'provider': 'official-capcut-local-builder', 'version': metadata['version'],
    'draft': draft, 'operations': operations, 'cloudSaved': False, 'mediaUploaded': False}), encoding='utf-8')
