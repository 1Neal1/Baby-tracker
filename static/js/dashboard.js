// ── Dashboard (总览) ────────────────────────────────────────
let dashboardData = null;
let timerIntervals = {}; // 存储计时器 interval ID
let timerStartTimes = {}; // 存储开始时间戳

// 计时器状态键名
const TIMER_KEY_PREFIX = 'baby_tracker_timer_';

function getTimerKey(btnId) {
    return `${TIMER_KEY_PREFIX}${btnId}`;
}

function getTimerState(btnId) {
    const key = getTimerKey(btnId);
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

function setTimerState(btnId, state) {
    const key = getTimerKey(btnId);
    if (state) {
        sessionStorage.setItem(key, JSON.stringify(state));
    } else {
        sessionStorage.removeItem(key);
    }
}

async function initDashboard() {
    const dateEl = document.getElementById('today-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
        });
    }
    await refreshDashboard();
    // 页面加载后恢复计时器状态
    restoreTimerStates();
}

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshDashboard();
            // 恢复计时器显示
            restoreTimerStates();
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
        restoreTimerStates();
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
        const timerState = isBreastBtn ? getTimerState(btn.id) : null;
        let btnLabel = esc(btn.label);
        if (isBreastBtn && timerState && timerState.isRunning) {
            // 计时中显示"停止计时"
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

// ── 母乳按钮计时器逻辑 ──────────────────────────────────────

function handleBreastButtonClick(btnId, label) {
    const timerState = getTimerState(btnId);
    
    if (timerState && timerState.isRunning) {
        // 停止计时 → 结束记录
        stopTimerAndRecord(btnId, label);
    } else {
        // 开始计时
        startTimer(btnId, label);
    }
}

function startTimer(btnId, label) {
    const startTime = Date.now();
    const state = {
        isRunning: true,
        startTime: startTime,
        label: label,
        btnId: btnId
    };
    setTimerState(btnId, state);
    timerStartTimes[btnId] = startTime;
    
    // 更新按钮文字
    updateBreastButtonLabel(btnId, '⏱ 停止');
    
    // 更新最近记录中的显示
    updateRecentRecordTimerDisplay(btnId, label, startTime);
    
    // 启动计时器更新
    if (timerIntervals[btnId]) {
        clearInterval(timerIntervals[btnId]);
    }
    timerIntervals[btnId] = setInterval(() => {
        updateRecentRecordTimerDisplay(btnId, label, startTime);
    }, 1000);
    
    showToast(`${label} 开始计时`);
}

function stopTimerAndRecord(btnId, label) {
    // 清除计时器
    if (timerIntervals[btnId]) {
        clearInterval(timerIntervals[btnId]);
        delete timerIntervals[btnId];
    }
    
    const state = getTimerState(btnId);
    if (!state) return;
    
    const startTime = state.startTime;
    const endTime = Date.now();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);
    
    // 移除计时状态
    setTimerState(btnId, null);
    delete timerStartTimes[btnId];
    
    // 恢复按钮文字
    updateBreastButtonLabel(btnId, label);
    
    // 如果时长小于10秒，提示并取消记录
    if (durationSeconds < 10) {
        showToast('计时太短（少于10秒），已取消记录');
        clearTimerDisplayFromRecent(btnId);
        return;
    }
    
    // 构建记录数据
    const startDate = new Date(startTime);
    const timestamp = formatDateTimeForAPI(startDate);
    
    const btnInfo = findButtonInfo(btnId);
    if (!btnInfo) {
        showToast('按钮信息未找到');
        return;
    }
    
    // 提交记录 - duration 存储总秒数
    submitBreastRecord(btnId, label, btnInfo, timestamp, durationSeconds, startDate)
        .then(() => {
            const mins = Math.floor(durationSeconds / 60);
            const secs = durationSeconds % 60;
            let timeStr = '';
            if (mins > 0 && secs > 0) {
                timeStr = `${mins}分钟${secs}秒`;
            } else if (mins > 0) {
                timeStr = `${mins}分钟`;
            } else {
                timeStr = `${secs}秒`;
            }
            showToast(`${label} - 记录成功 (${timeStr})`);
            clearTimerDisplayFromRecent(btnId);
            refreshDashboard();
        })
        .catch(err => {
            showToast(err.message || '记录失败');
            clearTimerDisplayFromRecent(btnId);
        });
}

function findButtonInfo(btnId) {
    if (!dashboardData || !dashboardData.quick_buttons) return null;
    return dashboardData.quick_buttons.find(b => b.id === btnId) || null;
}

