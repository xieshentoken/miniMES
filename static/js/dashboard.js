document.addEventListener('DOMContentLoaded', function() {
    // 全局变量
    let currentUser = {};
    let dashboardData = {};
    let charts = {};
    let currentTimeRange = '30';
    
    // DOM元素
    const timeRangeSelect = document.getElementById('timeRange');
    const customDateRange = document.getElementById('customDateRange');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const applyDateRangeBtn = document.getElementById('applyDateRange');
    const refreshBtn = document.getElementById('refreshBtn');
    const cpkMetricSelect = document.getElementById('cpkMetric');
    const oeeEquipmentSelect = document.getElementById('oeeEquipment');
    
    // KPI元素
    const totalBatchesEl = document.getElementById('totalBatches');
    const completionRateEl = document.getElementById('completionRate');
    const avgCycleTimeEl = document.getElementById('avgCycleTime');
    const defectRateEl = document.getElementById('defectRate');
    const batchTrendEl = document.getElementById('batchTrend');
    const completionTrendEl = document.getElementById('completionTrend');
    const cycleTrendEl = document.getElementById('cycleTrend');
    const defectTrendEl = document.getElementById('defectTrend');
    
    // 表格元素
    const recentBatchesTable = document.getElementById('recentBatchesTable');
    const qualityMetricsTable = document.getElementById('qualityMetricsTable');
    
    // 模态框元素
    const detailModal = document.getElementById('detailModal');
    
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
        
        // 设置默认日期范围
        setDefaultDateRange();
        
        // 设置事件监听器
        setupEventListeners();
        
        // 加载看板数据
        loadDashboardData();
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
        // 时间范围选择
        timeRangeSelect.addEventListener('change', function() {
            currentTimeRange = this.value;
            
            if (this.value === 'custom') {
                customDateRange.style.display = 'flex';
            } else {
                customDateRange.style.display = 'none';
                loadDashboardData();
            }
        });
        
        // 应用自定义日期范围
        applyDateRangeBtn.addEventListener('click', function() {
            if (!startDateInput.value || !endDateInput.value) {
                showNotification('请选择开始和结束日期', 'error');
                return;
            }
            
            if (new Date(startDateInput.value) > new Date(endDateInput.value)) {
                showNotification('开始日期不能晚于结束日期', 'error');
                return;
            }
            
            loadDashboardData();
        });
        
        // 刷新按钮
        refreshBtn.addEventListener('click', loadDashboardData);
        
        // CPK指标选择
        cpkMetricSelect.addEventListener('change', function() {
            updateCpkChart(this.value);
        });
        
        // OEE设备选择
        oeeEquipmentSelect.addEventListener('change', function() {
            updateOeeChart(this.value);
        });
        
        // 图表类型切换
        document.querySelectorAll('.chart-action-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const chartId = this.dataset.chart;
                const chartType = this.dataset.type;
                
                // 更新按钮状态
                document.querySelectorAll(`[data-chart="${chartId}"]`).forEach(b => {
                    b.classList.remove('active');
                });
                this.classList.add('active');
                
                // 更新图表类型
                updateChartType(chartId, chartType);
            });
        });
        
        // 模态框关闭
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', closeModals);
        });
        
        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
            if (event.target.classList.contains('modal')) {
                closeModals();
            }
        });
    }
    
    // 加载看板数据
    function loadDashboardData() {
        // 显示加载状态
        showLoadingState(true);
        
        // 构建查询参数
        const params = new URLSearchParams();
        
        if (currentTimeRange === 'custom') {
            params.append('start_date', startDateInput.value);
            params.append('end_date', endDateInput.value);
        } else {
            params.append('days', currentTimeRange);
        }
        
        fetch(`/api/dashboard/data?${params.toString()}`)
            .then(response => response.json())
            .then(data => {
                dashboardData = data;
                updateDashboard(data);
                showLoadingState(false);
            })
            .catch(error => {
                console.error('加载看板数据失败:', error);
                showNotification('加载看板数据失败', 'error');
                showLoadingState(false);
            });
    }
    
    // 显示/隐藏加载状态
    function showLoadingState(show) {
        // 这里可以添加加载指示器
        if (show) {
            // 可以添加加载动画
        } else {
            // 移除加载动画
        }
    }
    
    // 更新看板
    function updateDashboard(data) {
        // 更新KPI指标
        updateKpiCards(data);
        
        // 更新图表
        updateCharts(data);
        
        // 更新数据表格
        updateDataTables(data);
    }
    
    // 更新KPI指标卡片
    function updateKpiCards(data) {
        // 总批次数
        totalBatchesEl.textContent = data.total_batches || 0;
        
        // 完成率
        const completionRate = data.total_batches > 0 ? 
            Math.round((data.completed_batches / data.total_batches) * 100) : 0;
        completionRateEl.textContent = `${completionRate}%`;
        
        // 平均周期（简化计算）
        const avgCycleTime = calculateAverageCycleTime(data.recent_batches);
        avgCycleTimeEl.textContent = avgCycleTime.toFixed(1);
        
        // 不良率
        const defectRate = calculateDefectRate(data.quality_rates);
        defectRateEl.textContent = `${defectRate}%`;
        
        // 趋势数据（这里使用模拟数据）
        updateTrendIndicators();
    }
    
    // 计算平均周期时间
    function calculateAverageCycleTime(batches) {
        if (!batches || batches.length === 0) return 0;
        
        let totalDays = 0;
        let count = 0;
        
        batches.forEach(batch => {
            if (batch.end_time) {
                const start = new Date(batch.start_time);
                const end = new Date(batch.end_time);
                const days = (end - start) / (1000 * 60 * 60 * 24); // 转换为天数
                totalDays += days;
                count++;
            }
        });
        
        return count > 0 ? totalDays / count : 0;
    }
    
    // 计算不良率
    function calculateDefectRate(qualityRates) {
        if (!qualityRates || Object.keys(qualityRates).length === 0) return 0;
        
        let totalTests = 0;
        let totalDefects = 0;
        
        Object.values(qualityRates).forEach(rate => {
            totalTests += rate.total || 0;
            totalDefects += (rate.total - rate.passed) || 0;
        });
        
        return totalTests > 0 ? Math.round((totalDefects / totalTests) * 100) : 0;
    }
    
    // 更新趋势指示器（模拟数据）
    function updateTrendIndicators() {
        // 这里应该从API获取真实的趋势数据
        // 现在使用随机数据模拟
        const randomTrend = () => (Math.random() > 0.5 ? 1 : -1) * Math.random() * 10;
        
        updateTrendElement(batchTrendEl, randomTrend());
        updateTrendElement(completionTrendEl, randomTrend());
        updateTrendElement(cycleTrendEl, randomTrend());
        updateTrendElement(defectTrendEl, randomTrend());
    }
    
    // 更新趋势元素
    function updateTrendElement(element, value) {
        const absValue = Math.abs(value).toFixed(1);
        const isPositive = value > 0;
        
        element.textContent = `${isPositive ? '+' : '-'}${absValue}%`;
        element.className = isPositive ? 'trend-up' : 'trend-down';
    }
    
    // 更新图表
    function updateCharts(data) {
        // 生产趋势图表
        updateProductionChart(data);
        
        // 质量合格率图表
        updateQualityChart(data);
        
        // 工艺段分布图表
        updateProcessChart(data);
        
        // 不良品分析图表
        updateDefectChart(data);
        
        // 过程能力指数图表
        updateCpkChart('all');
        
        // 设备效率分析图表
        updateOeeChart('all');
    }
    
    // 更新生产趋势图表
    function updateProductionChart(data) {
        const ctx = document.getElementById('productionChart').getContext('2d');
        
        // 销毁现有图表
        if (charts.production) {
            charts.production.destroy();
        }
        
        // 生成模拟数据（实际应该从API获取）
        const labels = generateDateLabels(7);
        const completedData = labels.map(() => Math.floor(Math.random() * 10) + 5);
        const totalData = labels.map(() => Math.floor(Math.random() * 5) + completedData[0]);
        
        charts.production = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '完成批次数',
                        data: completedData,
                        borderColor: '#27ae60',
                        backgroundColor: 'rgba(39, 174, 96, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: '总批次数',
                        data: totalData,
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        tension: 0.3,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '批次数'
                        }
                    }
                }
            }
        });
    }
    
    // 更新质量合格率图表
    function updateQualityChart(data) {
        const ctx = document.getElementById('qualityChart').getContext('2d');
        
        // 销毁现有图表
        if (charts.quality) {
            charts.quality.destroy();
        }
        
        // 生成模拟数据（实际应该从API获取）
        const labels = generateDateLabels(7);
        const qualityRates = labels.map(() => Math.floor(Math.random() * 20) + 80); // 80-100%
        
        charts.quality = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '合格率',
                        data: qualityRates,
                        borderColor: '#27ae60',
                        backgroundColor: 'rgba(39, 174, 96, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: '目标线 (95%)',
                        data: labels.map(() => 95),
                        borderColor: '#e74c3c',
                        borderDash: [5, 5],
                        backgroundColor: 'transparent',
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                },
                scales: {
                    y: {
                        min: 70,
                        max: 100,
                        title: {
                            display: true,
                            text: '合格率 (%)'
                        }
                    }
                }
            }
        });
    }
    
    // 更新工艺段分布图表
    function updateProcessChart(data) {
        const ctx = document.getElementById('processChart').getContext('2d');
        
        // 销毁现有图表
        if (charts.process) {
            charts.process.destroy();
        }
        
        // 使用实际数据或模拟数据
        const segments = data.segment_counts || {
            '原料准备': 15,
            '混合搅拌': 25,
            '成型': 20,
            '热处理': 15,
            '表面处理': 10,
            '包装': 15
        };
        
        const labels = Object.keys(segments);
        const segmentData = Object.values(segments);
        
        // 生成颜色
        const backgroundColors = [
            '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c',
            '#34495e', '#d35400', '#c0392b', '#16a085', '#27ae60', '#2980b9'
        ];
        
        charts.process = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: segmentData,
                    backgroundColor: backgroundColors.slice(0, labels.length),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                    }
                }
            }
        });
    }
    
    // 更新不良品分析图表
    function updateDefectChart(data) {
        const ctx = document.getElementById('defectChart').getContext('2d');
        
        // 销毁现有图表
        if (charts.defect) {
            charts.defect.destroy();
        }
        
        // 生成模拟数据（实际应该从API获取）
        const defectTypes = ['尺寸不良', '外观缺陷', '性能不达标', '包装问题', '其他'];
        const defectCounts = defectTypes.map(() => Math.floor(Math.random() * 20) + 5);
        
        charts.defect = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: defectTypes,
                datasets: [{
                    label: '不良数量',
                    data: defectCounts,
                    backgroundColor: [
                        '#e74c3c', '#f39c12', '#3498db', '#2ecc71', '#9b59b6'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '不良数量'
                        }
                    }
                }
            }
        });
    }
    
    // 更新过程能力指数图表
    function updateCpkChart(metric) {
        const ctx = document.getElementById('cpkChart').getContext('2d');
        
        // 销毁现有图表
        if (charts.cpk) {
            charts.cpk.destroy();
        }
        
        // 生成模拟数据（实际应该从API获取）
        const metrics = ['尺寸', '重量', '硬度', '颜色', '纯度'];
        const cpkValues = metrics.map(() => (Math.random() * 2).toFixed(2));
        
        // 过滤数据（如果选择了特定指标）
        let displayMetrics = metrics;
        let displayCpkValues = cpkValues;
        
        if (metric !== 'all') {
            const index = metrics.indexOf(metric);
            if (index !== -1) {
                displayMetrics = [metric];
                displayCpkValues = [cpkValues[index]];
            }
        }
        
        // 设置颜色基于CPK值
        const backgroundColors = displayCpkValues.map(value => {
            const num = parseFloat(value);
            if (num >= 1.67) return '#27ae60'; // 优秀
            if (num >= 1.33) return '#3498db'; // 良好
            if (num >= 1.0) return '#f39c12';  // 边际
            return '#e74c3c';                  // 不足
        });
        
        charts.cpk = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: displayMetrics,
                datasets: [{
                    label: 'CPK值',
                    data: displayCpkValues,
                    backgroundColor: backgroundColors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    annotation: {
                        annotations: {
                            line1: {
                                type: 'line',
                                yMin: 1.33,
                                yMax: 1.33,
                                borderColor: '#f39c12',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: '目标: 1.33',
                                    enabled: true,
                                    position: 'end'
                                }
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 2.5,
                        title: {
                            display: true,
                            text: 'CPK值'
                        }
                    }
                }
            }
        });
        
        // 更新指标选择框
        updateCpkMetricSelect(metrics);
    }
    
    // 更新CPK指标选择框
    function updateCpkMetricSelect(metrics) {
        cpkMetricSelect.innerHTML = '<option value="all">全部指标</option>';
        
        metrics.forEach(metric => {
            const option = document.createElement('option');
            option.value = metric;
            option.textContent = metric;
            cpkMetricSelect.appendChild(option);
        });
    }
    
    // 更新设备效率分析图表
    function updateOeeChart(equipment) {
        const ctx = document.getElementById('oeeChart').getContext('2d');
        
        // 销毁现有图表
        if (charts.oee) {
            charts.oee.destroy();
        }
        
        // 生成模拟数据（实际应该从API获取）
        const equipmentList = ['混合机', '成型机', '热处理炉', '包装机', '检测设备'];
        const availability = equipmentList.map(() => Math.random() * 20 + 80); // 80-100%
        const performance = equipmentList.map(() => Math.random() * 20 + 75);  // 75-95%
        const quality = equipmentList.map(() => Math.random() * 15 + 85);     // 85-100%
        const oee = equipmentList.map((_, i) => 
            (availability[i] * performance[i] * quality[i] / 10000).toFixed(1)
        );
        
        // 过滤数据（如果选择了特定设备）
        let displayEquipment = equipmentList;
        let displayOee = oee;
        
        if (equipment !== 'all') {
            const index = equipmentList.indexOf(equipment);
            if (index !== -1) {
                displayEquipment = [equipment];
                displayOee = [oee[index]];
            }
        }
        
        charts.oee = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: displayEquipment,
                datasets: [
                    {
                        label: '可用率',
                        data: availability,
                        backgroundColor: 'rgba(52, 152, 219, 0.7)',
                        borderWidth: 0
                    },
                    {
                        label: '性能率',
                        data: performance,
                        backgroundColor: 'rgba(46, 204, 113, 0.7)',
                        borderWidth: 0
                    },
                    {
                        label: '合格率',
                        data: quality,
                        backgroundColor: 'rgba(155, 89, 182, 0.7)',
                        borderWidth: 0
                    },
                    {
                        label: 'OEE',
                        data: oee,
                        backgroundColor: 'rgba(231, 76, 60, 0.7)',
                        borderWidth: 0,
                        type: 'line',
                        fill: false,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                },
                scales: {
                    y: {
                        min: 0,
                        max: 100,
                        title: {
                            display: true,
                            text: '百分比 (%)'
                        }
                    }
                }
            }
        });
        
        // 更新设备选择框
        updateOeeEquipmentSelect(equipmentList);
    }
    
    // 更新OEE设备选择框
    function updateOeeEquipmentSelect(equipmentList) {
        oeeEquipmentSelect.innerHTML = '<option value="all">全部设备</option>';
        
        equipmentList.forEach(equipment => {
            const option = document.createElement('option');
            option.value = equipment;
            option.textContent = equipment;
            oeeEquipmentSelect.appendChild(option);
        });
    }
    
    // 更新图表类型
    function updateChartType(chartId, chartType) {
        // 这里可以根据需要重新创建图表
        // 现在只是简单示例
        console.log(`切换图表 ${chartId} 到类型 ${chartType}`);
    }
    
    // 更新数据表格
    function updateDataTables(data) {
        updateRecentBatchesTable(data.recent_batches || []);
        updateQualityMetricsTable(data.quality_rates || {});
    }
    
    // 更新最近生产批次表格
    function updateRecentBatchesTable(batches) {
        const tbody = recentBatchesTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        if (batches.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="8" style="text-align: center; color: #7f8c8d;">暂无数据</td>`;
            tbody.appendChild(row);
            return;
        }
        
        batches.forEach(batch => {
            const row = document.createElement('tr');
            
            // 计算周期（天）
            const startDate = new Date(batch.start_time);
            const endDate = batch.end_time ? new Date(batch.end_time) : new Date();
            const cycleDays = ((endDate - startDate) / (1000 * 60 * 60 * 24)).toFixed(1);
            
            // 状态标签
            const statusClass = `status-${getStatusClass(batch.status)}`;
            
            row.innerHTML = `
                <td>${batch.batch_number}</td>
                <td>${batch.product_name}</td>
                <td>${batch.process_segment}</td>
                <td><span class="status-badge ${statusClass}">${batch.status}</span></td>
                <td>${formatDate(batch.start_time)}</td>
                <td>${batch.end_time ? formatDate(batch.end_time) : '-'}</td>
                <td>${cycleDays}</td>
                <td><span class="result-badge result-${batch.quality_result || 'pending'}">${batch.quality_result || '待检'}</span></td>
            `;
            
            tbody.appendChild(row);
        });
    }
    
    // 更新质量指标表格
    function updateQualityMetricsTable(qualityRates) {
        const tbody = qualityMetricsTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        if (Object.keys(qualityRates).length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="7" style="text-align: center; color: #7f8c8d;">暂无数据</td>`;
            tbody.appendChild(row);
            return;
        }
        
        Object.entries(qualityRates).forEach(([item, data]) => {
            const row = document.createElement('tr');
            
            // 计算合格率
            const passRate = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
            
            // 计算CPK（模拟）
            const cpk = (Math.random() * 2).toFixed(2);
            const cpkClass = getCpkClass(cpk);
            
            // 计算标准差（模拟）
            const stdDev = (Math.random() * 0.5).toFixed(3);
            
            // 趋势（模拟）
            const trend = Math.random() > 0.5 ? 'up' : 'down';
            const trendValue = (Math.random() * 5).toFixed(1);
            
            row.innerHTML = `
                <td>${item}</td>
                <td>${data.total}</td>
                <td>${data.passed}</td>
                <td>${passRate}%</td>
                <td><span class="cpk-badge ${cpkClass}">${cpk}</span></td>
                <td>${stdDev}</td>
                <td><span class="trend-indicator ${trend}"><i class="fas fa-arrow-${trend}"></i>${trendValue}%</span></td>
            `;
            
            tbody.appendChild(row);
        });
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
    
    // 获取CPK类名
    function getCpkClass(cpkValue) {
        const value = parseFloat(cpkValue);
        if (value >= 1.67) return 'cpk-excellent';
        if (value >= 1.33) return 'cpk-good';
        if (value >= 1.0) return 'cpk-marginal';
        return 'cpk-poor';
    }
    
    // 格式化日期
    function formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN');
    }
    
    // 生成日期标签
    function generateDateLabels(count) {
        const labels = [];
        const today = new Date();
        
        for (let i = count - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('zh-CN', {month: 'short', day: 'numeric'}));
        }
        
        return labels;
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
