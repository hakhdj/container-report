'use strict';

const fs = require('fs');
const { callMCP, extractTextJson } = require('./tencent_mcp');

const FILE_ID = process.env.TENCENT_SMARTSHEET_FILE_ID;
const MARKER_FILE = '.last_modify';

function writeOutput(name, value) {
    const outputFile = process.env.GITHUB_OUTPUT;
    const line = `${name}=${value}\n`;
    if (outputFile) {
        fs.appendFileSync(outputFile, line, 'utf8');
    } else {
        process.stdout.write(line);
    }
}

function readLastModify() {
    if (!fs.existsSync(MARKER_FILE)) return '0';
    return fs.readFileSync(MARKER_FILE, 'utf8').trim() || '0';
}

async function main() {
    if (!FILE_ID) throw new Error('缺少 TENCENT_SMARTSHEET_FILE_ID');

    const response = await callMCP('manage.query_file_info', { file_id: FILE_ID });
    const info = extractTextJson(response);
    const current = String(info.last_modify_time || '').trim();

    if (!/^\d+$/.test(current) || Number(current) <= 0) {
        throw new Error(`腾讯文档返回了无效的 last_modify_time: ${JSON.stringify(info.last_modify_time)}`);
    }

    const previous = readLastModify();
    const forceRefresh = process.env.FORCE_REFRESH === 'true';
    const changed = forceRefresh || current !== previous;

    console.log(`当前文档修改时间戳: ${current}`);
    console.log(`上次记录修改时间戳: ${previous}`);
    console.log(forceRefresh ? '已启用强制刷新' : changed ? '文档已修改' : '文档未修改');

    writeOutput('changed', String(changed));
    writeOutput('last_modify', current);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`❌ 检查腾讯文档失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { main, readLastModify, writeOutput };
