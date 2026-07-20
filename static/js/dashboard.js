// ── Dashboard (总览) ────────────────────────────────────────
let dashboardData = null;
let timerIntervals = {}; // 存储计时器 interval ID
let timerStartTimes = {}; // 存储客户端开始时间戳（用于计算本地偏移）
let timerServerStartTimes = {}; // 存储服务器开始时间戳（用于显示校准）
let isInitialized = false;

// 计时器状态键名（仅用于本地缓存，主数据在服务器）
const TIMER_CACHE_PREFIX = 'baby_tracker_timer_cache_';

function getTimerCacheKey(btnId) {
    return `${TIMER_CACHE_PREFIX}${btnId}`;
}

function getCachedTimerState(btnId) {
    const key = getTimerCacheKey(btnId);
    const stored = sessionStorage.getItem(key);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            return null;
        }
    }
    return null;
}

function setCachedTimerState(btnId, state) {
    const key = getTimerCacheKey(btnId);
    if (state) {
        sessionStorage.setItem(key, JSON.stringify(state));
    } else {
        sessionStorage.removeItem(key);
    }
}

// ── 服务器端计时器 API ──────────────────────────────────────

async function serverTimerStart(btnId, label) {
    return await api('/api/timer/start', {
        method: 'POST',
        body: JSON.stringify({ btn_id: btnId, label: label })
    });
}

async function serverTimerStop(btnId) {
    return await api('/api/timer/stop', {
        method: 'POST',
        body: JSON.stringify({ btn_id: btnId })
    });
}

async function serverTimerClear(btnId) {
    return await api('/api/timer/clear', {
        method: 'POST',
        body: JSON.stringify({ btn_id: btnId })
    });
}

async function serverGetTimerState(btnId) {
    return await api(`/api/timer/state/${btnId}`);
}

async function serverGetAllTimerStates() {
    return await api('/api/timer/all');
}

// ── 初始化 ──────────────────────────────────────────────────

async function initDashboard() {
    const dateEl = document.getElementById('today-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
        });
    }
    await refreshDashboard();
    // 页面加载后从服务器恢复计时器状态
    await restoreTimerStatesFromServer();
    isInitialized = true;
}

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshDashboard();
            // 恢复计时器显示
            restoreTimerStatesFromServer();
        }
    });
});

// 手动刷新（带旋转动画）
async function refreshDashboard() {
    try {
        const data = await api(`/api/records/today?date=${getLocalDate()}`);
        dashboardData = data;
        renderDashboard(data);
        // 刷新后重新应用计时器状态到最近记录
        if (isInitialized) {
            await restoreTimerStatesFromServer();
        }
    } catch (e) {
        console.error('刷新失败:', e);
    }
}

function renderDashboard(data) {
    // 奶量进度环
    document.getElementById('milk-consumed').textContent = data.total_feed_ml;
    document.getElementById('milk-target').textContent = data.target_ml;
    document.getElementById('milk-remaining').textContent = data.remaining_ml;

    const ring = document.getElementById('milk-ring');
    if (ring) setProgressRing(ring, data.feed_progress);

    if (data.estimate) {
        document.getElementById('estimate-detail').textContent = data.estimate.calculation_detail;
    }

    // 喂养次数
    document.getElementById('feed-count').textContent = data.feed_count;
    document.getElementById('feed-total').textContent = data.estimated_feeds_per_day;
    document.getElementById('feed-progress-bar').style.width = (data.feed_progress * 100) + '%';
    document.getElementById('feeds-left').textContent = data.estimated_feeds_left;

    // 排泄
    document.getElementById('urine-count').textContent = data.urine_count;
    document.getElementById('stool-count').textContent = data.stool_count;

    // 上次喂养
    document.getElementById('last-feed-time').textContent = data.last_feed_time ? formatTime(data.last_feed_time) : '暂无记录';

    // 快速记录按钮（仅首次渲染）
    const btnContainer = document.getElementById('quick-buttons');
    if (btnContainer && data.quick_buttons) {
        renderQuickButtons(data.quick_buttons);
    }

    // 最近记录
    renderRecentRecords(data.recent_records);
}

