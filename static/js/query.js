document.addEventListener('DOMContentLoaded', function() {
    // 全局变量
    let currentUser = {};
    let processSegments = [];
    let queryResults = [];
    let filteredResults = [];
    let currentPage = 1;
    let pageSize = 25;
    let sortColumn = '';
    let sortDirection = 'asc';
    let chartInstance = null;
    let chartHasRendered = false;
    let chartColumnMeta = {};
    
    // DOM元素
    const batchNumberInput = document.getElementById('batchNumber');
    const productNameInput = document.getElementById('productName');
    const processSegmentSelect = document.getElementById('processSegment');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const materialCodeInput = document.getElementById('materialCode');
    const materialNameInput = document.getElementById('materialName');
    const supplierInput = document.getElementById('supplier');
    const equipmentCodeInput = document.getElementById('equipmentCode');
    const equipmentNameInput = document.getElementById('equipmentName');
    const equipmentStatusSelect = document.getElementById('equipmentStatus');
    const testItemInput = document.getElementById('testItem');
    const testResultSelect = document.getElementById('testResult');
    const minValueInput = document.getElementById('minValue');
    const maxValueInput = document.getElementById('maxValue');
    
    // 按钮元素
    const resetBtn = document.getElementById('resetBtn');
    const queryBtn = document.getElementById('queryBtn');
    const exportBtn = document.getElementById('exportBtn');
    
    // 结果区域元素
    const resultsCount = document.getElementById('resultsCount');
    const resultsLoading = document.getElementById('resultsLoading');
    const resultsEmpty = document.getElementById('resultsEmpty');
    const resultsTableContainer = document.getElementById('resultsTableContainer');
    const resultsTable = document.getElementById('resultsTable');
    const resultsTableBody = resultsTable.querySelector('tbody');
    
    // 表格控制元素
    const tableSearch = document.getElementById('tableSearch');
    const pageSizeSelect = document.getElementById('pageSize');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    
    // 模态框元素
    const exportModal = document.getElementById('exportModal');
    const exportForm = document.getElementById('exportForm');
    const columnsList = document.getElementById('columnsList');
    const detailModal = document.getElementById('detailModal');
    const chartSection = document.getElementById('resultsChartSection');
    const chartTypeSelect = document.getElementById('chartType');
    const chartXAxisSelect = document.getElementById('chartXAxis');
    const chartYAxisSelect = document.getElementById('chartYAxis');
    const renderChartBtn = document.getElementById('renderChartBtn');
    const chartCanvas = document.getElementById('resultsChart');

    const COLUMN_LABELS = {
        batch_number: '批号',
        product_name: '产品名称',
        process_segment: '工艺段',
        status: '状态',
        start_time: '开始时间',
        end_time: '结束时间',
        material_code: '物料编码',
        material_name: '物料名称',
        weight: '重量',
        material_unit: '物料单位',
        supplier: '供应商',
        equipment_code: '设备编码',
        equipment_name: '设备名称',
        equipment_status: '设备状态',
        test_item: '检测项目',
        test_value: '检测值',
        quality_unit: '检测单位',
        result: '结果',
        standard_min: '标准下限',
        standard_max: '标准上限'
    };

    const CHART_BACKGROUND_COLORS = [
        'rgba(78, 121, 167, 0.6)',
        'rgba(242, 142, 44, 0.6)',
        'rgba(225, 87, 89, 0.6)',
        'rgba(118, 183, 178, 0.6)',
        'rgba(89, 161, 79, 0.6)',
        'rgba(237, 201, 72, 0.6)',
        'rgba(176, 122, 161, 0.6)',
        'rgba(255, 157, 167, 0.6)',
        'rgba(156, 117, 95, 0.6)',
        'rgba(186, 176, 171, 0.6)'
    ];

    const CHART_BORDER_COLORS = [
        'rgba(78, 121, 167, 1)',
        'rgba(242, 142, 44, 1)',
        'rgba(225, 87, 89, 1)',
        'rgba(118, 183, 178, 1)',
        'rgba(89, 161, 79, 1)',
        'rgba(237, 201, 72, 1)',
        'rgba(176, 122, 161, 1)',
        'rgba(255, 157, 167, 1)',
        'rgba(156, 117, 95, 1)',
        'rgba(186, 176, 171, 1)'
    ];

    
    // 初始化应用
    initApp();
    
    // 初始化应用
    function initApp() {
        // 获取用户信息
        const bodyDataset = document.body.dataset || {};
        currentUser = {
            username: bodyDataset.username || document.getElementById('headerUsername').textContent || '未登录',
            role: bodyDataset.role || document.getElementById('sidebarUserRole').textContent || ''
        };

        const sidebarUsernameEl = document.getElementById('sidebarUsername');
        const sidebarUserRoleEl = document.getElementById('sidebarUserRole');
        const headerUsernameEl = document.getElementById('headerUsername');

        if (sidebarUsernameEl) {
            sidebarUsernameEl.textContent = currentUser.username || '未登录';
        }
        if (sidebarUserRoleEl) {
            sidebarUserRoleEl.textContent = getRoleDisplayName(currentUser.role);
        }
        if (headerUsernameEl) {
            headerUsernameEl.textContent = currentUser.username || '用户';
        }

        // 显示/隐藏管理员菜单
        if (currentUser.role === 'admin') {
            const adminMenu = document.getElementById('adminMenu');
            if (adminMenu) {
                adminMenu.style.display = 'block';
            }
        }
        
        // 设置默认日期范围（最近30天）
        setDefaultDateRange();
        
        // 加载工艺段
        loadProcessSegments();
        
        // 设置事件监听器
        setupEventListeners();
    }
    
    // 获取角色显示名称
    function getRoleDisplayName(role) {
        const roleMap = {
            'admin': '管理员',
            'read': '只读用户',
            'write': '只写用户'
        };
        return roleMap[role] || role;
    }
    
    // 设置默认日期范围
    function setDefaultDateRange() {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        
        startDateInput.value = startDate.toISOString().split('T')[0];
        endDateInput.value = endDate.toISOString().split('T')[0];
    }
    
    // 设置事件监听器
    function setupEventListeners() {
        // 查询按钮
        queryBtn.addEventListener('click', executeQuery);
        
        // 重置按钮
        resetBtn.addEventListener('click', resetConditions);
        
        // 导出按钮
        exportBtn.addEventListener('click', showExportModal);
        
        // 表格搜索
        tableSearch.addEventListener('input', filterTableResults);
        
        // 分页控制
        pageSizeSelect.addEventListener('change', function() {
            pageSize = parseInt(this.value);
            currentPage = 1;
            renderTable();
        });
        
        prevPageBtn.addEventListener('click', goToPrevPage);
        nextPageBtn.addEventListener('click', goToNextPage);
        
        // 模态框关闭
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', closeModals);
        });
        
        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
            if (event.target.classList.contains('modal')) {
                closeModals();
            }
        });
        
        // 导出表单提交
        exportForm.addEventListener('submit', handleExport);
        
        // 按Enter键执行查询
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                executeQuery();
            }
        });

        if (renderChartBtn) {
            renderChartBtn.addEventListener('click', () => renderResultsChart(true));
        }
    }
    
    // 加载工艺段
    function loadProcessSegments() {
        fetch('/api/process_segments')
            .then(response => response.json())
            .then(segments => {
                processSegments = segments;
                
                // 填充工艺段下拉框
                processSegmentSelect.innerHTML = '<option value="">所有工艺段</option>';
                
                segments.forEach(segment => {
                    const option = document.createElement('option');
                    option.value = segment.segment_name;
                    option.textContent = segment.segment_name;
                    processSegmentSelect.appendChild(option);
                });
            })
            .catch(error => {
                console.error('加载工艺段失败:', error);
                showNotification('加载工艺段失败', 'error');
            });
    }
    
    // 执行查询
    function executeQuery() {
        // 显示加载状态
        resultsLoading.style.display = 'block';
        resultsEmpty.style.display = 'none';
        resultsTableContainer.style.display = 'none';
        exportBtn.disabled = true;
        
        // 构建查询参数
        const params = new URLSearchParams();
        
        // 基本条件
        if (batchNumberInput.value) params.append('batch_number', batchNumberInput.value);
        if (productNameInput.value) params.append('product_name', productNameInput.value);
        if (processSegmentSelect.value) params.append('process_segment', processSegmentSelect.value);
        if (startDateInput.value) params.append('start_date', startDateInput.value);
        if (endDateInput.value) params.append('end_date', endDateInput.value);
        
        // 物料条件
        if (materialCodeInput.value) params.append('material_code', materialCodeInput.value);
        if (materialNameInput.value) params.append('material_name', materialNameInput.value);
        if (supplierInput.value) params.append('supplier', supplierInput.value);
        
        // 设备条件
        if (equipmentCodeInput.value) params.append('equipment_code', equipmentCodeInput.value);
        if (equipmentNameInput.value) params.append('equipment_name', equipmentNameInput.value);
        if (equipmentStatusSelect.value) params.append('equipment_status', equipmentStatusSelect.value);
        
        // 品质条件
        if (testItemInput.value) params.append('test_item', testItemInput.value);
        if (testResultSelect.value) params.append('test_result', testResultSelect.value);
        if (minValueInput.value) params.append('min_value', minValueInput.value);
        if (maxValueInput.value) params.append('max_value', maxValueInput.value);
        
        // 发送查询请求
        fetch(`/api/query?${params.toString()}`)
            .then(response => response.json())
            .then(data => {
                queryResults = data;
                filteredResults = [...data];

                destroyChart();
                chartHasRendered = false;
                updateChartControls();
                
                // 更新结果计数
                resultsCount.textContent = data.length;
                
                // 重置分页
                currentPage = 1;
                
                // 渲染表格
                renderTable();
                
                // 显示结果区域
                resultsLoading.style.display = 'none';
                
                if (data.length > 0) {
                    resultsTableContainer.style.display = 'block';
                    exportBtn.disabled = false;
                } else {
                    resultsEmpty.style.display = 'block';
                }
            })
            .catch(error => {
                console.error('查询失败:', error);
                resultsLoading.style.display = 'none';
                resultsEmpty.style.display = 'block';
                showNotification('查询失败，请检查网络连接', 'error');
            });
    }
    
    // 重置查询条件
    function resetConditions() {
        // 重置所有输入框和选择框
        document.querySelectorAll('.query-conditions input, .query-conditions select').forEach(element => {
            if (element.type === 'text' || element.type === 'number') {
                element.value = '';
            } else if (element.tagName === 'SELECT') {
                element.selectedIndex = 0;
            }
        });
        
        // 重置日期范围
        setDefaultDateRange();
        
        // 重置结果区域
        resultsCount.textContent = '0';
        resultsEmpty.style.display = 'block';
        resultsTableContainer.style.display = 'none';
        exportBtn.disabled = true;

        // 清空结果数据
        queryResults = [];
        filteredResults = [];

        destroyChart();
        chartHasRendered = false;
        if (chartSection) {
            chartSection.style.display = 'none';
        }
        if (chartXAxisSelect) {
            chartXAxisSelect.innerHTML = '';
        }
        if (chartYAxisSelect) {
            chartYAxisSelect.innerHTML = '';
        }
    }
    
    // 过滤表格结果（客户端搜索）
    function filterTableResults() {
        const searchTerm = tableSearch.value.toLowerCase();
        
        if (!searchTerm) {
            filteredResults = [...queryResults];
        } else {
            filteredResults = queryResults.filter(result => {
                // 搜索所有文本字段
                return Object.values(result).some(value => 
                    value && value.toString().toLowerCase().includes(searchTerm)
                );
            });
        }
        
        currentPage = 1;
        resultsCount.textContent = filteredResults.length;
        updateChartControls();
        renderTable();
        renderResultsChart(false);
    }
    
    // 渲染表格
    function renderTable() {
        // 计算分页数据
        const totalResults = filteredResults.length;
        const totalPages = Math.ceil(totalResults / pageSize);
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalResults);
        const pageResults = filteredResults.slice(startIndex, endIndex);
        
        // 更新分页信息
        paginationInfo.textContent = `第 ${currentPage} 页，共 ${totalPages} 页`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
        
        // 清空表格
        resultsTableBody.innerHTML = '';
        
        // 填充表格数据
        pageResults.forEach(result => {
            const row = document.createElement('tr');
            
            // 批号列（可点击查看详情）
            const batchCell = document.createElement('td');
            batchCell.innerHTML = `<span class="batch-number" data-batch="${result.batch_number}">${result.batch_number}</span>`;
            row.appendChild(batchCell);
            
            // 其他列
            row.appendChild(createCell(result.product_name));
            row.appendChild(createCell(result.process_segment));
            row.appendChild(createStatusCell(result.status));
            row.appendChild(createCell(formatDate(result.start_time)));
            row.appendChild(createCell(result.end_time ? formatDate(result.end_time) : '-'));
            row.appendChild(createCell(result.material_code || '-'));
            row.appendChild(createCell(result.material_name || '-'));
            row.appendChild(createCell(result.weight ? `${result.weight} ${result.material_unit || ''}` : '-'));
            row.appendChild(createAttachmentCell(result.material_attachments));
            row.appendChild(createCell(result.equipment_code || '-'));
            row.appendChild(createCell(result.equipment_name || '-'));
            row.appendChild(createAttachmentCell(result.equipment_attachments));
            row.appendChild(createCell(result.test_item || '-'));
            row.appendChild(createCell(result.test_value || '-'));
            row.appendChild(createAttachmentCell(result.quality_attachments));
            row.appendChild(createResultCell(result.result));
            
            resultsTableBody.appendChild(row);
        });
        
        // 添加批号点击事件
        resultsTableBody.querySelectorAll('.batch-number').forEach(element => {
            element.addEventListener('click', function() {
                viewBatchDetail(this.dataset.batch);
            });
        });
        
        // 添加表头排序事件
        addTableSorting();

        if (chartHasRendered) {
            renderResultsChart(false);
        }
    }
    
    // 创建普通表格单元格
    function createCell(content) {
        const cell = document.createElement('td');
        cell.textContent = content || '-';
        cell.title = content || '';
        return cell;
    }

    function createAttachmentCell(attachments) {
        const cell = document.createElement('td');
        if (Array.isArray(attachments) && attachments.length > 0) {
            const names = attachments.filter(Boolean).join('，');
            cell.textContent = names || '-';
            cell.title = names;
        } else {
            cell.textContent = '-';
        }
        return cell;
    }
    
    // 创建状态单元格
    function createStatusCell(status) {
        const cell = document.createElement('td');
        if (status) {
            const statusClass = `status-${getStatusClass(status)}`;
            cell.innerHTML = `<span class="status-badge ${statusClass}">${status}</span>`;
        } else {
            cell.textContent = '-';
        }
        return cell;
    }
    
    // 创建结果单元格
    function createResultCell(result) {
        const cell = document.createElement('td');
        if (result) {
            let resultClass = '';
            if (result === '合格') resultClass = 'result-pass';
            else if (result === '不合格') resultClass = 'result-fail';
            else if (result === '待定') resultClass = 'result-pending';
            
            cell.innerHTML = `<span class="result-badge ${resultClass}">${result}</span>`;
        } else {
            cell.textContent = '-';
        }
        return cell;
    }
    
    // 获取状态类名
    function getStatusClass(status) {
        const statusMap = {
            '进行中': 'active',
            '已完成': 'completed',
            '暂停': 'paused',
            '异常': 'error'
        };
        return statusMap[status] || 'active';
    }
    
    // 格式化日期
    function formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    }
    
    // 添加上一页
    function goToPrevPage() {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    }
    
    // 添加下一页
    function goToNextPage() {
        const totalPages = Math.ceil(filteredResults.length / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    }
    
    // 添加表格排序功能
    function addTableSorting() {
        const headers = resultsTable.querySelectorAll('th');
        
        headers.forEach((header, index) => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', function() {
                // 更新排序状态
                if (sortColumn === index) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = index;
                    sortDirection = 'asc';
                }
                
                // 添加排序指示器
                headers.forEach(h => {
                    h.innerHTML = h.innerHTML.replace(/ ?[↑↓]/, '');
                });
                
                const indicator = sortDirection === 'asc' ? ' ↑' : ' ↓';
                header.innerHTML += indicator;
                
                // 执行排序
                sortResults(index);
                renderTable();
            });
        });
    }
    
    // 排序结果
    function sortResults(columnIndex) {
        const columnKeys = [
            'batch_number', 'product_name', 'process_segment', 'status', 
            'start_time', 'end_time', 'material_code', 'material_name', 
            'weight', 'equipment_code', 'equipment_name', 'test_item', 
            'test_value', 'result'
        ];
        
        const key = columnKeys[columnIndex];
        
        filteredResults.sort((a, b) => {
            let aValue = a[key] || '';
            let bValue = b[key] || '';
            
            // 处理空值
            if (aValue === '' && bValue !== '') return 1;
            if (aValue !== '' && bValue === '') return -1;
            if (aValue === '' && bValue === '') return 0;
            
            // 特殊处理数字和日期
            if (key === 'weight' || key === 'test_value') {
                aValue = parseFloat(aValue) || 0;
                bValue = parseFloat(bValue) || 0;
            } else if (key === 'start_time' || key === 'end_time') {
                aValue = new Date(aValue).getTime();
                bValue = new Date(bValue).getTime();
            }
            
            // 比较值
            if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    // 查看批号详情
    function viewBatchDetail(batchNumber) {
        // 查找批号详情
        const batch = queryResults.find(r => r.batch_number === batchNumber);
        
        if (batch) {
            const content = `
                <div class="detail-section">
                    <h3>批号信息</h3>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <label>批号:</label>
                            <span>${batch.batch_number}</span>
                        </div>
                        <div class="detail-item">
                            <label>产品名称:</label>
                            <span>${batch.product_name}</span>
                        </div>
                        <div class="detail-item">
                            <label>工艺段:</label>
                            <span>${batch.process_segment}</span>
                        </div>
                        <div class="detail-item">
                            <label>状态:</label>
                            <span class="status-badge status-${getStatusClass(batch.status)}">${batch.status}</span>
                        </div>
                        <div class="detail-item">
                            <label>开始时间:</label>
                            <span>${formatDate(batch.start_time)}</span>
                        </div>
                        <div class="detail-item">
                            <label>结束时间:</label>
                            <span>${batch.end_time ? formatDate(batch.end_time) : '-'}</span>
                        </div>
                    </div>
                </div>
                
                ${batch.material_code ? `
                <div class="detail-section">
                    <h3>物料信息</h3>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <label>物料编码:</label>
                            <span>${batch.material_code}</span>
                        </div>
                        <div class="detail-item">
                            <label>物料名称:</label>
                            <span>${batch.material_name}</span>
                        </div>
                        <div class="detail-item">
                            <label>重量:</label>
                            <span>${batch.weight} ${batch.material_unit || ''}</span>
                        </div>
                        ${batch.supplier ? `
                        <div class="detail-item">
                            <label>供应商:</label>
                            <span>${batch.supplier}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
                ${batch.equipment_code ? `
                <div class="detail-section">
                    <h3>设备信息</h3>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <label>设备编码:</label>
                            <span>${batch.equipment_code}</span>
                        </div>
                        <div class="detail-item">
                            <label>设备名称:</label>
                            <span>${batch.equipment_name}</span>
                        </div>
                        <div class="detail-item">
                            <label>开始时间:</label>
                            <span>${formatDate(batch.equipment_start)}</span>
                        </div>
                        <div class="detail-item">
                            <label>结束时间:</label>
                            <span>${batch.equipment_end ? formatDate(batch.equipment_end) : '-'}</span>
                        </div>
                        <div class="detail-item">
                            <label>状态:</label>
                            <span>${batch.equipment_status || '-'}</span>
                        </div>
                    </div>
                </div>
                ` : ''}
                
                ${batch.test_item ? `
                <div class="detail-section">
                    <h3>品质信息</h3>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <label>检测项目:</label>
                            <span>${batch.test_item}</span>
                        </div>
                        <div class="detail-item">
                            <label>检测值:</label>
                            <span>${batch.test_value} ${batch.quality_unit || ''}</span>
                        </div>
                        <div class="detail-item">
                            <label>结果:</label>
                            <span class="result-badge ${batch.result === '合格' ? 'result-pass' : batch.result === '不合格' ? 'result-fail' : 'result-pending'}">${batch.result}</span>
                        </div>
                    </div>
                </div>
                ` : ''}
            `;
            
            document.getElementById('detailModalContent').innerHTML = content;
            detailModal.style.display = 'flex';
        }
    }
    
    // 显示导出模态框
    function showExportModal() {
        // 填充列选项
        columnsList.innerHTML = '';
        
        const columns = [
            { id: 'batch_number', name: '批号', checked: true },
            { id: 'product_name', name: '产品名称', checked: true },
            { id: 'process_segment', name: '工艺段', checked: true },
            { id: 'status', name: '状态', checked: true },
            { id: 'start_time', name: '开始时间', checked: true },
            { id: 'end_time', name: '结束时间', checked: true },
            { id: 'material_code', name: '物料编码', checked: true },
            { id: 'material_name', name: '物料名称', checked: true },
            { id: 'weight', name: '重量', checked: true },
            { id: 'equipment_code', name: '设备编码', checked: true },
            { id: 'equipment_name', name: '设备名称', checked: true },
            { id: 'test_item', name: '检测项目', checked: true },
            { id: 'test_value', name: '检测值', checked: true },
            { id: 'result', name: '结果', checked: true }
        ];
        
        columns.forEach(column => {
            const item = document.createElement('div');
            item.className = 'column-item';
            item.innerHTML = `
                <input type="checkbox" id="col_${column.id}" name="columns" value="${column.id}" ${column.checked ? 'checked' : ''}>
                <label for="col_${column.id}">${column.name}</label>
            `;
            columnsList.appendChild(item);
        });
        
        exportModal.style.display = 'flex';
    }
    
    // 处理导出
    function handleExport(e) {
        e.preventDefault();
        
        const fileName = document.getElementById('exportFileName').value;
        const exportScope = document.getElementById('exportScope').value;
        
        // 获取选中的列
        const selectedColumns = [];
        document.querySelectorAll('input[name="columns"]:checked').forEach(checkbox => {
            selectedColumns.push(checkbox.value);
        });
        
        if (selectedColumns.length === 0) {
            showNotification('请至少选择一列进行导出', 'error');
            return;
        }
        
        // 确定要导出的数据
        let dataToExport = [];
        if (exportScope === 'current') {
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, filteredResults.length);
            dataToExport = filteredResults.slice(startIndex, endIndex);
        } else {
            dataToExport = filteredResults;
        }
        
        // 生成CSV内容
        const csvContent = generateCSV(dataToExport, selectedColumns);
        
        // 创建下载链接
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        logExportEvent(blob.size);
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `${fileName}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // 关闭模态框
        closeModals();
        showNotification('CSV文件导出成功', 'success');
    }
    
    // 生成CSV内容
    function generateCSV(data, columns) {
        // CSV标题行
        const headers = columns.map(col => {
            const columnNames = {
                'batch_number': '批号',
                'product_name': '产品名称',
                'process_segment': '工艺段',
                'status': '状态',
                'start_time': '开始时间',
                'end_time': '结束时间',
                'material_code': '物料编码',
                'material_name': '物料名称',
                'weight': '重量',
                'equipment_code': '设备编码',
                'equipment_name': '设备名称',
                'test_item': '检测项目',
                'test_value': '检测值',
                'result': '结果'
            };
            return columnNames[col] || col;
        });
        
        let csvContent = headers.join(',') + '\n';
        
        // 数据行
        data.forEach(row => {
            const values = columns.map(col => {
                let value = row[col] || '';
                
                // 处理包含逗号的值
                if (value.toString().includes(',')) {
                    value = `"${value}"`;
                }
                
                return value;
            });
            
            csvContent += values.join(',') + '\n';
        });
        
        return csvContent;
    }

    function logExportEvent(fileSizeBytes) {
        if (!Number.isFinite(fileSizeBytes)) {
            return;
        }
        fetch('/api/export/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_size: fileSizeBytes })
        }).catch(error => console.warn('记录导出日志失败:', error));
    }

    function updateChartControls() {
        if (!chartSection || !chartXAxisSelect || !chartYAxisSelect) {
            return;
        }

        if (!filteredResults.length) {
            chartSection.style.display = 'none';
            chartColumnMeta = {};
            chartXAxisSelect.innerHTML = '';
            chartYAxisSelect.innerHTML = '';
            destroyChart();
            chartHasRendered = false;
            return;
        }

        chartColumnMeta = buildChartColumnMeta(filteredResults);
        const availableKeys = Object.keys(chartColumnMeta);
        if (!availableKeys.length) {
            chartSection.style.display = 'none';
            chartColumnMeta = {};
            chartXAxisSelect.innerHTML = '';
            chartYAxisSelect.innerHTML = '';
            return;
        }

        chartSection.style.display = 'flex';

        const previousX = chartXAxisSelect.value;
        const previousY = Array.from(chartYAxisSelect.selectedOptions || []).map(option => option.value);

        populateChartSelect(chartXAxisSelect, availableKeys, previousX, false);

        const numericKeys = availableKeys.filter(isNumericColumn);
        if (!numericKeys.length) {
            chartSection.style.display = 'none';
            chartYAxisSelect.innerHTML = '';
            if (chartHasRendered) {
                destroyChart();
                chartHasRendered = false;
            }
            return;
        }

        populateChartSelect(chartYAxisSelect, numericKeys, previousY, true);

        if (!chartXAxisSelect.value && availableKeys.length) {
            chartXAxisSelect.value = availableKeys[0];
        }

        if (!Array.from(chartYAxisSelect.selectedOptions || []).length && numericKeys.length) {
            chartYAxisSelect.value = numericKeys[0];
        }

        if (chartHasRendered) {
            renderResultsChart(false);
        }
    }

    function buildChartColumnMeta(results) {
        const meta = {};
        results.forEach(row => {
            Object.entries(row).forEach(([key, value]) => {
                if (key.endsWith('_attachments') || key === 'parameters_json') {
                    return;
                }

                if (value === null || value === undefined || value === '') {
                    if (!meta[key]) {
                        meta[key] = { numeric: true, hasValue: false };
                    }
                    return;
                }

                if (Array.isArray(value) || typeof value === 'object') {
                    return;
                }

                const entry = meta[key] || { numeric: true, hasValue: false };
                entry.hasValue = true;
                if (typeof value !== 'number') {
                    entry.numeric = false;
                }
                meta[key] = entry;
            });
        });

        Object.keys(meta).forEach(key => {
            if (!meta[key].hasValue) {
                delete meta[key];
            }
        });

        return meta;
    }

    function populateChartSelect(selectEl, keys, previous, isMultiple) {
        if (!selectEl) {
            return;
        }

        const previousValues = Array.isArray(previous)
            ? previous
            : (previous ? [previous] : []);

        selectEl.innerHTML = '';
        keys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = columnDisplayName(key);
            if (isMultiple) {
                option.selected = previousValues.includes(key);
            } else if (previousValues.length && previousValues[0] === key) {
                option.selected = true;
            }
            selectEl.appendChild(option);
        });
    }

    function columnDisplayName(key) {
        return COLUMN_LABELS[key] || key;
    }

    function destroyChart() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    function renderResultsChart(triggeredByUser = true) {
        if (!chartSection || !chartCanvas) {
            return;
        }

        if (!filteredResults.length) {
            if (triggeredByUser) {
                showNotification('暂无可用于绘图的数据', 'warning');
            }
            return;
        }

        if (!triggeredByUser && !chartHasRendered) {
            return;
        }

        const chartType = chartTypeSelect ? chartTypeSelect.value : 'line';
        const xKey = chartXAxisSelect ? chartXAxisSelect.value : '';
        const yKeys = chartYAxisSelect
            ? Array.from(chartYAxisSelect.selectedOptions || []).map(option => option.value)
            : [];

        if (!xKey || !yKeys.length) {
            if (triggeredByUser) {
                showNotification('请先选择X轴字段和至少一个Y轴字段', 'warning');
            }
            return;
        }

        if (chartType === 'scatter' && !isNumericColumn(xKey)) {
            if (triggeredByUser) {
                showNotification('散点图的X轴需要选择数值类型字段', 'error');
            }
            return;
        }

        const invalidY = yKeys.filter(key => !isNumericColumn(key));
        if (invalidY.length) {
            if (triggeredByUser) {
                showNotification('所选Y轴字段必须为数值类型', 'error');
            }
            return;
        }

        let chartConfig;

        if (chartType === 'scatter') {
            const datasets = yKeys.map((key, index) => {
                const dataPoints = filteredResults.map(row => {
                    const xValue = Number(row[xKey]);
                    const yValue = Number(row[key]);
                    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) {
                        return null;
                    }
                    return { x: xValue, y: yValue };
                }).filter(Boolean);

                return {
                    label: columnDisplayName(key),
                    data: dataPoints,
                    showLine: false,
                    borderColor: getChartColor(index, false),
                    backgroundColor: getChartColor(index, true)
                };
            }).filter(dataset => dataset.data.length);

            if (!datasets.length) {
                if (triggeredByUser) {
                    showNotification('所选字段无法生成有效的散点数据', 'warning');
                }
                return;
            }

            chartConfig = {
                type: 'scatter',
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { title: { display: true, text: columnDisplayName(xKey) } },
                        y: { title: { display: true, text: '数值' } }
                    }
                }
            };
        } else {
            const labels = filteredResults.map(row => formatChartLabel(row[xKey]));
            const datasets = yKeys.map((key, index) => ({
                label: columnDisplayName(key),
                data: filteredResults.map(row => toNumericValue(row[key])),
                fill: false,
                tension: chartType === 'line' ? 0.2 : 0,
                borderWidth: 2,
                borderColor: getChartColor(index, false),
                backgroundColor: getChartColor(index, true)
            })).filter(dataset => dataset.data.some(value => value !== null && value !== undefined));

            if (!datasets.length) {
                if (triggeredByUser) {
                    showNotification('所选字段无法生成有效的图表数据', 'warning');
                }
                return;
            }

            chartConfig = {
                type: chartType,
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { title: { display: true, text: columnDisplayName(xKey) } },
                        y: {
                            title: { display: true, text: '数值' },
                            beginAtZero: chartType === 'bar'
                        }
                    }
                }
            };
        }

        destroyChart();
        const context = chartCanvas.getContext('2d');
        chartInstance = new Chart(context, chartConfig);
        chartHasRendered = true;
    }

    function getChartColor(index, fill) {
        const palette = fill ? CHART_BACKGROUND_COLORS : CHART_BORDER_COLORS;
        return palette[index % palette.length];
    }

    function isNumericColumn(key) {
        return Boolean(chartColumnMeta[key]?.numeric);
    }

    function formatChartLabel(value) {
        if (value === null || value === undefined || value === '') {
            return '-';
        }
        if (typeof value === 'number') {
            return value.toString();
        }
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed) && typeof value === 'string') {
            return new Date(parsed).toLocaleString('zh-CN');
        }
        return value.toString();
    }

    function toNumericValue(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : null;
    }

    // 关闭所有模态框
    function closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
    
    // 显示通知
    function showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
            <button class="notification-close">&times;</button>
        `;
        
        // 添加样式
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${getNotificationColor(type)};
            color: white;
            padding: 15px 20px;
            border-radius: 6px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-width: 300px;
            animation: slideInRight 0.3s ease;
        `;
        
        // 添加到页面
        document.body.appendChild(notification);
        
        // 关闭按钮事件
        notification.querySelector('.notification-close').addEventListener('click', function() {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        });
        
        // 自动关闭（信息类通知）
        if (type === 'info' || type === 'success') {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.style.animation = 'slideOutRight 0.3s ease';
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 300);
                }
            }, 3000);
        }
        
        // 添加动画样式
        if (!document.querySelector('#notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                
                @keyframes slideOutRight {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // 获取通知图标
    function getNotificationIcon(type) {
        const icons = {
            'info': 'info-circle',
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'exclamation-triangle'
        };
        return icons[type] || 'info-circle';
    }
    
    // 获取通知颜色
    function getNotificationColor(type) {
        const colors = {
            'info': '#3498db',
            'success': '#27ae60',
            'error': '#e74c3c',
            'warning': '#f39c12'
        };
        return colors[type] || '#3498db';
    }
});
