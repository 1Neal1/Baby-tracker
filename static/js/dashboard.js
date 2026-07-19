// Dashboard main JavaScript

// ── Global State ──────────────────────────────────────────

let currentDate = new Date();
let timerStates = {};
let timerIntervals = {};
let currentUser = null;

// ── Utility Functions ─────────────────────────────────────

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleString('zh-CN', { hour12: false });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.log(`[${type}]`, message);
        return;
    }
    toast.textContent = message;
    toast.className = `toast show toast-${type}`;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ── Auth ──────────────────────────────────────────────────

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.user && data.user.status === 'approved') {
            currentUser = data.user;
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

// ── Dashboard Data ───────────────────────────────────────

async function loadDashboard(dateStr) {
    const date = dateStr || formatDate(currentDate);
    try {
        const res = await fetch(`/api/records/today?date=${date}`);
        if (!res.ok) {
            if (res.status === 401) window.location.href = '/login';
            return;
        }
        const data = await res.json();
        updateDashboardUI(data);
        updateQuickButtons(data.quick_buttons || []);
        // 恢复计时器状态
        restoreTimerStates();
        return data;
    } catch (e) {
        console.error('加载数据失败:', e);
        showToast('加载数据失败', 'error');
    }
}

function updateDashboardUI(data) {
    // 日期显示
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        const d = new Date(data.date);
        dateEl.textContent = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    }

    // 奶量
    const feedMl = document.getElementById('feed-ml');
    if (feedMl) feedMl.textContent = data.total_feed_ml || 0;

    const feedTarget = document.getElementById('feed-target');
    if (feedTarget) feedTarget.textContent = data.target_ml || 0;

    const feedProgress = document.getElementById('feed-progress');
    if (feedProgress) {
        const pct = Math.min(100, ((data.total_feed_ml || 0) / (data.target_ml || 1)) * 100);
        feedProgress.style.width = Math.min(100, pct) + '%';
        feedProgress.textContent = Math.round(Math.min(100, pct)) + '%';
    }

    const feedCount = document.getElementById('feed-count');
    if (feedCount) feedCount.textContent = data.feed_count || 0;

    const feedsLeft = document.getElementById('feeds-left');
    if (feedsLeft) feedsLeft.textContent = data.estimated_feeds_left || 0;

    // 排泄
    const urineCount = document.getElementById('urine-count');
    if (urineCount) urineCount.textContent = data.urine_count || 0;

    const stoolCount = document.getElementById('stool-count');
    if (stoolCount) stoolCount.textContent = data.stool_count || 0;

    // 上次喂养时间
    const lastFeed = document.getElementById('last-feed');
    if (lastFeed) {
        lastFeed.textContent = data.last_feed_time ? formatDateTime(data.last_feed_time) : '暂无';
    }

    // 估算详情
    const estimateDetail = document.getElementById('estimate-detail');
    if (estimateDetail && data.estimate) {
        estimateDetail.textContent = data.estimate.calculation_detail || '';
    }

    // 最近记录
    const recentList = document.getElementById('recent-records');
    if (recentList && data.recent_records) {
        recentList.innerHTML = '';
        data.recent_records.slice(0, 5).forEach(r => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            const typeMap = { feed: '🍼', excrete: '💩', symptom: '🤒', supplement: '💊' };
            li.innerHTML = `
                <span>${typeMap[r.type] || '📝'} ${r.sub_type} ${r.amount ? r.amount + 'ml' : ''}</span>
                <small class="text-muted">${formatDateTime(r.timestamp)}</small>
            `;
            recentList.appendChild(li);
        });
        if (data.recent_records.length === 0) {
            recentList.innerHTML = '<li class="list-group-item text-muted text-center">暂无记录</li>';
        }
    }
}

// ── Quick Buttons ────────────────────────────────────────

