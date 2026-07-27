// update_tencent_docs_data.js - 从腾讯文档 MCP 拉取数据更新 HTML 报表
const fs = require('fs');
const https = require('https');

const TOKEN = process.env.TENCENT_DOCS_TOKEN;
const FILE_ID = process.env.TENCENT_SMARTSHEET_FILE_ID;
const SHEET_ID = process.env.TENCENT_SMARTSHEET_SHEET_ID;
const MCP_URL = 'https://docs.qq.com/openapi/mcp';

if (!TOKEN || !FILE_ID || !SHEET_ID) {
    console.error('❌ 缺少环境变量: TENCENT_DOCS_TOKEN / TENCENT_SMARTSHEET_FILE_ID / TENCENT_SMARTSHEET_SHEET_ID');
    process.exit(1);
}

// 调用 MCP JSON-RPC
function callMCP(name, args) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: Math.floor(Math.random() * 10000),
            method: 'tools/call',
            params: { name, arguments: args }
        });
        const options = {
            hostname: 'docs.qq.com',
            path: '/openapi/mcp',
            method: 'POST',
            headers: {
                'Authorization': TOKEN,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (d) => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// 分页拉取所有记录
async function fetchAllRecords() {
    const allRecords = [];
    let offset = 0;
    const pageSize = 100;

    while (true) {
        console.log(`  拉取第 ${offset + 1}-${offset + pageSize} 条...`);
        const resp = await callMCP('smartsheet.list_records', {
            file_id: FILE_ID,
            sheet_id: SHEET_ID,
            count: pageSize,
            offset: offset
        });

        if (resp.error) {
            console.error('❌ 拉取记录失败:', JSON.stringify(resp.error));
            process.exit(1);
        }

        const content = resp.result?.content;
        if (!Array.isArray(content) || content.length === 0) {
            console.error('❌ 返回内容为空');
            process.exit(1);
        }

        let parsed;
        for (const c of content) {
            if (c.type === 'text') {
                try { parsed = JSON.parse(c.text); break; }
                catch (e) { /* 试下一个 */ }
            }
        }

        if (!parsed) {
            console.error('❌ 无法解析返回内容');
            process.exit(1);
        }

        const records = parsed.records || [];
        allRecords.push(...records);
        console.log(`  已获取 ${records.length} 条，累计 ${allRecords.length} 条`);

        if (!parsed.has_more) break;
        offset = parsed.next || (offset + pageSize);
        if (!parsed.next) break;
    }

    return allRecords;
}

// 把记录转成 row 对象（field → value）
function recordToRow(record) {
    const row = {};
    const fvs = record.field_values || [];
    for (const fv of fvs) {
        const field = fv.field;
        if (!field) continue;

        // 文本字段
        if (fv.text_value && fv.text_value.items) {
            const text = fv.text_value.items.map(i => i.text || '').join('');
            row[field] = text;
        }
        // 数字字段
        else if (fv.number_value !== undefined) {
            row[field] = fv.number_value;
        }
        else {
            row[field] = '';
        }
    }
    return row;
}

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
    let m = k.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) return String(parseInt(m[1])).padStart(2, '0') + '-' + String(parseInt(m[2])).padStart(2, '0');
    m = k.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) return String(parseInt(m[1])).padStart(2, '0') + '-' + String(parseInt(m[2])).padStart(2, '0');
    m = k.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return String(parseInt(m[2])).padStart(2, '0') + '-' + String(parseInt(m[3])).padStart(2, '0');
    return null;
}

const knownNonDataFields = ['区域', '供应商', '容器类别', '标准线', '备注', '备注说明'];

(async () => {
    console.log('开始拉取腾讯文档数据...');
    const records = await fetchAllRecords();
    console.log(`✅ 共拉取 ${records.length} 条记录`);

    const rows = records.map(recordToRow);

    // 构建 TIMELINE
    const TIMELINE = {};
    for (const row of rows) {
        const zoneRaw = (row['区域'] || '').toString().trim();
        if (!zoneRaw) continue;
        const zone = zoneMap[zoneRaw] || zoneMap[zoneRaw.replace(/\s/g, '')];
        if (!zone) {
            console.log(`未知区域: "${zoneRaw}"`);
            continue;
        }

        const supplierRaw = (row['供应商'] || '').toString().trim();
        const supplier = supMap[supplierRaw] || supplierRaw;

        const catRaw = (row['容器类别'] || '').toString().trim();
        const cat = catMap[catRaw] || catRaw;
        const catKey = catKeyMap[cat] || 'box';

        for (const [key, val] of Object.entries(row)) {
            if (knownNonDataFields.includes(key)) continue;
            const qty = typeof val === 'number' ? val : Number(val);
            if (isNaN(qty) || qty <= 0) continue;

            const dateKey = parseDateKey(key);
            if (!dateKey) continue;

            if (!TIMELINE[dateKey]) TIMELINE[dateKey] = {};
            if (!TIMELINE[dateKey][zone]) TIMELINE[dateKey][zone] = { box: [], rack: [], pallet: [], iron: [] };

            const item = { supplier, qty };
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
                pairs.push(key + ': ' + toJsLiteral(v, indent + 4));
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

    const now = new Date();
    const dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' +
                    String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const dateUpdate = newHtml.replace(
        /数据截止：[^<\|]*/,
        '数据截止：' + dateStr
    );

    fs.writeFileSync('index.html', dateUpdate, 'utf-8');
    console.log('✅ HTML 报表更新成功！');
    console.log('更新时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
})();
