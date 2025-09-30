import io
import json
import os
import sys
from pathlib import Path

import pytest
from werkzeug.datastructures import FileStorage

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import app, _save_attachments, _format_attachments


@pytest.fixture
def temp_upload_dir(tmp_path, monkeypatch):
    upload_dir = tmp_path / "download"
    upload_dir.mkdir()
    with app.app_context():
        monkeypatch.setitem(app.config, 'UPLOAD_FOLDER', str(upload_dir))
        yield upload_dir


def test_save_attachments_creates_hierarchy(temp_upload_dir):
    with app.app_context():
        file_storage = FileStorage(stream=io.BytesIO(b'demo data'), filename='example.txt')
        saved_paths = _save_attachments(
            [file_storage],
            product_name='产品A',
            batch_number='批次01',
            process_segment='工段#1',
            category='materials'
        )

    assert len(saved_paths) == 1
    relative_path = saved_paths[0]
    saved_file = Path(temp_upload_dir, relative_path)
    assert saved_file.exists()
    assert saved_file.read_bytes() == b'demo data'


def test_format_attachments_returns_name_and_url(temp_upload_dir):
    relative_path = os.path.join('产品A', '批次01', '工段#1', 'materials', 'example.txt')
    target_file = Path(temp_upload_dir, relative_path)
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_bytes(b'data')

    with app.app_context():
        with app.test_request_context('/'):
            formatted = _format_attachments(json.dumps([relative_path]))

    assert formatted
    entry = formatted[0]
    assert entry['name'] == 'example.txt'
    assert entry['path'] == relative_path
    assert entry['url'].startswith('/download/')
