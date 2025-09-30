import secrets
import sqlite3
import os
from contextlib import closing
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_file, send_from_directory, g
from database import Database
import config
import json
import csv
import io
from datetime import datetime, timedelta
from functools import wraps
from werkzeug.utils import secure_filename


class AttachmentValidationError(ValueError):
    """Raised when uploaded files do not meet attachment requirements."""

    def __init__(self, invalid_files):
        message = '不支持的附件类型: ' + '、'.join(invalid_files)
        super().__init__(message)
        self.invalid_files = invalid_files

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH

db = Database(config.DATABASE)


def _row_to_dict(row):
    if row is None:
        return {}
    if isinstance(row, dict):
        return row
    try:
        return dict(row)
    except TypeError:
        return {}


def _serialize_batch(row):
    data = _row_to_dict(row)
    if not data:
        return {}
    equipment_start = data.pop('equipment_start_time', None)
    equipment_end = data.pop('equipment_end_time', None)
    start_time = equipment_start if equipment_start else data.get('start_time')
    end_time = equipment_end if equipment_end else data.get('end_time')
    return {
        'id': data.get('id'),
        'batch_number': data.get('batch_number'),
        'product_name': data.get('product_name'),
        'process_segment': data.get('process_segment'),
        'status': data.get('status'),
        'start_time': start_time,
        'end_time': end_time,
        'created_by': data.get('created_by'),
        'created_by_name': data.get('created_by_name'),
        'material_count': data.get('material_count', 0),
        'equipment_count': data.get('equipment_count', 0),
        'quality_count': data.get('quality_count', 0)
    }


def _serialize_material(row):
    data = _row_to_dict(row)
    if not data:
        return {}
    attributes = _safe_load_json(data.pop('attributes_json', {}), {})
    data['attributes'] = attributes
    data['attachments'] = _format_attachments(data.pop('attachments_json', '[]'))
    return data


def _serialize_equipment(row):
    data = _row_to_dict(row)
    if not data:
        return {}
    data['parameters'] = _safe_load_json(data.get('parameters_json', {}), {})
    data['attachments'] = _format_attachments(data.pop('attachments_json', '[]'))
    return data


def _serialize_quality(row):
    data = _row_to_dict(row)
    if not data:
        return {}
    attributes = _safe_load_json(data.pop('attributes_json', {}), {})
    data['attributes'] = attributes
    data['attachments'] = _format_attachments(data.pop('attachments_json', '[]'))
    return data


def _delete_batch_records(cursor, batch_id):
    """Remove a batch and its related detail records."""
    cursor.execute("DELETE FROM material_records WHERE batch_id = ?", (batch_id,))
    cursor.execute("DELETE FROM equipment_records WHERE batch_id = ?", (batch_id,))
    cursor.execute("DELETE FROM quality_records WHERE batch_id = ?", (batch_id,))
    cursor.execute("DELETE FROM batches WHERE id = ?", (batch_id,))


def _format_attachments(raw_attachments):
    attachments = _safe_load_json(raw_attachments, [])
    formatted = []
    if not attachments:
        return formatted

    for relative_path in attachments:
        if not relative_path:
            continue
        filename = os.path.basename(relative_path)
        formatted.append({
            'name': filename,
            'path': relative_path,
            'url': url_for('download_attachment', filename=relative_path, _external=False)
        })
    return formatted



def _sanitize_path_component(value, default_label):
    if value is None:
        return default_label
    component = str(value).strip().replace('/', '_').replace('\\', '_')
    if component in ('', '.', '..'):
        return default_label
    return component


def _is_allowed_attachment(storage):
    allowed_prefixes = getattr(config, 'ALLOWED_ATTACHMENT_MIME_PREFIXES', None)
    allowed_extensions = getattr(config, 'ALLOWED_ATTACHMENT_EXTENSIONS', None)

    if not allowed_prefixes and not allowed_extensions:
        return True

    filename = (storage.filename or '').strip()
    mimetype = (storage.mimetype or '').lower()
    extension = os.path.splitext(filename)[1].lower()

    if allowed_prefixes:
        for prefix in allowed_prefixes:
            if mimetype.startswith(prefix.lower()):
                return True

    if allowed_extensions and extension in {ext.lower() for ext in allowed_extensions}:
        return True

    return False


def _save_attachments(file_storage_list, product_name, batch_number, process_segment, category, existing=None):
    saved = list(existing or [])
    if not file_storage_list:
        return saved

    product_folder = _sanitize_path_component(product_name, 'unknown_product')
    batch_folder = _sanitize_path_component(batch_number, 'unknown_batch')
    segment_folder = _sanitize_path_component(process_segment, 'unknown_segment')
    category_folder = _sanitize_path_component(category, 'misc')

    relative_folder = os.path.join(product_folder, batch_folder, segment_folder, category_folder)
    base_folder = os.path.join(app.config['UPLOAD_FOLDER'], relative_folder)
    os.makedirs(base_folder, exist_ok=True)

    invalid_files = []
    new_relative_paths = []
    new_absolute_paths = []

    for storage in file_storage_list:
        if not storage or not storage.filename:
            continue

        filename = secure_filename(storage.filename)
        if not filename:
            continue

        if not _is_allowed_attachment(storage):
            invalid_files.append(filename)
            continue

        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S%f')
        unique_name = f"{timestamp}_{filename}"
        relative_path = os.path.join(relative_folder, unique_name)
        absolute_path = os.path.join(base_folder, unique_name)

        storage.save(absolute_path)
        new_relative_paths.append(relative_path)
        new_absolute_paths.append(absolute_path)

    if invalid_files:
        for path in new_absolute_paths:
            try:
                os.remove(path)
            except OSError:
                continue
        raise AttachmentValidationError(invalid_files)

    saved.extend(new_relative_paths)
    return saved


def _extract_payload_and_files():
    if request.is_json:
        return request.get_json() or {}, [], []

    payload_raw = request.form.get('payload')
    if payload_raw:
        try:
            payload = json.loads(payload_raw)
        except json.JSONDecodeError:
            payload = {}
    else:
        payload = request.form.to_dict()

    files = request.files.getlist('attachments')
    existing_raw = request.form.get('existing_attachments')
    try:
        existing = json.loads(existing_raw) if existing_raw else []
    except json.JSONDecodeError:
        existing = []

    return payload, files, existing


def _fetch_material_records(conn, batch_id):
    cursor = conn.cursor()
    cursor.execute('''
        SELECT m.*, u.username as recorded_by_name
        FROM material_records m
        JOIN users u ON m.recorded_by = u.id
        WHERE m.batch_id = ?
        ORDER BY m.record_time DESC
    ''', (batch_id,))
    rows = cursor.fetchall()
    return [_serialize_material(row) for row in rows]


def _fetch_equipment_records(conn, batch_id):
    cursor = conn.cursor()
    cursor.execute('''
        SELECT e.*, u.username as recorded_by_name
        FROM equipment_records e
        JOIN users u ON e.recorded_by = u.id
        WHERE e.batch_id = ?
        ORDER BY e.start_time DESC
    ''', (batch_id,))
    rows = cursor.fetchall()
    return [_serialize_equipment(row) for row in rows]


def _fetch_quality_records(conn, batch_id):
    cursor = conn.cursor()
    cursor.execute('''
        SELECT q.*, u.username as tested_by_name
        FROM quality_records q
        JOIN users u ON q.tested_by = u.id
        WHERE q.batch_id = ?
        ORDER BY q.test_time DESC
    ''', (batch_id,))
    rows = cursor.fetchall()
    return [_serialize_quality(row) for row in rows]


