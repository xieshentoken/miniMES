document.addEventListener('DOMContentLoaded', () => {
    const state = {
        batches: [],
        processSegments: [],
        currentUser: {},
        activeBatchId: null,
        permissions: {
            createBatch: false,
            gotoRecord: false,
            editShortcut: false,
            deleteBatch: false
        }
    };

    const elements = {
        sidebarToggle: document.getElementById('sidebarToggle'),
        batchGrid: document.getElementById('batchGrid'),
        searchInput: document.getElementById('searchInput'),
        statusFilter: document.getElementById('statusFilter'),
        segmentFilter: document.getElementById('segmentFilter'),
        refreshBtn: document.getElementById('refreshBtn'),
        createBatchBtn: document.getElementById('createBatchBtn'),
        emptyCreateBtn: document.getElementById('emptyCreateBtn'),
        createBatchModal: document.getElementById('createBatchModal'),
        batchDetailModal: document.getElementById('batchDetailModal'),
        createBatchForm: document.getElementById('createBatchForm'),
        processSegmentSelect: document.getElementById('processSegment'),
        pipelineProgressValue: document.getElementById('pipelineProgressValue'),
        pipelineProgressFill: document.getElementById('pipelineProgressFill'),
        emptyState: document.getElementById('emptyState'),
        stats: {
            totalBatches: document.getElementById('totalBatches'),
            activeBatches: document.getElementById('activeBatches'),
            completedBatches: document.getElementById('completedBatches')
        }
    };

    const {
        sidebarToggle,
        batchGrid,
        searchInput,
        statusFilter,
        segmentFilter,
        refreshBtn,
        createBatchBtn,
        emptyCreateBtn,
        createBatchModal,
        batchDetailModal,
        createBatchForm,
        processSegmentSelect,
        pipelineProgressValue,
        pipelineProgressFill,
        emptyState,
        stats: { totalBatches, activeBatches, completedBatches }
    } = elements;

    const completedStatus = document.body.dataset.completedStatus || '已完成';
    const detailSegmentSelector = document.getElementById('detailSegmentSelector');
    const detailSegmentSelect = document.getElementById('detailSegmentSelect');
    const detailState = {
        batch: null,
        segments: [],
        segmentsById: new Map(),
        activeSegmentId: null,
        summary: null,
        activeTab: 'overview'
    };

    const roleDisplayMap = {
        admin: '管理员',
        read: '只读用户',
        write: '只写用户',
        write_material: '物料/设备录入',
        write_quality: '品质录入'
    };
    const displayToRoleMap = Object.fromEntries(
        Object.entries(roleDisplayMap).map(([key, value]) => [value, key])
    );

    const safeLower = value => String(value || '').toLowerCase();

    const normalizeRole = role => displayToRoleMap[role] || role;

    const defaultPermissions = {
        createBatch: false,
        gotoRecord: false,
        editShortcut: false,
        deleteBatch: false,
        viewQuality: true
    };

    const ROLE_CAPABILITIES = {
        admin: {
            createBatch: true,
            gotoRecord: true,
            editShortcut: true,
            deleteBatch: true,
            viewQuality: true
        },
        write: {
            createBatch: true,
            gotoRecord: true,
            editShortcut: true,
            deleteBatch: false,
            viewQuality: true
        },
        write_material: {
            createBatch: true,
            gotoRecord: true,
            editShortcut: true,
            deleteBatch: false,
            viewQuality: false
        },
        write_quality: {
            createBatch: false,
            gotoRecord: true,
            editShortcut: true,
            deleteBatch: false,
            viewQuality: true
        },
        read: {
            createBatch: false,
            gotoRecord: false,
            editShortcut: false,
            deleteBatch: false,
            viewQuality: true
        }
    };

    const resolvePermissions = role => ({
        ...defaultPermissions,
        ...(ROLE_CAPABILITIES[role] || {})
    });

    const debounce = (fn, delay = 200) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    };

    const toggleModal = (modal, visible) => {
        if (!modal) return;
        modal.style.display = visible ? 'flex' : 'none';
    };

    const fetchJSON = async (url, options = {}) => {
        const response = await fetch(url, options);
        const isJSON = response.headers.get('content-type')?.includes('application/json');
        let payload = null;

        if (isJSON) {
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error('响应解析失败');
            }
        }

        if (!response.ok) {
            const message = payload?.error || payload?.message || `请求失败(${response.status})`;
            const err = new Error(message);
            err.status = response.status;
            throw err;
        }

        return payload;
    };

    const findBatchById = batchId => state.batches.find(batch => batch.id === batchId);

    // 初始化应用
    initApp();
    
    // 初始化应用
    function initApp() {
        const bodyDataset = document.body.dataset || {};
        const headerUsernameEl = document.getElementById('headerUsername');
        const sidebarUsernameEl = document.getElementById('sidebarUsername');
        const sidebarUserRoleEl = document.getElementById('sidebarUserRole');

        state.currentUser = {
            username: bodyDataset.username || headerUsernameEl?.textContent || '未登录',
            role: normalizeRole(bodyDataset.role || sidebarUserRoleEl?.textContent || '')
        };

        if (sidebarUsernameEl) {
            sidebarUsernameEl.textContent = state.currentUser.username || '未登录';
        }
        if (sidebarUserRoleEl) {
            sidebarUserRoleEl.textContent = getRoleDisplayName(state.currentUser.role);
        }
        if (headerUsernameEl) {
            headerUsernameEl.textContent = state.currentUser.username || '用户';
        }

        state.permissions = resolvePermissions(state.currentUser.role);

        if (createBatchBtn) {
            createBatchBtn.style.display = state.permissions.createBatch ? 'inline-flex' : 'none';
        }
        if (emptyCreateBtn) {
            emptyCreateBtn.style.display = state.permissions.createBatch ? 'inline-flex' : 'none';
        }

        const adminMenu = document.getElementById('adminMenu');
        const isAdmin = state.currentUser.role === 'admin';
        if (adminMenu) {
            adminMenu.style.display = isAdmin ? 'block' : 'none';
        }

        const qualityTabButton = document.querySelector('.tab-button[data-tab="quality"]');
        const qualityTabPane = document.getElementById('qualityTab');
        if (qualityTabButton) {
            qualityTabButton.style.display = state.permissions.viewQuality ? 'inline-flex' : 'none';
        }
        if (qualityTabPane) {
            qualityTabPane.style.display = state.permissions.viewQuality ? '' : 'none';
        }
        if (!state.permissions.viewQuality && detailState.activeTab === 'quality') {
            detailState.activeTab = 'overview';
        }

        loadProcessSegments();
        loadBatches();
        setupEventListeners();
    }
    
    // 获取角色显示名称
    function getRoleDisplayName(role) {
        return roleDisplayMap[role] || role;
    }
    
    // 设置事件监听器
    function setupEventListeners() {
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', toggleSidebar);
        }

        if (searchInput) {
            searchInput.addEventListener('input', debounce(filterBatches, 200));
        }
        if (statusFilter) {
            statusFilter.addEventListener('change', filterBatches);
        }
        if (segmentFilter) {
            segmentFilter.addEventListener('change', filterBatches);
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadBatches);
        }

        [createBatchBtn, emptyCreateBtn].forEach(button => {
            if (button) {
                button.addEventListener('click', showCreateBatchModal);
            }
        });

        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', closeModals);
        });

        window.addEventListener('click', event => {
            if (event.target.classList?.contains('modal')) {
                closeModals();
            }
        });

        if (createBatchForm) {
            createBatchForm.addEventListener('submit', handleCreateBatch);
        }

        if (batchGrid) {
            batchGrid.addEventListener('click', handleBatchGridClick);
        }

        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                switchTab(button.dataset.tab);
            });
        });

        if (detailSegmentSelect) {
            detailSegmentSelect.addEventListener('change', () => {
                setActiveDetailSegment(detailSegmentSelect.value);
            });
        }
    }
    
    // 切换侧边栏
    function toggleSidebar() {
        document.querySelector('.sidebar').classList.toggle('collapsed');
    }
    
    // 加载工艺段
    async function loadProcessSegments() {
        try {
            const segments = await fetchJSON('/api/process_segments');
            state.processSegments = Array.isArray(segments) ? segments : [];

            if (segmentFilter) {
                segmentFilter.innerHTML = '<option value="all">所有工艺段</option>';
                const fragment = document.createDocumentFragment();
                state.processSegments.forEach(segment => {
                    const option = document.createElement('option');
                    option.value = segment.segment_name;
                    option.textContent = segment.segment_name;
                    fragment.appendChild(option);
                });
                segmentFilter.appendChild(fragment);
            }

            if (processSegmentSelect) {
                processSegmentSelect.innerHTML = '<option value="">请选择工艺段</option>';
                const fragment = document.createDocumentFragment();
                state.processSegments.forEach(segment => {
                    const option = document.createElement('option');
                    option.value = segment.segment_name;
                    option.textContent = segment.segment_name;
                    fragment.appendChild(option);
                });
                processSegmentSelect.appendChild(fragment);
            }
        } catch (error) {
            console.error('加载工艺段失败:', error);
            showNotification(`加载工艺段失败：${error.message}`, 'error');
        }
    }
    
    // 加载批号数据
    async function loadBatches() {
        if (!batchGrid) {
            return;
        }

        batchGrid.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>加载中...</p>
            </div>
        `;

        try {
            const data = await fetchJSON('/api/batches');
            state.batches = Array.isArray(data) ? data : [];
            renderBatches(state.batches);
            updateStats(state.batches);
        } catch (error) {
            console.error('加载批号数据失败:', error);
            showNotification(`加载批号数据失败：${error.message}`, 'error');
            renderBatchLoadError(error.message);
        }
    }

    function renderBatchLoadError(message = '无法加载批号数据，请稍后重试') {
        if (!batchGrid) {
            return;
        }

        batchGrid.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'empty-state';
        container.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            <h3>加载失败</h3>
            <p>${message}</p>
        `;

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-primary';
        retryBtn.innerHTML = '<i class="fas fa-redo"></i> 重新加载';
        retryBtn.addEventListener('click', loadBatches);

        container.appendChild(retryBtn);
        batchGrid.appendChild(container);

        if (emptyState) {
            emptyState.style.display = 'none';
        }
    }
    
    // 渲染批号卡片
    function renderBatches(batchesToRender) {
        if (!batchGrid) {
            return;
        }

        if (batchesToRender.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
            }
            batchGrid.style.display = 'none';
            batchGrid.innerHTML = '';
            return;
        }
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        batchGrid.style.display = 'grid';
        batchGrid.innerHTML = '';

        const fragment = document.createDocumentFragment();
        batchesToRender.forEach(batch => {
            fragment.appendChild(createBatchCard(batch));
        });
        batchGrid.appendChild(fragment);
    }

    function calcBatchProgress(batch) {
        if (typeof batch.stage_progress === 'number') {
            return Math.max(0, Math.min(100, batch.stage_progress));
        }
        const materialCount = Number(batch.material_count || 0);
        const equipmentCount = Number(batch.equipment_count || 0);
        const qualityCount = Number(batch.quality_count || 0);
        const totalRecords = materialCount + equipmentCount + qualityCount;
        return Math.min(totalRecords * 10, 100);
    }

    // 创建批号卡片
    function createBatchCard(batch) {
        const card = document.createElement('div');
        card.className = 'batch-card';

        const progress = Math.round(calcBatchProgress(batch));
        const statusClass = `status-${getStatusClass(batch.status)}`;
        const compositeKey = `${batch.batch_number}-${batch.process_segment}`;
        const isActive = batch.status === '进行中';

        card.innerHTML = `
            <div class="batch-header">
                <div class="batch-number">${batch.batch_number}</div>
                <div class="batch-status ${statusClass}">${batch.status}</div>
            </div>
            <div class="batch-body">
                <div class="batch-info">
                    <div class="batch-info-item">
                        <span class="batch-info-label">产品名称</span>
                        <span class="batch-info-value">${batch.product_name}</span>
                    </div>
                    <div class="batch-info-item">
                        <span class="batch-info-label">工艺段</span>
                        <span class="batch-info-value">${batch.process_segment}</span>
                    </div>
                    <div class="batch-info-item">
                        <span class="batch-info-label">创建人</span>
                        <span class="batch-info-value">${batch.created_by_name}</span>
                    </div>
                    <div class="batch-info-item">
                        <span class="batch-info-label">关键字</span>
                        <span class="batch-info-value">${compositeKey}</span>
                    </div>
                    <div class="batch-info-item">
                        <span class="batch-info-label">开始时间</span>
                        <span class="batch-info-value">${formatDate(batch.start_time)}</span>
                    </div>
                    ${batch.end_time ? `
                    <div class="batch-info-item">
                        <span class="batch-info-label">结束时间</span>
                        <span class="batch-info-value">${formatDate(batch.end_time)}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div class="batch-progress">
                    <div class="progress-label">
                        <span>完成进度</span>
                        <span>${progress}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
                
                <div class="batch-actions">
                    <button class="btn btn-primary" data-action="view" data-batch-id="${batch.id}">
                        <i class="fas fa-eye"></i>
                        查看详情
                    </button>
                    ${state.permissions.gotoRecord ? `
                    <button class="btn ${isActive ? 'btn-success' : 'btn-secondary'}" data-action="goto" data-batch-id="${batch.id}" data-enabled="${isActive}" ${isActive ? '' : 'disabled'}>
                        <i class="fas ${isActive ? 'fa-location-arrow' : 'fa-check'}"></i>
                        ${isActive ? '去记录' : completedStatus}
                    </button>` : ''}
                    ${state.permissions.editShortcut ? `
                    <button class="btn btn-secondary" data-action="edit" data-batch-id="${batch.id}">
                        <i class="fas fa-edit"></i>
                        编辑
                    </button>
                    ` : ''}
                    ${state.permissions.deleteBatch ? `
                    <button class="btn btn-danger" data-action="delete" data-batch-id="${batch.id}">
                        <i class="fas fa-trash"></i>
                        删除
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        return card;
    }

    function handleBatchGridClick(event) {
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) {
            return;
        }

        const batchId = Number(actionButton.dataset.batchId);
        if (!batchId) {
            return;
        }

        const batch = findBatchById(batchId);
        if (!batch) {
            showNotification('未找到批号数据，请刷新后重试', 'error');
            return;
        }

        const action = actionButton.dataset.action;
        if (action === 'view') {
            showBatchDetail(batchId);
        } else if (action === 'goto') {
            if (!state.permissions.gotoRecord) {
                showNotification('当前账号无权限访问生产记录页面', 'error');
                return;
            }
            if (actionButton.dataset.enabled === 'true') {
                redirectToRecord(batch);
            }
        } else if (action === 'edit') {
            if (!state.permissions.editShortcut) {
                showNotification('当前账号无权限编辑批号', 'error');
                return;
            }
            editBatch(batch);
        } else if (action === 'delete') {
            deleteBatch(batch);
        }
    }

    function deleteBatch(batch) {
        if (!state.permissions.deleteBatch) {
            showNotification('当前账号无权限删除批号', 'error');
            return;
        }

        if (!confirm(`删除批号 ${batch.batch_number} 将同时移除其所有记录，确认继续？`)) {
            return;
        }

        fetchJSON(`/api/batches/${batch.id}`, { method: 'DELETE' })
            .then(() => {
                showNotification('批号删除成功', 'success');
                loadBatches();
            })
            .catch(error => {
                console.error('删除批号失败:', error);
                showNotification(error.message || '删除批号失败，请重试', 'error');
            });
    }
    
    // 获取状态类名
    function getStatusClass(status) {
        const statusMap = {
            '进行中': 'active',
            [completedStatus]: 'completed',
            '暂停': 'paused',
            '异常': 'error'
        };
        return statusMap[status] || 'active';
    }
    
    // 格式化日期
    function formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }
        return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    }
    
    // 更新统计信息
    function updateStats(batches) {
        const total = batches.length;
        const active = batches.filter(b => b.status === '进行中').length;
        const completedCount = batches.filter(b => b.status === completedStatus).length;
        const completionRate = total ? Math.round((completedCount / total) * 100) : 0;
        const progressAverage = total ? Math.round(batches.reduce((sum, b) => sum + calcBatchProgress(b), 0) / total) : 0;

        if (totalBatches) {
            totalBatches.textContent = total;
        }
        if (activeBatches) {
            activeBatches.textContent = active;
        }
        if (completedBatches) {
            completedBatches.textContent = completedCount;
        }

        if (pipelineProgressValue && pipelineProgressFill) {
            pipelineProgressValue.textContent = `${completionRate}%`;
            pipelineProgressFill.style.width = `${completionRate}%`;
            pipelineProgressValue.title = `平均记录完成度约 ${progressAverage}%`;
        }
    }
    
    // 筛选批号
    function filterBatches() {
        const searchTerm = safeLower(searchInput ? searchInput.value : '');
        const statusValue = statusFilter ? statusFilter.value : 'all';
        const segmentValue = segmentFilter ? segmentFilter.value : 'all';
        
        const filtered = state.batches.filter(batch => {
            const batchNumber = safeLower(batch.batch_number);
            const productName = safeLower(batch.product_name);
            const compositeKey = safeLower(`${batch.batch_number}-${batch.process_segment}`);
            const matchesSearch = 
                batchNumber.includes(searchTerm) ||
                productName.includes(searchTerm) ||
                compositeKey.includes(searchTerm);
            
            // 状态条件
            const matchesStatus = statusValue === 'all' || batch.status === statusValue;
            
            // 工艺段条件
            const matchesSegment = segmentValue === 'all' || batch.process_segment === segmentValue;
            
            return matchesSearch && matchesStatus && matchesSegment;
        });
        
        renderBatches(filtered);
    }
    
    // 显示新建批号模态框
    function showCreateBatchModal() {
        if (!state.permissions.createBatch) {
            showNotification('当前账号无权限创建批号', 'error');
            return;
        }
        if (createBatchForm) {
            createBatchForm.reset();
        }
        toggleModal(createBatchModal, true);
    }
    
    // 关闭所有模态框
    function closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        state.activeBatchId = null;
    }
    
    // 处理新建批号
    async function handleCreateBatch(e) {
        e.preventDefault();

        if (!state.permissions.createBatch) {
            showNotification('当前账号无权限创建批号', 'error');
            return;
        }

        const formData = new FormData(createBatchForm);
        const batchData = {
            batch_number: formData.get('batchNumber'),
            product_name: formData.get('productName'),
            process_segment: formData.get('processSegment')
        };
        
        // 简单验证
        if (!batchData.batch_number || !batchData.product_name || !batchData.process_segment) {
            showNotification('请填写所有必填字段', 'error');
            return;
        }
        
        // 检查重复批号
        const existingSameNumber = state.batches.filter(b => b.batch_number === batchData.batch_number);
        if (existingSameNumber.length > 0) {
            const proceed = confirm('提示：系统中已存在相同批号，继续创建将以工段区分。是否继续？');
            if (!proceed) {
                return;
            }
            showNotification('已确认使用相同批号，将以工段区分记录。', 'warning');
        }

        // 显示加载状态
        const submitBtn = createBatchForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 创建中...';
        submitBtn.disabled = true;

        try {
            await fetchJSON('/api/batches', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(batchData)
            });

            showNotification('批号创建成功', 'success');
            closeModals();
            await loadBatches();
        } catch (error) {
            console.error('创建批号失败:', error);
            showNotification(error.message || '创建批号失败，请重试', 'error');
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    }

    function redirectToRecord(batch) {
        if (!state.permissions.gotoRecord) {
            showNotification('当前账号无权限访问生产记录页面', 'error');
            return;
        }
        const url = `/record?batchId=${batch.id}&segment=${encodeURIComponent(batch.process_segment)}`;
        window.location.href = url;
    }
    
    // 显示批号详情
    async function showBatchDetail(batchId) {
        try {
            const payload = await fetchJSON(`/api/batches/${batchId}`);
            if (!payload) {
                throw new Error('未找到批号详情');
            }

            const batch = payload.batch || payload;
            const segments = Array.isArray(payload.segments) ? payload.segments : [];
            detailState.batch = batch;
            detailState.summary = payload.summary || null;
            detailState.segments = segments;
            detailState.segmentsById = new Map();

            segments.forEach(segment => {
                const segBatch = segment.batch || {};
                if (segBatch.id !== undefined && segBatch.id !== null) {
                    detailState.segmentsById.set(String(segBatch.id), segment);
                }
            });

            const preferredSegmentId = detailState.segmentsById.has(String(batchId))
                ? String(batchId)
                : (segments.length ? String(segments[0].batch?.id ?? segments[0].batch_id) : null);

            detailState.activeSegmentId = preferredSegmentId;
            detailState.activeTab = 'overview';
            state.activeBatchId = batchId;

            updateDetailHeader();
            populateDetailSegmentSelector();
            toggleModal(batchDetailModal, true);
            switchTab(detailState.activeTab);
        } catch (error) {
            console.error('获取批号详情失败:', error);
            showNotification(error.message || '加载详情失败', 'error');
        }
    }

    function updateDetailHeader() {
        const detailTitle = document.getElementById('detailBatchNumber');
        if (!detailTitle || !detailState.batch) {
            return;
        }
        const { batch_number, product_name } = detailState.batch;
        detailTitle.textContent = product_name ? `${batch_number} / ${product_name}` : batch_number;
    }

    function populateDetailSegmentSelector() {
        if (!detailSegmentSelect) {
            return;
        }

        detailSegmentSelect.innerHTML = '';

        if (!detailState.segments.length) {
            if (detailSegmentSelector) {
                detailSegmentSelector.style.display = 'none';
            }
            return;
        }

        detailState.segments.forEach(segment => {
            const segBatch = segment.batch || {};
            const option = document.createElement('option');
            option.value = String(segBatch.id);
            const statusLabel = segBatch.status || '-';
            option.textContent = `${segBatch.process_segment || '未指定工段'} (${statusLabel})`;
            detailSegmentSelect.appendChild(option);
        });

        if (detailSegmentSelector) {
            detailSegmentSelector.style.display = detailState.segments.length > 1 ? 'flex' : 'none';
        }

        if (detailState.activeSegmentId) {
            detailSegmentSelect.value = detailState.activeSegmentId;
        } else {
            detailSegmentSelect.value = detailSegmentSelect.options[0]?.value || '';
            detailState.activeSegmentId = detailSegmentSelect.value;
        }
    }

    function setActiveDetailSegment(segmentId) {
        if (!segmentId && detailState.segments.length) {
            segmentId = String(detailState.segments[0].batch?.id ?? '');
        }
        detailState.activeSegmentId = segmentId;
        if (detailSegmentSelect && detailSegmentSelect.value !== segmentId) {
            detailSegmentSelect.value = segmentId;
        }
        renderCurrentDetailTab();
    }

    function getActiveSegmentEntry() {
        if (!detailState.segments.length) {
            return null;
        }
        if (detailState.activeSegmentId && detailState.segmentsById.has(detailState.activeSegmentId)) {
            return detailState.segmentsById.get(detailState.activeSegmentId);
        }
        return detailState.segments[0];
    }

    // 切换标签页
    function switchTab(tabName) {
        if (tabName === 'quality' && !state.permissions.viewQuality) {
            showNotification('当前账号无权限查看品质记录', 'warning');
            return;
        }

        const targetButton = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
        const targetPane = document.getElementById(`${tabName}Tab`);

        if (!targetButton || !targetPane) {
            return;
        }

        detailState.activeTab = tabName;

        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.toggle('active', button === targetButton);
        });

        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane === targetPane);
        });

        renderCurrentDetailTab();
    }

    function renderCurrentDetailTab() {
        const activeSegment = getActiveSegmentEntry();
        if (!activeSegment) {
            renderEmptyDetailTabs();
            return;
        }

        switch (detailState.activeTab) {
            case 'materials':
                renderMaterialsTab(activeSegment);
                break;
            case 'equipment':
                renderEquipmentTab(activeSegment);
                break;
            case 'quality':
                if (state.permissions.viewQuality) {
                    renderQualityTab(activeSegment);
                } else {
                    renderOverviewTab(activeSegment);
                }
                break;
            default:
                renderOverviewTab(activeSegment);
        }
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatAttributeList(attributes) {
        if (!attributes || !Object.keys(attributes).length) {
            return '-';
        }
        return Object.entries(attributes)
            .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`)
            .join('<br>');
    }

    function renderEmptyDetailTabs() {
        const overviewTab = document.getElementById('overviewTab');
        const materialsTab = document.getElementById('materialsTab');
        const equipmentTab = document.getElementById('equipmentTab');
        const qualityTab = document.getElementById('qualityTab');

        if (overviewTab) {
            overviewTab.innerHTML = '<div class="detail-section"><p>暂无批号数据</p></div>';
        }
        if (materialsTab) {
            materialsTab.innerHTML = '<div class="detail-section"><p>暂无物料记录</p></div>';
        }
        if (equipmentTab) {
            equipmentTab.innerHTML = '<div class="detail-section"><p>暂无设备记录</p></div>';
        }
        if (qualityTab) {
            if (state.permissions.viewQuality) {
                qualityTab.innerHTML = '<div class="detail-section"><p>暂无品质记录</p></div>';
            } else {
                qualityTab.innerHTML = '<div class="detail-section"><p>当前账号无权限查看品质记录</p></div>';
            }
        }
    }

    function renderOverviewTab(segmentEntry) {
        const overviewTab = document.getElementById('overviewTab');
        if (!overviewTab) {
            return;
        }

        const segBatch = segmentEntry.batch || {};
        const batch = detailState.batch || segBatch;
        const summary = detailState.summary || {};

        const showQuality = state.permissions.viewQuality !== false;
        const segmentsMarkup = detailState.segments.map(segment => {
            const info = segment.batch || {};
            const counts = segment.counts || {};
            const parts = [
                `<span class="segment-count">物料 ${counts.materials || 0}</span>`,
                `<span class="segment-count">设备 ${counts.equipment || 0}</span>`
            ];
            if (showQuality) {
                parts.push(`<span class="segment-count">品质 ${counts.quality || 0}</span>`);
            }
            return `
                <li>
                    <span class=\"segment-name\">${escapeHtml(info.process_segment || '未指定工段')}</span>
                    <span class=\"segment-status badge status-${getStatusClass(info.status)}\">${escapeHtml(info.status || '-')}</span>
                    ${parts.join('')}
                </li>
            `;
        }).join('');
        const segmentsList = segmentsMarkup || '<li>暂无其它工段数据</li>';
        const summaryItems = [
            `<span>工段数量：${summary.segment_count ?? detailState.segments.length}</span>`,
            `<span>物料记录：${summary.material_total ?? 0}</span>`,
            `<span>设备记录：${summary.equipment_total ?? 0}</span>`
        ];
        if (showQuality) {
            summaryItems.push(`<span>质量记录：${summary.quality_total ?? 0}</span>`);
        }

        overviewTab.innerHTML = `
            <div class="detail-section">
                <h3>当前工段：${escapeHtml(segBatch.process_segment || '未指定')}</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <label>批号:</label>
                        <span>${escapeHtml(batch.batch_number || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>产品名称:</label>
                        <span>${escapeHtml(batch.product_name || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>状态:</label>
                        <span class="batch-status status-${getStatusClass(segBatch.status)}">${escapeHtml(segBatch.status || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>创建人:</label>
                        <span>${escapeHtml(segBatch.created_by_name || batch.created_by_name || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>开始时间:</label>
                        <span>${escapeHtml(formatDate(segBatch.start_time || batch.start_time))}</span>
                    </div>
                    <div class="detail-item">
                        <label>结束时间:</label>
                        <span>${escapeHtml(formatDate(segBatch.end_time || batch.end_time))}</span>
                    </div>
                </div>
            </div>
            <div class="detail-section">
                <h3>工段汇总</h3>
                <div class="segment-summary">
                    ${summaryItems.join('')}
                </div>
                <ul class="segment-list">
                    ${segmentsList}
                </ul>
            </div>
        `;
    }

    function renderMaterialsTab(segmentEntry) {
        const materialsTab = document.getElementById('materialsTab');
        if (!materialsTab) {
            return;
        }

        const records = segmentEntry.materials || [];
        if (!records.length) {
            materialsTab.innerHTML = '<div class="detail-section"><p>该工段暂无物料记录</p></div>';
            return;
        }

        const rows = records.map(record => {
            const attributes = formatAttributeList(record.attributes);
            return `
                <tr>
                    <td>${escapeHtml(record.material_code || '-')}</td>
                    <td>${escapeHtml(record.material_name || '-')}</td>
                    <td>${record.weight ?? '-'}</td>
                    <td>${escapeHtml(record.unit || '-')}</td>
                    <td>${escapeHtml(record.supplier || '-')}</td>
                    <td>${escapeHtml(record.lot_number || '-')}</td>
                    <td>${escapeHtml(record.recorded_by_name || '-')}</td>
                    <td>${escapeHtml(formatDate(record.record_time))}</td>
                    <td>${attributes}</td>
                </tr>
            `;
        }).join('');

        materialsTab.innerHTML = `
            <div class="detail-section">
                <h3>${segmentEntry.batch?.process_segment || '工段'}物料记录</h3>
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>物料编码</th>
                            <th>物料名称</th>
                            <th>重量</th>
                            <th>单位</th>
                            <th>供应商</th>
                            <th>批号</th>
                            <th>记录人</th>
                            <th>记录时间</th>
                            <th>附加信息</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderEquipmentTab(segmentEntry) {
        const equipmentTab = document.getElementById('equipmentTab');
        if (!equipmentTab) {
            return;
        }

        const records = segmentEntry.equipment || [];
        if (!records.length) {
            equipmentTab.innerHTML = '<div class="detail-section"><p>该工段暂无设备记录</p></div>';
            return;
        }

        const rows = records.map(record => {
            const parameters = record.parameters && Object.keys(record.parameters).length
                ? Object.entries(record.parameters).map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`).join('<br>')
                : '-';
            return `
                <tr>
                    <td>${escapeHtml(record.equipment_code || '-')}</td>
                    <td>${escapeHtml(record.equipment_name || '-')}</td>
                    <td>${escapeHtml(record.status || '-')}</td>
                    <td>${escapeHtml(formatDate(record.start_time))}</td>
                    <td>${escapeHtml(formatDate(record.end_time))}</td>
                    <td>${escapeHtml(record.recorded_by_name || '-')}</td>
                    <td>${parameters}</td>
                </tr>
            `;
        }).join('');

        equipmentTab.innerHTML = `
            <div class="detail-section">
                <h3>${segmentEntry.batch?.process_segment || '工段'}设备记录</h3>
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>设备编码</th>
                            <th>设备名称</th>
                            <th>状态</th>
                            <th>开始时间</th>
                            <th>结束时间</th>
                            <th>记录人</th>
                            <th>运行参数</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderQualityTab(segmentEntry) {
        const qualityTab = document.getElementById('qualityTab');
        if (!qualityTab) {
            return;
        }

        if (!state.permissions.viewQuality) {
            qualityTab.innerHTML = '<div class="detail-section"><p>当前账号无权限查看品质记录</p></div>';
            return;
        }

        const records = segmentEntry.quality || [];
        if (!records.length) {
            qualityTab.innerHTML = '<div class="detail-section"><p>该工段暂无品质记录</p></div>';
            return;
        }

        const rows = records.map(record => {
            const range = (record.standard_min !== undefined || record.standard_max !== undefined)
                ? `${record.standard_min ?? '-'} ~ ${record.standard_max ?? '-'}`
                : '-';
            const attributes = formatAttributeList(record.attributes);
            return `
                <tr>
                    <td>${escapeHtml(record.test_item || '-')}</td>
                    <td>${record.test_value ?? '-'}</td>
                    <td>${escapeHtml(record.unit || '-')}</td>
                    <td>${escapeHtml(range)}</td>
                    <td>${escapeHtml(record.result || '-')}</td>
                    <td>${escapeHtml(formatDate(record.test_time))}</td>
                    <td>${escapeHtml(record.tested_by_name || '-')}</td>
                    <td>${escapeHtml(record.notes || '-')}</td>
                    <td>${attributes}</td>
                </tr>
            `;
        }).join('');

        qualityTab.innerHTML = `
            <div class="detail-section">
                <h3>${segmentEntry.batch?.process_segment || '工段'}品质记录</h3>
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>检测项目</th>
                            <th>检测值</th>
                            <th>单位</th>
                            <th>标准范围</th>
                            <th>结果</th>
                            <th>检测时间</th>
                            <th>检测人</th>
                            <th>备注</th>
                            <th>附加信息</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }
    
    function editBatch(batch) {
        if (!batch) {
            showNotification('未找到批号数据，请刷新后重试', 'error');
            return;
        }
        redirectToRecord(batch);
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
    
    // 添加一些CSS样式到页面
    const additionalStyles = document.createElement('style');
    additionalStyles.textContent = `
        .detail-section {
            margin-bottom: 30px;
        }
        
        .detail-section h3 {
            margin-bottom: 15px;
            color: #2c3e50;
            font-size: 18px;
        }
        
        .detail-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 15px;
        }
        
        .detail-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .detail-item label {
            font-weight: 600;
            color: #7f8c8d;
        }
        
        .segment-selector {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 15px 0;
        }
        
        .segment-selector label {
            font-weight: 600;
            color: #2c3e50;
        }
        
        .segment-selector select {
            min-width: 220px;
            padding: 6px 10px;
        }
        
        .detail-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        
        .detail-table th,
        .detail-table td {
            padding: 8px 10px;
            border: 1px solid #ecf0f1;
            text-align: left;
            vertical-align: top;
        }
        
        .detail-table th {
            background-color: #f5f7fa;
            font-weight: 600;
            color: #34495e;
        }
        
        .segment-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 12px;
            color: #2c3e50;
        }
        
        .segment-summary span {
            background-color: #f1f5fb;
            border-radius: 12px;
            padding: 6px 12px;
        }
        
        .segment-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .segment-list li {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .segment-list .segment-name {
            font-weight: 600;
            color: #2c3e50;
        }
        
        .segment-list .segment-status {
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 12px;
            background-color: #ecf0f1;
            color: #2c3e50;
        }
        
        .segment-status.badge {
            display: inline-block;
        }
        
        .segment-list .segment-count {
            color: #7f8c8d;
            font-size: 13px;
        }
        
        .notification-content {
            display: flex;
            align-items: center;
        }
        
        .notification-content i {
            margin-right: 10px;
            font-size: 18px;
        }
        
        .notification-close {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            margin-left: 15px;
        }
        
        .sidebar.collapsed {
            width: 70px;
        }
        
        .sidebar.collapsed .logo span,
        .sidebar.collapsed .nav-item span,
        .sidebar.collapsed .user-details,
        .sidebar.collapsed .logout-btn span {
            display: none;
        }
        
        .sidebar.collapsed .logo i {
            margin-right: 0;
            font-size: 28px;
        }
        
        .sidebar.collapsed .nav-item {
            justify-content: center;
            padding: 15px;
        }
        
        .sidebar.collapsed .nav-item i {
            margin-right: 0;
            font-size: 20px;
        }
    `;
    document.head.appendChild(additionalStyles);
});
