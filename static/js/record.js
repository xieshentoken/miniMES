document.addEventListener('DOMContentLoaded', function() {
    // 全局变量
    let currentBatch = null;
    let batches = [];
    let filteredBatches = [];
    let processSegments = [];
    let currentUser = {};
    let initialBatchId = null;
    let initialSegment = null;
    const completedStatus = document.body.dataset.completedStatus || '已完成';
    const defaultBatchStatusOptions = Array.from(new Set(['进行中', completedStatus, '暂停', '异常']));
    let batchStatusOptions = [...defaultBatchStatusOptions];
    let equipmentStatusOptions = ['正常运行', '故障', '维护'];
    let segmentDefinitions = { materials: [], equipment: [], quality: [] };
    let materialDefinitionMap = new Map();
    let equipmentDefinitionMap = new Map();
    let qualityDefinitionMap = new Map();

    const materialRecordsMap = {};
    const equipmentRecordsMap = {};
    const qualityRecordsMap = {};
    let pendingAttachmentUpload = null;
    let permissions = {
        viewMaterials: false,
        manageMaterials: false,
        viewEquipment: false,
        manageEquipment: false,
        viewQuality: false,
        manageQuality: false,
        manageBatchStatus: false,
        manageBatchSegment: false,
        createBatch: false,
        duplicateBatch: false
    };
    let deletionMap = new Map();

    const MATERIAL_VIEW_ROLES = new Set(['admin', 'write', 'write_material', 'read']);
    const MATERIAL_MANAGE_ROLES = new Set(['admin', 'write', 'write_material']);
    const EQUIPMENT_VIEW_ROLES = new Set(['admin', 'write', 'write_material', 'read']);
    const EQUIPMENT_MANAGE_ROLES = new Set(['admin', 'write', 'write_material']);
    const QUALITY_VIEW_ROLES = new Set(['admin', 'write', 'write_quality', 'read']);
    const QUALITY_MANAGE_ROLES = new Set(['admin', 'write', 'write_quality']);
    const BATCH_STATUS_ROLES = new Set(['admin', 'write', 'write_material']);
    const BATCH_SEGMENT_ROLES = new Set(['admin', 'write', 'write_material']);
    const CREATE_BATCH_ROLES = new Set(['admin', 'write', 'write_material']);
    const DUPLICATE_BATCH_ROLES = new Set(['admin', 'write']);

    // DOM元素
    const batchSelect = document.getElementById('batchSelect');
    const batchInfoCard = document.getElementById('batchInfoCard');
    const batchFilterProductInput = document.getElementById('batchFilterProduct');
    const batchFilterKeywordInput = document.getElementById('batchFilterKeyword');
    const batchFilterSegmentSelect = document.getElementById('batchFilterSegment');
    const createBatchBtn = document.getElementById('createBatchBtn');
    const createBatchModal = document.getElementById('createBatchModal');
    const createBatchForm = document.getElementById('createBatchForm');
    const processSegmentSelect = document.getElementById('processSegment');
    const segmentEditRow = document.getElementById('segmentEditRow');
    const batchSegmentSelect = document.getElementById('batchSegmentSelect');
    const updateSegmentBtn = document.getElementById('updateSegmentBtn');
    const statusEditRow = document.getElementById('statusEditRow');
    const batchStatusSelect = document.getElementById('batchStatusSelect');
    const updateStatusBtn = document.getElementById('updateStatusBtn');
    const equipmentStatusSelect = document.getElementById('equipmentStatus');

    // 标签页元素
    const allTabHeaders = Array.from(document.querySelectorAll('.tab-header'));
    const allTabPanes = Array.from(document.querySelectorAll('.tab-pane'));
    let tabHeaders = [...allTabHeaders];
    let tabPanes = [...allTabPanes];

    // 添加记录按钮
    const addMaterialBtn = document.getElementById('addMaterialBtn');
    const addEquipmentBtn = document.getElementById('addEquipmentBtn');
    const addQualityBtn = document.getElementById('addQualityBtn');
    
    // 模态框
    const addMaterialModal = document.getElementById('addMaterialModal');
    const detailModal = document.getElementById('detailModal');

    // 表单
    const addMaterialForm = document.getElementById('addMaterialForm');
    const addEquipmentForm = document.getElementById('addEquipmentForm');
    const addQualityForm = document.getElementById('addQualityForm');
    const materialConfirmBtn = document.getElementById('materialConfirmBtn');
    const equipmentConfirmBtn = document.getElementById('equipmentConfirmBtn');
    const qualityConfirmBtn = document.getElementById('qualityConfirmBtn');
    const materialCodeSelect = document.getElementById('materialCode');
    const materialNameInput = document.getElementById('materialName');
    const materialSupplierInput = document.getElementById('materialSupplier');
    const materialUnitSelect = document.getElementById('materialUnit');
    const materialDefinitionInfo = document.getElementById('materialDefinitionInfo');
    const materialAttachmentsInput = document.getElementById('materialAttachments');
    const materialAttachmentList = document.getElementById('materialAttachmentList');
    const equipmentCodeSelect = document.getElementById('equipmentCode');
    const equipmentNameInput = document.getElementById('equipmentName');
    const equipmentDefinitionInfo = document.getElementById('equipmentDefinitionInfo');
    const equipmentAttachmentsInput = document.getElementById('equipmentAttachments');
    const equipmentAttachmentList = document.getElementById('equipmentAttachmentList');
    const equipmentResetBtn = document.getElementById('equipmentResetBtn');
    const equipmentRowAttachmentInput = document.getElementById('equipmentRowAttachmentInput');
    const qualityTestItemSelect = document.getElementById('qualityTestItem');
    const qualityUnitInput = document.getElementById('qualityUnit');
    const qualityStandardMinInput = document.getElementById('qualityStandardMin');
    const qualityStandardMaxInput = document.getElementById('qualityStandardMax');
    const qualityDefinitionInfo = document.getElementById('qualityDefinitionInfo');
    const qualityAttachmentsInput = document.getElementById('qualityAttachments');
    const qualityAttachmentList = document.getElementById('qualityAttachmentList');
    const qualityResetBtn = document.getElementById('qualityResetBtn');
    const qualityRowAttachmentInput = document.getElementById('qualityRowAttachmentInput');

    const deleteSection = document.getElementById('batchDeleteSection');
    const deleteProductSelect = document.getElementById('deleteProductSelect');
    const deleteBatchSelect = document.getElementById('deleteBatchSelect');
    const deleteSegmentSelect = document.getElementById('deleteSegmentSelect');
    const deleteStatusSelect = document.getElementById('deleteStatusSelect');
    const deleteSegmentBtn = document.getElementById('deleteSegmentBtn');

    const duplicateControls = document.getElementById('batchDuplicateControls');
    const duplicateBatchNumberInput = document.getElementById('duplicateBatchNumber');
    const duplicateProductNameInput = document.getElementById('duplicateProductName');
    const duplicateCopyRecordsCheckbox = document.getElementById('duplicateCopyRecords');
    const duplicateBatchBtn = document.getElementById('duplicateBatchBtn');

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

    const normalizeRole = role => displayToRoleMap[role] || role;

    function resolvePermissions(role) {
        const normalized = role || '';
        return {
            viewMaterials: MATERIAL_VIEW_ROLES.has(normalized),
            manageMaterials: MATERIAL_MANAGE_ROLES.has(normalized),
            viewEquipment: EQUIPMENT_VIEW_ROLES.has(normalized),
            manageEquipment: EQUIPMENT_MANAGE_ROLES.has(normalized),
            viewQuality: QUALITY_VIEW_ROLES.has(normalized),
            manageQuality: QUALITY_MANAGE_ROLES.has(normalized),
            manageBatchStatus: BATCH_STATUS_ROLES.has(normalized),
            manageBatchSegment: BATCH_SEGMENT_ROLES.has(normalized),
            createBatch: CREATE_BATCH_ROLES.has(normalized),
            duplicateBatch: DUPLICATE_BATCH_ROLES.has(normalized)
        };
    }

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

    // 初始化应用
    initApp();
    
    // 初始化应用
    function initApp() {
        // 获取用户信息
        const bodyDataset = document.body.dataset || {};
        const sidebarUserRoleEl = document.getElementById('sidebarUserRole');
        const sidebarUsernameEl = document.getElementById('sidebarUsername');
        const headerUsernameEl = document.getElementById('headerUsername');

        const rawRole = bodyDataset.role || sidebarUserRoleEl?.textContent || '';
        currentUser = {
            username: bodyDataset.username || headerUsernameEl?.textContent || '未登录',
            role: normalizeRole(rawRole)
        };

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

        const urlParams = new URLSearchParams(window.location.search);
        initialBatchId = urlParams.get('batchId');
        initialSegment = urlParams.get('segment');

        // 检查用户权限
        checkUserPermissions();

        populateStatusSelect();
        populateEquipmentStatusOptions();
        loadRecordFieldConfig();
        // 加载数据
        loadBatches();
        loadProcessSegments();
        
        // 设置事件监听器
        setupEventListeners();
    }
    
    // 获取角色显示名称
    function getRoleDisplayName(role) {
        return roleDisplayMap[role] || role;
    }
    
    // 检查用户权限
    function checkUserPermissions() {
        permissions = resolvePermissions(currentUser.role);

        if (createBatchBtn) {
            createBatchBtn.style.display = permissions.createBatch ? 'inline-flex' : 'none';
        }

        if (addMaterialBtn) {
            addMaterialBtn.style.display = permissions.manageMaterials ? 'inline-flex' : 'none';
        }
        if (materialConfirmBtn) {
            materialConfirmBtn.disabled = !permissions.manageMaterials;
        }

        if (addEquipmentBtn) {
            addEquipmentBtn.style.display = permissions.manageEquipment ? 'inline-flex' : 'none';
        }
        if (equipmentConfirmBtn) {
            equipmentConfirmBtn.disabled = !permissions.manageEquipment;
        }

        if (addQualityBtn) {
            addQualityBtn.style.display = permissions.manageQuality ? 'inline-flex' : 'none';
        }
        if (qualityConfirmBtn) {
            qualityConfirmBtn.disabled = !permissions.manageQuality;
        }

        if (segmentEditRow) {
            segmentEditRow.style.display = permissions.manageBatchSegment ? 'flex' : 'none';
            if (updateSegmentBtn) {
                updateSegmentBtn.disabled = !permissions.manageBatchSegment;
            }
        }

        if (statusEditRow) {
            statusEditRow.style.display = permissions.manageBatchStatus ? 'flex' : 'none';
        }
        if (batchStatusSelect) {
            batchStatusSelect.disabled = !permissions.manageBatchStatus;
        }
        if (updateStatusBtn) {
            updateStatusBtn.disabled = !permissions.manageBatchStatus;
        }

        if (deleteSection) {
            const canDelete = currentUser.role === 'admin';
            deleteSection.style.display = canDelete ? 'flex' : 'none';
            if (!canDelete) {
                clearDeletionSelectors();
            }
        }

        applyTabVisibility();
    }

    function applyTabVisibility() {
        const tabConfig = [
            { key: 'material', canView: permissions.viewMaterials },
            { key: 'equipment', canView: permissions.viewEquipment },
            { key: 'quality', canView: permissions.viewQuality }
        ];

        let firstVisibleKey = null;

        tabConfig.forEach(({ key, canView }) => {
            const header = document.querySelector(`.tab-header[data-tab="${key}"]`);
            const pane = document.getElementById(`${key}Tab`);
            if (!header || !pane) {
                return;
            }

            if (canView) {
                header.style.display = '';
                pane.style.display = '';
                if (!firstVisibleKey) {
                    firstVisibleKey = key;
                }
            } else {
                header.style.display = 'none';
                header.classList.remove('active');
                pane.classList.remove('active');
                pane.style.display = 'none';
            }
        });

        tabHeaders = tabConfig
            .map(({ key, canView }) => ({ header: document.querySelector(`.tab-header[data-tab="${key}"]`), canView }))
            .filter(item => item.header && item.canView)
            .map(item => item.header);

        tabPanes = tabConfig
            .map(({ key, canView }) => ({ pane: document.getElementById(`${key}Tab`), canView }))
            .filter(item => item.pane && item.canView)
            .map(item => item.pane);

        const activeHeaderExists = tabHeaders.some(header => header.classList.contains('active'));
        if (!activeHeaderExists) {
            if (firstVisibleKey) {
                switchTab(firstVisibleKey);
            } else {
                allTabHeaders.forEach(header => header.classList.remove('active'));
                allTabPanes.forEach(pane => pane.classList.remove('active'));
            }
        }
    }
    
    // 设置事件监听器
    function setupEventListeners() {
        // 批号选择
        if (batchSelect) {
            batchSelect.addEventListener('change', handleBatchSelect);
        }
        if (batchFilterProductInput) {
            batchFilterProductInput.addEventListener('input', applyBatchFilters);
        }
        if (batchFilterKeywordInput) {
            batchFilterKeywordInput.addEventListener('input', applyBatchFilters);
        }
        if (batchFilterSegmentSelect) {
            batchFilterSegmentSelect.addEventListener('change', applyBatchFilters);
        }

        // 新建批号按钮
        if (createBatchBtn) {
            createBatchBtn.addEventListener('click', showCreateBatchModal);
        }

        // 标签页切换
        tabHeaders.forEach(header => {
            header.addEventListener('click', function() {
                if (this.style.display === 'none') {
                    return;
                }
                switchTab(this.dataset.tab);
            });
        });

        if (updateSegmentBtn) {
            updateSegmentBtn.addEventListener('click', updateBatchSegment);
        }

        if (updateStatusBtn) {
            updateStatusBtn.addEventListener('click', updateBatchStatus);
        }

        // 添加记录按钮
        if (addMaterialBtn) {
            addMaterialBtn.addEventListener('click', showAddMaterialModal);
        }
        if (addEquipmentBtn) {
            addEquipmentBtn.addEventListener('click', () => setEquipmentFormMode('create'));
        }
        if (addQualityBtn) {
            addQualityBtn.addEventListener('click', () => setQualityFormMode('create'));
        }

        if (duplicateBatchBtn) {
            duplicateBatchBtn.addEventListener('click', handleDuplicateBatch);
        }

        if (deleteProductSelect) {
            deleteProductSelect.addEventListener('change', () => {
                updateDeleteBatchOptions(deleteProductSelect.value, null, null, null);
            });
        }
        if (deleteBatchSelect) {
            deleteBatchSelect.addEventListener('change', () => {
                updateDeleteSegmentOptions(deleteProductSelect.value, deleteBatchSelect.value, null, null);
            });
        }
        if (deleteSegmentSelect) {
            deleteSegmentSelect.addEventListener('change', () => {
                updateDeleteStatusOptions(
                    deleteProductSelect.value,
                    deleteBatchSelect.value,
                    deleteSegmentSelect.value,
                    null
                );
            });
        }
        if (deleteStatusSelect) {
            deleteStatusSelect.addEventListener('change', updateDeleteButtonState);
        }
        if (deleteSegmentBtn) {
            deleteSegmentBtn.addEventListener('click', handleDeleteSegment);
        }

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
        
        // 表单提交
        if (createBatchForm) {
            createBatchForm.addEventListener('submit', handleCreateBatch);
        }
        if (addMaterialForm) {
            addMaterialForm.addEventListener('submit', e => e.preventDefault());
        }
        if (materialConfirmBtn) {
            materialConfirmBtn.addEventListener('click', handleAddMaterial);
        }

        if (addEquipmentForm) {
            addEquipmentForm.addEventListener('submit', handleAddEquipment);
        }
        if (equipmentResetBtn) {
            equipmentResetBtn.addEventListener('click', () => setEquipmentFormMode('create'));
        }

        if (addQualityForm) {
            addQualityForm.addEventListener('submit', handleAddQuality);
        }
        if (qualityResetBtn) {
            qualityResetBtn.addEventListener('click', () => setQualityFormMode('create'));
        }

        if (materialCodeSelect) {
            materialCodeSelect.addEventListener('change', () => {
                const definition = materialDefinitionMap.get(materialCodeSelect.value) || null;
                applyMaterialDefinition(definition, true);
            });
        }

        if (equipmentCodeSelect) {
            equipmentCodeSelect.addEventListener('change', () => {
                const definition = equipmentDefinitionMap.get(equipmentCodeSelect.value) || null;
                applyEquipmentDefinition(definition, collectEquipmentParameterValues());
            });
        }

        if (qualityTestItemSelect) {
            qualityTestItemSelect.addEventListener('change', () => {
                const definition = qualityDefinitionMap.get(qualityTestItemSelect.value) || null;
                applyQualityDefinition(definition);
            });
        }

        if (equipmentAttachmentsInput) {
            equipmentAttachmentsInput.addEventListener('change', () => renderSelectedAttachments(equipmentAttachmentsInput, equipmentAttachmentList));
        }
        if (qualityAttachmentsInput) {
            qualityAttachmentsInput.addEventListener('change', () => renderSelectedAttachments(qualityAttachmentsInput, qualityAttachmentList));
        }
        if (equipmentRowAttachmentInput) {
            equipmentRowAttachmentInput.addEventListener('change', event => handleRowAttachmentUpload('equipment', event.target));
        }
        if (qualityRowAttachmentInput) {
            qualityRowAttachmentInput.addEventListener('change', event => handleRowAttachmentUpload('quality', event.target));
        }
    }
    
    // 加载批号数据
    function loadBatches() {
        fetch('/api/batches')
            .then(response => response.json())
            .then(data => {
                const expanded = expandBatchEntries(data || []);
                batches = sortBatches(expanded);
                refreshBatchOptions({ initial: true });
                populateDeletionControls();
            })
            .catch(error => {
                console.error('加载批号数据失败:', error);
                showNotification('加载批号数据失败', 'error');
                clearDeletionSelectors();
            });
    }
    
    // 填充批号选择下拉框
    function populateBatchSelect(batches) {
        batchSelect.innerHTML = '<option value="">请选择批号...</option>';
        
        batches.forEach(batch => {
            const option = document.createElement('option');
            option.value = batch.id;
            option.textContent = `${batch.batch_number}-${batch.process_segment} | ${batch.product_name} (${batch.status})`;
            batchSelect.appendChild(option);
        });
    }
    
    // 加载工艺段
    function loadProcessSegments() {
        fetch('/api/process_segments')
            .then(response => response.json())
            .then(segments => {
                processSegments = segments;
                
                // 填充新建批号表单的工艺段下拉框
                processSegmentSelect.innerHTML = '<option value="">请选择工艺段</option>';
                
                segments.forEach(segment => {
                    const option = document.createElement('option');
                    option.value = segment.segment_name;
                    option.textContent = segment.segment_name;
                    processSegmentSelect.appendChild(option);
                });

                if (batchFilterSegmentSelect) {
                    batchFilterSegmentSelect.innerHTML = '<option value="">所有工序</option>';
                    segments.forEach(segment => {
                        const option = document.createElement('option');
                        option.value = segment.segment_name;
                        option.textContent = segment.segment_name;
                        batchFilterSegmentSelect.appendChild(option);
                    });
                }

                if (batchSegmentSelect) {
                    batchSegmentSelect.innerHTML = '<option value="">请选择工段</option>';
                    segments.forEach(segment => {
                        const option = document.createElement('option');
                        option.value = segment.segment_name;
                        option.textContent = segment.segment_name;
                        batchSegmentSelect.appendChild(option);
                    });
                    if (currentBatch) {
                        batchSegmentSelect.value = currentBatch.process_segment;
                    }
                }
            })
            .catch(error => {
                console.error('加载工艺段失败:', error);
                showNotification('加载工艺段失败', 'error');
            });
    }

    async function loadSegmentDefinitions(segment) {
        if (!segment) {
            segmentDefinitions = { materials: [], equipment: [], quality: [] };
            refreshDefinitionMaps();
            return;
        }

        try {
            const data = await fetchJSON(`/api/segment_definitions?segment=${encodeURIComponent(segment)}`);
            segmentDefinitions = {
                materials: data.materials || [],
                equipment: data.equipment || [],
                quality: data.quality || []
            };
        } catch (error) {
            console.error('加载工段配置失败:', error);
            showNotification('加载工段配置失败，已使用默认项目', 'warning');
            segmentDefinitions = { materials: [], equipment: [], quality: [] };
        }

        refreshDefinitionMaps();
    }

    function refreshDefinitionMaps() {
        materialDefinitionMap = new Map((segmentDefinitions.materials || []).map(item => [String(item.code), item]));
        equipmentDefinitionMap = new Map((segmentDefinitions.equipment || []).map(item => [String(item.code), item]));
        qualityDefinitionMap = new Map((segmentDefinitions.quality || []).map(item => [String(item.item), item]));

        populateMaterialOptions(materialCodeSelect?.value || null);
        populateEquipmentOptions(equipmentCodeSelect?.value || null, collectEquipmentParameterValues());
        populateQualityOptions(qualityTestItemSelect?.value || null);
        populateEquipmentStatusOptions(equipmentStatusSelect?.value || null);
    }

    function populateMaterialOptions(selectedCode) {
        if (!materialCodeSelect) {
            return;
        }

        const materials = Array.from(materialDefinitionMap.values());
        materialCodeSelect.innerHTML = '';

        if (!materials.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '未配置物料，手动录入';
            materialCodeSelect.appendChild(option);
            materialCodeSelect.disabled = true;
            applyMaterialDefinition(null, false);
            return;
        }

        materialCodeSelect.disabled = false;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择物料';
        materialCodeSelect.appendChild(placeholder);

        materials.forEach(material => {
            const option = document.createElement('option');
            option.value = material.code;
            option.textContent = `${material.code} - ${material.name}`;
            materialCodeSelect.appendChild(option);
        });

        if (selectedCode && !materialDefinitionMap.has(String(selectedCode))) {
            const externalOption = document.createElement('option');
            externalOption.value = selectedCode;
            externalOption.textContent = `${selectedCode} (未在配置中)`;
            materialCodeSelect.appendChild(externalOption);
        }

        const targetCode = selectedCode && materialDefinitionMap.has(String(selectedCode))
            ? String(selectedCode)
            : '';

        materialCodeSelect.value = targetCode;
        applyMaterialDefinition(materialDefinitionMap.get(materialCodeSelect.value) || null, true);
    }

    function applyMaterialDefinition(definition, forceReadonly = true) {
        if (!materialNameInput || !materialSupplierInput) {
            return;
        }

        if (definition) {
            materialNameInput.value = definition.name || '';
            materialSupplierInput.value = definition.supplier || '';
            if (materialUnitSelect && definition.unit) {
                materialUnitSelect.value = definition.unit;
            }
            materialNameInput.readOnly = forceReadonly;
            materialSupplierInput.readOnly = forceReadonly;
            if (materialDefinitionInfo) {
                const infoParts = [];
                if (definition.stock !== undefined) {
                    infoParts.push(`当前库存：${definition.stock}`);
                }
                if (definition.notes) {
                    infoParts.push(definition.notes);
                }
                materialDefinitionInfo.textContent = infoParts.join(' | ');
            }
        } else {
            materialNameInput.readOnly = false;
            materialSupplierInput.readOnly = false;
            if (materialDefinitionInfo) {
                materialDefinitionInfo.textContent = materialDefinitionMap.size
                    ? '请选择物料，或在配置中添加新的物料条目'
                    : '未配置物料，请手动维护相关信息';
            }
        }
    }

    function populateEquipmentStatusOptions(selectedValue) {
        if (!equipmentStatusSelect) {
            return;
        }

        const options = [...equipmentStatusOptions];
        equipmentStatusSelect.innerHTML = '';

        if (!options.length) {
            options.push('正常运行');
        }

        options.forEach(status => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = status;
            equipmentStatusSelect.appendChild(option);
        });

        if (selectedValue && options.includes(selectedValue)) {
            equipmentStatusSelect.value = selectedValue;
        }
    }

    function populateEquipmentOptions(selectedCode, presetParameters = {}) {
        if (!equipmentCodeSelect) {
            return;
        }

        const equipments = Array.from(equipmentDefinitionMap.values());
        equipmentCodeSelect.innerHTML = '';

        if (!equipments.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '未配置设备，手动录入';
            equipmentCodeSelect.appendChild(option);
            equipmentCodeSelect.disabled = true;
            applyEquipmentDefinition(null, presetParameters);
            return;
        }

        equipmentCodeSelect.disabled = false;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择设备';
        equipmentCodeSelect.appendChild(placeholder);

        equipments.forEach(equipment => {
            const option = document.createElement('option');
            option.value = equipment.code;
            option.textContent = `${equipment.code} - ${equipment.name}`;
            equipmentCodeSelect.appendChild(option);
        });

        if (selectedCode && !equipmentDefinitionMap.has(String(selectedCode))) {
            const externalOption = document.createElement('option');
            externalOption.value = selectedCode;
            externalOption.textContent = `${selectedCode} (未在配置中)`;
            equipmentCodeSelect.appendChild(externalOption);
        }

        const targetCode = selectedCode && equipmentDefinitionMap.has(String(selectedCode))
            ? String(selectedCode)
            : '';

        equipmentCodeSelect.value = targetCode;
        applyEquipmentDefinition(equipmentDefinitionMap.get(equipmentCodeSelect.value) || null, presetParameters);
    }

    function applyEquipmentDefinition(definition, presetParameters = {}) {
        if (!equipmentNameInput) {
            return;
        }

        if (definition) {
            equipmentNameInput.value = definition.name || '';
            equipmentNameInput.readOnly = true;
            if (equipmentDefinitionInfo) {
                equipmentDefinitionInfo.textContent = definition.notes || '';
            }
            renderEquipmentParameters(definition.parameters || [], presetParameters);
        } else {
            equipmentNameInput.readOnly = false;
            if (equipmentDefinitionInfo) {
                equipmentDefinitionInfo.textContent = equipmentDefinitionMap.size
                    ? '请选择设备，或在配置中维护设备参数'
                    : '未配置设备参数，请手动填写';
            }
            renderEquipmentParameters([], presetParameters);
        }
    }

    function renderEquipmentParameters(parameters, presetValues = {}) {
        const parametersContainer = document.getElementById('equipmentParameters');
        if (!parametersContainer) {
            return;
        }

        parametersContainer.innerHTML = '';

        if (!parameters || !parameters.length) {
            parametersContainer.innerHTML = '<p>当前设备未配置参数，可根据需要在备注中记录。</p>';
            return;
        }

        parameters.forEach(param => {
            const wrapper = document.createElement('div');
            wrapper.className = 'parameter-item';

            const label = document.createElement('label');
            const unitSuffix = param.unit ? ` (${param.unit})` : '';
            label.setAttribute('for', `equipment_param_${param.key}`);
            label.textContent = `${param.label || param.key}${unitSuffix}`;

            const input = createParameterInput(param, presetValues[param.key]);
            wrapper.appendChild(label);
            wrapper.appendChild(input);
            parametersContainer.appendChild(wrapper);
        });
    }

    function createParameterInput(param, value) {
        const inputName = param.key;
        const type = param.type || 'text';
        const requiredAttr = param.required ? 'required' : '';
        const elementId = `equipment_param_${inputName}`;

        let element;
        if (type === 'number') {
            element = document.createElement('input');
            element.type = 'number';
            element.step = param.step || '0.01';
        } else if (type === 'boolean') {
            element = document.createElement('select');
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '请选择';
            element.appendChild(placeholder);

            const trueOption = document.createElement('option');
            trueOption.value = 'true';
            trueOption.textContent = '是';
            element.appendChild(trueOption);

            const falseOption = document.createElement('option');
            falseOption.value = 'false';
            falseOption.textContent = '否';
            element.appendChild(falseOption);
        } else if (type === 'datetime') {
            element = document.createElement('input');
            element.type = 'datetime-local';
        } else if (type === 'select' && Array.isArray(param.options)) {
            element = document.createElement('select');
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '请选择';
            element.appendChild(placeholder);
            param.options.forEach(optionValue => {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = optionValue;
                element.appendChild(option);
            });
        } else {
            element = document.createElement('input');
            element.type = 'text';
        }

        element.id = elementId;
        element.name = inputName;
        if (param.required) {
            element.required = true;
        }
        if (value !== undefined && value !== null) {
            element.value = typeof value === 'boolean' ? String(value) : value;
        } else if (param.default !== undefined) {
            element.value = typeof param.default === 'boolean' ? String(param.default) : param.default;
        }

        return element;
    }

    function collectEquipmentParameterValues() {
        const values = {};
        const parameterInputs = addEquipmentForm ? addEquipmentForm.querySelectorAll('#equipmentParameters [name]') : [];
        parameterInputs.forEach(input => {
            values[input.name] = input.value;
        });
        return values;
    }

    function renderSelectedAttachments(inputEl, listEl) {
        if (!inputEl || !listEl) {
            return;
        }

        const files = Array.from(inputEl.files || []);
        listEl.innerHTML = '';

        if (!files.length) {
            listEl.style.display = 'none';
            return;
        }

        listEl.style.display = 'block';
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'attachment-item';
            item.textContent = file.name;
            listEl.appendChild(item);
        });
    }

    function promptRowAttachmentUpload(recordType, recordId) {
        const manageMap = {
            equipment: permissions.manageEquipment,
            quality: permissions.manageQuality
        };

        if (!manageMap[recordType]) {
            showNotification('当前账号无权限上传附件', 'error');
            return;
        }
        if (!currentBatch) {
            showNotification('请先选择批号', 'warning');
            return;
        }

        const targetInput = recordType === 'equipment' ? equipmentRowAttachmentInput : qualityRowAttachmentInput;
        if (!targetInput) {
            showNotification('当前无法使用附件上传控件', 'error');
            return;
        }

        pendingAttachmentUpload = { type: recordType, recordId: Number(recordId) };
        targetInput.value = '';
        targetInput.click();
    }

    function handleRowAttachmentUpload(recordType, inputEl) {
        const manageMap = {
            equipment: permissions.manageEquipment,
            quality: permissions.manageQuality
        };

        if (!manageMap[recordType]) {
            showNotification('当前账号无权限上传附件', 'error');
            pendingAttachmentUpload = null;
            if (inputEl) {
                inputEl.value = '';
            }
            return;
        }

        if (!pendingAttachmentUpload || pendingAttachmentUpload.type !== recordType) {
            return;
        }

        const files = Array.from(inputEl.files || []);
        if (!files.length) {
            pendingAttachmentUpload = null;
            return;
        }

        const recordId = pendingAttachmentUpload.recordId;
        const recordMap = recordType === 'equipment' ? equipmentRecordsMap : qualityRecordsMap;
        const record = recordMap[recordId];

        if (!record) {
            showNotification('未找到对应记录，附件上传取消', 'error');
            pendingAttachmentUpload = null;
            inputEl.value = '';
            return;
        }

        const endpoint = recordType === 'equipment'
            ? `/api/batches/${currentBatch.id}/equipment/${recordId}`
            : `/api/batches/${currentBatch.id}/quality/${recordId}`;

        const payload = recordType === 'equipment'
            ? {
                equipment_code: record.equipment_code,
                equipment_name: record.equipment_name,
                start_time: record.start_time,
                end_time: record.end_time,
                status: record.status,
                parameters: record.parameters || {}
            }
            : {
                test_item: record.test_item,
                test_value: record.test_value,
                unit: record.unit,
                standard_min: record.standard_min,
                standard_max: record.standard_max,
                notes: record.notes || null,
                extras: record.attributes || {}
            };

        const existingAttachments = (record.attachments || []).map(att => att.path);
        const requestBody = new FormData();
        requestBody.append('payload', JSON.stringify(payload));
        requestBody.append('existing_attachments', JSON.stringify(existingAttachments));
        files.forEach(file => requestBody.append('attachments', file));

        fetch(endpoint, {
            method: 'PUT',
            body: requestBody
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
                return;
            }
            showNotification('附件上传成功', 'success');
            if (recordType === 'equipment') {
                loadEquipmentRecords();
                if (addEquipmentForm.dataset.mode === 'edit' && addEquipmentForm.dataset.recordId) {
                    const current = equipmentRecordsMap[Number(addEquipmentForm.dataset.recordId)];
                    if (current) {
                        setEquipmentFormMode('edit', current);
                    }
                } else {
                    setEquipmentFormMode('create');
                }
            } else {
                loadQualityRecords();
                if (addQualityForm.dataset.mode === 'edit' && addQualityForm.dataset.recordId) {
                    const current = qualityRecordsMap[Number(addQualityForm.dataset.recordId)];
                    if (current) {
                        setQualityFormMode('edit', current);
                    }
                } else {
                    setQualityFormMode('create');
                }
            }
        })
        .catch(error => {
            console.error('附件上传失败:', error);
            showNotification('附件上传失败，请重试', 'error');
        })
        .finally(() => {
            pendingAttachmentUpload = null;
            inputEl.value = '';
        });
    }

    function populateQualityOptions(selectedItem) {
        if (!qualityTestItemSelect) {
            return;
        }

        const items = Array.from(qualityDefinitionMap.values());
        qualityTestItemSelect.innerHTML = '';

        if (!items.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '未配置项目，手动录入';
            qualityTestItemSelect.appendChild(option);
            qualityTestItemSelect.disabled = true;
            applyQualityDefinition(null);
            return;
        }

        qualityTestItemSelect.disabled = false;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择项目';
        qualityTestItemSelect.appendChild(placeholder);

        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.item;
            option.textContent = item.item;
            qualityTestItemSelect.appendChild(option);
        });

        if (selectedItem && !qualityDefinitionMap.has(String(selectedItem))) {
            const externalOption = document.createElement('option');
            externalOption.value = selectedItem;
            externalOption.textContent = `${selectedItem} (未在配置中)`;
            qualityTestItemSelect.appendChild(externalOption);
        }

        const targetItem = selectedItem && qualityDefinitionMap.has(String(selectedItem))
            ? String(selectedItem)
            : '';

        qualityTestItemSelect.value = targetItem;
        applyQualityDefinition(qualityDefinitionMap.get(qualityTestItemSelect.value) || null);
    }

    function applyQualityDefinition(definition) {
        if (!qualityDefinitionInfo) {
            return;
        }

        if (definition) {
            if (qualityUnitInput) {
                qualityUnitInput.value = definition.unit || '';
                qualityUnitInput.readOnly = true;
            }
            if (qualityStandardMinInput && definition.min !== undefined) {
                qualityStandardMinInput.value = definition.min;
            }
            if (qualityStandardMaxInput && definition.max !== undefined) {
                qualityStandardMaxInput.value = definition.max;
            }
            const notes = [];
            if (definition.standard_value !== undefined) {
                notes.push(`标准值：${definition.standard_value}`);
            }
            if (definition.device) {
                notes.push(`检测设备：${definition.device}`);
            }
            if (definition.notes) {
                notes.push(definition.notes);
            }
            qualityDefinitionInfo.textContent = notes.join(' | ');
        } else {
            if (qualityUnitInput) {
                qualityUnitInput.readOnly = false;
            }
            qualityDefinitionInfo.textContent = qualityDefinitionMap.size
                ? '请选择检测项目，或在配置中维护检测项目信息'
                : '未配置检测项目，手动录入';
        }
    }
    
    // 处理批号选择
    async function handleBatchSelect(event) {
        const batchId = event.target.value;
        
        if (!batchId) {
            loadSegmentDefinitions(null);
            batchInfoCard.style.display = 'none';
            currentBatch = null;
            clearRecordTables();
            if (segmentEditRow) {
                segmentEditRow.style.display = 'none';
            }
            if (duplicateControls) {
                duplicateControls.style.display = 'none';
            }
            return;
        }
        
        // 查找选中的批号
        currentBatch = batches.find(b => b.id == batchId);
        
        if (currentBatch) {
            await loadSegmentDefinitions(currentBatch.process_segment);
            // 显示批号信息
            displayBatchInfo(currentBatch);

            // 加载记录数据
            loadRecordData();

            setEquipmentFormMode('create');
            setQualityFormMode('create');
        }
    }
    
    // 显示批号信息
    function displayBatchInfo(batch) {
        document.getElementById('selectedBatchNumber').textContent = batch.batch_number;
        document.getElementById('selectedProductName').textContent = batch.product_name;
        document.getElementById('selectedProcessSegment').textContent = batch.process_segment;
        document.getElementById('selectedCreateTime').textContent = formatDate(batch.start_time);
        document.getElementById('selectedCompositeKey').textContent = `${batch.batch_number}-${batch.process_segment}`;

        // 设置状态
        const statusElement = document.getElementById('selectedBatchStatus');
        statusElement.textContent = batch.status;
        statusElement.className = `batch-status status-${getStatusClass(batch.status)}`;

        if (batchStatusSelect) {
            populateStatusSelect(batch.status);
        }
        if (statusEditRow) {
            const canManageStatus = permissions.manageBatchStatus;
            statusEditRow.style.display = canManageStatus ? 'flex' : 'none';
            if (updateStatusBtn) {
                updateStatusBtn.disabled = !canManageStatus;
            }
            if (batchStatusSelect) {
                batchStatusSelect.disabled = !canManageStatus;
            }
        }

        if (segmentEditRow && permissions.manageBatchSegment) {
            segmentEditRow.style.display = 'flex';
            if (batchSegmentSelect) {
                batchSegmentSelect.value = batch.process_segment;
            }
            if (initialSegment && batchSegmentSelect && initialSegment !== batch.process_segment) {
                batchSegmentSelect.value = initialSegment;
                showNotification(`提示：批号当前工段为 ${batch.process_segment}，可根据需要调整至 ${initialSegment}。`, 'warning');
                initialSegment = null;
            }
        }

        batchInfoCard.style.display = 'block';

        if (duplicateControls) {
            const canDuplicate = permissions.duplicateBatch;
            duplicateControls.style.display = canDuplicate ? 'flex' : 'none';
            if (canDuplicate) {
                if (duplicateBatchNumberInput) {
                    duplicateBatchNumberInput.value = batch.batch_number || '';
                }
                if (duplicateProductNameInput) {
                    duplicateProductNameInput.value = batch.product_name || '';
                }
                if (duplicateCopyRecordsCheckbox) {
                    duplicateCopyRecordsCheckbox.checked = true;
                }
            }
        }
    }

    function handleDuplicateBatch() {
        if (!currentBatch) {
            showNotification('请先选择批号', 'warning');
            return;
        }

        if (!permissions.duplicateBatch) {
            showNotification('当前账号无权限执行该操作', 'error');
            return;
        }

        const newBatchNumber = duplicateBatchNumberInput ? duplicateBatchNumberInput.value.trim() : '';
        const newProductName = duplicateProductNameInput ? duplicateProductNameInput.value.trim() : '';
        const copyRecords = duplicateCopyRecordsCheckbox ? duplicateCopyRecordsCheckbox.checked : true;

        if (!newBatchNumber || !newProductName) {
            showNotification('请填写新批号和产品名称', 'warning');
            return;
        }

        if (newBatchNumber === currentBatch.batch_number && newProductName === currentBatch.product_name) {
            const proceed = confirm('新批号和产品名称与当前一致，将创建完全相同的记录，是否继续？');
            if (!proceed) {
                return;
            }
        }

        if (!duplicateBatchBtn) {
            return;
        }

        const payload = {
            batch_number: newBatchNumber,
            product_name: newProductName,
            process_segment: currentBatch.process_segment,
            copy_records: copyRecords
        };

        const originalHtml = duplicateBatchBtn.innerHTML;
        duplicateBatchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        duplicateBatchBtn.disabled = true;

        fetchJSON(`/api/batches/${currentBatch.id}/duplicate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
            .then(newBatch => {
                showNotification('批号另存成功', 'success');
                if (newBatch && newBatch.id) {
                    initialBatchId = String(newBatch.id);
                }
                loadBatches();
            })
            .catch(error => {
                console.error('另存为新批号失败:', error);
                showNotification(error.message || '另存失败，请重试', 'error');
            })
            .finally(() => {
                duplicateBatchBtn.innerHTML = originalHtml;
                duplicateBatchBtn.disabled = false;
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

    function updateBatchSegment() {
        if (!currentBatch) {
            showNotification('请先选择批号', 'warning');
            return;
        }

        if (!permissions.manageBatchSegment) {
            showNotification('当前账号无权限调整工段', 'error');
            return;
        }

        if (!batchSegmentSelect) {
            return;
        }

        const newSegment = batchSegmentSelect.value;
        if (!newSegment) {
            showNotification('请选择目标工段', 'warning');
            return;
        }

        if (newSegment === currentBatch.process_segment) {
            showNotification('当前批号已在该工段，无需调整', 'info');
            return;
        }

        if (!confirm(`确认将批号 ${currentBatch.batch_number} 调整至工段「${newSegment}」吗？`)) {
            return;
        }

        const originalText = updateSegmentBtn.innerHTML;
        updateSegmentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 更新中...';
        updateSegmentBtn.disabled = true;

        fetch(`/api/batches/${currentBatch.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ process_segment: newSegment })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                Object.assign(currentBatch, data);
                document.getElementById('selectedProcessSegment').textContent = currentBatch.process_segment;
                document.getElementById('selectedCompositeKey').textContent = `${currentBatch.batch_number}-${currentBatch.process_segment}`;
                const targetIndex = batches.findIndex(b => b.id === currentBatch.id);
                if (targetIndex !== -1) {
                    batches[targetIndex] = { ...batches[targetIndex], ...data };
                }
                updateBatchOptionLabel(currentBatch);
                loadSegmentDefinitions(currentBatch.process_segment);
                populateDeletionControls();
                showNotification('工段更新成功', 'success');
            }
        })
        .catch(error => {
            console.error('更新工段失败:', error);
            showNotification('更新工段失败，请重试', 'error');
        })
        .finally(() => {
            updateSegmentBtn.innerHTML = originalText;
            updateSegmentBtn.disabled = !permissions.manageBatchSegment;
        });
    }

    function updateBatchStatus() {
        if (!currentBatch) {
            showNotification('请先选择批号', 'warning');
            return;
        }

        if (!permissions.manageBatchStatus) {
            showNotification('当前账号无权限更新状态', 'error');
            return;
        }

        if (!batchStatusSelect || !updateStatusBtn) {
            return;
        }

        const newStatus = batchStatusSelect.value;
        if (!newStatus) {
            showNotification('请选择批号状态', 'warning');
            return;
        }

        if (newStatus === currentBatch.status) {
            showNotification('状态未发生变化', 'info');
            return;
        }

        if (!batchStatusOptions.includes(newStatus)) {
            showNotification('请选择有效的状态选项', 'error');
            return;
        }

        if (!confirm(`确认将批号 ${currentBatch.batch_number} 更新为「${newStatus}」状态吗？`)) {
            return;
        }

        const originalText = updateStatusBtn.innerHTML;
        updateStatusBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 更新中...';
        updateStatusBtn.disabled = true;
        batchStatusSelect.disabled = true;

        fetchJSON(`/api/batches/${currentBatch.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        })
            .then(updatedBatch => {
                Object.assign(currentBatch, updatedBatch);
                const targetIndex = batches.findIndex(b => b.id === currentBatch.id);
                if (targetIndex !== -1) {
                    batches[targetIndex] = { ...batches[targetIndex], ...updatedBatch };
                }
                displayBatchInfo(currentBatch);
                updateBatchOptionLabel(currentBatch);
                populateDeletionControls();
                showNotification('批号状态更新成功', 'success');
            })
            .catch(error => {
                console.error('更新批号状态失败:', error);
                showNotification(error.message || '更新状态失败，请重试', 'error');
                populateStatusSelect(currentBatch?.status);
            })
            .finally(() => {
                updateStatusBtn.innerHTML = originalText;
                const disabled = !permissions.manageBatchStatus;
                updateStatusBtn.disabled = disabled;
                batchStatusSelect.disabled = disabled;
                populateStatusSelect(currentBatch?.status);
            });
    }

    function updateBatchOptionLabel(batch) {
        if (!batchSelect) {
            return;
        }
        const option = Array.from(batchSelect.options).find(opt => String(opt.value) === String(batch.id));
        if (option) {
            option.textContent = `${batch.batch_number}-${batch.process_segment} | ${batch.product_name} (${batch.status})`;
        }
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

    function formatDateForInput(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toISOString().slice(0, 16);
    }
    
    // 清除记录表格
    function clearRecordTables() {
        document.querySelectorAll('.record-table tbody').forEach(tbody => {
            tbody.innerHTML = '';
        });
        
        document.querySelectorAll('.empty-state').forEach(empty => {
            empty.style.display = 'block';
        });

        Object.keys(materialRecordsMap).forEach(key => delete materialRecordsMap[key]);
        Object.keys(equipmentRecordsMap).forEach(key => delete equipmentRecordsMap[key]);
        Object.keys(qualityRecordsMap).forEach(key => delete qualityRecordsMap[key]);
    }

    function resetMaterialTable() {
        const tbody = document.querySelector('#materialTable tbody');
        if (tbody) {
            tbody.innerHTML = '';
        }
        const emptyState = document.getElementById('materialEmpty');
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        Object.keys(materialRecordsMap).forEach(key => delete materialRecordsMap[key]);
    }

    function resetEquipmentTable() {
        const tbody = document.querySelector('#equipmentTable tbody');
        if (tbody) {
            tbody.innerHTML = '';
        }
        const emptyState = document.getElementById('equipmentEmpty');
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        Object.keys(equipmentRecordsMap).forEach(key => delete equipmentRecordsMap[key]);
    }

    function resetQualityTable() {
        const tbody = document.querySelector('#qualityTable tbody');
        if (tbody) {
            tbody.innerHTML = '';
        }
        const emptyState = document.getElementById('qualityEmpty');
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        Object.keys(qualityRecordsMap).forEach(key => delete qualityRecordsMap[key]);
    }

    // 加载记录数据
    function loadRecordData() {
        if (!currentBatch) {
            return;
        }

        if (permissions.viewMaterials) {
            loadMaterialRecords();
        } else {
            resetMaterialTable();
        }

        if (permissions.viewEquipment) {
            loadEquipmentRecords();
        } else {
            resetEquipmentTable();
        }

        if (permissions.viewQuality) {
            loadQualityRecords();
        } else {
            resetQualityTable();
        }
    }
    
    // 加载物料记录
    function loadMaterialRecords() {
        if (!permissions.viewMaterials) {
            resetMaterialTable();
            return;
        }
        fetch(`/api/batches/${currentBatch.id}/materials`)
            .then(response => response.json().catch(() => ({})))
            .then(materials => {
                if (!Array.isArray(materials)) {
                    resetMaterialTable();
                    if (materials && materials.error) {
                        showNotification(materials.error, 'warning');
                    }
                    return;
                }
                renderMaterialTable(materials);
            })
            .catch(error => {
                console.error('加载物料记录失败:', error);
                showNotification('加载物料记录失败', 'error');
            });
    }
    
    // 渲染物料表格
    function renderMaterialTable(materials) {
        const tbody = document.querySelector('#materialTable tbody');
        const emptyState = document.getElementById('materialEmpty');

        if (materials.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tbody.innerHTML = '';
        Object.keys(materialRecordsMap).forEach(key => delete materialRecordsMap[key]);

        const canManage = permissions.manageMaterials;

        materials.forEach(material => {
            materialRecordsMap[material.id] = material;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${material.material_code}</td>
                <td>${material.material_name}</td>
                <td>${material.weight}</td>
                <td>${material.unit || '-'}</td>
                <td>${material.supplier || '-'}</td>
                <td>${material.lot_number || '-'}</td>
                <td>${formatDate(material.record_time)}</td>
                <td class="actions">
                    <button class="btn btn-primary view-detail" data-type="material" data-id="${material.id}">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${canManage ? `
                    <button class="btn btn-secondary edit-record" data-type="material" data-id="${material.id}">
                        <i class="fas fa-edit"></i>
                    </button>
                    ` : ''}
                    ${canManage ? `
                    <button class="btn btn-danger delete-record" data-type="material" data-id="${material.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
        
        // 添加查看详情事件
        tbody.querySelectorAll('.view-detail').forEach(btn => {
            btn.addEventListener('click', function() {
                viewRecordDetail(this.dataset.type, this.dataset.id);
            });
        });

        tbody.querySelectorAll('.edit-record').forEach(btn => {
            btn.addEventListener('click', function() {
                openRecordEditor(this.dataset.type, this.dataset.id);
            });
        });

        // 添加删除事件
        tbody.querySelectorAll('.delete-record').forEach(btn => {
            btn.addEventListener('click', function() {
                deleteRecord(this.dataset.type, this.dataset.id);
            });
        });
    }
    
    // 加载设备记录
    function loadEquipmentRecords() {
        if (!permissions.viewEquipment) {
            resetEquipmentTable();
            return;
        }
        fetch(`/api/batches/${currentBatch.id}/equipment`)
            .then(response => response.json().catch(() => ({})))
            .then(equipment => {
                if (!Array.isArray(equipment)) {
                    resetEquipmentTable();
                    if (equipment && equipment.error) {
                        showNotification(equipment.error, 'warning');
                    }
                    return;
                }
                renderEquipmentTable(equipment);
            })
            .catch(error => {
                console.error('加载设备记录失败:', error);
                showNotification('加载设备记录失败', 'error');
            });
    }

    function populateDeletionControls() {
        if (!deleteProductSelect || !deleteBatchSelect || !deleteSegmentSelect || !deleteStatusSelect) {
            return;
        }

        if (currentUser.role !== 'admin') {
            deletionMap = new Map();
            clearDeletionSelectors();
            return;
        }

        deletionMap = new Map();

        batches.forEach(batch => {
            const productName = batch.product_name || '';
            const batchNumber = batch.batch_number || '';
            const segmentName = batch.process_segment || '';
            const batchId = batch.id;

            if (!productName || !batchNumber || !segmentName || batchId === undefined || batchId === null) {
                return;
            }

            if (!deletionMap.has(productName)) {
                deletionMap.set(productName, new Map());
            }
            const batchMap = deletionMap.get(productName);
            if (!batchMap.has(batchNumber)) {
                batchMap.set(batchNumber, []);
            }

            const segmentList = batchMap.get(batchNumber);
            const exists = segmentList.some(item => item.segment === segmentName && item.id === batchId);
            if (!exists) {
                segmentList.push({
                    id: batchId,
                    segment: segmentName,
                    status: batch.status,
                    isLatest: batch.is_latest_segment
                });
            }
        });

        const previousProduct = deleteProductSelect?.value || '';
        const previousBatch = deleteBatchSelect?.value || '';
        const previousSegment = deleteSegmentSelect?.value || '';
        const previousStatus = deleteStatusSelect?.value || '';

        renderDeleteProductOptions(previousProduct, previousBatch, previousSegment, previousStatus);
    }

    function renderDeleteProductOptions(selectedProduct, selectedBatch, selectedSegment, selectedStatus) {
        if (!deleteProductSelect) {
            return;
        }

        const products = Array.from(deletionMap.keys()).sort((a, b) => a.localeCompare(b));
        deleteProductSelect.innerHTML = '<option value="">选择产品名称...</option>';

        products.forEach(product => {
            const option = document.createElement('option');
            option.value = product;
            option.textContent = product;
            deleteProductSelect.appendChild(option);
        });

        const targetProduct = products.includes(selectedProduct) ? selectedProduct : '';
        deleteProductSelect.value = targetProduct;

        updateDeleteBatchOptions(targetProduct, selectedBatch, selectedSegment, selectedStatus);
    }

    function updateDeleteBatchOptions(product, selectedBatch, selectedSegment, selectedStatus) {
        if (!deleteBatchSelect) {
            return;
        }

        deleteBatchSelect.innerHTML = '<option value="">选择批号...</option>';
        let batchesForProduct = [];
        if (product && deletionMap.has(product)) {
            batchesForProduct = Array.from(deletionMap.get(product).keys()).sort((a, b) => a.localeCompare(b));
            batchesForProduct.forEach(batchNumber => {
                const option = document.createElement('option');
                option.value = batchNumber;
                option.textContent = batchNumber;
                deleteBatchSelect.appendChild(option);
            });
        }

        const targetBatch = batchesForProduct.includes(selectedBatch) ? selectedBatch : '';
        deleteBatchSelect.value = targetBatch;

        updateDeleteSegmentOptions(product, targetBatch, selectedSegment, selectedStatus);
    }

    function updateDeleteSegmentOptions(product, batchNumber, selectedSegment, selectedStatus) {
        if (!deleteSegmentSelect) {
            return;
        }

        deleteSegmentSelect.innerHTML = '<option value="">选择工段...</option>';
        let segments = [];

        if (product && batchNumber && deletionMap.has(product)) {
            const batchMap = deletionMap.get(product);
            if (batchMap.has(batchNumber)) {
                segments = batchMap.get(batchNumber)
                    .slice()
                    .sort((a, b) => a.segment.localeCompare(b.segment));

                segments.forEach(item => {
                    const option = document.createElement('option');
                    option.value = item.segment;
                    const statusLabel = item.status ? `（${item.status}）` : '';
                    const latestLabel = item.isLatest ? '【当前】' : '';
                    option.textContent = `${item.segment}${statusLabel}${latestLabel}`;
                    deleteSegmentSelect.appendChild(option);
                });
            }
        }

        const segmentNames = segments.map(item => item.segment);
        const targetSegment = segmentNames.includes(selectedSegment) ? selectedSegment : '';
        deleteSegmentSelect.value = targetSegment;

        updateDeleteStatusOptions(product, batchNumber, targetSegment, selectedStatus);
    }


    function updateDeleteStatusOptions(product, batchNumber, segmentName, selectedStatus) {
        if (!deleteStatusSelect) {
            updateDeleteButtonState();
            return;
        }

        deleteStatusSelect.innerHTML = '<option value="">选择状态...</option>';
        let statuses = [];

        if (product && batchNumber && segmentName && deletionMap.has(product)) {
            const batchMap = deletionMap.get(product);
            if (batchMap.has(batchNumber)) {
                statuses = batchMap.get(batchNumber)
                    .filter(item => item.segment === segmentName && item.status)
                    .map(item => item.status);

                const uniqueStatuses = Array.from(new Set(statuses)).sort((a, b) => a.localeCompare(b));

                uniqueStatuses.forEach(status => {
                    const option = document.createElement('option');
                    option.value = status;
                    option.textContent = status;
                    deleteStatusSelect.appendChild(option);
                });

                statuses = uniqueStatuses;
            }
        }

        const targetStatus = (selectedStatus && statuses.includes(selectedStatus))
            ? selectedStatus
            : (statuses.length === 1 ? statuses[0] : '');
        deleteStatusSelect.value = targetStatus;

        updateDeleteButtonState();
    }


    function updateDeleteButtonState() {
        if (!deleteSegmentBtn || !deleteProductSelect || !deleteBatchSelect || !deleteSegmentSelect || !deleteStatusSelect) {
            return;
        }

        const ready = Boolean(
            deleteProductSelect.value &&
            deleteBatchSelect.value &&
            deleteSegmentSelect.value &&
            deleteStatusSelect.value
        );
        deleteSegmentBtn.disabled = !ready;
    }

    function clearDeletionSelectors() {
        deletionMap = new Map();
        if (deleteProductSelect) {
            deleteProductSelect.innerHTML = '<option value="">选择产品名称...</option>';
            deleteProductSelect.value = '';
        }
        if (deleteBatchSelect) {
            deleteBatchSelect.innerHTML = '<option value="">选择批号...</option>';
            deleteBatchSelect.value = '';
        }
        if (deleteSegmentSelect) {
            deleteSegmentSelect.innerHTML = '<option value="">选择工段...</option>';
            deleteSegmentSelect.value = '';
        }
        if (deleteStatusSelect) {
            deleteStatusSelect.innerHTML = '<option value="">选择状态...</option>';
            deleteStatusSelect.value = '';
        }
        updateDeleteButtonState();
    }

    function handleDeleteSegment() {
        if (!deleteProductSelect || !deleteBatchSelect || !deleteSegmentSelect || !deleteStatusSelect) {
            return;
        }

        if (currentUser.role !== 'admin') {
            showNotification('当前账号无权限删除批号记录', 'error');
            return;
        }

        const productName = deleteProductSelect.value;
        const batchNumber = deleteBatchSelect.value;
        const segmentName = deleteSegmentSelect.value;
        const statusValue = deleteStatusSelect.value;

        if (!productName || !batchNumber || !segmentName || !statusValue) {
            showNotification('请完整选择产品、批号、工段和状态', 'warning');
            return;
        }

        const batchMap = deletionMap.get(productName);
        const segmentList = batchMap?.get(batchNumber) || [];
        const targetEntry = segmentList.find(item => item.segment === segmentName && item.status === statusValue);

        if (!targetEntry) {
            showNotification('未找到匹配的批号记录或状态', 'error');
            return;
        }

        if (!confirm(`确认删除产品「${productName}」批号「${batchNumber}」工段「${segmentName}」状态「${statusValue}」的所有数据吗？`)) {
            return;
        }

        deleteSegmentBtn.disabled = true;
        deleteSegmentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 删除中...';

        const payload = {
            product_name: productName,
            batch_number: batchNumber,
            process_segment: segmentName,
            status: statusValue
        };

        fetchJSON('/api/batches/delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
            .then(result => {
                const deletedCount = Number(result?.deleted ?? 0);
                const successMessage = deletedCount > 1
                    ? `批号记录删除成功（共删除${deletedCount}条）`
                    : '批号记录删除成功';
                showNotification(successMessage, 'success');
                clearDeletionSelectors();
                loadBatches();
            })
            .catch(error => {
                console.error('删除批号记录失败:', error);
                showNotification(error.message || '删除失败，请重试', 'error');
            })
            .finally(() => {
                deleteSegmentBtn.disabled = false;
                deleteSegmentBtn.innerHTML = '<i class="fas fa-trash"></i> 删除';
            });
    }

    function expandBatchEntries(list) {
        const expanded = [];
        (list || []).forEach(batch => {
            const summaries = Array.isArray(batch.segment_summaries) ? batch.segment_summaries : [];

            if (!summaries.length) {
                expanded.push(batch);
                return;
            }

            summaries.forEach(summary => {
                const entry = {
                    ...batch,
                    id: summary.batch_id,
                    process_segment: summary.process_segment,
                    status: summary.status,
                    start_time: summary.start_time,
                    end_time: summary.end_time,
                    material_count: summary.material_count,
                    equipment_count: summary.equipment_count,
                    quality_count: summary.quality_count,
                    latest_batch_id: batch.id,
                    is_latest_segment: summary.batch_id === batch.id
                };
                expanded.push(entry);
            });
        });
        return expanded;
    }

    function sortBatches(list) {
        return [...(list || [])].sort((a, b) => {
            const productCompare = (a.product_name || '').localeCompare(b.product_name || '');
            if (productCompare !== 0) {
                return productCompare;
            }
            const batchCompare = (a.batch_number || '').localeCompare(b.batch_number || '');
            if (batchCompare !== 0) {
                return batchCompare;
            }
            return (a.process_segment || '').localeCompare(b.process_segment || '');
        });
    }

    function applyBatchFilters() {
        refreshBatchOptions({ preserveSelection: true });
    }

    function refreshBatchOptions(options = {}) {
        if (!batchSelect) {
            return;
        }

        const { initial = false, preserveSelection = false } = options;
        const previousValue = batchSelect.value;

        const productKeyword = (batchFilterProductInput?.value || '').trim().toLowerCase();
        const batchKeyword = (batchFilterKeywordInput?.value || '').trim().toLowerCase();
        const segmentFilter = batchFilterSegmentSelect?.value || '';

        filteredBatches = batches.filter(batch => {
            const productMatch = productKeyword
                ? (batch.product_name || '').toLowerCase().includes(productKeyword)
                : true;
            const batchMatch = batchKeyword
                ? (batch.batch_number || '').toLowerCase().includes(batchKeyword)
                : true;
            const segmentMatch = segmentFilter
                ? batch.process_segment === segmentFilter
                : true;
            return productMatch && batchMatch && segmentMatch;
        });

        populateBatchSelect(filteredBatches);

        let nextValue = '';
        if (initial && initialBatchId) {
            const matched = filteredBatches.find(b => String(b.id) === String(initialBatchId));
            if (matched) {
                nextValue = String(matched.id);
                initialBatchId = null;
            }
        }

        if (!nextValue && preserveSelection && previousValue && filteredBatches.some(b => String(b.id) === String(previousValue))) {
            nextValue = previousValue;
        }

        batchSelect.value = nextValue;
        const selectionChanged = nextValue !== previousValue;

        if (nextValue && (selectionChanged || initial)) {
            handleBatchSelect({ target: batchSelect }).catch(error => console.error('批号加载失败:', error));
        } else if (!nextValue && previousValue) {
            handleBatchSelect({ target: batchSelect }).catch(error => console.error('批号清空失败:', error));
        }
    }
    
    // 渲染设备表格
    function renderEquipmentTable(equipment) {
        const tbody = document.querySelector('#equipmentTable tbody');
        const emptyState = document.getElementById('equipmentEmpty');

        if (equipment.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tbody.innerHTML = '';
        Object.keys(equipmentRecordsMap).forEach(key => delete equipmentRecordsMap[key]);

        const canManage = permissions.manageEquipment;

        equipment.forEach(record => {
            equipmentRecordsMap[record.id] = record;
            // 解析参数
            let parametersText = '-';
            if (record.parameters && Object.keys(record.parameters).length > 0) {
                parametersText = Object.entries(record.parameters)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('; ');
            }

            const attachmentsHtml = (record.attachments && record.attachments.length)
                ? record.attachments.map(att => `<a href="${att.url}" target="_blank">${att.name}</a>`).join('<br>')
                : '-';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${record.equipment_code}</td>
                <td>${record.equipment_name}</td>
                <td title="${parametersText}">${truncateText(parametersText, 30)}</td>
                <td>${formatDate(record.start_time)}</td>
                <td>${record.end_time ? formatDate(record.end_time) : '-'}</td>
                <td>${record.status}</td>
                <td>${attachmentsHtml}</td>
                <td>${formatDate(record.record_time || record.start_time)}</td>
                <td class="actions">
                    <button class="btn btn-primary view-detail" data-type="equipment" data-id="${record.id}">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${canManage ? `
                    <button class="btn btn-secondary edit-record" data-type="equipment" data-id="${record.id}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-secondary upload-attachment" data-type="equipment" data-id="${record.id}">
                        <i class="fas fa-paperclip"></i>
                    </button>
                    <button class="btn btn-danger delete-record" data-type="equipment" data-id="${record.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
        
        // 添加查看详情事件
        tbody.querySelectorAll('.view-detail').forEach(btn => {
            btn.addEventListener('click', function() {
                viewRecordDetail(this.dataset.type, this.dataset.id);
            });
        });

        tbody.querySelectorAll('.edit-record').forEach(btn => {
            btn.addEventListener('click', function() {
                openRecordEditor(this.dataset.type, this.dataset.id);
            });
        });

        // 添加删除事件
        tbody.querySelectorAll('.delete-record').forEach(btn => {
            btn.addEventListener('click', function() {
                deleteRecord(this.dataset.type, this.dataset.id);
            });
        });

        tbody.querySelectorAll('.upload-attachment').forEach(btn => {
            btn.addEventListener('click', function() {
                promptRowAttachmentUpload(this.dataset.type, this.dataset.id);
            });
        });
    }
    
    // 加载品质记录
    function loadQualityRecords() {
        if (!permissions.viewQuality) {
            resetQualityTable();
            return;
        }
        fetch(`/api/batches/${currentBatch.id}/quality`)
            .then(response => response.json().catch(() => ({})))
            .then(quality => {
                if (!Array.isArray(quality)) {
                    resetQualityTable();
                    if (quality && quality.error) {
                        showNotification(quality.error, 'warning');
                    }
                    return;
                }
                renderQualityTable(quality);
            })
            .catch(error => {
                console.error('加载品质记录失败:', error);
                showNotification('加载品质记录失败', 'error');
            });
    }
    
    // 渲染品质表格
    function renderQualityTable(quality) {
        const tbody = document.querySelector('#qualityTable tbody');
        const emptyState = document.getElementById('qualityEmpty');

        if (quality.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tbody.innerHTML = '';
        Object.keys(qualityRecordsMap).forEach(key => delete qualityRecordsMap[key]);

        const canManageQuality = permissions.manageQuality;

        quality.forEach(record => {
            qualityRecordsMap[record.id] = record;
            const standardRange = record.standard_min !== null && record.standard_max !== null 
                ? `${record.standard_min} ~ ${record.standard_max}` 
                : '-';

            const attachmentsHtml = (record.attachments && record.attachments.length)
                ? record.attachments.map(att => `<a href="${att.url}" target="_blank">${att.name}</a>`).join('<br>')
                : '-';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${record.test_item}</td>
                <td>${record.test_value}</td>
                <td>${record.unit || '-'}</td>
                <td>${standardRange}</td>
                <td>${record.result || '-'}</td>
                <td>${formatDate(record.test_time)}</td>
                <td title="${record.notes || ''}">${truncateText(record.notes, 20)}</td>
                <td>${attachmentsHtml}</td>
                <td class="actions">
                    <button class="btn btn-primary view-detail" data-type="quality" data-id="${record.id}">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${canManageQuality ? `
                    <button class="btn btn-secondary edit-record" data-type="quality" data-id="${record.id}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-secondary upload-attachment" data-type="quality" data-id="${record.id}">
                        <i class="fas fa-paperclip"></i>
                    </button>
                    <button class="btn btn-danger delete-record" data-type="quality" data-id="${record.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
        
        // 添加查看详情事件
        tbody.querySelectorAll('.view-detail').forEach(btn => {
            btn.addEventListener('click', function() {
                viewRecordDetail(this.dataset.type, this.dataset.id);
            });
        });

        tbody.querySelectorAll('.edit-record').forEach(btn => {
            btn.addEventListener('click', function() {
                openRecordEditor(this.dataset.type, this.dataset.id);
            });
        });

        // 添加删除事件
        tbody.querySelectorAll('.delete-record').forEach(btn => {
            btn.addEventListener('click', function() {
                deleteRecord(this.dataset.type, this.dataset.id);
            });
        });

        tbody.querySelectorAll('.upload-attachment').forEach(btn => {
            btn.addEventListener('click', function() {
                promptRowAttachmentUpload(this.dataset.type, this.dataset.id);
            });
        });
    }
    
    // 截断文本
    function truncateText(text, maxLength) {
        if (!text) return '-';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }
    
    // 切换标签页
    function switchTab(tabName) {
        // 移除所有活动标签
        tabHeaders.forEach(header => {
            header.classList.remove('active');
        });
        
        tabPanes.forEach(pane => {
            pane.classList.remove('active');
        });
        
        const targetHeader = document.querySelector(`.tab-header[data-tab="${tabName}"]`);
        const targetPane = document.getElementById(`${tabName}Tab`);
        if (!targetHeader || !targetPane || targetHeader.style.display === 'none') {
            return;
        }

        // 激活选中标签
        targetHeader.classList.add('active');
        targetPane.classList.add('active');
    }
    
    // 显示新建批号模态框
    function showCreateBatchModal() {
        if (!permissions.createBatch) {
            showNotification('当前账号无权限创建批号', 'error');
            return;
        }
        createBatchModal.style.display = 'flex';
        createBatchForm.reset();
    }

    function setMaterialFormMode(mode, record = null) {
        addMaterialForm.dataset.mode = mode;
        addMaterialForm.dataset.recordId = record ? record.id : '';
        addMaterialForm.dataset.originalExtras = record && record.attributes ? JSON.stringify(record.attributes) : '{}';
        const text = mode === 'edit' ? '确认更新' : '确认保存';
        materialConfirmBtn.textContent = text;
        materialConfirmBtn.disabled = !permissions.manageMaterials;
    }

    function setEquipmentFormMode(mode, record = null) {
        if (!addEquipmentForm) {
            return;
        }

        const isEdit = mode === 'edit';
        addEquipmentForm.dataset.mode = mode;
        addEquipmentForm.dataset.recordId = record ? record.id : '';
        addEquipmentForm.dataset.originalParameters = record && record.parameters ? JSON.stringify(record.parameters) : '{}';
        addEquipmentForm.dataset.originalAttachments = record && Array.isArray(record.attachments)
            ? JSON.stringify(record.attachments.map(item => item.path))
            : '[]';

        if (equipmentConfirmBtn) {
            const text = isEdit ? '确认更新' : '保存设备记录';
            equipmentConfirmBtn.textContent = text;
            equipmentConfirmBtn.disabled = !permissions.manageEquipment;
        }

        const batchInput = document.getElementById('equipmentBatchId');
        if (batchInput) {
            batchInput.value = currentBatch ? currentBatch.id : '';
        }

        if (!isEdit) {
            addEquipmentForm.reset();
            if (batchInput) {
                batchInput.value = currentBatch ? currentBatch.id : '';
            }
            populateEquipmentOptions(null, {});
            populateEquipmentStatusOptions();
            const now = new Date();
            const localDateTime = now.toISOString().slice(0, 16);
            const startInput = document.getElementById('equipmentStartTime');
            if (startInput) {
                startInput.value = localDateTime;
            }
            if (equipmentAttachmentsInput) {
                equipmentAttachmentsInput.value = '';
            }
            renderSelectedAttachments(equipmentAttachmentsInput, equipmentAttachmentList);
            addEquipmentForm.dataset.originalAttachments = '[]';
            pendingAttachmentUpload = null;
            return;
        }

        populateEquipmentOptions(record.equipment_code, record.parameters || {});
        if (equipmentCodeSelect) {
            equipmentCodeSelect.value = record.equipment_code || '';
        }
        applyEquipmentDefinition(equipmentDefinitionMap.get(record.equipment_code) || null, record.parameters || {});
        if (equipmentNameInput) {
            equipmentNameInput.value = record.equipment_name || '';
        }
        const startInput = document.getElementById('equipmentStartTime');
        if (startInput) {
            startInput.value = formatDateForInput(record.start_time);
        }
        const endInput = document.getElementById('equipmentEndTime');
        if (endInput) {
            endInput.value = formatDateForInput(record.end_time);
        }
        populateEquipmentStatusOptions(record.status || equipmentStatusSelect?.value);
        if (equipmentStatusSelect && record.status) {
            equipmentStatusSelect.value = record.status;
        }
        if (equipmentAttachmentsInput) {
            equipmentAttachmentsInput.value = '';
        }
        renderSelectedAttachments(equipmentAttachmentsInput, equipmentAttachmentList);
    }

    function setQualityFormMode(mode, record = null) {
        if (!addQualityForm) {
            return;
        }

        const isEdit = mode === 'edit';
        addQualityForm.dataset.mode = mode;
        addQualityForm.dataset.recordId = record ? record.id : '';
        addQualityForm.dataset.originalExtras = record && record.attributes ? JSON.stringify(record.attributes) : '{}';
        addQualityForm.dataset.originalAttachments = record && Array.isArray(record.attachments)
            ? JSON.stringify(record.attachments.map(item => item.path))
            : '[]';

        if (qualityConfirmBtn) {
            const text = isEdit ? '确认更新' : '保存品质记录';
            qualityConfirmBtn.textContent = text;
            qualityConfirmBtn.disabled = !permissions.manageQuality;
        }

        const batchInput = document.getElementById('qualityBatchId');
        if (batchInput) {
            batchInput.value = currentBatch ? currentBatch.id : '';
        }

        if (!isEdit) {
            addQualityForm.reset();
            if (batchInput) {
                batchInput.value = currentBatch ? currentBatch.id : '';
            }
            populateQualityOptions();
            if (qualityAttachmentsInput) {
                qualityAttachmentsInput.value = '';
            }
            renderSelectedAttachments(qualityAttachmentsInput, qualityAttachmentList);
            addQualityForm.dataset.originalAttachments = '[]';
            pendingAttachmentUpload = null;
            return;
        }

        populateQualityOptions(record.test_item);
        if (qualityTestItemSelect) {
            qualityTestItemSelect.value = record.test_item || '';
        }
        applyQualityDefinition(qualityDefinitionMap.get(record.test_item) || null);
        const valueInput = document.getElementById('qualityTestValue');
        if (valueInput) {
            valueInput.value = record.test_value ?? '';
        }
        if (qualityUnitInput && record.unit) {
            qualityUnitInput.value = record.unit;
        }
        if (qualityStandardMinInput) {
            qualityStandardMinInput.value = record.standard_min ?? '';
        }
        if (qualityStandardMaxInput) {
            qualityStandardMaxInput.value = record.standard_max ?? '';
        }
        const notesInput = document.getElementById('qualityNotes');
        if (notesInput) {
            notesInput.value = record.notes || '';
        }
        if (qualityAttachmentsInput) {
            qualityAttachmentsInput.value = '';
        }
        renderSelectedAttachments(qualityAttachmentsInput, qualityAttachmentList);
    }

    // 显示添加物料记录模态框
    function showAddMaterialModal() {
        if (!permissions.manageMaterials) {
            showNotification('当前账号无权限维护物料记录', 'error');
            return;
        }
        if (!currentBatch) {
            showNotification('请先选择批号', 'warning');
            return;
        }
        
        addMaterialModal.style.display = 'flex';
        addMaterialForm.reset();
        document.getElementById('materialBatchId').value = currentBatch.id;
        populateMaterialOptions();
        materialCodeSelect && (materialCodeSelect.value = '');
        applyMaterialDefinition(null, false);
        setMaterialFormMode('create');
    }

    // 关闭所有模态框
    function closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });

        addMaterialForm.reset();
        setMaterialFormMode('create');

        addEquipmentForm.reset();
        setEquipmentFormMode('create');

        addQualityForm.reset();
        setQualityFormMode('create');
    }
    
    // 处理新建批号
    function handleCreateBatch(e) {
        e.preventDefault();
        if (!permissions.createBatch) {
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

        const existingSameNumber = batches.filter(b => b.batch_number === batchData.batch_number);
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
        
        fetch('/api/batches', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(batchData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification('批号创建成功', 'success');
                closeModals();
                loadBatches(); // 重新加载数据
                
                // 自动选择新创建的批号
                setTimeout(() => {
                    batchSelect.value = data.id;
                    handleBatchSelect({target: batchSelect});
                }, 500);
            }
        })
        .catch(error => {
            console.error('创建批号失败:', error);
            showNotification('创建批号失败，请重试', 'error');
        })
        .finally(() => {
            // 恢复按钮状态
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        });
    }
    
    // 处理添加/更新物料记录
    function handleAddMaterial(e) {
        if (e) e.preventDefault();

        if (!permissions.manageMaterials) {
            showNotification('当前账号无权限维护物料记录', 'error');
            return;
        }

        if (!currentBatch) {
            showNotification('请先选择批号', 'error');
            return;
        }

        const mode = addMaterialForm.dataset.mode || 'create';
        const recordId = addMaterialForm.dataset.recordId;
        const actionLabel = mode === 'edit' ? '更新' : '保存';

        const formData = new FormData(addMaterialForm);
        const weightValue = formData.get('materialWeight');
        const weight = weightValue ? parseFloat(weightValue) : null;

        const materialData = {
            material_code: formData.get('materialCode'),
            material_name: formData.get('materialName'),
            weight: weight,
            unit: formData.get('materialUnit') || null,
            supplier: formData.get('materialSupplier') || null,
            lot_number: formData.get('materialLotNumber') || null
        };

        if (!materialData.material_code || !materialData.material_name || weight === null || Number.isNaN(weight)) {
            showNotification('请填写所有必填字段', 'error');
            return;
        }

        if (!confirm(`确认${actionLabel}该物料记录？`)) {
            return;
        }

        let extras = {};
        if (mode === 'edit') {
            try {
                extras = JSON.parse(addMaterialForm.dataset.originalExtras || '{}');
            } catch (error) {
                extras = {};
            }
        }

        const endpoint = mode === 'edit'
            ? `/api/batches/${currentBatch.id}/materials/${recordId}`
            : `/api/batches/${currentBatch.id}/materials`;
        const method = mode === 'edit' ? 'PUT' : 'POST';

        const payload = { ...materialData };
        if (extras && Object.keys(extras).length > 0) {
            payload.extras = extras;
        }

        materialConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        materialConfirmBtn.disabled = true;

        fetch(endpoint, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification(`物料记录${actionLabel}成功`, 'success');
                closeModals();
                loadMaterialRecords();
            }
        })
        .catch(error => {
            console.error(`${actionLabel}物料记录失败:`, error);
            showNotification(`${actionLabel}物料记录失败，请重试`, 'error');
        })
        .finally(() => {
            const defaultText = (addMaterialForm.dataset.mode === 'edit') ? '确认更新' : '确认保存';
            materialConfirmBtn.textContent = defaultText;
            materialConfirmBtn.disabled = false;
        });
    }
    
    // 处理添加/更新设备记录
    function handleAddEquipment(e) {
        if (e) e.preventDefault();

        if (!permissions.manageEquipment) {
            showNotification('当前账号无权限维护设备记录', 'error');
            return;
        }

        if (!currentBatch) {
            showNotification('请先选择批号', 'error');
            return;
        }

        const mode = addEquipmentForm.dataset.mode || 'create';
        const recordId = addEquipmentForm.dataset.recordId;
        const actionLabel = mode === 'edit' ? '更新' : '保存';

        const formData = new FormData(addEquipmentForm);

        let parameters = {};
        if (mode === 'edit') {
            try {
                parameters = JSON.parse(addEquipmentForm.dataset.originalParameters || '{}');
            } catch (error) {
                parameters = {};
            }
        }

        const baseData = {
            equipment_code: formData.get('equipmentCode'),
            equipment_name: formData.get('equipmentName'),
            start_time: formData.get('equipmentStartTime'),
            end_time: formData.get('equipmentEndTime') || null,
            status: formData.get('equipmentStatus') || equipmentStatusOptions[0] || '正常运行'
        };

        if (!baseData.equipment_code || !baseData.equipment_name || !baseData.start_time) {
            showNotification('请填写所有必填字段', 'error');
            return;
        }

        const parameterInputs = addEquipmentForm.querySelectorAll('#equipmentParameters [name]');
        parameterInputs.forEach(input => {
            const key = input.name;
            const value = input.value;
            if (value === '' || value === null) {
                delete parameters[key];
            } else {
                parameters[key] = value;
            }
        });

        if (!confirm(`确认${actionLabel}该设备记录？`)) {
            return;
        }

        const endpoint = mode === 'edit'
            ? `/api/batches/${currentBatch.id}/equipment/${recordId}`
            : `/api/batches/${currentBatch.id}/equipment`;
        const method = mode === 'edit' ? 'PUT' : 'POST';

        const payload = {
            ...baseData,
            parameters: parameters
        };

        const requestBody = new FormData();
        requestBody.append('payload', JSON.stringify(payload));
        requestBody.append('existing_attachments', addEquipmentForm.dataset.originalAttachments || '[]');
        const attachmentFiles = equipmentAttachmentsInput ? Array.from(equipmentAttachmentsInput.files || []) : [];
        attachmentFiles.forEach(file => requestBody.append('attachments', file));

        equipmentConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        equipmentConfirmBtn.disabled = true;

        fetch(endpoint, {
            method,
            body: requestBody
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification(`设备记录${actionLabel}成功`, 'success');
                setEquipmentFormMode('create');
                loadEquipmentRecords();
            }
        })
        .catch(error => {
            console.error(`${actionLabel}设备记录失败:`, error);
            showNotification(`${actionLabel}设备记录失败，请重试`, 'error');
        })
        .finally(() => {
            const defaultText = (addEquipmentForm.dataset.mode === 'edit') ? '确认更新' : '保存设备记录';
            equipmentConfirmBtn.textContent = defaultText;
            equipmentConfirmBtn.disabled = false;
            if (equipmentAttachmentsInput) {
                equipmentAttachmentsInput.value = '';
            }
            renderSelectedAttachments(equipmentAttachmentsInput, equipmentAttachmentList);
        });
    }
    
    // 处理添加/更新品质记录
    function handleAddQuality(e) {
        if (e) e.preventDefault();

        if (!permissions.manageQuality) {
            showNotification('当前账号无权限维护品质记录', 'error');
            return;
        }

        if (!currentBatch) {
            showNotification('请先选择批号', 'error');
            return;
        }

        const mode = addQualityForm.dataset.mode || 'create';
        const recordId = addQualityForm.dataset.recordId;
        const actionLabel = mode === 'edit' ? '更新' : '保存';

        const formData = new FormData(addQualityForm);
        const valueRaw = formData.get('qualityTestValue');
        const standardMinRaw = formData.get('qualityStandardMin');
        const standardMaxRaw = formData.get('qualityStandardMax');

        const qualityData = {
            test_item: formData.get('qualityTestItem'),
            test_value: valueRaw ? parseFloat(valueRaw) : null,
            unit: formData.get('qualityUnit') || null,
            standard_min: standardMinRaw ? parseFloat(standardMinRaw) : null,
            standard_max: standardMaxRaw ? parseFloat(standardMaxRaw) : null,
            notes: formData.get('qualityNotes') || null
        };

        if (!qualityData.test_item || qualityData.test_value === null || Number.isNaN(qualityData.test_value)) {
            showNotification('请填写所有必填字段', 'error');
            return;
        }

        if (!confirm(`确认${actionLabel}该品质记录？`)) {
            return;
        }

        let extras = {};
        if (mode === 'edit') {
            try {
                extras = JSON.parse(addQualityForm.dataset.originalExtras || '{}');
            } catch (error) {
                extras = {};
            }
        }

        const endpoint = mode === 'edit'
            ? `/api/batches/${currentBatch.id}/quality/${recordId}`
            : `/api/batches/${currentBatch.id}/quality`;
        const method = mode === 'edit' ? 'PUT' : 'POST';

        const payload = { ...qualityData };
        if (extras && Object.keys(extras).length > 0) {
            payload.extras = extras;
        }

        const requestBody = new FormData();
        requestBody.append('payload', JSON.stringify(payload));
        requestBody.append('existing_attachments', addQualityForm.dataset.originalAttachments || '[]');
        const attachmentFiles = qualityAttachmentsInput ? Array.from(qualityAttachmentsInput.files || []) : [];
        attachmentFiles.forEach(file => requestBody.append('attachments', file));

        qualityConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        qualityConfirmBtn.disabled = true;

        fetch(endpoint, {
            method,
            body: requestBody
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification(`品质记录${actionLabel}成功`, 'success');
                setQualityFormMode('create');
                loadQualityRecords();
            }
        })
        .catch(error => {
            console.error(`${actionLabel}品质记录失败:`, error);
            showNotification(`${actionLabel}品质记录失败，请重试`, 'error');
        })
        .finally(() => {
            const defaultText = (addQualityForm.dataset.mode === 'edit') ? '确认更新' : '保存品质记录';
            qualityConfirmBtn.textContent = defaultText;
            qualityConfirmBtn.disabled = false;
            if (qualityAttachmentsInput) {
                qualityAttachmentsInput.value = '';
            }
            renderSelectedAttachments(qualityAttachmentsInput, qualityAttachmentList);
        });
    }

    function openRecordEditor(recordType, recordId) {
        const permissionMap = {
            material: permissions.manageMaterials,
            equipment: permissions.manageEquipment,
            quality: permissions.manageQuality
        };
        if (!permissionMap[recordType]) {
            showNotification('当前账号无权限编辑该记录', 'error');
            return;
        }

        const id = Number(recordId);
        switch (recordType) {
            case 'material': {
                const record = materialRecordsMap[id];
                if (!record) {
                    showNotification('未找到物料记录', 'error');
                    return;
                }
                addMaterialModal.style.display = 'flex';
                addMaterialForm.reset();
                document.getElementById('materialBatchId').value = currentBatch.id;
                populateMaterialOptions(record.material_code);
                if (materialCodeSelect) {
                    materialCodeSelect.value = record.material_code || '';
                }
                applyMaterialDefinition(materialDefinitionMap.get(record.material_code) || null, true);
                materialNameInput.value = record.material_name || materialNameInput.value || '';
                materialSupplierInput.value = record.supplier || materialSupplierInput.value || '';
                document.getElementById('materialWeight').value = record.weight ?? '';
                if (materialUnitSelect && record.unit) {
                    materialUnitSelect.value = record.unit;
                }
                document.getElementById('materialLotNumber').value = record.lot_number || '';
                setMaterialFormMode('edit', record);
                break;
            }
            case 'equipment': {
                const record = equipmentRecordsMap[id];
                if (!record) {
                    showNotification('未找到设备记录', 'error');
                    return;
                }
                setEquipmentFormMode('edit', record);
                break;
            }
            case 'quality': {
                const record = qualityRecordsMap[id];
                if (!record) {
                    showNotification('未找到品质记录', 'error');
                    return;
                }
                setQualityFormMode('edit', record);
                break;
            }
        }
    }

    function populateStatusSelect(selectedValue) {
        if (!batchStatusSelect) {
            return;
        }

        const fragment = document.createDocumentFragment();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择状态';
        fragment.appendChild(placeholder);

        batchStatusOptions.forEach(status => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = status;
            fragment.appendChild(option);
        });

        batchStatusSelect.innerHTML = '';
        batchStatusSelect.appendChild(fragment);

        const targetValue = selectedValue ?? batchStatusSelect.dataset.pendingValue ?? currentBatch?.status ?? '';
        if (targetValue) {
            batchStatusSelect.value = targetValue;
            if (batchStatusSelect.value !== targetValue) {
                batchStatusSelect.dataset.pendingValue = targetValue;
            } else {
                delete batchStatusSelect.dataset.pendingValue;
            }
        }
    }

    function populateEquipmentStatusOptions(selectedValue) {
        if (!equipmentStatusSelect) {
            return;
        }

        const fragment = document.createDocumentFragment();
        const options = [...equipmentStatusOptions];
        if (selectedValue && !options.includes(selectedValue)) {
            options.push(selectedValue);
        }

        options.forEach(status => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = status;
            fragment.appendChild(option);
        });

        equipmentStatusSelect.innerHTML = '';
        equipmentStatusSelect.appendChild(fragment);

        if (selectedValue) {
            equipmentStatusSelect.value = selectedValue;
        } else if (options.length > 0) {
            equipmentStatusSelect.value = options[0];
        }
    }

    function loadRecordFieldConfig() {
        fetchJSON('/api/config/record_fields')
            .then(config => {
                const equipmentColumns = config?.equipment?.columns || [];
                const equipmentStatusColumn = equipmentColumns.find(column => column.key === 'status');
                if (equipmentStatusColumn && Array.isArray(equipmentStatusColumn.options) && equipmentStatusColumn.options.length > 0) {
                    equipmentStatusOptions = equipmentStatusColumn.options;
                    populateEquipmentStatusOptions(equipmentStatusSelect?.value);
                }

                if (Array.isArray(config?.batch_status_options) && config.batch_status_options.length > 0) {
                    batchStatusOptions = [...config.batch_status_options];
                    if (!batchStatusOptions.includes(completedStatus)) {
                        batchStatusOptions.push(completedStatus);
                    }
                }

                populateStatusSelect(currentBatch?.status);
            })
            .catch(error => {
                console.warn('加载字段配置失败，使用默认状态配置', error);
                populateStatusSelect(currentBatch?.status);
                populateEquipmentStatusOptions(equipmentStatusSelect?.value);
            });
    }

    // 查看记录详情
    function viewRecordDetail(recordType, recordId) {
        let title = '';
        let content = '';

        const numericId = Number(recordId);

        switch(recordType) {
            case 'material': {
                const record = materialRecordsMap[numericId];
                title = '物料记录详情';
                if (record) {
                    content = `
                        <div class="detail-grid">
                            <div class="detail-item"><label>物料编码:</label><span>${record.material_code || '-'}</span></div>
                            <div class="detail-item"><label>物料名称:</label><span>${record.material_name || '-'}</span></div>
                            <div class="detail-item"><label>重量:</label><span>${record.weight ?? '-'} ${record.unit || ''}</span></div>
                            <div class="detail-item"><label>供应商:</label><span>${record.supplier || '-'}</span></div>
                            <div class="detail-item"><label>批次号:</label><span>${record.lot_number || '-'}</span></div>
                            <div class="detail-item"><label>记录时间:</label><span>${formatDate(record.record_time)}</span></div>
                        </div>`;
                } else {
                    content = '<p>未找到物料记录详情</p>';
                }
                break;
            }
            case 'equipment': {
                const record = equipmentRecordsMap[numericId];
                title = '设备记录详情';
                if (record) {
                    const parametersText = record.parameters && Object.keys(record.parameters).length > 0
                        ? Object.entries(record.parameters).map(([key, value]) => `${key}: ${value}`).join('<br>')
                        : '无';
                    content = `
                        <div class="detail-grid">
                            <div class="detail-item"><label>设备编码:</label><span>${record.equipment_code || '-'}</span></div>
                            <div class="detail-item"><label>设备名称:</label><span>${record.equipment_name || '-'}</span></div>
                            <div class="detail-item"><label>设备状态:</label><span>${record.status || '-'}</span></div>
                            <div class="detail-item"><label>开始时间:</label><span>${formatDate(record.start_time)}</span></div>
                            <div class="detail-item"><label>结束时间:</label><span>${record.end_time ? formatDate(record.end_time) : '-'}</span></div>
                            <div class="detail-item full-row"><label>运行参数:</label><span>${parametersText}</span></div>
                        </div>`;
                } else {
                    content = '<p>未找到设备记录详情</p>';
                }
                break;
            }
            case 'quality': {
                const record = qualityRecordsMap[numericId];
                title = '品质记录详情';
                if (record) {
                    const rangeText = (record.standard_min !== null && record.standard_max !== null)
                        ? `${record.standard_min} ~ ${record.standard_max}`
                        : '-';
                    content = `
                        <div class="detail-grid">
                            <div class="detail-item"><label>检测项目:</label><span>${record.test_item || '-'}</span></div>
                            <div class="detail-item"><label>检测值:</label><span>${record.test_value ?? '-'} ${record.unit || ''}</span></div>
                            <div class="detail-item"><label>标准范围:</label><span>${rangeText}</span></div>
                            <div class="detail-item"><label>结果:</label><span>${record.result || '-'}</span></div>
                            <div class="detail-item"><label>检测时间:</label><span>${formatDate(record.test_time)}</span></div>
                            <div class="detail-item full-row"><label>备注:</label><span>${record.notes || '-'}</span></div>
                        </div>`;
                } else {
                    content = '<p>未找到品质记录详情</p>';
                }
                break;
            }
            default:
                title = '记录详情';
                content = '<p>未找到对应的记录信息</p>';
        }

        document.getElementById('detailModalTitle').textContent = title;
        document.getElementById('detailModalContent').innerHTML = content;
        detailModal.style.display = 'flex';
    }
    
    // 删除记录
    function deleteRecord(recordType, recordId) {
        const manageMap = {
            material: permissions.manageMaterials,
            equipment: permissions.manageEquipment,
            quality: permissions.manageQuality
        };

        if (!manageMap[recordType]) {
            showNotification('当前账号无权限删除该记录', 'error');
            return;
        }

        if (!confirm('确定要删除这条记录吗？此操作不可恢复。')) {
            return;
        }
        
        // 根据记录类型调用不同的API
        let endpoint = '';
        switch(recordType) {
            case 'material':
                endpoint = `/api/batches/${currentBatch.id}/materials/${recordId}`;
                break;
            case 'equipment':
                endpoint = `/api/batches/${currentBatch.id}/equipment/${recordId}`;
                break;
            case 'quality':
                endpoint = `/api/batches/${currentBatch.id}/quality/${recordId}`;
                break;
        }
        
        fetch(endpoint, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.ok) {
                showNotification('记录删除成功', 'success');
                // 重新加载数据
                switch(recordType) {
                    case 'material':
                        loadMaterialRecords();
                        break;
                    case 'equipment':
                        loadEquipmentRecords();
                        break;
                    case 'quality':
                        loadQualityRecords();
                        break;
                }
            } else {
                showNotification('删除记录失败', 'error');
            }
        })
        .catch(error => {
            console.error('删除记录失败:', error);
            showNotification('删除记录失败，请重试', 'error');
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
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(additionalStyles);
});
