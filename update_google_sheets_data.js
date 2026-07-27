// update_google_sheets_data.js - 从 Google Sheets 数据更新 HTML 报表
const fs = require('fs');

// 读取 Google Sheets 数据
let rawData;
try {
    rawData = JSON.parse(fs.readFileSync('google_sheets_data.json', 'utf-8'));
} catch (e) {
    console.error('无法读取 google_sheets_data.json:', e.message);
    process.exit(1);
}

// Google Sheets API 返回的数据格式：
// { values: [[行1列1, 行1列2, ...], [行2列1, 行2列2, ...], ...] }
// 第一行是表头
let values = rawData.values || [];
if (values.length < 2) {
    console.error('Google Sheets 数据为空或只有表头');
    process.exit(1);
}

const headers = values[0];
console.log('表头:', headers.join(' | '));

// 把每行数据转成对象数组
let records = [];
for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.length === 0) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
        const header = headers[j] ? headers[j].toString().trim() : '';
        const val = row[j] !== undefined ? row[j] : '';
        if (header) obj[header] = val;
    }
    records.push(obj);
}

console.log(`读取到 ${records.length} 条记录`);

// 供应商名称映射
const supMap = {
    '庆欧': '庆瓯', '韩森': '韩森源', '九州': '九州电机',
    '  顶邦': '顶邦', '顶邦': '顶邦',
};

// 容器类别映射
const catMap = {
    '不可折叠胶框': '胶框', '可折叠胶框': '可折叠胶框',
    '架子': '架子', '可折叠铁框': '可折叠铁框',
    '周转架': '架子', 'pe箱': 'PE折叠箱', 'PE箱': 'PE折叠箱',
    '电机隔板': '隔板', '铁框': '可折叠铁框',
    '托盘': '托盘', '隔板': '隔板',
    '可折叠架子': '架子', '轮胎架子': '轮胎架子',
};

const catKeyMap = {
    '胶框': 'box', '架子': 'rack', '托盘': 'pallet',
    'PE折叠箱': 'iron', '可折叠铁框': 'iron', '隔板': 'iron',
    '可折叠胶框': 'box', '轮胎架子': 'rack',
};

const zoneMap = { '科技': 'tech', '智能': 'intel', '智造港': 'mfg', 'C2南': 'c2' };

const specialCats = ['可折叠胶框', 'PE折叠箱', '可折叠铁框', '隔板', '轮胎架子'];

// 日期解析
function parseDateKey(key) {
    if (!key) return null;
    const k = key.toString().trim();

    // "7月22日" 或 "07月22日"
    let m = k.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) return String(parseInt(m[1])).padStart(2, '0') + '-' + String(parseInt(m[2])).padStart(2, '0');

    // "07-22"
    m = k.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) return String(parseInt(m[1])).padStart(2, '0') + '-' + String(parseInt(m[2])).padStart(2, '0');

    // "2024-07-22"
    m = k.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return String(parseInt(m[2])).padStart(2, '0') + '-' + String(parseInt(m[3])).padStart(2, '0');

    return null;
}

function extractNumber(val) {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return val;
    const s = val.toString().trim().replace(/,/g, '');
    const n = Number(s);
    return isNaN(n) ? null : n;
}

function extractText(val) {
    if (val === undefined || val === null) return '';
    return val.toString().trim();
}

// 构建 TIMELINE
const TIMELINE = {};
const knownNonDataFields = ['区域', '供应商', '容器类别', '备注', '备注说明'];

for (const row of records) {
    const zoneRaw = extractText(row['区域']);
    if (!zoneRaw) continue;

    const zone = zoneMap[zoneRaw] || zoneMap[zoneRaw.replace(/\s/g, '')];
    if (!zone) {
        console.log(`未知区域: "${zoneRaw}"`);
        continue;
    }

    const supplierRaw = extractText(row['供应商']);
    const supplier = supMap[supplierRaw] || supplierRaw;

    const catRaw = extractText(row['容器类别']);
    const cat = catMap[catRaw] || catRaw;
    const catKey = catKeyMap[cat] || 'box';

    // 遍历所有可能是日期的列
    for (const [key, val] of Object.entries(row)) {
        if (knownNonDataFields.includes(key)) continue;

        const qty = extractNumber(val);
        if (qty === null || qty <= 0) continue;

        const dateKey = parseDateKey(key);
        if (!dateKey) continue;

        if (!TIMELINE[dateKey]) TIMELINE[dateKey] = {};
        if (!TIMELINE[dateKey][zone]) TIMELINE[dateKey][zone] = { box: [], rack: [], pallet: [], iron: [] };

        const item = { supplier: supplier, qty: qty };
        if (specialCats.includes(cat) && cat !== '胶框' && cat !== '架子') {
            item.cat = cat;
        }

        TIMELINE[dateKey][zone][catKey].push(item);
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

console.log('TIMELINE 日期:', Object.keys(TIMELINE).sort().join(', '));
for (const d of Object.keys(TIMELINE).sort()) {
    let total = 0;
    for (const z of Object.values(TIMELINE[d])) {
        for (const c of Object.values(z)) total += c.length;
    }
    console.log(`  ${d}: ${total} 条`);
}

// 读取 HTML
const html = fs.readFileSync('index.html', 'utf-8');

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
const timelineRegex = /const TIMELINE = \{[\s\S]*?\};/;
const newHtml = html.replace(timelineRegex, timelineStr);

if (newHtml === html) {
    console.log('❌ HTML 未变化');
    process.exit(1);
}

const dateUpdate = newHtml.replace(
    /数据截止：\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/,
    '数据截止：' + new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})
);

fs.writeFileSync('index.html', dateUpdate, 'utf-8');
console.log('✅ HTML 报表更新成功！');
console.log('更新时间:', new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'}));
