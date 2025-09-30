import os
import json
import copy
import fnmatch

# 基础路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 用户账户配置（如需调整账号数量或密码仅需编辑以下列表）
ADMIN_USERS = [
    {"username": "admin", "password": "admin123"}
]

READ_ONLY_USERS = [
    {"username": "read1", "password": "read123"},
    {"username": "read2", "password": "read456"}
]

WRITE_ONLY_USERS = [
    {"username": "write1", "password": "write123"},
    {"username": "write2", "password": "write456"}
]

# 物料/设备录入账号：只能维护物料与设备数据
WRITE_MATERIAL_USERS = [
    {"username": "write_me1", "password": "me123"},
    {"username": "write_me2", "password": "me456"}
]

# 品质录入账号：只能查看/维护品质数据
WRITE_QUALITY_USERS = [
    {"username": "write_quality1", "password": "quality123"}
]


def _build_user_mapping():
    users = {}
    for entry in ADMIN_USERS:
        users[entry["username"]] = {"password": entry["password"], "role": "admin"}
    for entry in READ_ONLY_USERS:
        users[entry["username"]] = {"password": entry["password"], "role": "read"}
    for entry in WRITE_ONLY_USERS:
        users[entry["username"]] = {"password": entry["password"], "role": "write"}
    for entry in WRITE_MATERIAL_USERS:
        users[entry["username"]] = {"password": entry["password"], "role": "write_material"}
    for entry in WRITE_QUALITY_USERS:
        users[entry["username"]] = {"password": entry["password"], "role": "write_quality"}
    return users


USERS = _build_user_mapping()

# 数据库配置
DATABASE = os.path.join(BASE_DIR, "production.db")

# 默认工艺段配置（当字段配置文件未提供时使用）
DEFAULT_PROCESS_SEGMENTS = [
    "旋涂", "前烘烤", "曝光", "后烘烤", "显影", "刻蚀", "剥离"
]

# 应用配置
SECRET_KEY = "production_line_manager_secret_key_2024"
DEBUG = True
HOST = "0.0.0.0"
PORT = 5001

# 附件存储配置
DOWNLOAD_ROOT = os.path.join(BASE_DIR, "download")
UPLOAD_FOLDER = DOWNLOAD_ROOT  # 兼容历史代码中引用的常量名
ALLOWED_ATTACHMENT_MIME_PREFIXES = ("image/", "text/")
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff",
    ".txt", ".log", ".csv", ".json", ".md"
}
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB

# 会话配置
SESSION_TOKEN_TTL_HOURS = 24
MAX_SESSIONS_PER_USER = 5

# 批号状态配置
BATCH_STATUS_OPTIONS = [
    "进行中", "已完成", "暂停", "异常"
]
BATCH_COMPLETED_STATUS = "已完成"

# 自定义字段配置文件
FIELDS_CONFIG_PATH = os.path.join(BASE_DIR, "fields_config.json")
_FIELDS_CONFIG_CACHE = None
_FIELDS_CONFIG_MTIME = None

# 数据记录字段配置
MATERIAL_RECORD_FIELDS = {
    "columns": [
        {"key": "material_code", "label": "物料编码", "required": True, "type": "text", "column": "material_code"},
        {"key": "material_name", "label": "物料名称", "required": True, "type": "text", "column": "material_name"},
        {"key": "weight", "label": "重量", "required": True, "type": "number", "column": "weight"},
        {"key": "unit", "label": "单位", "required": False, "type": "text", "default": "kg", "column": "unit"},
        {"key": "supplier", "label": "供应商", "required": False, "type": "text", "column": "supplier"},
        {"key": "lot_number", "label": "批次号", "required": False, "type": "text", "column": "lot_number"}
    ],
    "extras": [
        {"key": "moisture", "label": "含水率", "required": False, "type": "number"},
        {"key": "remark", "label": "备注", "required": False, "type": "text"}
    ]
}

EQUIPMENT_RECORD_FIELDS = {
    "columns": [
        {"key": "equipment_code", "label": "设备编码", "required": True, "type": "text", "column": "equipment_code"},
        {"key": "equipment_name", "label": "设备名称", "required": True, "type": "text", "column": "equipment_name"},
        {"key": "start_time", "label": "开始时间", "required": True, "type": "datetime", "column": "start_time"},
        {"key": "end_time", "label": "结束时间", "required": False, "type": "datetime", "column": "end_time"},
        {"key": "status", "label": "状态", "required": False, "type": "select", "options": ["正常运行", "故障", "维护"], "default": "正常运行", "column": "status"}
    ],
    "parameters": [
        {"key": "temperature", "label": "温度", "required": False, "type": "number", "unit": "℃"},
        {"key": "pressure", "label": "压力", "required": False, "type": "number", "unit": "MPa"},
        {"key": "speed", "label": "转速", "required": False, "type": "number", "unit": "rpm"}
    ]
}