def _collect_batch_segments(conn, batch_number, product_name):
    current_user = get_current_user() or {}
    role = current_user.get('role') or ''
    hide_quality = role == 'write_material'

    cursor = conn.cursor()
    cursor.execute('''
        SELECT b.*, u.username as created_by_name
        FROM batches b
        JOIN users u ON b.created_by = u.id
        WHERE b.batch_number = ? AND b.product_name = ?
        ORDER BY b.start_time ASC
    ''', (batch_number, product_name))
    segments = []
    for row in cursor.fetchall():
        batch_info = _serialize_batch(row)
        if hide_quality:
            batch_info['quality_count'] = 0
        batch_id = batch_info.get('id')
        materials = _fetch_material_records(conn, batch_id)
        equipment = _fetch_equipment_records(conn, batch_id)
        quality = [] if hide_quality else _fetch_quality_records(conn, batch_id)
        if not hide_quality:
            batch_info['quality_count'] = len(quality)

        segments.append({
            'batch': batch_info,
            'materials': materials,
            'equipment': equipment,
            'quality': quality,
            'counts': {
                'materials': len(materials),
                'equipment': len(equipment),
                'quality': len(quality)
            }
        })
    return segments


def _extract_token_from_request():
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header.split(' ', 1)[1].strip()

    token = request.headers.get('X-Auth-Token')
    if token:
        return token.strip()

    token = request.args.get('token')
    if token:
        return token.strip()

    return None


def get_current_user():
    if hasattr(g, 'current_user') and g.current_user:
        return g.current_user

    if 'user_id' in session:
        user_context = {
            'id': session['user_id'],
            'username': session.get('username'),
            'role': session.get('role'),
            'token': session.get('api_token')
        }
        g.current_user = user_context
        return user_context

    token = _extract_token_from_request()
    if token:
        session_info = db.get_user_session(token)
        if session_info:
            db.touch_user_session(token)
            user_context = {
                'id': session_info['user_id'],
                'username': session_info['username'],
                'role': session_info['role'],
                'token': token,
                'device': session_info.get('device')
            }
            g.current_user = user_context
            return user_context

    return None


def build_template_context(active_page=None):
    user = get_current_user()
    username = user.get('username') if user else ''
    role = user.get('role') if user else ''

    can_access_record = role in ('admin', 'write', 'write_material', 'write_quality')
    can_access_query = role in ('admin', 'read')
    can_access_dashboard = role in ('admin', 'read')

    return {
        'username': username,
        'role': role,
        'can_access_record': can_access_record,
        'can_access_query': can_access_query,
        'can_access_dashboard': can_access_dashboard,
        'active_page': active_page or '',
        'completed_status': getattr(config, 'BATCH_COMPLETED_STATUS', '已完成')
    }


def _safe_load_json(raw_value, default=None):
    if raw_value in (None, '', b''):
        return default if default is not None else {}
    try:
        if isinstance(raw_value, bytes):
            raw_value = raw_value.decode('utf-8')
        return json.loads(raw_value)
    except (json.JSONDecodeError, TypeError, ValueError):
        return default if default is not None else {}


def _convert_field_value(value, field_type, field_config):
    if value in (None, ''):
        return None, None

    if field_type in ('text', 'textarea'):
        return str(value).strip(), None

    if field_type == 'number':
        try:
            return float(value), None
        except (TypeError, ValueError):
            label = field_config.get('label') or field_config.get('key')
            return None, f"{label} 需要为数值类型"

    if field_type == 'integer':
        try:
            return int(value), None
        except (TypeError, ValueError):
            label = field_config.get('label') or field_config.get('key')
            return None, f"{label} 需要为整数"

    if field_type == 'boolean':
        if isinstance(value, bool):
            return value, None
        str_val = str(value).strip().lower()
        if str_val in ('true', '1', 'yes', 'y', '是'):
            return True, None
        if str_val in ('false', '0', 'no', 'n', '否'):
            return False, None
        label = field_config.get('label') or field_config.get('key')
        return None, f"{label} 需要为布尔类型"

    if field_type == 'select':
        options = field_config.get('options') or []
        if options and value not in options:
            label = field_config.get('label') or field_config.get('key')
            return None, f"{label} 的取值必须在 {options} 中"
        return value, None

    # datetime/date/time 等类型默认以字符串处理
    return value, None


def _collect_structured_data(payload, field_config, extra_section='extras'):
    payload = payload or {}
    errors = []
    columns = {}

    for field in field_config.get('columns', []):
        key = field['key']
        column_name = field.get('column', key)
        raw_value = payload.get(key)

        if raw_value in (None, ''):
            if 'default' in field:
                raw_value = field['default']
            elif field.get('required'):
                label = field.get('label') or key
                errors.append(f"{label} 为必填项")
                continue

        if raw_value in (None, ''):
            columns[column_name] = None
            continue

        converted, error = _convert_field_value(raw_value, field.get('type', 'text'), field)
        if error:
            errors.append(error)
            continue
        columns[column_name] = converted

    extras = {}
    extra_payload = {}
    configured_extra_fields = {field['key']: field for field in field_config.get(extra_section, [])}

    if isinstance(payload.get(extra_section), dict):
        extra_payload.update(payload.get(extra_section))

    # 支持顶层直接传递扩展字段
    for key in configured_extra_fields.keys():
        if key in payload and key not in extra_payload:
            extra_payload[key] = payload.get(key)

    for key, field in configured_extra_fields.items():
        value = extra_payload.get(key)
        if value in (None, ''):
            if field.get('required'):
                label = field.get('label') or key
                errors.append(f"{label} 为必填项")
            continue

        converted, error = _convert_field_value(value, field.get('type', 'text'), field)
        if error:
            errors.append(error)
            continue
        extras[key] = converted

    # 保留未配置但传入的扩展字段，便于前端自定义
    for key, value in extra_payload.items():
        if key not in extras and value not in (None, ''):
            extras[key] = value

    return columns, extras, errors


def _prepare_material_payload(data):
    return _collect_structured_data(data, config.MATERIAL_RECORD_FIELDS, extra_section='extras')


def _prepare_quality_payload(data):
    return _collect_structured_data(data, config.QUALITY_RECORD_FIELDS, extra_section='extras')


def _prepare_equipment_payload(data):
    columns, params, errors = _collect_structured_data(data, config.EQUIPMENT_RECORD_FIELDS, extra_section='parameters')
    if errors:
        return columns, params, errors

    # 设备参数支持从 data['parameters'] 直接传入其它键
    existing_params = {}
    if isinstance(data.get('parameters'), dict):
        existing_params.update(data['parameters'])

    # 结合配置校验的参数，优先使用 columns 函数返回的 params（即 extras）
    params = {**existing_params, **params}

    # 移除与列同名的键，避免覆盖
    for field in config.EQUIPMENT_RECORD_FIELDS.get('columns', []):
        params.pop(field['key'], None)

    return columns, params, errors
