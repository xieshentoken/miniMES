#!/usr/bin/env python3
"""Tkinter GUI helper to edit ``fields_config.json`` conveniently."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple, Union

import tkinter as tk
from tkinter import messagebox, simpledialog, ttk


PathKey = Tuple[Union[str, int], ...]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "fields_config.json"


DEFAULT_TEMPLATES: Dict[str, Any] = {
    "materials": {
        "code": "",
        "name": "",
        "supplier": "",
        "unit": "",
        "stock": "",
        "notes": "",
        "segments": [],
    },
    "equipment": {
        "code": "",
        "name": "",
        "parameters": [],
        "segments": [],
    },
    "quality": {
        "item": "",
        "unit": "",
        "standard_value": "",
        "min": "",
        "max": "",
        "device": "",
        "notes": "",
        "segments": [],
    },
}


def load_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_config(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def short_repr(value: Any, limit: int = 40) -> str:
    text = repr(value)
    return text if len(text) <= limit else text[: limit - 3] + "..."


def describe_value(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("name", "code", "item", "label"):
            if key in value and isinstance(value[key], str):
                return f"({value[key]})"
        keys = list(value.keys())[:3]
        joined = ", ".join(keys)
        return f"{{{joined}}}" if joined else "{ }"
    if isinstance(value, list):
        return f"[{len(value)}]"
    return f": {short_repr(value)}"


def path_to_string(path: PathKey) -> str:
    if not path:
        return "/"
    parts: List[str] = []
    for step in path:
        parts.append(f"[{step}]" if isinstance(step, int) else str(step))
    return "/" + "/".join(parts)


class FieldConfigEditor:
    def __init__(self, master: tk.Tk, config_path: Path) -> None:
        self.master = master
        self.config_path = config_path
        self.data: Dict[str, Any] = load_config(config_path)
        self.dirty = False
        self.iid_to_path: Dict[str, PathKey] = {}
        self.path_to_iid: Dict[PathKey, str] = {}
        self.selected_path: PathKey = ()

        self.status_var = tk.StringVar()

        self._build_ui()
        self.refresh_tree(())
        self.select_path(())

    def _build_ui(self) -> None:
        self.master.title("fields_config.json 编辑器")
        self.master.geometry("960x640")
        self.master.minsize(760, 520)
        self.master.protocol("WM_DELETE_WINDOW", self.on_close)

        main = ttk.Frame(self.master, padding=8)
        main.grid(row=0, column=0, sticky="nsew")
        self.master.columnconfigure(0, weight=1)
        self.master.rowconfigure(0, weight=1)
        main.columnconfigure(0, weight=1, minsize=240)
        main.columnconfigure(1, weight=3, minsize=360)
        main.rowconfigure(0, weight=1)
        main.rowconfigure(1, weight=0)

        tree_frame = ttk.Frame(main)
        tree_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        tree_frame.rowconfigure(0, weight=1)
        tree_frame.columnconfigure(0, weight=1)

        self.tree = ttk.Treeview(tree_frame, show="tree", selectmode="browse")
        tree_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        tree_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.column("#0", width=260, minwidth=200, stretch=True)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        for sequence in (
            "<Control-Shift-e>",
            "<Control-Shift-E>",
            "<Command-Shift-e>",
            "<Command-Shift-E>",
        ):
            self.tree.bind(sequence, self.expand_selected_subtree)

        editor_frame = ttk.Frame(main)
        editor_frame.grid(row=0, column=1, sticky="nsew")
        editor_frame.columnconfigure(0, weight=1)
        editor_frame.rowconfigure(1, weight=1)

        info = ttk.Label(
            editor_frame,
            text="双击树节点或使用 Ctrl/⌘+Shift+E 展开子项；右侧可直接修改值。",
            wraplength=400,
            justify="left",
        )
        info.grid(row=0, column=0, sticky="w", pady=(0, 6))

        detail_container = ttk.Frame(editor_frame)
        detail_container.grid(row=1, column=0, sticky="nsew")
        detail_container.rowconfigure(0, weight=1)
        detail_container.columnconfigure(0, weight=1)

        self.detail_canvas = tk.Canvas(detail_container, highlightthickness=0)
        self.detail_canvas.grid(row=0, column=0, sticky="nsew")
        detail_scroll = ttk.Scrollbar(detail_container, orient="vertical", command=self.detail_canvas.yview)
        detail_scroll.grid(row=0, column=1, sticky="ns")
        self.detail_canvas.configure(yscrollcommand=detail_scroll.set)
        for sequence in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            self.master.bind_all(sequence, self._on_mousewheel, add=True)

        self.detail_inner = ttk.Frame(self.detail_canvas)
        self.detail_window = self.detail_canvas.create_window((0, 0), window=self.detail_inner, anchor="nw")
        self.detail_inner.bind(
            "<Configure>", lambda e: self.detail_canvas.configure(scrollregion=self.detail_canvas.bbox("all"))
        )
        self.detail_canvas.bind(
            "<Configure>", lambda e: self.detail_canvas.itemconfigure(self.detail_window, width=e.width)
        )

        buttons = ttk.Frame(editor_frame)
        buttons.grid(row=2, column=0, sticky="ew", pady=(4, 0))
        buttons.columnconfigure((0, 1, 2, 3), weight=1)

        ttk.Button(buttons, text="新增子项", command=self.add_child).grid(row=0, column=0, padx=1)
        ttk.Button(buttons, text="删除当前节点", command=self.delete_current_node).grid(row=0, column=1, padx=1)
        ttk.Button(buttons, text="保存文件", command=self.save_file).grid(row=0, column=2, padx=1)
        ttk.Button(buttons, text="重新加载", command=self.reload_data).grid(row=0, column=3, padx=1)

        status_bar = ttk.Label(main, textvariable=self.status_var, anchor="w")
        status_bar.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(4, 0))

    def refresh_tree(self, focus_path: PathKey | None) -> None:
        for child in self.tree.get_children(""):
            self.tree.delete(child)
        self.iid_to_path.clear()
        self.path_to_iid.clear()

        root_iid = self.tree.insert("", "end", text="fields_config.json", open=True)
        self.iid_to_path[root_iid] = ()
        self.path_to_iid[()] = root_iid
        self._populate_tree(root_iid, self.data, ())

        if focus_path is not None:
            self.select_path(focus_path)

    def _populate_tree(self, parent_iid: str, value: Any, path: PathKey) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                label = f"{key} {describe_value(item)}"
                iid = self.tree.insert(parent_iid, "end", text=label, open=len(path) < 1)
                new_path = path + (key,)
                self.iid_to_path[iid] = new_path
                self.path_to_iid[new_path] = iid
                if isinstance(item, (dict, list)):
                    self._populate_tree(iid, item, new_path)
        elif isinstance(value, list):
            for idx, item in enumerate(value):
                prefix = f"[{idx}]"
                label = f"{prefix} {describe_value(item)}"
                iid = self.tree.insert(parent_iid, "end", text=label, open=len(path) < 1)
                new_path = path + (idx,)
                self.iid_to_path[iid] = new_path
                self.path_to_iid[new_path] = iid
                if isinstance(item, (dict, list)):
                    self._populate_tree(iid, item, new_path)

    def select_path(self, path: PathKey) -> None:
        iid = self.path_to_iid.get(path)
        while iid is None and path:
            path = path[:-1]
            iid = self.path_to_iid.get(path)
        if iid is None:
            iid = self.path_to_iid.get(())
        if iid is None:
            return
        self.tree.see(iid)
        self.tree.selection_set(iid)
        self.tree.focus(iid)
        self.on_select(None)

    def on_select(self, event: Any) -> None:  # type: ignore[override]
        selection = self.tree.selection()
        if not selection:
            return
        iid = selection[0]
        path = self.iid_to_path.get(iid, ())
        self.selected_path = path
        self.render_detail(path)
        info = f"选中: {path_to_string(path)}"
        self.update_status(info)

    def get_value(self, path: PathKey) -> Any:
        value: Any = self.data
        for step in path:
            value = value[step]
        return value

    def set_value(self, path: PathKey, new_value: Any) -> None:
        if not path:
            if not isinstance(new_value, dict):
                raise ValueError("根节点必须是 JSON 对象。")
            self.data = new_value
            return
        parent_path = path[:-1]
        key = path[-1]
        parent = self.get_value(parent_path)
        if isinstance(key, int):
            parent[key] = new_value
        else:
            parent[key] = new_value

    def render_detail(self, path: PathKey) -> None:
        for child in self.detail_inner.winfo_children():
            child.destroy()

        value = self.get_value(path) if path else self.data
        self.detail_canvas.yview_moveto(0)
        header = ttk.Label(
            self.detail_inner,
            text=f"路径: {path_to_string(path)}    类型: {type(value).__name__}",
            anchor="w",
        )
        header.pack(fill="x", pady=(0, 4))

        self._render_value(self.detail_inner, path, value)

    def _on_mousewheel(self, event: tk.Event):
        widget = event.widget
        if not self._is_detail_widget(widget):
            return
        delta = 0
        if event.delta:
            delta = -1 if event.delta > 0 else 1
        elif getattr(event, "num", None) in (4, 5):
            delta = -1 if event.num == 4 else 1
        if delta:
            self.detail_canvas.yview_scroll(delta, "units")
            return "break"

    def _is_detail_widget(self, widget) -> bool:
        while widget is not None:
            if widget is self.detail_inner or widget is self.detail_canvas:
                return True
            widget = getattr(widget, "master", None)
        return False

    def _render_value(self, parent: ttk.Frame, path: PathKey, value: Any) -> None:
        if isinstance(value, dict):
            self._render_dict(parent, path, value)
        elif isinstance(value, list):
            self._render_list(parent, path, value)
        else:
            self._render_scalar(parent, path, value)

    def _render_dict(self, parent: ttk.Frame, path: PathKey, data: Dict[str, Any]) -> None:
        container = ttk.Frame(parent)
        container.pack(fill="x", padx=2, pady=2)
        if not data:
            ttk.Label(container, text="(空字典)", padding=(4, 2), foreground="#666").pack(anchor="w")
            return
        for key, child in data.items():
            child_path = path + (key,)
            row = ttk.Frame(container)
            row.pack(fill="x", pady=1)
            row.columnconfigure(1, weight=1)

            ttk.Label(row, text=str(key), width=12, anchor="w").grid(row=0, column=0, sticky="w", padx=(0, 6))

            body = ttk.Frame(row)
            body.grid(row=0, column=1, sticky="ew")
            self._render_child_content(body, child_path, child)

    def _render_list(self, parent: ttk.Frame, path: PathKey, items: List[Any]) -> None:
        container = ttk.Frame(parent)
        container.pack(fill="x", padx=2, pady=2)
        if not items:
            ttk.Label(container, text="(空列表)", padding=(4, 2), foreground="#666").pack(anchor="w")
            return
        for idx, child in enumerate(items):
            child_path = path + (idx,)
            row = ttk.Frame(container)
            row.pack(fill="x", pady=1)
            row.columnconfigure(1, weight=1)

            ttk.Label(row, text=f"[{idx}]", width=8, anchor="w").grid(row=0, column=0, sticky="w", padx=(0, 6))

            body = ttk.Frame(row)
            body.grid(row=0, column=1, sticky="ew")
            self._render_child_content(body, child_path, child)

    def _render_scalar(self, parent: ttk.Frame, path: PathKey, value: Any) -> None:
        container = ttk.Frame(parent)
        container.pack(fill="x", padx=2, pady=2)
        self._render_child_content(container, path, value)

    def _render_child_content(self, parent: ttk.Frame, path: PathKey, value: Any) -> None:
        if isinstance(value, dict):
            ttk.Label(parent, text=f"字典 · {len(value)} 项", foreground="#555").pack(anchor="w", pady=(0, 1))
            nested = ttk.Frame(parent)
            nested.pack(fill="x", padx=(12, 0), pady=(1, 3))
            self._render_dict(nested, path, value)
        elif isinstance(value, list):
            header = ttk.Frame(parent)
            header.pack(fill="x", pady=(0, 1))
            ttk.Label(header, text=f"列表 · {len(value)} 项", foreground="#555").pack(side="left", anchor="w")
            if value:
                nested = ttk.Frame(parent)
                nested.pack(fill="x", padx=(12, 0), pady=(1, 3))
                self._render_list(nested, path, value)
            if self._is_equipment_parameters(path):
                ttk.Button(parent, text="新增参数", width=8, command=lambda p=path: self._add_parameter(p)).pack(
                    anchor="e", pady=(2, 0)
                )
            elif self._is_segments_path(path):
                ttk.Button(parent, text="新增工段", command=lambda p=path: self._add_segment(p)).pack(
                    anchor="e", pady=(2, 0)
                )
        else:
            self._render_scalar_inputs(parent, path, value)

    @staticmethod
    def _is_segments_path(path: PathKey) -> bool:
        return bool(path) and path[-1] == "segments"

    @staticmethod
    def _is_equipment_parameters(path: PathKey) -> bool:
        return len(path) >= 3 and path[0] == "equipment" and path[-1] == "parameters"

    def _add_segment(self, path: PathKey) -> None:
        value = self.get_value(path)
        if not isinstance(value, list):
            return
        segment = simpledialog.askstring("新增工序", "请输入工序名称：", parent=self.master)
        if segment is None:
            return
        segment = segment.strip()
        if not segment:
            messagebox.showinfo("新增取消", "工序名称不能为空。", parent=self.master)
            return
        value.append(segment)
        self.set_dirty(True)
        self.refresh_tree(path)
        self.update_status(f"已添加工序：{segment}")

    def _add_parameter(self, path: PathKey) -> None:
        value = self.get_value(path)
        if not isinstance(value, list):
            return
        name = simpledialog.askstring("新增参数", "请输入参数标识 key：", parent=self.master)
        if name is None:
            return
        name = name.strip()
        if not name:
            messagebox.showinfo("新增取消", "参数 key 不能为空。", parent=self.master)
            return
        param = {
            "key": name,
            "label": name,
            "type": "number",
            "unit": "",
            "required": False,
            "default": "",
        }
        value.append(param)
        self.set_dirty(True)
        self.refresh_tree(path)
        self.update_status(f"已添加参数：{name}")

    def _render_scalar_inputs(self, frame: tk.Widget, path: PathKey, value: Any) -> None:
        if isinstance(value, bool):
            var = tk.StringVar(value="True" if value else "False")
            combo = ttk.Combobox(frame, textvariable=var, values=("True", "False"), state="readonly")
            combo.pack(fill="x", padx=0, pady=1)
            combo.bind(
                "<<ComboboxSelected>>",
                lambda _event, p=path, v=var, original=value: self._on_scalar_change(p, v.get(), original),
            )
        else:
            var = tk.StringVar(value=self._format_display(value))
            entry = ttk.Entry(frame, textvariable=var)
            entry.pack(fill="x", padx=0, pady=1)
            entry.bind(
                "<FocusOut>",
                lambda _event, p=path, v=var, original=value: self._on_scalar_change(p, v.get(), original),
            )
            def handle_return(event: Any, widget: tk.Widget = entry) -> str:
                next_widget = widget.tk_focusNext()
                if next_widget:
                    next_widget.focus_set()
                return "break"

            entry.bind("<Return>", handle_return)

    def _on_scalar_change(self, path: PathKey, text: str, original: Any) -> None:
        try:
            new_value = self._coerce_input(text, original)
        except ValueError as exc:
            messagebox.showerror("修改失败", str(exc), parent=self.master)
            self.refresh_tree(self.selected_path)
            return
        if new_value == original:
            return
        self.set_value(path, new_value)
        self.set_dirty(True)
        self.refresh_tree(self.selected_path)
        self.update_status(f"已更新 {path_to_string(path)}")

    @staticmethod
    def _coerce_input(text: str, original: Any) -> Any:
        stripped = text.strip()
        if isinstance(original, bool):
            lowered = stripped.lower()
            if lowered in {"true", "1", "y", "yes", "是"}:
                return True
            if lowered in {"false", "0", "n", "no", "否"}:
                return False
            raise ValueError("请输入 true 或 false。")
        if isinstance(original, int) and not isinstance(original, bool):
            if stripped == "":
                raise ValueError("整数值不能为空。")
            try:
                return int(stripped)
            except ValueError as exc:
                raise ValueError("请输入有效的整数。") from exc
        if isinstance(original, float):
            if stripped == "":
                raise ValueError("浮点数值不能为空。")
            try:
                return float(stripped)
            except ValueError as exc:
                raise ValueError("请输入有效的浮点数。") from exc
        if original is None:
            return stripped
        return text

    @staticmethod
    def _format_display(value: Any) -> str:
        if value is None:
            return ""
        return str(value)

    def expand_selected_subtree(self, event: Any | None = None) -> str:
        selection = self.tree.selection()
        if not selection:
            return "break"
        iid = selection[0]
        path = self.iid_to_path.get(iid, ())
        if len(path) < 2:
            self.update_status("该快捷键仅适用于二级节点。")
            return "break"
        self._expand_recursive(iid)
        self.update_status(f"已展开 {path_to_string(path)} 的所有子项")
        return "break"

    def _expand_recursive(self, iid: str) -> None:
        self.tree.item(iid, open=True)
        for child in self.tree.get_children(iid):
            self._expand_recursive(child)

    def delete_value(self, path: PathKey) -> None:
        parent_path = path[:-1]
        key = path[-1]
        parent = self.get_value(parent_path)
        if isinstance(parent, list) and isinstance(key, int):
            parent.pop(key)
        elif isinstance(parent, dict) and isinstance(key, str):
            del parent[key]
        else:
            raise ValueError("无法删除该节点。")

    def resolve_container(self) -> Tuple[PathKey, Any] | None:
        path = self.selected_path
        value = self.get_value(path)
        if isinstance(value, (dict, list)):
            return path, value
        if not path:
            return None
        parent_path = path[:-1]
        parent_value = self.get_value(parent_path)
        if isinstance(parent_value, (dict, list)):
            return parent_path, parent_value
        return None

    def add_child(self) -> None:
        resolved = self.resolve_container()
        if not resolved:
            messagebox.showinfo("无法新增", "请选择一个字典或列表节点。")
            return
        container_path, container_value = resolved
        if isinstance(container_value, dict):
            key = simpledialog.askstring("新增键", "请输入新的键名：", parent=self.master)
            if not key:
                return
            if key in container_value:
                messagebox.showerror("新增失败", "该键已存在。")
                return
            value_text = simpledialog.askstring(
                "新增键",
                "请输入该键的初始值 (JSON 格式，例如 {}, [] 或 \"文本\")：",
                parent=self.master,
                initialvalue="{}",
            )
            if value_text is None:
                return
            try:
                container_value[key] = json.loads(value_text)
            except json.JSONDecodeError as exc:
                messagebox.showerror("新增失败", f"JSON 解析错误：{exc}")
                return
            new_path = container_path + (key,)
        else:
            special_path = self._match_top_level_list(container_path)
            if special_path:
                key_name = "name" if special_path in {"materials", "equipment"} else "item"
                prompt = f"请输入新的{key_name}："
                value = simpledialog.askstring("新增子项", prompt, parent=self.master)
                if not value:
                    return
                template = self._create_entry_from_template(special_path, container_value)
                template[key_name] = value
                container_value.append(template)
                new_path = container_path + (len(container_value) - 1,)
            else:
                template = "{}" if self._guess_list_of_dicts(container_value) else "\""
                initial = template if template != "\"" else "\"\""
                value_text = simpledialog.askstring(
                    "新增元素",
                    "请输入新元素的值 (JSON 格式)：",
                    parent=self.master,
                    initialvalue=initial,
                )
                if value_text is None:
                    return
                try:
                    new_value = json.loads(value_text)
                except json.JSONDecodeError as exc:
                    messagebox.showerror("新增失败", f"JSON 解析错误：{exc}")
                    return
                container_value.append(new_value)
                new_path = container_path + (len(container_value) - 1,)
        self.set_dirty(True)
        self.refresh_tree(new_path)
        self.update_status(f"已新增 {path_to_string(new_path)}")

    def delete_current_node(self) -> None:
        path = self.selected_path
        if not path:
            messagebox.showinfo("无法删除", "根节点不能删除。")
            return
        if not messagebox.askyesno("确认删除", f"是否删除 {path_to_string(path)} ?", parent=self.master):
            return
        try:
            self.delete_value(path)
        except ValueError as exc:
            messagebox.showerror("删除失败", str(exc))
            return
        parent_path = path[:-1]
        self.set_dirty(True)
        self.refresh_tree(parent_path)
        self.update_status(f"已删除 {path_to_string(path)}")

    def save_file(self) -> bool:
        try:
            save_config(self.config_path, self.data)
        except OSError as exc:
            messagebox.showerror("保存失败", str(exc))
            return False
        self.set_dirty(False)
        self.update_status(f"已保存到 {self.config_path}")
        return True

    def reload_data(self) -> None:
        if self.dirty and not messagebox.askyesno(
            "重新加载", "存在未保存修改，确定放弃并重新加载？", parent=self.master
        ):
            return
        self.data = load_config(self.config_path)
        self.set_dirty(False)
        self.refresh_tree(())
        self.update_status("已重新加载文件")

    def on_close(self) -> None:
        if self.dirty:
            answer = messagebox.askyesnocancel("退出", "存在未保存修改，是否保存后退出？", parent=self.master)
            if answer is None:
                return
            if answer:
                if not self.save_file():
                    return
        self.master.destroy()

    def set_dirty(self, flag: bool) -> None:
        if self.dirty == flag:
            return
        self.dirty = flag
        title = "fields_config.json 编辑器"
        if flag:
            title += " *"
        self.master.title(title)

    def update_status(self, message: str) -> None:
        self.status_var.set(message)

    @staticmethod
    def _guess_list_of_dicts(values: Sequence[Any]) -> bool:
        return any(isinstance(item, dict) for item in values)

    def _match_top_level_list(self, path: PathKey) -> str | None:
        if len(path) == 1 and isinstance(path[0], str) and path[0] in DEFAULT_TEMPLATES:
            return path[0]
        return None

    def _create_entry_from_template(self, category: str, existing: Sequence[Any]) -> Dict[str, Any]:
        if existing:
            example = existing[0]
            return self._blank_like(example)
        template = DEFAULT_TEMPLATES.get(category, {})
        return copy.deepcopy(template)

    def _blank_like(self, example: Any) -> Any:
        if isinstance(example, dict):
            return {key: self._blank_like(value) for key, value in example.items()}
        if isinstance(example, list):
            if example and isinstance(example[0], dict):
                return [self._blank_like(example[0])]
            return []
        if isinstance(example, bool):
            return False
        return ""


def run_gui(config_path: Path) -> None:
    root = tk.Tk()
    FieldConfigEditor(root, config_path)
    root.mainloop()


def main() -> None:
    parser = argparse.ArgumentParser(description="使用 Tkinter 编辑 fields_config.json 的工具")
    parser.add_argument(
        "--config",
        type=Path,
        default=CONFIG_PATH,
        help="自定义配置文件路径（默认使用项目内的 fields_config.json）",
    )
    args = parser.parse_args()
    config_path = args.config.expanduser()
    if not config_path.exists():
        raise SystemExit(f"未找到配置文件：{config_path}")
    run_gui(config_path)


if __name__ == "__main__":
    main()
