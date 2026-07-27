// update_feishu_data.js - 从飞书多维表格数据更新 HTML 报表
const fs = require('fs');

// 读取飞书数据
let rawData;
try {
    rawData = JSON.parse(fs.readFileSync('feishu_records.json', 'utf-8'));
} catch (e) {
    console.error('无法读取 feishu_records.json:', e.message);
    process.exit(1);
}

// 提取记录列表（兼容两种数据格式）
let records;
if (rawData.items && Array.isArray(rawData.items)) {
    // 飞书 bitable API 格式：{ items: [{ record_id, fields: {...} }] }
    records = rawData.items.map(item => item.fields);
} else if (Array.isArray(rawData)) {
    // 飞书自动化流程可能发送纯数组格式
    records = rawData.map(item => item.fields || item);
} else if (rawData.data && rawData.data.items) {
    // 另一种飞书 API 格式
    records = rawData.data.items.map(item => item.fields);
} else {
    console.error('未知的数据格式:', Object.keys(rawData));
    console.log('Raw data preview:', JSON.stringify(rawData).substring(0, 500));
    process.exit(1);
}

console.log(`读取到 ${records.length} 条记录`);

// 供应商名称映射 (飞书表格 → 标准名称)
const supMap = {
    '庆欧': '庆瓯', '韩森': '韩森源', '九州': '九州电机',
    '  顶邦': '顶邦', '顶邦': '顶邦',
};

// 容器类别映射 (飞书表格 → 标准名称)
const catMap = {
    '不可折叠胶框': '胶框', '可折叠胶框': '可折叠胶框',
    '架子': '架子', '可折叠铁框': '可折叠铁框',
    '周转架': '架子', 'pe箱': 'PE折叠箱', 'PE箱': 'PE折叠箱',
    '电机隔板': '隔板', '铁框': '可折叠铁框',
    '托盘': '托盘', '隔板': '隔板',
    '可折叠架子': '架子', '轮胎架子': '轮胎架子',
};

// 容器类别 key 映射
const catKeyMap = {
    '胶框': 'box', '架子': 'rack', '托盘': 'pallet',
    'PE折叠箱': 'iron', '可折叠铁框': 'iron', '隔板': 'iron',
    '可折叠胶框': 'box', '轮胎架子': 'rack',
};

// 区域映射
const zoneMap = { '科技': 'tech', '智能': 'intel', '智造港': 'mfg', 'C2南': 'c2' };

// 需要保留原 cat 名称的容器类别
const specialCats = ['可折叠胶框', 'PE折叠箱', '可折叠铁框', '隔板', '轮胎架子'];

// 日期解析函数（兼容多种日期格式）
function parseDateKey(key, value) {
    // 格式1：数字键（Excel date serial 或飞书数字列名）
    if (/^\d+$/.test(key)) {
        const serial = parseInt(key);
        if (serial > 40000 && serial < 50000) {
            // Excel date serial number
            const d = new Date((serial - 25569) * 86400 * 1000);
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return mm + '-' + dd;
        }
        // 可能是飞书 bitable 的数字列 ID，跳过
        return null;
    }

    // 格式2：飞书日期字符串 "7月22日"、"07-22"、"2024-07-22"
    let match;
    // "7月22日" 或 "07月22日"
    match = key.match(/(\d{1,2})月(\d{1,2})日/);
    if (match) {
        return String(parseInt(match[1])).padStart(2, '0') + '-' + String(parseInt(match[2])).padStart(2, '0');
    }
    // "07-22"
    match = key.match(/^(\d{2})-(\d{2})$/);
    if (match) {
        return match[1] + '-' + match[2];
    }
    // "2024-07-22" 或 "2026-07-22"
    match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return match[2] + '-' + match[3];
    }

    return null;
}

// 提取数值（兼容飞书 bitable 不同字段类型）
function extractNumber(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const n = Number(val);
        if (!isNaN(n)) return n;
    }
    // 飞书 bitable 数字字段可能是对象 { text: "800", type: "number" }
    if (typeof val === 'object' && val !== null) {
        if (typeof val.text === 'string') {
            const n = Number(val.text);
            if (!isNaN(n)) return n;
        }
    }
    return null;
}

// 提取文本（兼容飞书 bitable 不同字段类型）
function extractText(val) {
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number') return String(val);
    if (typeof val === 'object' && val !== null) {
        // 飞书 bitable 单选字段: [{ text: "科技" }]
        if (Array.isArray(val)) {
            return val.map(v => v.text || String(v)).join('').trim();
        }
        if (typeof val.text === 'string') return val.text.trim();
    }
    return String(val).trim();
}

// 构建 TIMELINE 数据
const TIMELINE = {};
const knownNonDataFields = ['区域', '供应商', '容器类别', '备注', '备注说明'];

for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const zoneRaw = extractText(row['区域'] || '');
    if (!zoneRaw) continue;

    const zone = zoneMap[zoneRaw] || zoneMap[zoneRaw.replace(/\s/g, '')];
    if (!zone) {
        console.log(`未知区域: "${zoneRaw}" (行 ${i})`);
        continue;
    }

    const supplierRaw = extractText(row['供应商'] || '');
    const supplier = supMap[supplierRaw] || supplierRaw;

    const catRaw = extractText(row['容器类别'] || '');
    const cat = catMap[catRaw] || catRaw;
    const catKey = catKeyMap[cat] || 'box';

    // 遍历所有可能是日期的列
    for (const [key, val] of Object.entries(row)) {
        // 跳过已知非数据列
        if (knownNonDataFields.includes(key)) continue;
        // 跳过飞书内部字段
        if (key.startsWith('_') || key === 'record_id') continue;

        const qty = extractNumber(val);
        if (qty === null || qty <= 0) continue;

        const dateKey = parseDateKey(key, val);
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

if (newHtml === html) {
    console.log('❌ HTML 未变化（TIMELINE 替换失败）');
    process.exit(1);
}

// 更新日期
const dateUpdate = newHtml.replace(
    /数据截止：\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/,
    '数据截止：' + new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})
);

// 写入
fs.writeFileSync('index.html', dateUpdate, 'utf-8');
console.log('✅ HTML 报表更新成功！');
console.log('更新时间:', new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'}));