async function submitBreastRecord(btnId, label, btnInfo, timestamp, durationSeconds, startDate) {
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

function formatDateTimeForAPI(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateBreastButtonLabel(btnId, label) {
    const btn = document.querySelector(`.quick-btn[data-btn-id="${btnId}"]`);
    if (btn) {
        const span = btn.querySelector('span.text-text-secondary');
        if (span) span.textContent = label;
    }
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

function updateRecentRecordTimerDisplay(btnId, label, startTime) {
    // 在最近记录中找到对应的条目并更新显示
    const container = document.getElementById('recent-records');
    if (!container) return;
    
    // 查找是否有对应的计时条目（通过 data-timer-btn-id 属性）
    let timerEntry = container.querySelector(`[data-timer-btn-id="${btnId}"]`);
    
    if (!timerEntry) {
        // 创建新的计时条目
        timerEntry = createTimerEntry(btnId, label);
        if (timerEntry) {
            // 插入到列表最前面
            container.insertBefore(timerEntry, container.firstChild);
        }
    }
    
    if (timerEntry) {
        // 更新计时显示 - XX分钟XX秒 格式
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const timeDisplay = timerEntry.querySelector('.timer-display');
        if (timeDisplay) {
            timeDisplay.textContent = formatDurationToChinese(elapsed);
        }
        
        // 确保显示开始时间
        const startDisplay = timerEntry.querySelector('.timer-start-time');
        if (startDisplay) {
            const startDate = new Date(startTime);
            startDisplay.textContent = formatTime(startDate.toISOString());
        }
    }
}

function createTimerEntry(btnId, label) {
    // 复制最近记录条目的模板
    const template = document.querySelector('#recent-records .card');
    if (!template) return null;
    
    const clone = template.cloneNode(true);
    clone.dataset.timerBtnId = btnId;
    
    // 修改图标为计时器图标
    const iconContainer = clone.querySelector('.w-8.h-8');
    if (iconContainer) {
        iconContainer.className = 'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-amber-500/10';
        const icon = iconContainer.querySelector('i');
        if (icon) {
            icon.className = 'w-4 h-4 text-amber-400';
            icon.dataset.lucide = 'clock';
        }
    }
    
    // 修改标签
    const labelSpan = clone.querySelector('.text-sm.text-text-primary');
    if (labelSpan) {
        labelSpan.textContent = `⏱ ${label}`;
    }
    
    // 修改详情
    const detailP = clone.querySelector('.text-xs.text-text-muted');
    if (detailP) {
        const startDate = new Date();
        const timeStr = formatTime(startDate.toISOString());
        detailP.innerHTML = `开始: <span class="timer-start-time">${timeStr}</span> · 已计时: <span class="timer-display text-amber-400 font-mono">0秒</span>`;
    }
    
    // 移除编辑和删除按钮
    const actionBtns = clone.querySelectorAll('.flex.items-center.gap-1.flex-shrink-0 button');
    actionBtns.forEach(btn => btn.remove());
    
    // 添加停止按钮
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
    
    // 重新生成图标
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

function restoreTimerStates() {
    // 恢复所有正在运行的计时器
    const keys = Object.keys(sessionStorage);
    for (const key of keys) {
        if (key.startsWith(TIMER_KEY_PREFIX)) {
            try {
                const state = JSON.parse(sessionStorage.getItem(key));
                if (state && state.isRunning) {
                    const btnId = state.btnId;
                    const label = state.label;
                    const startTime = state.startTime;
                    
                    // 检查是否超时（超过2小时自动结束）
                    if (Date.now() - startTime > 2 * 60 * 60 * 1000) {
                        setTimerState(btnId, null);
                        updateBreastButtonLabel(btnId, label);
                        continue;
                    }
                    
                    // 恢复计时器
                    timerStartTimes[btnId] = startTime;
                    if (timerIntervals[btnId]) {
                        clearInterval(timerIntervals[btnId]);
                    }
                    timerIntervals[btnId] = setInterval(() => {
                        updateRecentRecordTimerDisplay(btnId, label, startTime);
                    }, 1000);
                    
                    // 更新按钮文字
                    updateBreastButtonLabel(btnId, '⏱ 停止');
                    
                    // 更新显示
                    updateRecentRecordTimerDisplay(btnId, label, startTime);
                }
            } catch (e) {
                console.error('恢复计时器状态失败:', e);
            }
        }
    }
}

// ── 原有快速记录函数 ────────────────────────────────────────

async function quickRecord(btnId, label) {
    try {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const data = await api(`/api/quick-record/${btnId}`, { method: 'POST', body: JSON.stringify({ timestamp, date: getLocalDate() }) });
        showToast(`${label} - 记录成功`);
        // API 直接返回更新后的概览数据，无需二次请求
        dashboardData = data;
        renderDashboard(data);
        // 恢复计时器状态
        restoreTimerStates();
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
    // 编辑后 API 直接返回概览数据，无需二次 GET 请求
    if (data && data.total_feed_ml !== undefined) {
        dashboardData = data;
        renderDashboard(data);
        restoreTimerStates();
    } else {
        // 兜底：如果返回数据不包含概览，则重新请求
        refreshDashboard();
    }
}

async function deleteDashboardRecord(id) {
    if (!await showConfirm('确定删除此记录？', { confirmText: '删除', danger: true })) return;
    try {
        const data = await api(`/api/records/${id}?date=${getLocalDate()}`, { method: 'DELETE' });
        showToast('已删除');
        // 删除后 API 直接返回概览数据，无需二次 GET 请求
        if (data && data.total_feed_ml !== undefined) {
            dashboardData = data;
            renderDashboard(data);
            restoreTimerStates();
        } else {
            await refreshDashboard();
        }
    } catch (e) {
        showToast(e.message || '删除失败');
    }
}