function renderQuickButtons(buttons) {
    const container = document.getElementById('quick-buttons');
    if (!container) return;

    const typeIcons = { feed: 'droplets', excrete: 'circle-dot', symptom: 'heart-pulse', supplement: 'pill' };
    const typeColors = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };
    const typeBorders = { feed: 'border-blue-500/20', excrete: 'border-amber-500/20', symptom: 'border-red-500/20', supplement: 'border-purple-500/20' };

    let html = '';
    for (const btn of buttons) {
        // 检查是否为母乳左右按钮（根据 label 判断）
        const isBreastBtn = btn.label === '母乳(左)' || btn.label === '母乳(右)';
        const cachedState = isBreastBtn ? getCachedTimerState(btn.id) : null;
        let btnLabel = esc(btn.label);
        if (isBreastBtn && cachedState && cachedState.isRunning) {
            btnLabel = '⏱ 停止';
        }
        html += `
        <button class="quick-btn flex flex-col items-center gap-1 p-3 rounded-xl border ${typeBorders[btn.type]} bg-surface hover:bg-white/5 active:scale-95 transition-all duration-150 cursor-pointer"
                data-btn-id="${btn.id}" data-btn-label="${esc(btn.label)}" data-is-breast="${isBreastBtn ? 'true' : 'false'}">
            <i data-lucide="${typeIcons[btn.type]}" class="w-5 h-5 ${typeColors[btn.type]}"></i>
            <span class="text-xs text-text-secondary">${btnLabel}</span>
        </button>`;
    }
    container.innerHTML = html;

    // 事件委托只绑定一次
    if (!container.dataset.delegateBound) {
        container.addEventListener('click', e => {
            const btn = e.target.closest('.quick-btn');
            if (!btn) return;
            const btnId = parseInt(btn.dataset.btnId);
            const label = btn.dataset.btnLabel;
            const isBreast = btn.dataset.isBreast === 'true';
            
            if (isBreast) {
                handleBreastButtonClick(btnId, label);
            } else {
                quickRecord(btnId, label);
            }
        });
        container.dataset.delegateBound = 'true';
    }

    lucide.createIcons();
}

// ── 母乳按钮计时器逻辑（基于服务器） ──────────────────────

async function handleBreastButtonClick(btnId, label) {
    try {
        // 先从服务器获取最新状态
        const state = await serverGetTimerState(btnId);
        
        if (state && state.is_running) {
            // 停止计时 → 结束记录
            await stopTimerAndRecord(btnId, label);
        } else {
            // 开始计时
            await startTimer(btnId, label);
        }
    } catch (e) {
        showToast(e.message || '操作失败，请重试');
    }
}

async function startTimer(btnId, label) {
    try {
        const result = await serverTimerStart(btnId, label);
        const serverStartTime = result.start_time; // 服务器时间（秒）
        const clientStartTime = Date.now(); // 客户端当前时间（毫秒）
        
        // 更新本地缓存 - 存储客户端时间用于计算
        setCachedTimerState(btnId, {
            isRunning: true,
            clientStartTime: clientStartTime,
            serverStartTime: serverStartTime,
            label: label,
            btnId: btnId
        });
        timerStartTimes[btnId] = clientStartTime;
        timerServerStartTimes[btnId] = serverStartTime;
        
        // 更新按钮文字
        updateBreastButtonLabel(btnId, '⏱ 停止');
        
        // 更新最近记录中的显示
        updateRecentRecordTimerDisplay(btnId, label, clientStartTime);
        
        // 启动计时器更新
        if (timerIntervals[btnId]) {
            clearInterval(timerIntervals[btnId]);
        }
        timerIntervals[btnId] = setInterval(() => {
            const cached = getCachedTimerState(btnId);
            if (cached && cached.isRunning) {
                // 使用客户端开始时间计算
                updateRecentRecordTimerDisplay(btnId, label, cached.clientStartTime);
            }
        }, 1000);
        
        showToast(`${label} 开始计时`);
    } catch (e) {
        showToast(e.message || '开始计时失败');
    }
}

