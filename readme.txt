MiniMES (Mini Manufacturing Execution System)
===========================================

Overview
--------
MiniMES 是一个针对小型生产线的数据采集与可视化系统，包含登录、生产记录、数据查询、仪表板等模块。后端采用 Flask + SQLite，前端是静态模板配合少量 JavaScript 实现的单页式交互。

Core Features
-------------
* 用户登录及角色权限（admin / read / write）。
* 生产批号管理（创建、状态/工段更新）。
* 物料、设备、品质三类记录的维护与附件上传（保存于 `download/` 目录）。
* 查询界面支持组合筛选、导出 CSV 以及结果图表化展示。
* 仪表板展示批次概览，开始/结束时间自动对齐对应工序的设备记录。

Prerequisites
-------------
* Python 3.10 或更新版本（推荐 3.11）。
* SQLite（随 Python 内置）。
* 可选：桌面环境（若需使用 `tools/field_config_editor.py` 的 Tkinter GUI）。

Installation
------------
1. 创建并激活虚拟环境：

   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows 使用 .venv\Scripts\activate
   ```

2. 安装依赖：

   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

Configuration
-------------
* 核心配置位于 `config.py`：
  * 用户初始账号（`ADMIN_USERS`, `READ_ONLY_USERS`, `WRITE_ONLY_USERS`）。
  * 默认工艺段（`DEFAULT_PROCESS_SEGMENTS`）。
  * 附件大小/类型限制、会话参数等。
* 可维护字段定义与工艺段：`fields_config.json`。
  * 顶层键 `process_segments` 控制流程顺序。
  * `materials` / `equipment` / `quality` 节点分别定义各工段可用条目。
  * 提供 GUI 辅助工具 `python tools/field_config_editor.py`（需 Tkinter）。
* 数据库存储在 `production.db`，首次运行会自动初始化表结构及基础数据。

Running the Server
------------------
```bash
python server.py
```

默认监听 `http://127.0.0.1:5000/`。登录凭证由系统管理员统一分配，如需开通或重置请联系相关负责人。

Project Layout
--------------
```
miniMES/
├── server.py                # Flask 入口
├── database.py              # SQLite 数据访问/初始化
├── config.py                # 系统配置 & 动态字段加载
├── fields_config.json       # 工艺段及记录字段定义
├── requirements.txt
├── readme.txt
├── templates/               # Jinja2 模板
├── static/                  # 前端资源 (CSS/JS)
├── download/                # 附件存储目录
├── tools/field_config_editor.py
└── tests/
```

Testing
-------
运行单元测试（当前包含附件处理测试）：

```bash
pytest
```

Data & Attachments
------------------
* 所有上传附件按 `download/<产品名>/<批号>/<工段>/<类别>/` 组织。
* `MAX_CONTENT_LENGTH`（16MB 默认）与允许 MIME/扩展在 `config.py` 中配置。
* 开发环境中可清空 `production.db` 与 `download/` 以重置数据。

Troubleshooting
---------------
* 若更新了 `fields_config.json` 后界面无变化，可重启 Flask 服务。
* 请确保虚拟环境已激活并安装 `requirements.txt` 列出的依赖。
* Tkinter GUI 在精简发行版 Linux 可能默认未安装，需要额外安装 `python3-tk` 包。