function updateQuickButtons(buttons) {
    const container = document.getElementById('quick-buttons');
    if (!container) return;

    container.innerHTML = '';
    buttons.forEach(btn => {
        const isTimer = btn.type === 'timer' || btn.sub_type === 'timer' || btn.sub_type?.includes('timer');
        const col = document.createElement('div');
        col.className = 'col-6 col-md-3 col-lg-2 mb-2';
        
        const btnEl = document.createElement('button');
        btnEl.className = `btn w-100 py-3 quick-btn ${isTimer ? 'timer-btn' : 'btn-primary'}`;
        if (!isTimer) btnEl.className += ' btn-primary';
        btnEl.dataset.btnId = btn.id;
        btnEl.dataset.type = btn.type;
        btnEl.dataset.subType = btn.sub_type;
        btnEl.dataset.label = btn.label;
        btnEl.dataset.amount = btn.amount || 0;
        btnEl.dataset.isTimer = isTimer ? 'true' : 'false';
        btnEl.dataset.originalLabel = btn.label;

        const content = document.createElement('div');
        content.className = 'd-flex flex-column align-items-center';
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'btn-label';
        labelSpan.textContent = btn.label;
        content.appendChild(labelSpan);

        if (isTimer) {
            const timerSpan = document.createElement('span');
            timerSpan.className = 'timer-display';
            timerSpan.style.display = 'none';
            timerSpan.style.fontSize = '0.8rem';
            timerSpan.style.fontWeight = 'bold';
            timerSpan.style.background = 'rgba(0,0,0,0.1)';
            timerSpan.style.padding = '2px 8px';
            timerSpan.style.borderRadius = '4px';
            timerSpan.style.marginTop = '2px';
            content.appendChild(timerSpan);
        }

        if (btn.amount && btn.amount > 0 && !isTimer) {
            const small = document.createElement('small');
            small.className = 'text-muted';
            small.textContent = `${btn.amount}ml`;
            content.appendChild(small);
        }

        btnEl.appendChild(content);
        col.appendChild(btnEl);
        container.appendChild(col);

        if (isTimer) {
            btnEl.addEventListener('click', function(e) {
                e.preventDefault();
                handleTimerToggle(btn.id);
            });
        } else {
            btnEl.addEventListener('click', function(e) {
                e.preventDefault();
                handleQuickRecord(btn.id);
            });
        }
    });

    // 恢复计时器状态
    if (buttons.some(b => b.type === 'timer' || b.sub_type === 'timer' || b.sub_type?.includes('timer'))) {
        restoreTimerStates();
    }
}

// ── Quick Record ─────────────────────────────────────────