async function stopTimerAndRecord(btnId, label) {
    // 清除本地计时器
    if (timerIntervals[btnId]) {
        clearInterval(timerIntervals[btnId]);
        delete timerIntervals[btnId];
    }
    
    try {
        // 从服务器停止计时并获取时长
        const result = await serverTimerStop(btnId);
        const durationSeconds = result.duration_seconds;
        // 使用服务器返回的 start_time 记录开始时间
        const serverStartTime = result.start_time;
        
        // 清除本地缓存
        setCachedTimerState(btnId, null);
        delete timerStartTimes[btnId];
        delete timerServerStartTimes[btnId];
        
        // 恢复按钮文字
        updateBreastButtonLabel(btnId, label);
        
        // 如果时长小于10秒，提示并取消记录
        if (durationSeconds < 10) {
            showToast('计时太短（少于10秒），已取消记录');
            clearTimerDisplayFromRecent(btnId);
            return;
        }
        
        // 构建记录数据 - 使用服务器时间
        const startDate = new Date(serverStartTime * 1000);
        const timestamp = formatDateTimeForAPI(startDate);
        
        const btnInfo = findButtonInfo(btnId);
        if (!btnInfo) {
            showToast('按钮信息未找到');
            return;
        }
        
        // 提交记录
        await submitBreastRecord(btnId, label, btnInfo, timestamp, durationSeconds);
        
        const timeStr = formatDurationToChinese(durationSeconds);
        showToast(`${label} - 记录成功 (${timeStr})`);
        clearTimerDisplayFromRecent(btnId);
        await refreshDashboard();
        
    } catch (e) {
        showToast(e.message || '停止计时失败');
        // 如果失败，尝试清除本地状态
        clearTimerDisplayFromRecent(btnId);
        setCachedTimerState(btnId, null);
        updateBreastButtonLabel(btnId, label);
    }
}

async function submitBreastRecord(btnId, label, btnInfo, timestamp, durationSeconds) {
    const recordData = {
        type: btnInfo.type,
        sub_type: btnInfo.sub_type,
        amount: btnInfo.amount || 0,
        duration: durationSeconds,
        timestamp: timestamp,
        _date: getLocalDate()
    };
    
    return await api('/api/records', {
        method: 'POST',
        body: JSON.stringify(recordData)
    });
}

function findButtonInfo(btnId) {
    if (!dashboardData || !dashboardData.quick_buttons) return null;
    return dashboardData.quick_buttons.find(b => b.id === btnId) || null;
}

function formatDateTimeForAPI(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDurationToChinese(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) {
        return `${mins}分钟${secs}秒`;
    } else if (mins > 0) {
        return `${mins}分钟`;
    } else {
        return `${secs}秒`;
    }
}

function updateBreastButtonLabel(btnId, label) {
    const btn = document.querySelector(`.quick-btn[data-btn-id="${btnId}"]`);
    if (btn) {
        const span = btn.querySelector('span.text-text-secondary');
        if (span) span.textContent = label;
    }
}

function updateRecentRecordTimerDisplay(btnId, label, clientStartTime) {
    const container = document.getElementById('recent-records');
    if (!container) return;
    
    let timerEntry = container.querySelector(`[data-timer-btn-id="${btnId}"]`);
    
    if (!timerEntry) {
        timerEntry = createTimerEntry(btnId, label);
        if (timerEntry) {
            container.insertBefore(timerEntry, container.firstChild);
        }
    }
    
    if (timerEntry) {
        // 使用客户端开始时间计算经过时长（避免服务器时间差问题）
        const elapsed = Math.max(0, Math.floor((Date.now() - clientStartTime) / 1000));
        const timeDisplay = timerEntry.querySelector('.timer-display');
        if (timeDisplay) {
            timeDisplay.textContent = formatDurationToChinese(elapsed);
        }
        
        const startDisplay = timerEntry.querySelector('.timer-start-time');
        if (startDisplay) {
            // 使用服务器时间显示开始时间（更准确）
            const cached = getCachedTimerState(btnId);
            if (cached && cached.serverStartTime) {
                const startDate = new Date(cached.serverStartTime * 1000);
                startDisplay.textContent = formatTime(startDate.toISOString());
            } else {
                const startDate = new Date(clientStartTime);
                startDisplay.textContent = formatTime(startDate.toISOString());
            }
        }
    }
}

