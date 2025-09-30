import sqlite3
import json
from datetime import datetime, timedelta
import hashlib
import config

ALLOWED_USER_ROLES = ('admin', 'read', 'write', 'write_material', 'write_quality')

class Database:
    def __init__(self, db_path):
        self.db_path = db_path
        self.init_db()
        self.init_data()
    
    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_column(self, cursor, table, column, definition):
        cursor.execute(f"PRAGMA table_info({table})")
        existing_columns = {row[1] for row in cursor.fetchall()}
        if column not in existing_columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def init_db(self):
        conn = self.get_connection()
        c = conn.cursor()
        
        # 创建用户表
        allowed_roles_sql = "', '".join(ALLOWED_USER_ROLES)
        c.execute(f'''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('{allowed_roles_sql}')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        ''')

        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        users_ddl = c.fetchone()
        if users_ddl and users_ddl[0] and 'write_material' not in users_ddl[0]:
            c.execute('PRAGMA foreign_keys = OFF')
            c.execute(f'''
                CREATE TABLE IF NOT EXISTS users_tmp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('{allowed_roles_sql}')),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                )
            ''')
            c.execute('''
                INSERT INTO users_tmp (id, username, password_hash, role, created_at, last_login)
                SELECT id, username, password_hash, role, created_at, last_login FROM users
            ''')
            c.execute('DROP TABLE users')
            c.execute('ALTER TABLE users_tmp RENAME TO users')
            c.execute('PRAGMA foreign_keys = ON')
        
        # 创建产品批号表
        c.execute('''
            CREATE TABLE IF NOT EXISTS batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_number TEXT NOT NULL,
                product_name TEXT NOT NULL,
                process_segment TEXT NOT NULL,
                status TEXT DEFAULT '进行中' CHECK(status IN ('进行中', '已完成', '暂停', '异常')),
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP,
                created_by INTEGER NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        ''')

        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='batches'")
        batches_ddl = c.fetchone()
        if batches_ddl and batches_ddl[0] and 'UNIQUE' in batches_ddl[0] and 'batch_number' in batches_ddl[0]:
            c.execute('PRAGMA foreign_keys = OFF')
            c.execute('''
                CREATE TABLE IF NOT EXISTS batches_tmp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_number TEXT NOT NULL,
                    product_name TEXT NOT NULL,
                    process_segment TEXT NOT NULL,
                    status TEXT DEFAULT '进行中' CHECK(status IN ('进行中', '已完成', '暂停', '异常')),
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    end_time TIMESTAMP,
                    created_by INTEGER NOT NULL,
                    FOREIGN KEY (created_by) REFERENCES users(id)
                )
            ''')
            c.execute('''
                INSERT INTO batches_tmp (id, batch_number, product_name, process_segment, status, start_time, end_time, created_by)
                SELECT id, batch_number, product_name, process_segment, status, start_time, end_time, created_by FROM batches
            ''')
            c.execute('DROP TABLE batches')
            c.execute('ALTER TABLE batches_tmp RENAME TO batches')
            c.execute('PRAGMA foreign_keys = ON')
        
        # 创建工艺段配置表
        c.execute('''
            CREATE TABLE IF NOT EXISTS process_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                segment_name TEXT UNIQUE NOT NULL,
                description TEXT,
                sort_order INTEGER DEFAULT 0
            )
        ''')

        # 创建物料记录表
        c.execute('''
            CREATE TABLE IF NOT EXISTS material_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL,
                material_code TEXT NOT NULL,
                material_name TEXT NOT NULL,
                weight REAL NOT NULL CHECK(weight > 0),
                unit TEXT DEFAULT 'kg',
                supplier TEXT,
                lot_number TEXT,
                record_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                recorded_by INTEGER NOT NULL,
                attributes_json TEXT DEFAULT '{}',
                FOREIGN KEY (batch_id) REFERENCES batches(id),
                FOREIGN KEY (recorded_by) REFERENCES users(id)
            )
        ''')

        # 创建设备运行记录表
        c.execute('''
            CREATE TABLE IF NOT EXISTS equipment_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL,
                equipment_code TEXT NOT NULL,
                equipment_name TEXT NOT NULL,
                parameters_json TEXT NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP,
                status TEXT DEFAULT '正常运行' CHECK(status IN ('正常运行', '故障', '维护')),
                recorded_by INTEGER NOT NULL,
                FOREIGN KEY (batch_id) REFERENCES batches(id),
                FOREIGN KEY (recorded_by) REFERENCES users(id)
            )
        ''')

        # 创建质量检测记录表
        c.execute('''
            CREATE TABLE IF NOT EXISTS quality_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL,
                test_item TEXT NOT NULL,
                test_value REAL NOT NULL,
                unit TEXT,
                standard_min REAL,
                standard_max REAL,
                result TEXT CHECK(result IN ('合格', '不合格', '待定')),
                test_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                tested_by INTEGER NOT NULL,
                notes TEXT,
                attributes_json TEXT DEFAULT '{}',
                FOREIGN KEY (batch_id) REFERENCES batches(id),
                FOREIGN KEY (tested_by) REFERENCES users(id)
            )
        ''')

        # 创建自定义字段配置表
        c.execute('''
            CREATE TABLE IF NOT EXISTS custom_fields (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                field_type TEXT NOT NULL CHECK(field_type IN ('equipment', 'quality')),
                field_name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                data_type TEXT NOT NULL CHECK(data_type IN ('text', 'number', 'boolean', 'date')),
                required BOOLEAN DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                options_json TEXT
            )
        ''')

        # 创建用户会话表，用于多端登录
        c.execute('''
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                device TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')

        # 导出日志表
        c.execute('''
            CREATE TABLE IF NOT EXISTS export_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT,
                ip_address TEXT,
                file_size_bytes INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')

        # 补充缺少的扩展字段
        self._ensure_column(c, 'material_records', 'attributes_json', "TEXT DEFAULT '{}'")
        self._ensure_column(c, 'quality_records', 'attributes_json', "TEXT DEFAULT '{}'")
        self._ensure_column(c, 'material_records', 'attachments_json', "TEXT DEFAULT '[]'")
        self._ensure_column(c, 'equipment_records', 'attachments_json', "TEXT DEFAULT '[]'")
        self._ensure_column(c, 'quality_records', 'attachments_json', "TEXT DEFAULT '[]'")

        conn.commit()
        conn.close()
    
    def init_data(self):
        conn = self.get_connection()
        c = conn.cursor()
        
        # 插入默认用户
        for username, user_info in config.USERS.items():
            # 检查用户是否已存在
            c.execute("SELECT id FROM users WHERE username = ?", (username,))
            if c.fetchone() is None:
                password_hash = hashlib.md5(user_info['password'].encode()).hexdigest()
                c.execute(
                    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                    (username, password_hash, user_info['role'])
                )
        
        # 插入默认工艺段
        for i, segment in enumerate(config.get_process_segments()):
            c.execute(
                "INSERT OR IGNORE INTO process_segments (segment_name, sort_order) VALUES (?, ?)",
                (segment, i)
            )
        
        # 插入默认自定义字段
        default_fields = [
            ('equipment', 'temperature', '温度', 'number', 1, 0, '{"unit": "℃"}'),
            ('equipment', 'pressure', '压力', 'number', 1, 1, '{"unit": "MPa"}'),
            ('equipment', 'speed', '转速', 'number', 0, 2, '{"unit": "rpm"}'),
            ('quality', 'size', '尺寸', 'number', 1, 0, '{"unit": "mm"}'),
            ('quality', 'weight', '重量', 'number', 1, 1, '{"unit": "g"}'),
            ('quality', 'color', '颜色', 'text', 0, 2, '{}'),
        ]
        
        for field in default_fields:
            c.execute(
                'SELECT 1 FROM custom_fields WHERE field_type = ? AND field_name = ? LIMIT 1',
                (field[0], field[1])
            )
            if c.fetchone() is None:
                c.execute(
                    '''INSERT INTO custom_fields 
                    (field_type, field_name, display_name, data_type, required, sort_order, options_json) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)''',
                    field
                )

        # 去重，保留同名字段中排序靠前的记录
        c.execute('''
            DELETE FROM custom_fields
            WHERE id NOT IN (
                SELECT MIN(id) FROM custom_fields GROUP BY field_type, field_name
            )
        ''')
        
        conn.commit()
        conn.close()
    
    # 用户认证方法
    def authenticate_user(self, username, password):
        conn = self.get_connection()
        c = conn.cursor()
        
        password_hash = hashlib.md5(password.encode()).hexdigest()
        c.execute(
            "SELECT id, username, role FROM users WHERE username = ? AND password_hash = ?",
            (username, password_hash)
        )
        
        user = c.fetchone()
        conn.close()
        
        if user:
            return {
                'id': user[0],
                'username': user[1],
                'role': user[2]
            }
        return None

    # 更新用户最后登录时间
    def update_last_login(self, user_id):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "UPDATE users SET last_login = ? WHERE id = ?",
            (datetime.now(), user_id)
        )
        conn.commit()
        conn.close()

    # 会话管理
    def _purge_expired_sessions(self, cursor):
        cursor.execute(
            "DELETE FROM user_sessions WHERE expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')"
        )

    def create_user_session(self, user_id, token, device=None, ip_address=None, expires_at=None):
        conn = self.get_connection()
        c = conn.cursor()

        self._purge_expired_sessions(c)

        now = datetime.utcnow()
        expiry = expires_at or (now + timedelta(hours=config.SESSION_TOKEN_TTL_HOURS))
        now_str = now.strftime('%Y-%m-%d %H:%M:%S')
        expiry_str = expiry.strftime('%Y-%m-%d %H:%M:%S')

        max_sessions = getattr(config, 'MAX_SESSIONS_PER_USER', None)
        if max_sessions:
            c.execute(
                "SELECT id FROM user_sessions WHERE user_id = ? ORDER BY last_active ASC",
                (user_id,)
            )
            existing = c.fetchall()
            overflow = len(existing) - (max_sessions - 1)
            if overflow > 0:
                for session_id, in existing[:overflow]:
                    c.execute("DELETE FROM user_sessions WHERE id = ?", (session_id,))

        c.execute(
            '''INSERT INTO user_sessions (user_id, token, device, ip_address, created_at, last_active, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (user_id, token, device, ip_address, now_str, now_str, expiry_str)
        )

        conn.commit()
        conn.close()

        return expiry_str

    def get_user_session(self, token):
        conn = self.get_connection()
        c = conn.cursor()

        self._purge_expired_sessions(c)

        c.execute('''
            SELECT us.user_id, us.token, us.device, us.ip_address, us.expires_at,
                   u.username, u.role
            FROM user_sessions us
            JOIN users u ON u.id = us.user_id
            WHERE us.token = ?
        ''', (token,))

        row = c.fetchone()
        conn.close()

        if not row:
            return None

        expires_at = row[4]
        if expires_at:
            expires_dt = datetime.strptime(expires_at, '%Y-%m-%d %H:%M:%S')
            if expires_dt <= datetime.utcnow():
                self.delete_user_session(token)
                return None

        return {
            'user_id': row[0],
            'token': row[1],
            'device': row[2],
            'ip_address': row[3],
            'expires_at': row[4],
            'username': row[5],
            'role': row[6]
        }

    def touch_user_session(self, token):
        conn = self.get_connection()
        c = conn.cursor()
        now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        c.execute(
            "UPDATE user_sessions SET last_active = ? WHERE token = ?",
            (now_str, token)
        )
        conn.commit()
        conn.close()

    def delete_user_session(self, token):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("DELETE FROM user_sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()

    def purge_expired_sessions(self):
        conn = self.get_connection()
        c = conn.cursor()
        self._purge_expired_sessions(c)
        conn.commit()
        conn.close()
    
    # 添加获取用户信息的方法
    def get_user_by_id(self, user_id):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'username': row[1],
                'role': row[2]
            }
        return None
    
    # 添加获取批号详情的方法
    def get_batch_details(self, batch_id):
        conn = self.get_connection()
        c = conn.cursor()
        
        c.execute('''
            SELECT b.*, u.username as created_by_name 
            FROM batches b 
            JOIN users u ON b.created_by = u.id 
            WHERE b.id = ?
        ''', (batch_id,))
        
        row = c.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'batch_number': row[1],
                'product_name': row[2],
                'process_segment': row[3],
                'status': row[4],
                'start_time': row[5],
                'end_time': row[6],
                'created_by': row[7],
                'created_by_name': row[8]
            }
        return None

# 创建数据库实例
db = Database(config.DATABASE)