async function handleQuickRecord(btnId) {
    try {
        const res = await fetch(`/api/quick-record/${btnId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
                date: formatDate(currentDate)
            })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || '记录成功', 'success');
            loadDashboard(formatDate(currentDate));
        } else {
            showToast(data.error || '记录失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

// ── Timer Functions ──────────────────────────────────────

async function handleTimerToggle(btnId) {
    try {
        const res = await fetch(`/api/timer/${btnId}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok) {
            if (data.status === 'started') {
                showToast('⏱️ 计时已开始', 'info');
                // 更新按钮状态为计时中
                updateTimerButtonUI(btnId, true, 0, data.start_time);
                // 启动计时更新
                startTimerUpdate(btnId);
            } else {
                showToast(`⏱️ 计时结束: ${data.duration}秒`, 'success');
                // 重置按钮状态
                updateTimerButtonUI(btnId, false, 0);
                loadDashboard(formatDate(currentDate));
            }
        } else {
            showToast(data.error || '操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

function updateTimerButtonUI(btnId, isRunning, elapsedSeconds, startTime) {
    const btn = document.querySelector(`[data-btn-id="${btnId}"]`);
    if (!btn) return;

    const labelSpan = btn.querySelector('.btn-label');
    const timerSpan = btn.querySelector('.timer-display');

    if (isRunning) {
        btn.classList.add('timer-active');
        btn.classList.remove('btn-primary');
        btn.style.backgroundColor = '#ffc107';
        btn.style.borderColor = '#ffc107';
        btn.style.color = '#000';
        btn.style.animation = 'pulse 1.5s ease-in-out infinite';

        if (timerSpan) {
            timerSpan.style.display = 'inline';
            timerSpan.textContent = formatDuration(elapsedSeconds || 0);
        }
        if (labelSpan) {
            labelSpan.textContent = '⏱️ 计时中...';
            labelSpan.style.color = '#000';
        }
    } else {
        btn.classList.remove('timer-active');
        btn.classList.add('btn-primary');
        btn.style.backgroundColor = '';
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.style.animation = '';

        if (timerSpan) {
            timerSpan.style.display = 'none';
            timerSpan.textContent = '';
        }
        if (labelSpan) {
            labelSpan.textContent = btn.dataset.originalLabel || btn.dataset.label;
            labelSpan.style.color = '';
        }
    }
}

function startTimerUpdate(btnId) {
    // 清除已存在的更新循环
    if (timerIntervals[btnId]) {
        cancelAnimationFrame(timerIntervals[btnId]);
    }

    function update() {
        const btn = document.querySelector(`[data-btn-id="${btnId}"]`);
        if (!btn || !btn.classList.contains('timer-active')) {
            timerIntervals[btnId] = null;
            return;
        }

        const timerSpan = btn.querySelector('.timer-display');
        if (timerSpan) {
            // 从服务器获取最新状态
            fetch(`/api/timer/${btnId}/status`)
                .then(res => res.json())
                .then(data => {
                    if (data.is_running) {
                        timerSpan.textContent = formatDuration(data.elapsed_seconds || 0);
                        timerIntervals[btnId] = requestAnimationFrame(update);
                    } else {
                        // 计时已结束（可能在另一标签页）
                        updateTimerButtonUI(btnId, false, 0);
                        timerIntervals[btnId] = null;
                        loadDashboard(formatDate(currentDate));
                    }
                })
                .catch(() => {
                    timerIntervals[btnId] = requestAnimationFrame(update);
                });
        } else {
            timerIntervals[btnId] = null;
        }
    }

    timerIntervals[btnId] = requestAnimationFrame(update);
}

async function restoreTimerStates() {
    const timerBtns = document.querySelectorAll('[data-is-timer="true"]');
    for (const btn of timerBtns) {
        const btnId = parseInt(btn.dataset.btnId);
        try {
            const res = await fetch(`/api/timer/${btnId}/status`);
            const data = await res.json();
            if (data.is_running) {
                updateTimerButtonUI(btnId, true, data.elapsed_seconds || 0, data.start_time);
                startTimerUpdate(btnId);
            } else {
                updateTimerButtonUI(btnId, false, 0);
            }
        } catch (e) {
            console.error('恢复计时器状态失败:', e);
        }
    }
}

// ── Date Navigation ──────────────────────────────────────

function changeDate(delta) {
    currentDate.setDate(currentDate.getDate() + delta);
    loadDashboard(formatDate(currentDate));
}

function goToToday() {
    currentDate = new Date();
    loadDashboard(formatDate(currentDate));
}

// ── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
    // 检查登录状态
    const loggedIn = await checkAuth();
    if (!loggedIn) {
        window.location.href = '/login';
        return;
    }

    // 加载数据
    await loadDashboard(formatDate(currentDate));

    // 绑定日期导航事件
    document.getElementById('prev-day')?.addEventListener('click', () => changeDate(-1));
    document.getElementById('next-day')?.addEventListener('click', () => changeDate(1));
    document.getElementById('today-btn')?.addEventListener('click', goToToday);

    // 绑定登出事件
    document.getElementById('logout-btn')?.addEventListener('click', logout);

    // 自动刷新 - 每60秒
    setInterval(() => {
        if (formatDate(currentDate) === formatDate(new Date())) {
            loadDashboard(formatDate(currentDate));
        }
    }, 60000);

    // 页面可见时刷新计时器状态
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            restoreTimerStates();
            if (formatDate(currentDate) === formatDate(new Date())) {
                loadDashboard(formatDate(currentDate));
            }
        }
    });
});

// 添加 CSS 动画样式
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.03); }
    }
    .timer-btn.timer-active {
        background-color: #ffc107 !important;
        border-color: #ffc107 !important;
        color: #000 !important;
        animation: pulse 1.5s ease-in-out infinite;
    }
    .timer-btn.timer-active .btn-label {
        color: #000 !important;
    }
    .timer-btn .timer-display {
        font-weight: bold;
        font-size: 0.9rem;
        background: rgba(0,0,0,0.1);
        padding: 2px 8px;
        border-radius: 4px;
        margin-top: 2px;
        color: #000;
    }
    .toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        padding: 12px 24px;
        border-radius: 8px;
        background: #333;
        color: #fff;
        font-size: 14px;
        opacity: 0;
        transition: all 0.3s ease;
        z-index: 9999;
        max-width: 90%;
        pointer-events: none;
    }
    .toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
    .toast-success { background: #28a745; }
    .toast-error { background: #dc3545; }
    .toast-info { background: #17a2b8; }
    .toast-warning { background: #ffc107; color: #000; }
`;
document.head.appendChild(style);