function createTimerEntry(btnId, label) {
    const template = document.querySelector('#recent-records .card');
    if (!template) return null;
    
    const clone = template.cloneNode(true);
    clone.dataset.timerBtnId = btnId;
    
    const iconContainer = clone.querySelector('.w-8.h-8');
    if (iconContainer) {
        iconContainer.className = 'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-amber-500/10';
        const icon = iconContainer.querySelector('i');
        if (icon) {
            icon.className = 'w-4 h-4 text-amber-400';
            icon.dataset.lucide = 'clock';
        }
    }
    
    const labelSpan = clone.querySelector('.text-sm.text-text-primary');
    if (labelSpan) {
        labelSpan.textContent = `⏱ ${label}`;
    }
    
    const detailP = clone.querySelector('.text-xs.text-text-muted');
    if (detailP) {
        const startDate = new Date();
        const timeStr = formatTime(startDate.toISOString());
        detailP.innerHTML = `开始: <span class="timer-start-time">${timeStr}</span> · 已计时: <span class="timer-display text-amber-400 font-mono">0秒</span>`;
    }
    
    const actionBtns = clone.querySelectorAll('.flex.items-center.gap-1.flex-shrink-0 button');
    actionBtns.forEach(btn => btn.remove());
    
    const actionContainer = clone.querySelector('.flex.items-center.gap-1.flex-shrink-0');
    if (actionContainer) {
        const stopBtn = document.createElement('button');
        stopBtn.className = 'text-red-400 hover:text-red-500 transition-colors p-1';
        stopBtn.title = '停止计时并记录';
        stopBtn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5"></i>';
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleBreastButtonClick(btnId, label);
        });
        actionContainer.appendChild(stopBtn);
    }
    
    lucide.createIcons();
    return clone;
}

function clearTimerDisplayFromRecent(btnId) {
    const container = document.getElementById('recent-records');
    if (!container) return;
    const entry = container.querySelector(`[data-timer-btn-id="${btnId}"]`);
    if (entry) {
        entry.remove();
    }
}

// ── 从服务器恢复计时状态 ────────────────────────────────────

async function restoreTimerStatesFromServer() {
    try {
        const allStates = await serverGetAllTimerStates();
        const breastButtons = document.querySelectorAll('.quick-btn[data-is-breast="true"]');
        
        for (const btn of breastButtons) {
            const btnId = parseInt(btn.dataset.btnId);
            const label = btn.dataset.btnLabel;
            const state = allStates[String(btnId)];
            
            if (state && state.is_running) {
                const serverStartTime = state.start_time; // 服务器时间（秒）
                const clientNow = Date.now();
                // 计算服务器已运行时间
                const serverElapsed = Math.floor(clientNow / 1000) - serverStartTime;
                
                // 检查是否超时（超过2小时自动结束）
                if (serverElapsed > 2 * 60 * 60) {
                    await serverTimerClear(btnId);
                    setCachedTimerState(btnId, null);
                    updateBreastButtonLabel(btnId, label);
                    continue;
                }
                
                // 使用客户端当前时间作为开始时间的基准
                // 通过服务器已运行时间反推客户端开始时间
                const clientStartTime = clientNow - (serverElapsed * 1000);
                
                // 恢复状态
                setCachedTimerState(btnId, {
                    isRunning: true,
                    clientStartTime: clientStartTime,
                    serverStartTime: serverStartTime,
                    label: label,
                    btnId: btnId
                });
                timerStartTimes[btnId] = clientStartTime;
                timerServerStartTimes[btnId] = serverStartTime;
                
                // 更新按钮文字
                updateBreastButtonLabel(btnId, '⏱ 停止');
                
                // 启动计时器
                if (timerIntervals[btnId]) {
                    clearInterval(timerIntervals[btnId]);
                }
                timerIntervals[btnId] = setInterval(() => {
                    const cached = getCachedTimerState(btnId);
                    if (cached && cached.isRunning) {
                        updateRecentRecordTimerDisplay(btnId, label, cached.clientStartTime);
                    }
                }, 1000);
                
                // 更新显示
                updateRecentRecordTimerDisplay(btnId, label, clientStartTime);
            } else {
                // 清除本地状态
                const cached = getCachedTimerState(btnId);
                if (cached && cached.isRunning) {
                    setCachedTimerState(btnId, null);
                    updateBreastButtonLabel(btnId, label);
                    clearTimerDisplayFromRecent(btnId);
                }
            }
        }
    } catch (e) {
        console.error('恢复计时状态失败:', e);
    }
}

