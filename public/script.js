let completionChartInstance = null;
let trendChartInstance = null;

async function fetchData() {
    const timeRange = document.getElementById('timeRange').value;
    let url = '/api/stats';
    
    if (timeRange !== 'all') {
        const end = new Date();
        const start = new Date();
        if (timeRange === '1day') start.setDate(start.getDate() - 1);
        if (timeRange === '1week') start.setDate(start.getDate() - 7);
        url += `?start=${start.toISOString()}&end=${end.toISOString()}`;
    }

    document.getElementById('aiText').innerHTML = 'データを分析中...';
    document.getElementById('aiText').classList.add('loading-pulse');

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.analysisText) {
            document.getElementById('aiText').innerHTML = data.analysisText.replace(/\n/g, '<br>');
        } else {
            document.getElementById('aiText').innerHTML = 'データが不足しているため分析できません。';
        }
        document.getElementById('aiText').classList.remove('loading-pulse');

        renderCompletionChart(data.statusData);
        renderTrendChart(data.actionTrends);
        renderTables(data.rescheduleRanking, data.cancelTrend);
    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('aiText').innerHTML = 'データの取得に失敗しました。';
        document.getElementById('aiText').classList.remove('loading-pulse');
    }
}

function renderCompletionChart(statusData) {
    const ctx = document.getElementById('completionChart').getContext('2d');
    
    const labels = [];
    const values = [];

    statusData.forEach(d => {
        if(d.status === 'done') labels.push('完了');
        else if(d.status === 'cancelled') labels.push('取止め');
        else if(d.status === 'scheduled') labels.push('予定済み');
        else labels.push('未予定');
        
        values.push(parseInt(d.count));
    });

    if (completionChartInstance) completionChartInstance.destroy();

    completionChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length > 0 ? labels : ['データなし'],
            datasets: [{
                data: values.length > 0 ? values : [1],
                backgroundColor: values.length > 0 ? ['#10b981', '#ef4444', '#3b82f6', '#94a3b8'] : ['#334155'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', padding: 20 } } },
            cutout: '75%',
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function renderTrendChart(trends) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    const dates = [...new Set(trends.map(t => new Date(t.date).toLocaleDateString()))].sort();
    
    const createdData = dates.map(d => {
        const record = trends.find(t => new Date(t.date).toLocaleDateString() === d && t.action_type === 'created');
        return record ? parseInt(record.count) : 0;
    });
    const doneData = dates.map(d => {
        const record = trends.find(t => new Date(t.date).toLocaleDateString() === d && t.action_type === 'done');
        return record ? parseInt(record.count) : 0;
    });

    if (trendChartInstance) trendChartInstance.destroy();

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates.length > 0 ? dates : ['今日'],
            datasets: [
                { label: '登録数', data: createdData.length > 0 ? createdData : [0], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.4, fill: true },
                { label: '完了数', data: doneData.length > 0 ? doneData : [0], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.4, fill: true }
            ]
        },
        options: {
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { labels: { color: '#cbd5e1' } } },
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function renderTables(resched, cancel) {
    const reschedTbody = document.querySelector('#reschedTable tbody');
    reschedTbody.innerHTML = resched.length === 0 ? '<tr><td colspan="2" style="text-align: center; color: #64748b;">データがありません</td></tr>' : '';
    resched.forEach(r => {
        reschedTbody.innerHTML += `<tr><td>${r.title}</td><td style="color: #ef4444; font-weight: bold;">${r.resched_count}回</td></tr>`;
    });

    const cancelTbody = document.querySelector('#cancelTable tbody');
    cancelTbody.innerHTML = cancel.length === 0 ? '<tr><td colspan="2" style="text-align: center; color: #64748b;">データがありません</td></tr>' : '';
    cancel.forEach(c => {
        cancelTbody.innerHTML += `<tr><td>${c.hour}時台</td><td style="color: #ef4444; font-weight: bold;">${c.count}回</td></tr>`;
    });
}

document.getElementById('refreshBtn').addEventListener('click', fetchData);
document.getElementById('timeRange').addEventListener('change', fetchData);

// Canvas height setup for charts
document.getElementById('completionChart').parentElement.style.height = '300px';
document.getElementById('trendChart').parentElement.style.height = '300px';

fetchData();
