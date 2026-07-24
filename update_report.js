// update_report.js - 从 WPS 数据自动更新 HTML 报表
const fs = require('fs');

// 读取 WPS webhook 返回的数据
const resp = JSON.parse(fs.readFileSync('wps_response.json', 'utf-8'));
const dataStr = resp.data.result;
const records = JSON.parse(dataStr);

// 供应商名称映射 (WPS表格 → 标准名称)
const supMap = {
    '庆欧': '庆瓯', '韩森': '韩森源', '九州': '九州电机',
    '  顶邦': '顶邦', '顶邦': '顶邦',
};

// 容器类别映射 (WPS表格 → 标准名称)
// 注：不可折叠胶框=胶框，周转架=架子
const catMap = {
    '不可折叠胶框': '胶框', '可折叠胶框': '可折叠胶框',
    '架子': '架子', '可折叠铁框': '可折叠铁框',
    '周转架': '架子', 'pe箱': 'PE折叠箱',
    '电机隔板': '隔板', '铁框': '可折叠铁框',
    '托盘': '托盘', '隔板': '隔板',
    '可折叠架子': '架子',
};

// 容器类别 key 映射
const catKeyMap = {
    '胶框': 'box', '架子': 'rack', '托盘': 'pallet',
    'PE折叠箱': 'iron', '可折叠铁框': 'iron', '隔板': 'iron',
    '可折叠胶框': 'box',
};

// 区域映射
const zoneMap = { '科技': 'tech', '智能': 'intel', '智造港': 'mfg', 'C2南': 'c2' };

// 需要保留原 cat 名称的容器类别
const specialCats = ['可折叠胶框', 'PE折叠箱', '可折叠铁框', '隔板', '轮胎架子'];

// 构建 TIMELINE 数据
// 日期序列号映射 (Excel date serial)
const newDates = {};
const TIMELINE = {};

// 遍历所有行
for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const zone = row['区域'] ? row['区域'].toString().trim() : '';
    if (!zone) continue;

    const supplier = supMap[row['供应商']] || row['供应商'];
    const cat = catMap[row['容器类别']] || row['容器类别'];
    const zoneKey = zoneMap[zone];
    const catKey = catKeyMap[cat] || 'box';

    if (!zoneKey) continue;

    // 检查所有可能是日期的列（数字键）
    for (const [key, val] of Object.entries(row)) {
        if (!/^\d+$/.test(key)) continue; // 非数字键跳过
        const qty = Number(val);
        if (isNaN(qty) || qty <= 0) continue;

        // 第一次遇到这个日期序列号，确定日期
        if (!newDates[key]) {
            // Excel date serial to date string
            const serial = parseInt(key);
            const d = new Date((serial - 25569) * 86400 * 1000);
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            newDates[key] = mm + '-' + dd;
            console.log('Found date: ' + key + ' -> ' + newDates[key]);
        }

        const dateKey = newDates[key];
        if (!TIMELINE[dateKey]) TIMELINE[dateKey] = {};
        if (!TIMELINE[dateKey][zoneKey]) TIMELINE[dateKey][zoneKey] = { box: [], rack: [], pallet: [], iron: [] };

        const item = { supplier: supplier, qty: qty };
        if (specialCats.includes(cat) && cat !== '胶框' && cat !== '架子') {
            item.cat = cat;
        }

        TIMELINE[dateKey][zoneKey][catKey].push(item);
    }
}

// 确保所有 zone 都有 4 个 cat 类别
const zones = ['tech', 'intel', 'mfg', 'c2'];
const cats = ['box', 'rack', 'pallet', 'iron'];
for (const [dateKey, dateObj] of Object.entries(TIMELINE)) {
    for (const z of zones) {
        if (!dateObj[z]) dateObj[z] = {};
        for (const c of cats) {
            if (!dateObj[z][c]) dateObj[z][c] = [];
        }
    }
}

console.log('TIMELINE dates:', Object.keys(TIMELINE).sort().join(', '));
for (const d of Object.keys(TIMELINE).sort()) {
    let total = 0;
    for (const z of Object.values(TIMELINE[d])) {
        for (const c of Object.values(z)) total += c.length;
    }
    console.log('  ' + d + ': ' + total + ' items');
}

// 读取 HTML 文件
const html = fs.readFileSync('index.html', 'utf-8');

// 生成新的 TIMELINE JS 代码
function toJsLiteral(obj, indent = 4) {
    const sp = ' '.repeat(indent);
    const sp2 = ' '.repeat(indent + 4);
    if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        const items = obj.map(item => toJsLiteral(item, indent + 4));
        return '[\n' + sp2 + items.join(',\n' + sp2) + '\n' + sp + ']';
    }
    if (typeof obj === 'object' && obj !== null) {
        const pairs = [];
        for (const [k, v] of Object.entries(obj)) {
            const key = k.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/) ? k : "'" + k + "'";
            const val = toJsLiteral(v, indent + 4);
            pairs.push(key + ': ' + val);
        }
        return '{\n' + sp2 + pairs.join(',\n' + sp2) + '\n' + sp + '}';
    }
    if (typeof obj === 'string') return "'" + obj + "'";
    return String(obj);
}

const timelineStr = 'const TIMELINE = ' + toJsLiteral(TIMELINE) + ';';

// 用正则替换
const timelineRegex = /const TIMELINE = \{[\s\S]*?\};/;
const newHtml = html.replace(timelineRegex, timelineStr);

// 更新日期
const dateUpdate = newHtml.replace(
    /数据截止：\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/,
    '数据截止：' + new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})
);

// 写入
fs.writeFileSync('index.html', dateUpdate, 'utf-8');
console.log('HTML report updated successfully!');