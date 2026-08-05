// update_tencent_docs_data.js - 从腾讯文档 MCP 拉取数据更新 HTML 报表
'use strict';

const fs = require('fs');
const { callMCP, extractTextJson } = require('./tencent_mcp');

const FILE_ID = process.env.TENCENT_SMARTSHEET_FILE_ID;
const SHEET_ID = process.env.TENCENT_SMARTSHEET_SHEET_ID;
const LAST_MODIFY = process.env.TENCENT_LAST_MODIFY;

// 分页拉取所有记录
async function fetchAllRecords() {
    const allRecords = [];
    const seenOffsets = new Set();
    let offset = 0;
    const pageSize = 100;

    for (let page = 1; page <= 1000; page += 1) {
        if (seenOffsets.has(offset)) {
            throw new Error(`腾讯文档分页游标重复: ${offset}`);
        }
        seenOffsets.add(offset);

        console.log(`  拉取第 ${offset + 1}-${offset + pageSize} 条...`);
        const resp = await callMCP('smartsheet.list_records', {
            file_id: FILE_ID,
            sheet_id: SHEET_ID,
            count: pageSize,
            offset: offset
        });

        const parsed = extractTextJson(resp);

        const records = parsed.records || [];
        if (!Array.isArray(records)) {
            throw new Error('腾讯文档 records 不是数组');
        }
        allRecords.push(...records);
        console.log(`  已获取 ${records.length} 条，累计 ${allRecords.length} 条`);

        if (!parsed.has_more) break;
        const nextOffset = Number(parsed.next);
        offset = Number.isFinite(nextOffset) && nextOffset > offset
            ? nextOffset
            : offset + pageSize;

        if (page === 1000) {
            throw new Error('腾讯文档记录超过 1000 页，已停止以避免无限循环');
        }
    }

    return allRecords;
}

// 把记录转成 row 对象（field → value）
function recordToRow(record) {
    const row = {};
    const fvs = record.field_values || [];
    for (const fv of fvs) {
        const field = fv.field_title || fv.field;
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

const zoneMap = { '科技': 'tech', '智能': 'intel', '智造港': 'mfg' };

const specialCats = ['可折叠胶框', 'PE折叠箱', '可折叠铁框', '隔板', '轮胎架子'];

// 日期解析
function parseDateKey(key) {
    if (!key) return null;
    const k = key.toString().trim();
    let m = k.match(/(\d{1,2})月(\d{1,2})(?:日|号)/);
    if (m) return String(parseInt(m[1])).padStart(2, '0') + '-' + String(parseInt(m[2])).padStart(2, '0');
    m = k.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) return String(parseInt(m[1])).padStart(2, '0') + '-' + String(parseInt(m[2])).padStart(2, '0');
    m = k.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return String(parseInt(m[2])).padStart(2, '0') + '-' + String(parseInt(m[3])).padStart(2, '0');
    return null;
}

const knownNonDataFields = ['区域', '供应商', '容器类别', '标准线', '备注', '备注说明'];

async function main() {
    if (!process.env.TENCENT_DOCS_TOKEN || !FILE_ID || !SHEET_ID) {
        throw new Error('缺少环境变量: TENCENT_DOCS_TOKEN / TENCENT_SMARTSHEET_FILE_ID / TENCENT_SMARTSHEET_SHEET_ID');
    }

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
    const zones = ['tech', 'intel', 'mfg'];
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

    // =====================================================================
    // 构建 STANDARD（从源文档"标准线"列动态读取）
    // =====================================================================
    const STANDARD = {};
    for (const row of rows) {
        const zoneRaw = (row['区域'] || '').toString().trim();
        const zone = zoneMap[zoneRaw] || zoneMap[zoneRaw.replace(/\s/g, '')];
        if (!zone) continue;

        const supplierRaw = (row['供应商'] || '').toString().trim();
        const supplier = supMap[supplierRaw] || supplierRaw;
        if (!supplier) continue;

        const catRaw = (row['容器类别'] || '').toString().trim();
        if (!catRaw) continue; // 无容器类别的行（如纯托盘记录）跳过
        const cat = catMap[catRaw] || catRaw;

        const stdVal = row['标准线'];
        const std = typeof stdVal === 'number' ? stdVal : Number(stdVal);
        if (isNaN(std) || std <= 0) continue;

        STANDARD[`${zone}|${supplier}|${cat}`] = std;
    }
    console.log('STANDARD 条目数:', Object.keys(STANDARD).length);

    // 读取 HTML
    const html = fs.readFileSync('index.html', 'utf-8');

    function toSafeJsLiteral(obj) {
        return JSON.stringify(obj, null, 4)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    const timelineStr = 'const TIMELINE = ' + toSafeJsLiteral(TIMELINE) + ';';
    const timelineRegex = /const TIMELINE = \{[\s\S]*?\};/;
    if (!timelineRegex.test(html)) throw new Error('index.html 中未找到 TIMELINE 数据块');
    let newHtml = html.replace(timelineRegex, timelineStr);

    const standardStr = 'const STANDARD = ' + toSafeJsLiteral(STANDARD) + ';';
    const standardRegex = /const STANDARD = \{[\s\S]*?\};/;
    if (!standardRegex.test(newHtml)) throw new Error('index.html 中未找到 STANDARD 数据块');
    newHtml = newHtml.replace(standardRegex, standardStr);

    // 复用检查步骤取得的修改时间，避免再次调用腾讯文档接口。
    const cutoffDate = /^\d+$/.test(LAST_MODIFY || '')
        ? new Date(Number(LAST_MODIFY))
        : new Date();
    const fmt = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = {};
    for (const p of fmt.formatToParts(cutoffDate)) parts[p.type] = p.value;
    const cutoffStr = `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`;
    console.log('文档最后修改时间:', cutoffStr);

    const dateUpdate = newHtml.replace(
        /数据截止：[^<\|]*/,
        '数据截止：' + cutoffStr
    );

    if (dateUpdate === html) {
        console.log('ℹ️ HTML 内容未变化');
    } else {
        fs.writeFileSync('index.html', dateUpdate, 'utf-8');
        console.log('✅ HTML 报表更新成功！');
    }
    console.log('更新时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
}

if (require.main === module) {
    main().catch(error => {
        console.error(`❌ 更新腾讯文档数据失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    fetchAllRecords,
    main,
    parseDateKey,
    recordToRow
};