// ── 原有快速记录函数 ────────────────────────────────────────

async function quickRecord(btnId, label) {
    try {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const data = await api(`/api/quick-record/${btnId}`, { method: 'POST', body: JSON.stringify({ timestamp, date: getLocalDate() }) });
        showToast(`${label} - 记录成功`);
        dashboardData = data;
        renderDashboard(data);
        await restoreTimerStatesFromServer();
    } catch (e) {
        showToast(e.message);
    }
}

function renderRecentRecords(records) {
    const container = document.getElementById('recent-records');
    if (!records || records.length === 0) {
        container.innerHTML = `<div class="card text-center text-text-muted text-sm py-8"><p>暂无记录</p></div>`;
        return;
    }

    container.innerHTML = records.map(r => {
        const badgeMap = { feed: 'badge-feed', excrete: 'badge-excrete', symptom: 'badge-symptom', supplement: 'badge-supplement' };
        const typeClass = badgeMap[r.type] || 'badge-symptom';
        const bgMap = { feed: 'bg-blue-500/10', excrete: 'bg-amber-500/10', symptom: 'bg-red-500/10', supplement: 'bg-purple-500/10' };
        const iconMap = { feed: 'droplets', excrete: 'circle-dot', symptom: 'heart-pulse', supplement: 'pill' };
        const colorMap = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };
        const detail = buildRecordDetail(r);

        return `
        <div class="card flex items-center gap-3 py-3 px-4 fade-in">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bgMap[r.type] || bgMap.symptom}">
                <i data-lucide="${iconMap[r.type] || iconMap.symptom}" class="w-4 h-4 ${colorMap[r.type] || colorMap.symptom}"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-text-primary">${esc(typeLabel(r.type, r.sub_type))}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded border ${typeClass}">${TYPE_LABELS[r.type]}</span>
                </div>
                <p class="text-xs text-text-muted mt-0.5">${esc(detail)}</p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <span class="font-mono text-xs text-text-muted">${formatTime(r.timestamp)}</span>
                <button class="text-text-muted hover:text-amber-400 transition-colors p-1" onclick="openEditModal(${r.id}, onDashboardEditSaved)" title="编辑">
                    <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                </button>
                <button class="text-text-muted hover:text-red-400 transition-colors p-1" onclick="deleteDashboardRecord(${r.id})" title="删除">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    lucide.createIcons();
}

function buildRecordDetail(r) {
    const parts = [];
    if (r.amount) parts.push(`${r.amount}ml`);
    if (r.duration) {
        parts.push(formatDurationToChinese(r.duration));
    }
    if (r.temperature) parts.push(`${r.temperature}°C`);
    if (r.color) parts.push(r.color);
    if (r.consistency) parts.push(r.consistency);
    if (r.note) parts.push(r.note);
    return parts.join(' · ') || '--';
}

function onDashboardEditSaved(data) {
    if (data && data.total_feed_ml !== undefined) {
        dashboardData = data;
        renderDashboard(data);
        restoreTimerStatesFromServer();
    } else {
        refreshDashboard();
    }
}

async function deleteDashboardRecord(id) {
    if (!await showConfirm('确定删除此记录？', { confirmText: '删除', danger: true })) return;
    try {
        const data = await api(`/api/records/${id}?date=${getLocalDate()}`, { method: 'DELETE' });
        showToast('已删除');
        if (data && data.total_feed_ml !== undefined) {
            dashboardData = data;
            renderDashboard(data);
            await restoreTimerStatesFromServer();
        } else {
            await refreshDashboard();
        }
    } catch (e) {
        showToast(e.message || '删除失败');
    }
}