# 登录验证装饰器
def login_required(role=None):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user = get_current_user()
            if not user:
                return jsonify({'error': '请先登录'}), 401
            if role and user.get('role') not in role:
                return jsonify({'error': '权限不足'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# 路由定义
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('main_page'))
    return redirect(url_for('login_page'))

@app.route('/login', methods=['GET'])
def login_page():
    return render_template('login.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    device = data.get('device') or request.headers.get('X-Client-Device') or request.user_agent.string
    
    user = db.authenticate_user(username, password)
    if user:
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        db.update_last_login(user['id'])
        token = secrets.token_urlsafe(32)
        expires_at = db.create_user_session(
            user_id=user['id'],
            token=token,
            device=device,
            ip_address=request.remote_addr,
            expires_at=datetime.utcnow() + timedelta(hours=config.SESSION_TOKEN_TTL_HOURS)
        )
        session['api_token'] = token

        return jsonify({
            'success': True,
            'user': user,
            'token': token,
            'expires_at': expires_at
        })
    else:
        return jsonify({'success': False, 'error': '用户名或密码错误'})

@app.route('/logout', methods=['GET', 'POST'])
def logout():
    token = _extract_token_from_request()
    if token:
        db.delete_user_session(token)

    session_token = session.get('api_token')
    if session_token:
        db.delete_user_session(session_token)

    session.clear()

    if request.method == 'POST' or request.is_json:
        return jsonify({'success': True})

    return redirect(url_for('login_page'))

@app.route('/main')
@login_required()
def main_page():
    return render_template('index.html', **build_template_context(active_page='main'))

@app.route('/record')
@login_required()
def record_page():
    context = build_template_context(active_page='record')
    if not context['can_access_record']:
        return redirect(url_for('main_page'))
    return render_template('record.html', **context)

@app.route('/query')
@login_required()
def query_page():
    context = build_template_context(active_page='query')
    if not context['can_access_query']:
        return redirect(url_for('main_page'))
    return render_template('query.html', **context)

@app.route('/dashboard')
@login_required()
def dashboard_page():
    context = build_template_context(active_page='dashboard')
    if not context['can_access_dashboard'] and context['role'] != 'admin':
        return redirect(url_for('main_page'))
    return render_template('dashboard.html', **context)


@app.route('/api/config/record_fields', methods=['GET'])
@login_required()
def record_field_config():
    return jsonify({
        'materials': config.MATERIAL_RECORD_FIELDS,
        'equipment': config.EQUIPMENT_RECORD_FIELDS,
        'quality': config.QUALITY_RECORD_FIELDS,
        'batch_status_options': getattr(config, 'BATCH_STATUS_OPTIONS', ['进行中', '已完成', '暂停', '异常']),
        'batch_completed_status': getattr(config, 'BATCH_COMPLETED_STATUS', '已完成')
    })


@app.route('/api/segment_definitions', methods=['GET'])
@login_required()
def segment_definitions_config():
    segment = request.args.get('segment')
    definition_type = request.args.get('type')
    definitions = config.get_segment_definitions(segment)

    if definition_type and definition_type in definitions:
        return jsonify(definitions[definition_type])

    return jsonify(definitions)


@app.route('/download/<path:filename>')
@login_required()
def download_attachment(filename):
    safe_path = os.path.normpath(filename)
    if safe_path.startswith('..'):
        return jsonify({'error': '无效的文件路径'}), 400
    return send_from_directory(app.config['UPLOAD_FOLDER'], safe_path, as_attachment=True)

# API端点 - 批号管理
@app.route('/api/batches', methods=['GET'])
@login_required()
def get_batches():
    current_user = get_current_user() or {}
    role = current_user.get('role') or ''
    hide_quality = role == 'write_material'

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT b.*, u.username as created_by_name,
                   (SELECT COUNT(*) FROM material_records WHERE batch_id = b.id) as material_count,
                   (SELECT COUNT(*) FROM equipment_records WHERE batch_id = b.id) as equipment_count,
                   (SELECT COUNT(*) FROM quality_records WHERE batch_id = b.id) as quality_count,
                   (SELECT MIN(start_time) FROM equipment_records WHERE batch_id = b.id) as equipment_start_time,
                   (SELECT MAX(COALESCE(end_time, start_time)) FROM equipment_records WHERE batch_id = b.id) as equipment_end_time
            FROM batches b
            JOIN users u ON b.created_by = u.id
            ORDER BY b.start_time DESC
        ''')
        rows = cursor.fetchall()

    pipeline_segments = config.get_process_segments()
    pipeline_length = len(pipeline_segments) if pipeline_segments else 1

    aggregated = {}

    for row in rows:
        batch = _serialize_batch(row)
        if hide_quality:
            batch['quality_count'] = 0
        key = (batch.get('batch_number'), batch.get('product_name'))
        group = aggregated.setdefault(key, {
            'latest': None,
            'segments': [],
            'material_total': 0,
            'equipment_total': 0,
            'quality_total': 0
        })

        group['segments'].append(batch)
        group['material_total'] += batch.get('material_count', 0) or 0
        group['equipment_total'] += batch.get('equipment_count', 0) or 0
        group['quality_total'] += batch.get('quality_count', 0) or 0

        latest = group['latest']
        if latest is None or (batch.get('start_time') or '') > (latest.get('start_time') or ''):
            group['latest'] = batch

    response = []

    for (batch_number, product_name), group in aggregated.items():
        latest = group['latest'] or {}
        display_batch = dict(latest)

        process_segment = latest.get('process_segment')
        stage_index = 0
        if process_segment and pipeline_segments:
            try:
                stage_index = pipeline_segments.index(process_segment)
            except ValueError:
                stage_index = 0

        if latest.get('status') == getattr(config, 'BATCH_COMPLETED_STATUS', '已完成'):
            stage_progress = 100
        else:
            stage_progress = round(((stage_index + 1) / pipeline_length) * 100) if pipeline_length else 0

        display_batch.update({
            'batch_number': batch_number,
            'product_name': product_name,
            'material_count': group['material_total'],
            'equipment_count': group['equipment_total'],
            'quality_count': 0 if hide_quality else group['quality_total'],
            'segment_count': len(group['segments']),
            'stage_index': stage_index,
            'stage_progress': stage_progress,
            'segment_summaries': [
                {
                    'batch_id': seg.get('id'),
                    'process_segment': seg.get('process_segment'),
                    'status': seg.get('status'),
                    'start_time': seg.get('start_time'),
                    'end_time': seg.get('end_time'),
                    'material_count': seg.get('material_count', 0) or 0,
                    'equipment_count': seg.get('equipment_count', 0) or 0,
                    'quality_count': 0 if hide_quality else (seg.get('quality_count', 0) or 0)
                }
                for seg in group['segments']
            ]
        })

        if hide_quality:
            display_batch['quality_total'] = 0

        response.append(display_batch)

    response.sort(key=lambda item: (item.get('start_time') or ''), reverse=True)

    return jsonify(response)

@app.route('/api/batches', methods=['POST'])
@login_required(role=['admin', 'write', 'write_material'])
def create_batch():
    data = request.get_json()
    batch_number = data.get('batch_number')
    product_name = data.get('product_name')
    process_segment = data.get('process_segment')
    current_user = get_current_user()
    
    if not batch_number or not product_name or not process_segment:
        return jsonify({'error': '缺少必要参数'}), 400
    
    try:
        with closing(db.get_connection()) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO batches (batch_number, product_name, process_segment, created_by) VALUES (?, ?, ?, ?)",
                (batch_number, product_name, process_segment, current_user['id'])
            )
            batch_id = cursor.lastrowid
            conn.commit()

            cursor.execute('''
                SELECT b.*, u.username as created_by_name FROM batches b 
                JOIN users u ON b.created_by = u.id WHERE b.id = ?
            ''', (batch_id,))
            row = cursor.fetchone()

        return jsonify(_serialize_batch(row)), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': '批号已存在'}), 400

@app.route('/api/batches/<int:batch_id>/duplicate', methods=['POST'])
@login_required(role=['admin', 'write'])
def duplicate_batch(batch_id):
    payload = request.get_json() or {}

    def _normalize_text(value):
        if value is None:
            return ''
        return str(value).strip()

    new_batch_number = _normalize_text(payload.get('batch_number'))
    new_product_name = _normalize_text(payload.get('product_name'))
    requested_segment = _normalize_text(payload.get('process_segment'))

    if not new_batch_number or not new_product_name:
        return jsonify({'error': '新批号和产品名称不能为空'}), 400

    copy_records = payload.get('copy_records', True)
    if isinstance(copy_records, str):
        copy_records = copy_records.strip().lower() not in ('false', '0', 'no', '')
    else:
        copy_records = bool(copy_records)

    allowed_status = getattr(config, 'BATCH_STATUS_OPTIONS', ['进行中', '已完成', '暂停', '异常'])
    completed_status = getattr(config, 'BATCH_COMPLETED_STATUS', '已完成')
    requested_status = payload.get('status')

    if requested_status is not None and requested_status not in allowed_status:
        return jsonify({'error': '状态值无效'}), 400

    current_user = get_current_user()

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM batches WHERE id = ?', (batch_id,))
        original_row = cursor.fetchone()
        if not original_row:
            return jsonify({'error': '源批号不存在'}), 404

        original = _row_to_dict(original_row)
        target_segment = requested_segment or original.get('process_segment') or ''
        if not target_segment:
            return jsonify({'error': '缺少目标工段信息'}), 400

        default_status = original.get('status') or '进行中'
        if default_status == completed_status:
            default_status = '进行中'
        new_status = requested_status or default_status

        cursor.execute(
            '''INSERT INTO batches (batch_number, product_name, process_segment, status, created_by)
               VALUES (?, ?, ?, ?, ?)''',
            (new_batch_number, new_product_name, target_segment, new_status, current_user['id'])
        )
        new_batch_id = cursor.lastrowid

        if copy_records:
            cursor.execute('''
                SELECT material_code, material_name, weight, unit, supplier, lot_number,
                       record_time, recorded_by, attributes_json, attachments_json
                FROM material_records
                WHERE batch_id = ?
            ''', (batch_id,))
            material_rows = cursor.fetchall()
            for material in material_rows:
                cursor.execute('''
                    INSERT INTO material_records 
                    (batch_id, material_code, material_name, weight, unit, supplier, lot_number,
                     record_time, recorded_by, attributes_json, attachments_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    new_batch_id,
                    material['material_code'],
                    material['material_name'],
                    material['weight'],
                    material['unit'],
                    material['supplier'],
                    material['lot_number'],
                    material['record_time'],
                    material['recorded_by'],
                    material['attributes_json'] or '{}',
                    material['attachments_json'] or '[]'
                ))

            cursor.execute('''
                SELECT equipment_code, equipment_name, parameters_json, start_time, end_time,
                       status, recorded_by, attachments_json
                FROM equipment_records
                WHERE batch_id = ?
            ''', (batch_id,))
            equipment_rows = cursor.fetchall()
            for equipment in equipment_rows:
                cursor.execute('''
                    INSERT INTO equipment_records
                    (batch_id, equipment_code, equipment_name, parameters_json, start_time, end_time,
                     status, recorded_by, attachments_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    new_batch_id,
                    equipment['equipment_code'],
                    equipment['equipment_name'],
                    equipment['parameters_json'] or '{}',
                    equipment['start_time'],
                    equipment['end_time'],
                    equipment['status'],
                    equipment['recorded_by'],
                    equipment['attachments_json'] or '[]'
                ))

            cursor.execute('''
                SELECT test_item, test_value, unit, standard_min, standard_max, result,
                       test_time, tested_by, notes, attributes_json, attachments_json
                FROM quality_records
                WHERE batch_id = ?
            ''', (batch_id,))
            quality_rows = cursor.fetchall()
            for quality in quality_rows:
                cursor.execute('''
                    INSERT INTO quality_records
                    (batch_id, test_item, test_value, unit, standard_min, standard_max, result,
                     test_time, tested_by, notes, attributes_json, attachments_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    new_batch_id,
                    quality['test_item'],
                    quality['test_value'],
                    quality['unit'],
                    quality['standard_min'],
                    quality['standard_max'],
                    quality['result'],
                    quality['test_time'],
                    quality['tested_by'],
                    quality['notes'],
                    quality['attributes_json'] or '{}',
                    quality['attachments_json'] or '[]'
                ))

        conn.commit()

        cursor.execute('''
            SELECT b.*, u.username as created_by_name
            FROM batches b
            JOIN users u ON b.created_by = u.id
            WHERE b.id = ?
        ''', (new_batch_id,))
        new_row = cursor.fetchone()

    return jsonify(_serialize_batch(new_row)), 201


@app.route('/api/batches/<int:batch_id>', methods=['PUT'])
@login_required(role=['admin', 'write', 'write_material'])
def update_batch(batch_id):
    data = request.get_json() or {}

    status = data.get('status')
    process_segment = data.get('process_segment')
    allowed_status = getattr(config, 'BATCH_STATUS_OPTIONS', ['进行中', '已完成', '暂停', '异常'])
    completed_status = getattr(config, 'BATCH_COMPLETED_STATUS', '已完成')

    if status is None and process_segment is None:
        return jsonify({'error': '未提供需要更新的字段'}), 400

    if status is not None and status not in allowed_status:
        return jsonify({'error': '状态值无效'}), 400

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status, process_segment FROM batches WHERE id = ?", (batch_id,))
        current_row = cursor.fetchone()
        if not current_row:
            return jsonify({'error': '批号不存在'}), 404

        updates = []
        params = []

        if status is not None:
            updates.append('status = ?')
            params.append(status)
            end_time = datetime.now() if status == completed_status else None
            updates.append('end_time = ?')
            params.append(end_time)

        if process_segment is not None:
            updates.append('process_segment = ?')
            params.append(process_segment)

        params.append(batch_id)

        cursor.execute(
            f"UPDATE batches SET {', '.join(updates)} WHERE id = ?",
            params
        )
        conn.commit()

        cursor.execute('''
            SELECT b.*, u.username as created_by_name
            FROM batches b
            JOIN users u ON b.created_by = u.id
            WHERE b.id = ?
        ''', (batch_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_batch(row))


@app.route('/api/batches/<int:batch_id>', methods=['DELETE'])
@login_required(role=['admin'])
def delete_batch(batch_id):
    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM batches WHERE id = ?", (batch_id,))
        if not cursor.fetchone():
            return jsonify({'error': '批号不存在'}), 404

        _delete_batch_records(cursor, batch_id)
        conn.commit()

    return jsonify({'success': True, 'deleted': 1})


@app.route('/api/batches/delete', methods=['DELETE'])
@login_required(role=['admin'])
def delete_batch_by_details():
    payload = request.get_json(silent=True) or {}

    product_name = str(payload.get('product_name') or '').strip()
    batch_number = str(payload.get('batch_number') or '').strip()
    process_segment = str(payload.get('process_segment') or '').strip()
    status = str(payload.get('status') or '').strip()

    if not product_name or not batch_number or not process_segment or not status:
        return jsonify({'error': '产品名称、批号、工段和状态均为必填项'}), 400

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id FROM batches
            WHERE product_name = ? AND batch_number = ? AND process_segment = ? AND status = ?
            ''',
            (product_name, batch_number, process_segment, status)
        )
        rows = cursor.fetchall()

        if not rows:
            return jsonify({'error': '未找到匹配的批号记录'}), 404

        deleted = 0
        for row in rows:
            batch_id = row['id'] if isinstance(row, dict) else row[0]
            _delete_batch_records(cursor, batch_id)
            deleted += 1

        conn.commit()

    return jsonify({'success': True, 'deleted': deleted})


# API端点 - 工艺段配置
@app.route('/api/process_segments', methods=['GET'])
@login_required()
def get_process_segments():
    conn = db.get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM process_segments ORDER BY sort_order")
    
    segments = []
    for row in c.fetchall():
        segment = {
            'id': row[0],
            'segment_name': row[1],
            'description': row[2],
            'sort_order': row[3]
        }
        segments.append(segment)
    
    conn.close()
    return jsonify(segments)

# API端点 - 物料记录
@app.route('/api/batches/<int:batch_id>/materials', methods=['GET'])
@login_required()
def get_materials(batch_id):
    current_user = get_current_user()
    if current_user and current_user.get('role') == 'write_quality':
        return jsonify({'error': '权限不足'}), 403

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT m.*, u.username as recorded_by_name 
            FROM material_records m 
            JOIN users u ON m.recorded_by = u.id 
            WHERE m.batch_id = ? 
            ORDER BY m.record_time DESC
        ''', (batch_id,))
        rows = cursor.fetchall()

    return jsonify([_serialize_material(row) for row in rows])

@app.route('/api/batches/<int:batch_id>/materials', methods=['POST'])
@login_required(role=['admin', 'write', 'write_material'])
def add_material(batch_id):
    payload, files, _ = _extract_payload_and_files()
    data = payload
    current_user = get_current_user()
    columns, extra_attributes, errors = _prepare_material_payload(data)

    if errors:
        return jsonify({'error': '；'.join(errors)}), 400

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT batch_number, product_name, process_segment FROM batches WHERE id = ?", (batch_id,))
        batch_row = cursor.fetchone()
        if not batch_row:
            return jsonify({'error': '批号不存在'}), 404

        batch_number, product_name, process_segment = batch_row
        try:
            attachments = _save_attachments(files, product_name, batch_number, process_segment, 'materials')
        except AttachmentValidationError as error:
            return jsonify({'error': str(error)}), 400

        cursor.execute('''
            INSERT INTO material_records 
            (batch_id, material_code, material_name, weight, unit, supplier, lot_number, recorded_by, attributes_json, attachments_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            batch_id,
            columns.get('material_code'),
            columns.get('material_name'),
            columns.get('weight'),
            columns.get('unit'),
            columns.get('supplier'),
            columns.get('lot_number'),
            current_user['id'],
            json.dumps(extra_attributes, ensure_ascii=False),
            json.dumps(attachments, ensure_ascii=False)
        ))

        material_id = cursor.lastrowid
        conn.commit()

        cursor.execute('''
            SELECT m.*, u.username as recorded_by_name 
            FROM material_records m 
            JOIN users u ON m.recorded_by = u.id 
            WHERE m.id = ?
        ''', (material_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_material(row)), 201


@app.route('/api/batches/<int:batch_id>/materials/<int:material_id>', methods=['PUT'])
@login_required(role=['admin', 'write', 'write_material'])
def update_material(batch_id, material_id):
    payload, files, existing_attachments = _extract_payload_and_files()
    data = payload
    current_user = get_current_user()
    columns, extra_attributes, errors = _prepare_material_payload(data)

    if errors:
        return jsonify({'error': '；'.join(errors)}), 400

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT b.batch_number, b.product_name, b.process_segment, m.attachments_json
            FROM material_records m
            JOIN batches b ON m.batch_id = b.id
            WHERE m.id = ? AND m.batch_id = ?
        ''', (material_id, batch_id))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': '记录不存在'}), 404

        batch_number, product_name, process_segment, original_attachments = row
        if not existing_attachments:
            existing_attachments = _safe_load_json(original_attachments, [])

        try:
            attachments = _save_attachments(files, product_name, batch_number, process_segment, 'materials', existing_attachments)
        except AttachmentValidationError as error:
            return jsonify({'error': str(error)}), 400

        cursor.execute(
            '''UPDATE material_records
               SET material_code = ?, material_name = ?, weight = ?, unit = ?, supplier = ?, lot_number = ?,
                   attributes_json = ?, attachments_json = ?, recorded_by = ?, record_time = ?
               WHERE id = ? AND batch_id = ?''',
            (
                columns.get('material_code'),
                columns.get('material_name'),
                columns.get('weight'),
                columns.get('unit'),
                columns.get('supplier'),
                columns.get('lot_number'),
                json.dumps(extra_attributes, ensure_ascii=False),
                json.dumps(attachments, ensure_ascii=False),
                current_user['id'],
                datetime.now(),
                material_id,
                batch_id
            )
        )

        conn.commit()

        cursor.execute('''
            SELECT m.*, u.username as recorded_by_name
            FROM material_records m
            JOIN users u ON m.recorded_by = u.id
            WHERE m.id = ?
        ''', (material_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_material(row))

# API端点 - 设备记录
@app.route('/api/batches/<int:batch_id>/equipment', methods=['GET'])
@login_required()
def get_equipment_records(batch_id):
    current_user = get_current_user()
    if current_user and current_user.get('role') == 'write_quality':
        return jsonify({'error': '权限不足'}), 403

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT e.*, u.username as recorded_by_name 
            FROM equipment_records e 
            JOIN users u ON e.recorded_by = u.id 
            WHERE e.batch_id = ? 
            ORDER BY e.start_time DESC
        ''', (batch_id,))
        rows = cursor.fetchall()

    return jsonify([_serialize_equipment(row) for row in rows])

@app.route('/api/batches/<int:batch_id>/equipment', methods=['POST'])
@login_required(role=['admin', 'write', 'write_material'])
def add_equipment_record(batch_id):
    payload, files, _ = _extract_payload_and_files()
    data = payload
    current_user = get_current_user()
    columns, parameters, errors = _prepare_equipment_payload(data)

    if errors:
        return jsonify({'error': '；'.join(errors)}), 400
    
    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT batch_number, product_name, process_segment FROM batches WHERE id = ?", (batch_id,))
        batch_row = cursor.fetchone()
        if not batch_row:
            return jsonify({'error': '批号不存在'}), 404

        batch_number, product_name, process_segment = batch_row
        parameters_json = json.dumps(parameters, ensure_ascii=False) if parameters else '{}'
        try:
            attachments = _save_attachments(files, product_name, batch_number, process_segment, 'equipment')
        except AttachmentValidationError as error:
            return jsonify({'error': str(error)}), 400

        cursor.execute('''
            INSERT INTO equipment_records 
            (batch_id, equipment_code, equipment_name, parameters_json, start_time, end_time, status, recorded_by, attachments_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            batch_id,
            columns.get('equipment_code'),
            columns.get('equipment_name'),
            parameters_json,
            columns.get('start_time'),
            columns.get('end_time'),
            columns.get('status', '正常运行'),
            current_user['id'],
            json.dumps(attachments, ensure_ascii=False)
        ))

        record_id = cursor.lastrowid
        conn.commit()

        cursor.execute('''
            SELECT e.*, u.username as recorded_by_name 
            FROM equipment_records e 
            JOIN users u ON e.recorded_by = u.id 
            WHERE e.id = ?
        ''', (record_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_equipment(row)), 201

# 更新设备记录
@app.route('/api/batches/<int:batch_id>/equipment/<int:equipment_id>', methods=['PUT'])
@login_required(role=['admin', 'write', 'write_material'])
def update_equipment_record(batch_id, equipment_id):
    payload, files, existing_attachments = _extract_payload_and_files()
    data = payload
    current_user = get_current_user()
    columns, parameters, errors = _prepare_equipment_payload(data)

    if errors:
        return jsonify({'error': '；'.join(errors)}), 400

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT b.batch_number, b.product_name, b.process_segment, e.attachments_json
            FROM equipment_records e
            JOIN batches b ON e.batch_id = b.id
            WHERE e.id = ? AND e.batch_id = ?
        ''', (equipment_id, batch_id))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': '记录不存在'}), 404

        batch_number, product_name, process_segment, original_attachments = row
        parameters_json = json.dumps(parameters, ensure_ascii=False) if parameters else '{}'

        if not existing_attachments:
            existing_attachments = _safe_load_json(original_attachments, [])

        try:
            attachments = _save_attachments(files, product_name, batch_number, process_segment, 'equipment', existing_attachments)
        except AttachmentValidationError as error:
            return jsonify({'error': str(error)}), 400

        cursor.execute(
            '''UPDATE equipment_records
               SET equipment_code = ?, equipment_name = ?, parameters_json = ?, start_time = ?, end_time = ?,
                   status = ?, attachments_json = ?, recorded_by = ?
               WHERE id = ? AND batch_id = ?''',
            (
                columns.get('equipment_code'),
                columns.get('equipment_name'),
                parameters_json,
                columns.get('start_time'),
                columns.get('end_time'),
                columns.get('status', '正常运行'),
                json.dumps(attachments, ensure_ascii=False),
                current_user['id'],
                equipment_id,
                batch_id
            )
        )

        conn.commit()

        cursor.execute('''
            SELECT e.*, u.username as recorded_by_name
            FROM equipment_records e
            JOIN users u ON e.recorded_by = u.id
            WHERE e.id = ?
        ''', (equipment_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_equipment(row))

# API端点 - 质量记录
@app.route('/api/batches/<int:batch_id>/quality', methods=['GET'])
@login_required()
def get_quality_records(batch_id):
    current_user = get_current_user()
    if current_user and current_user.get('role') == 'write_material':
        return jsonify({'error': '权限不足'}), 403

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT q.*, u.username as tested_by_name 
            FROM quality_records q 
            JOIN users u ON q.tested_by = u.id 
            WHERE q.batch_id = ? 
            ORDER BY q.test_time DESC
        ''', (batch_id,))
        rows = cursor.fetchall()

    return jsonify([_serialize_quality(row) for row in rows])

@app.route('/api/batches/<int:batch_id>/quality', methods=['POST'])
@login_required(role=['admin', 'write', 'write_quality'])
def add_quality_record(batch_id):
    payload, files, _ = _extract_payload_and_files()
    data = payload
    current_user = get_current_user()
    columns, extra_attributes, errors = _prepare_quality_payload(data)

    if errors:
        return jsonify({'error': '；'.join(errors)}), 400
    
    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT batch_number, product_name, process_segment FROM batches WHERE id = ?", (batch_id,))
        batch_row = cursor.fetchone()
        if not batch_row:
            return jsonify({'error': '批号不存在'}), 404

        batch_number, product_name, process_segment = batch_row

        standard_min = columns.get('standard_min')
        standard_max = columns.get('standard_max')
        test_value = columns.get('test_value')

        result = '待定'
        if standard_min is not None and standard_max is not None:
            if standard_min <= test_value <= standard_max:
                result = '合格'
            else:
                result = '不合格'

        try:
            attachments = _save_attachments(files, product_name, batch_number, process_segment, 'quality')
        except AttachmentValidationError as error:
            return jsonify({'error': str(error)}), 400

        cursor.execute('''
            INSERT INTO quality_records 
            (batch_id, test_item, test_value, unit, standard_min, standard_max, result, test_time, tested_by, notes, attributes_json, attachments_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            batch_id,
            columns.get('test_item'),
            test_value,
            columns.get('unit'),
            standard_min,
            standard_max,
            result,
            data.get('test_time', datetime.now()),
            current_user['id'],
            columns.get('notes'),
            json.dumps(extra_attributes, ensure_ascii=False),
            json.dumps(attachments, ensure_ascii=False)
        ))

        record_id = cursor.lastrowid
        conn.commit()

        cursor.execute('''
            SELECT q.*, u.username as tested_by_name 
            FROM quality_records q 
            JOIN users u ON q.tested_by = u.id 
            WHERE q.id = ?
        ''', (record_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_quality(row)), 201

# 更新品质记录
@app.route('/api/batches/<int:batch_id>/quality/<int:quality_id>', methods=['PUT'])
@login_required(role=['admin', 'write', 'write_quality'])
def update_quality_record(batch_id, quality_id):
    payload, files, existing_attachments = _extract_payload_and_files()
    data = payload
    current_user = get_current_user()
    columns, extra_attributes, errors = _prepare_quality_payload(data)

    if errors:
        return jsonify({'error': '；'.join(errors)}), 400

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT b.batch_number, b.product_name, b.process_segment, q.test_time, q.attachments_json
            FROM quality_records q
            JOIN batches b ON q.batch_id = b.id
            WHERE q.id = ? AND q.batch_id = ?
        ''', (quality_id, batch_id))
        existing_row = cursor.fetchone()
        if not existing_row:
            return jsonify({'error': '记录不存在'}), 404

        batch_number, product_name, process_segment, existing_test_time, original_attachments = existing_row

        standard_min = columns.get('standard_min')
        standard_max = columns.get('standard_max')
        test_value = columns.get('test_value')

        if not existing_attachments:
            existing_attachments = _safe_load_json(original_attachments, [])

        try:
            attachments = _save_attachments(files, product_name, batch_number, process_segment, 'quality', existing_attachments)
        except AttachmentValidationError as error:
            return jsonify({'error': str(error)}), 400

        result = '待定'
        if standard_min is not None and standard_max is not None and test_value is not None:
            if standard_min <= test_value <= standard_max:
                result = '合格'
            else:
                result = '不合格'

        cursor.execute(
            '''UPDATE quality_records
               SET test_item = ?, test_value = ?, unit = ?, standard_min = ?, standard_max = ?, result = ?,
                   test_time = ?, tested_by = ?, notes = ?, attributes_json = ?, attachments_json = ?
           WHERE id = ? AND batch_id = ?''',
        (
            columns.get('test_item'),
            test_value,
            columns.get('unit'),
            standard_min,
            standard_max,
            result,
            data.get('test_time', existing_test_time) or existing_test_time or datetime.now(),
            current_user['id'],
            columns.get('notes'),
            json.dumps(extra_attributes, ensure_ascii=False),
            json.dumps(attachments, ensure_ascii=False),
            quality_id,
            batch_id
        )
    )

        conn.commit()

        cursor.execute('''
            SELECT q.*, u.username as tested_by_name
            FROM quality_records q
            JOIN users u ON q.tested_by = u.id
            WHERE q.id = ?
        ''', (quality_id,))
        row = cursor.fetchone()

    return jsonify(_serialize_quality(row))

# API端点 - 自定义字段配置
@app.route('/api/custom_fields', methods=['GET'])
@login_required()
def get_custom_fields():
    field_type = request.args.get('type')  # 'equipment' 或 'quality'
    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        if field_type:
            cursor.execute("SELECT * FROM custom_fields WHERE field_type = ? ORDER BY sort_order", (field_type,))
        else:
            cursor.execute("SELECT * FROM custom_fields ORDER BY field_type, sort_order")

        rows = cursor.fetchall()

    fields = []
    for row in rows:
        field = dict(row)
        field['required'] = bool(field.get('required'))
        options_json = field.get('options_json')
        if options_json:
            try:
                field['options'] = json.loads(options_json)
            except json.JSONDecodeError:
                field['options'] = {}
        else:
            field['options'] = {}
        fields.append(field)

    return jsonify(fields)

# API端点 - 查询和导出
@app.route('/api/query', methods=['GET'])
@login_required()
def query_data():
    # 获取查询参数
    batch_number = request.args.get('batch_number', '')
    product_name = request.args.get('product_name', '')
    process_segment = request.args.get('process_segment', '')
    start_date = request.args.get('start_date', '')
    end_date = request.args.get('end_date', '')
    material_code = request.args.get('material_code', '')
    material_name = request.args.get('material_name', '')
    supplier = request.args.get('supplier', '')
    equipment_code = request.args.get('equipment_code', '')
    equipment_name = request.args.get('equipment_name', '')
    equipment_status = request.args.get('equipment_status', '')
    test_item = request.args.get('test_item', '')
    test_result = request.args.get('test_result', '')
    min_value = request.args.get('min_value', '')
    max_value = request.args.get('max_value', '')
    
    conn = db.get_connection()
    c = conn.cursor()
    
    # 构建复杂的多表查询
    query = '''
        SELECT 
            b.batch_number,
            b.product_name,
            b.process_segment,
            b.status,
            b.start_time,
            b.end_time,
            m.material_code,
            m.material_name,
            m.weight,
            m.unit as material_unit,
            m.supplier,
            m.attachments_json as material_attachments_json,
            e.equipment_code,
            e.equipment_name,
            e.parameters_json,
            e.start_time as equipment_start,
            e.end_time as equipment_end,
            e.status as equipment_status,
            e.attachments_json as equipment_attachments_json,
            q.test_item,
            q.test_value,
            q.unit as quality_unit,
            q.result,
            q.standard_min,
            q.standard_max,
            q.attachments_json as quality_attachments_json
        FROM batches b
        LEFT JOIN material_records m ON b.id = m.batch_id
        LEFT JOIN equipment_records e ON b.id = e.batch_id
        LEFT JOIN quality_records q ON b.id = q.batch_id
        WHERE 1=1
    '''
    
    params = []
    
    # 添加批号条件
    if batch_number:
        query += " AND b.batch_number LIKE ?"
        params.append(f'%{batch_number}%')
    
    # 添加产品名称条件
    if product_name:
        query += " AND b.product_name LIKE ?"
        params.append(f'%{product_name}%')
    
    # 添加工艺段条件
    if process_segment:
        query += " AND b.process_segment = ?"
        params.append(process_segment)
    
    # 添加时间范围条件
    if start_date:
        query += " AND DATE(b.start_time) >= ?"
        params.append(start_date)
    
    if end_date:
        query += " AND DATE(b.start_time) <= ?"
        params.append(end_date)
    
    # 添加物料条件
    if material_code:
        query += " AND m.material_code LIKE ?"
        params.append(f'%{material_code}%')
    
    if material_name:
        query += " AND m.material_name LIKE ?"
        params.append(f'%{material_name}%')
    
    if supplier:
        query += " AND m.supplier LIKE ?"
        params.append(f'%{supplier}%')
    
    # 添加设备条件
    if equipment_code:
        query += " AND e.equipment_code LIKE ?"
        params.append(f'%{equipment_code}%')
    
    if equipment_name:
        query += " AND e.equipment_name LIKE ?"
        params.append(f'%{equipment_name}%')
    
    if equipment_status:
        query += " AND e.status = ?"
        params.append(equipment_status)
    
    # 添加品质条件
    if test_item:
        query += " AND q.test_item LIKE ?"
        params.append(f'%{test_item}%')
    
    if test_result:
        query += " AND q.result = ?"
        params.append(test_result)
    
    if min_value:
        query += " AND q.test_value >= ?"
        params.append(float(min_value))
    
    if max_value:
        query += " AND q.test_value <= ?"
        params.append(float(max_value))
    
    query += " ORDER BY b.start_time DESC"
    
    c.execute(query, params)
    
    # 处理查询结果
    results = []
    for row in c.fetchall():
        material_attachments = [os.path.basename(path) for path in _safe_load_json(row['material_attachments_json'], [])]
        equipment_attachments = [os.path.basename(path) for path in _safe_load_json(row['equipment_attachments_json'], [])]
        quality_attachments = [os.path.basename(path) for path in _safe_load_json(row['quality_attachments_json'], [])]

        result = {
            'batch_number': row['batch_number'],
            'product_name': row['product_name'],
            'process_segment': row['process_segment'],
            'status': row['status'],
            'start_time': row['start_time'],
            'end_time': row['end_time'],
            'material_code': row['material_code'],
            'material_name': row['material_name'],
            'weight': row['weight'],
            'material_unit': row['material_unit'],
            'supplier': row['supplier'],
            'material_attachments': material_attachments,
            'equipment_code': row['equipment_code'],
            'equipment_name': row['equipment_name'],
            'parameters_json': row['parameters_json'],
            'equipment_start': row['equipment_start'],
            'equipment_end': row['equipment_end'],
            'equipment_status': row['equipment_status'],
            'equipment_attachments': equipment_attachments,
            'test_item': row['test_item'],
            'test_value': row['test_value'],
            'quality_unit': row['quality_unit'],
            'result': row['result'],
            'standard_min': row['standard_min'],
            'standard_max': row['standard_max'],
            'quality_attachments': quality_attachments
        }

        results.append(result)

    conn.close()
    return jsonify(results)

@app.route('/api/export', methods=['GET'])
@login_required()
def export_data():
    # 获取查询参数（与查询API相同）
    batch_number = request.args.get('batch_number', '')
    process_segment = request.args.get('process_segment', '')
    test_item = request.args.get('test_item', '')
    material_code = request.args.get('material_code', '')
    equipment_code = request.args.get('equipment_code', '')
    
    # 获取数据（这里简化处理，实际应该复用查询逻辑）
    # 这里为了简化，直接调用上面的查询函数
    # 在实际应用中，应该重构代码以避免重复
    
    # 创建CSV输出
    output = io.StringIO()
    writer = csv.writer(output)
    
    # 写入标题行
    writer.writerow([
        '批号', '产品名称', '工艺段', '状态', '开始时间', '结束时间',
        '物料编码', '物料名称', '重量', '单位',
        '设备编码', '设备名称', '设备参数', '设备开始时间', '设备结束时间',
        '检测项目', '检测值', '检测单位', '结果'
    ])
    
    # 获取数据并写入CSV
    # 这里简化处理，实际应该调用查询函数获取数据
    # 为了演示，我们只写入一些示例数据
    writer.writerow([
        'BATCH001', '产品A', '混合搅拌', '已完成', '2024-01-01 08:00:00', '2024-01-01 10:00:00',
        'MAT001', '原料A', 100.5, 'kg',
        'EQ001', '混合机', '{"speed": 100, "temperature": 50}', '2024-01-01 08:30:00', '2024-01-01 09:30:00',
        '尺寸', 25.5, 'mm', '合格'
    ])
    
    # 准备响应
    output.seek(0)
    
    # 创建响应
    response = app.response_class(
        response=output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=production_data.csv'}
    )
    
    return response


@app.route('/api/export/log', methods=['POST'])
@login_required()
def log_export_event():
    data = request.get_json() or {}
    file_size = data.get('file_size') or data.get('file_size_bytes')

    try:
        file_size = int(file_size)
    except (TypeError, ValueError):
        return jsonify({'error': '无效的文件大小'}), 400

    current_user = get_current_user() or {}
    user_id = current_user.get('id')
    username = current_user.get('username') or ''

    forwarded_for = request.headers.get('X-Forwarded-For', '')
    ip_address = forwarded_for.split(',')[0].strip() if forwarded_for else request.remote_addr or ''

    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO export_logs (user_id, username, ip_address, file_size_bytes)
               VALUES (?, ?, ?, ?)''',
            (user_id, username, ip_address, file_size)
        )
        conn.commit()

    return jsonify({'success': True})


# 错误处理
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': '资源未找到'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': '服务器内部错误'}), 500

@app.route('/api/batches/<int:batch_id>', methods=['GET'])
@login_required()
def get_batch(batch_id):
    with closing(db.get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT b.*, u.username as created_by_name 
            FROM batches b 
            JOIN users u ON b.created_by = u.id 
            WHERE b.id = ?
        ''', (batch_id,))
        row = cursor.fetchone()

        if not row:
            return jsonify({'error': '批号不存在'}), 404

        batch = _serialize_batch(row)
        segments = _collect_batch_segments(conn, batch.get('batch_number'), batch.get('product_name'))

        summary = {
            'segment_count': len(segments),
            'material_total': sum(len(seg.get('materials', [])) for seg in segments),
            'equipment_total': sum(len(seg.get('equipment', [])) for seg in segments),
            'quality_total': sum(len(seg.get('quality', [])) for seg in segments)
        }

    return jsonify({
        'batch': batch,
        'segments': segments,
        'summary': summary
    })
    