QUALITY_RECORD_FIELDS = {
    "columns": [
        {"key": "test_item", "label": "检测项目", "required": True, "type": "text", "column": "test_item"},
        {"key": "test_value", "label": "检测值", "required": True, "type": "number", "column": "test_value"},
        {"key": "unit", "label": "单位", "required": False, "type": "text", "column": "unit"},
        {"key": "standard_min", "label": "标准下限", "required": False, "type": "number", "column": "standard_min"},
        {"key": "standard_max", "label": "标准上限", "required": False, "type": "number", "column": "standard_max"},
        {"key": "notes", "label": "备注", "required": False, "type": "text", "column": "notes"}
    ],
    "extras": [
        {"key": "inspector", "label": "检验员", "required": False, "type": "text"},
        {"key": "method", "label": "检测方法", "required": False, "type": "text"}
    ]
}

# 确保存储目录存在
if not os.path.exists(DOWNLOAD_ROOT):
    os.makedirs(DOWNLOAD_ROOT, exist_ok=True)



def _load_fields_config():
    """Load structured record definitions from JSON with caching."""
    global _FIELDS_CONFIG_CACHE, _FIELDS_CONFIG_MTIME, PROCESS_SEGMENTS

    try:
        mtime = os.path.getmtime(FIELDS_CONFIG_PATH)
    except (FileNotFoundError, OSError):
        _FIELDS_CONFIG_CACHE = {
            'process_segments': list(DEFAULT_PROCESS_SEGMENTS),
            'materials': [],
            'equipment': [],
            'quality': []
        }
        _FIELDS_CONFIG_MTIME = None
        PROCESS_SEGMENTS = list(DEFAULT_PROCESS_SEGMENTS)
        return _FIELDS_CONFIG_CACHE

    if _FIELDS_CONFIG_CACHE is None or _FIELDS_CONFIG_MTIME != mtime:
        try:
            with open(FIELDS_CONFIG_PATH, 'r', encoding='utf-8') as config_file:
                data = json.load(config_file) or {}
        except (json.JSONDecodeError, ValueError, OSError):
            data = {}

        _FIELDS_CONFIG_CACHE = {
            'process_segments': data.get('process_segments') or list(DEFAULT_PROCESS_SEGMENTS),
            'materials': data.get('materials', []) or [],
            'equipment': data.get('equipment', []) or [],
            'quality': data.get('quality', []) or []
        }
        _FIELDS_CONFIG_MTIME = mtime
        PROCESS_SEGMENTS = list(_FIELDS_CONFIG_CACHE.get('process_segments', DEFAULT_PROCESS_SEGMENTS))

    return _FIELDS_CONFIG_CACHE


def _filter_by_segment(items, segment):
    if not items:
        return []
    if not segment:
        return copy.deepcopy(items)

    filtered = []
    for item in items:
        segments = item.get('segments')

        if not segments:
            filtered.append(item)
            continue

        if isinstance(segments, str):
            segments = [segments]

        include_item = False
        for pattern in segments:
            if pattern in (None, ''):
                include_item = True
                break
            if pattern == '*':
                include_item = True
                break
            if fnmatch.fnmatch(segment, str(pattern)):
                include_item = True
                break

        if include_item:
            filtered.append(item)

    return copy.deepcopy(filtered)


def get_material_definitions(segment=None):
    config_data = _load_fields_config()
    return _filter_by_segment(config_data.get('materials'), segment)


def get_equipment_definitions(segment=None):
    config_data = _load_fields_config()
    return _filter_by_segment(config_data.get('equipment'), segment)


def get_quality_definitions(segment=None):
    config_data = _load_fields_config()
    return _filter_by_segment(config_data.get('quality'), segment)


def get_segment_definitions(segment=None):
    return {
        'materials': get_material_definitions(segment),
        'equipment': get_equipment_definitions(segment),
        'quality': get_quality_definitions(segment)
    }


def get_process_segments():
    config_data = _load_fields_config()
    segments = config_data.get('process_segments') or list(DEFAULT_PROCESS_SEGMENTS)
    return list(segments)


def list_defined_segments():
    config_data = _load_fields_config()
    segments = set()
    all_pipeline_segments = set(get_process_segments())

    for category in ('materials', 'equipment', 'quality'):
        for item in config_data.get(category, []):
            item_segments = item.get('segments')
            if not item_segments:
                segments.update(all_pipeline_segments)
                continue

            if isinstance(item_segments, str):
                item_segments = [item_segments]

            for seg in item_segments:
                if seg == '*':
                    segments.update(all_pipeline_segments)
                elif seg:
                    segments.add(seg)
    return sorted(segments)


# 向后兼容的常量访问
PROCESS_SEGMENTS = get_process_segments()