# 删除物料记录
@app.route('/api/batches/<int:batch_id>/materials/<int:material_id>', methods=['DELETE'])
@login_required(role=['admin', 'write', 'write_material'])
def delete_material_record(batch_id, material_id):
    conn = db.get_connection()
    c = conn.cursor()
    
    # 检查记录是否存在
    c.execute("SELECT id FROM material_records WHERE id = ? AND batch_id = ?", (material_id, batch_id))
    if not c.fetchone():
        conn.close()
        return jsonify({'error': '记录不存在'}), 404
    
    # 删除记录
    c.execute("DELETE FROM material_records WHERE id = ?", (material_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# 删除设备记录
@app.route('/api/batches/<int:batch_id>/equipment/<int:equipment_id>', methods=['DELETE'])
@login_required(role=['admin', 'write', 'write_material'])
def delete_equipment_record(batch_id, equipment_id):
    conn = db.get_connection()
    c = conn.cursor()
    
    # 检查记录是否存在
    c.execute("SELECT id FROM equipment_records WHERE id = ? AND batch_id = ?", (equipment_id, batch_id))
    if not c.fetchone():
        conn.close()
        return jsonify({'error': '记录不存在'}), 404
    
    # 删除记录
    c.execute("DELETE FROM equipment_records WHERE id = ?", (equipment_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# 删除质量记录
@app.route('/api/batches/<int:batch_id>/quality/<int:quality_id>', methods=['DELETE'])
@login_required(role=['admin', 'write', 'write_quality'])
def delete_quality_record(batch_id, quality_id):
    conn = db.get_connection()
    c = conn.cursor()
    
    # 检查记录是否存在
    c.execute("SELECT id FROM quality_records WHERE id = ? AND batch_id = ?", (quality_id, batch_id))
    if not c.fetchone():
        conn.close()
        return jsonify({'error': '记录不存在'}), 404
    
    # 删除记录
    c.execute("DELETE FROM quality_records WHERE id = ?", (quality_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# API端点 - 制程能力看板数据
@app.route('/api/dashboard/data', methods=['GET'])
@login_required()
def get_dashboard_data():
    # 获取查询参数
    days = request.args.get('days', '30')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    conn = db.get_connection()
    c = conn.cursor()
    
    # 构建时间条件
    time_condition = ""
    params = []
    
    if start_date and end_date:
        time_condition = " AND DATE(b.start_time) BETWEEN ? AND ?"
        params.extend([start_date, end_date])
    else:
        # 默认最近N天
        days = int(days)
        time_condition = " AND DATE(b.start_time) >= DATE('now', ?)"
        params.append(f'-{days} days')
    
    # 获取基本统计
    c.execute(f"SELECT COUNT(*) FROM batches b WHERE 1=1 {time_condition}", params)
    total_batches = c.fetchone()[0]
    
    c.execute(f"SELECT COUNT(*) FROM batches b WHERE b.status = '进行中' {time_condition}", params)
    active_batches = c.fetchone()[0]
    
    c.execute(f"SELECT COUNT(*) FROM batches b WHERE b.status = '已完成' {time_condition}", params)
    completed_batches = c.fetchone()[0]
    
    # 获取各工艺段的批号数量
    c.execute(f'''
        SELECT process_segment, COUNT(*) as count 
        FROM batches b 
        WHERE 1=1 {time_condition}
        GROUP BY process_segment
    ''', params)
    segment_counts = {row[0]: row[1] for row in c.fetchall()}
    
    # 获取质量合格率
    c.execute(f'''
        SELECT 
            q.test_item,
            COUNT(*) as total,
            SUM(CASE WHEN q.result = '合格' THEN 1 ELSE 0 END) as passed
        FROM quality_records q
        JOIN batches b ON q.batch_id = b.id
        WHERE 1=1 {time_condition}
        GROUP BY q.test_item
    ''', params)
    quality_rates = {}
    for row in c.fetchall():
        test_item, total, passed = row
        quality_rates[test_item] = {
            'total': total,
            'passed': passed,
            'rate': passed / total if total > 0 else 0
        }
    
    # 获取最近完成的批号
    c.execute(f'''
        SELECT b.batch_number, b.product_name, b.process_segment, 
               b.start_time, b.end_time, b.status
        FROM batches b 
        WHERE b.status = '已完成' {time_condition}
        ORDER BY b.end_time DESC 
        LIMIT 10
    ''', params)
    recent_batches = []
    for row in c.fetchall():
        recent_batches.append({
            'batch_number': row[0],
            'product_name': row[1],
            'process_segment': row[2],
            'start_time': row[3],
            'end_time': row[4],
            'status': row[5]
        })
    
    # 获取设备运行数据（简化版）
    c.execute(f'''
        SELECT 
            e.equipment_name,
            COUNT(*) as total_runs,
            AVG((julianday(e.end_time) - julianday(e.start_time)) * 24) as avg_hours
        FROM equipment_records e
        JOIN batches b ON e.batch_id = b.id
        WHERE e.end_time IS NOT NULL {time_condition}
        GROUP BY e.equipment_name
    ''', params)
    equipment_data = {}
    for row in c.fetchall():
        equipment_name, total_runs, avg_hours = row
        equipment_data[equipment_name] = {
            'total_runs': total_runs,
            'avg_hours': avg_hours or 0
        }
    
    conn.close()
    
    return jsonify({
        'total_batches': total_batches,
        'active_batches': active_batches,
        'completed_batches': completed_batches,
        'segment_counts': segment_counts,
        'quality_rates': quality_rates,
        'recent_batches': recent_batches,
        'equipment_data': equipment_data
    })

if __name__ == '__main__':
    app.run(debug=config.DEBUG, host=config.HOST, port=config.PORT)
