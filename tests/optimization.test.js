'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'container-report-test-'));
const lastModify = String(Date.UTC(2026, 7, 5, 1, 0, 0));

let requestCount = 0;
let firstRequest = true;

const record = {
    field_values: [
        { field_title: '区域', text_value: { items: [{ text: '科技' }] } },
        { field_title: '供应商', text_value: { items: [{ text: "测试'供应商" }] } },
        { field_title: '容器类别', text_value: { items: [{ text: '胶框' }] } },
        { field_title: '标准线', number_value: 350 },
        { field_title: '8月5日', number_value: 12 }
    ]
};

const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        requestCount += 1;
        assert.strictEqual(req.headers.authorization, 'test-token');

        // 验证临时错误会自动重试。
        if (firstRequest) {
            firstRequest = false;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'temporary' }));
            return;
        }

        const body = JSON.parse(raw);
        const tool = body.params.name;
        const result = tool === 'manage.query_file_info'
            ? { last_modify_time: lastModify }
            : { records: [record], has_more: false };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
                content: [{ type: 'text', text: JSON.stringify(result) }]
            }
        }));
    });
});

async function run() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    process.env.TENCENT_DOCS_TOKEN = 'test-token';
    process.env.TENCENT_SMARTSHEET_FILE_ID = 'test-file';
    process.env.TENCENT_SMARTSHEET_SHEET_ID = 'test-sheet';
    process.env.TENCENT_LAST_MODIFY = lastModify;
    process.env.TENCENT_MCP_URL = `http://127.0.0.1:${port}/mcp`;
    process.env.TENCENT_MCP_RETRIES = '3';

    fs.copyFileSync(path.join(repoRoot, 'index.html'), path.join(tempDir, 'index.html'));
    fs.writeFileSync(path.join(tempDir, '.last_modify'), '1\n', 'utf8');
    process.env.GITHUB_OUTPUT = path.join(tempDir, 'github-output.txt');
    process.chdir(tempDir);

    const { main: checkMain } = require(path.join(repoRoot, 'check_tencent_doc.js'));
    await checkMain();
    const outputs = fs.readFileSync(process.env.GITHUB_OUTPUT, 'utf8');
    assert.match(outputs, /changed=true/);
    assert.match(outputs, new RegExp(`last_modify=${lastModify}`));

    fs.writeFileSync(path.join(tempDir, '.last_modify'), `${lastModify}\n`, 'utf8');
    fs.writeFileSync(process.env.GITHUB_OUTPUT, '', 'utf8');
    await checkMain();
    const unchangedOutputs = fs.readFileSync(process.env.GITHUB_OUTPUT, 'utf8');
    assert.match(unchangedOutputs, /changed=false/);

    const { main: updateMain, parseDateKey } = require(path.join(repoRoot, 'update_tencent_docs_data.js'));
    assert.strictEqual(parseDateKey('8月5日'), '08-05');
    assert.strictEqual(parseDateKey('8月5号'), '08-05');
    assert.strictEqual(parseDateKey('2026-8-5'), '08-05');

    await updateMain();
    const html = fs.readFileSync(path.join(tempDir, 'index.html'), 'utf8');
    assert.match(html, /"08-05"/);
    assert.match(html, /测试'供应商/);
    assert.match(html, /数据截止：2026年8月5日 09:00/);

    await updateMain();
    const secondHtml = fs.readFileSync(path.join(tempDir, 'index.html'), 'utf8');
    assert.strictEqual(secondHtml, html, '同一份腾讯文档数据不应重复改写网页');
    assert.ok(requestCount >= 5, '应包含失败重试、两次信息查询和两次数据查询');
}

run()
    .then(() => console.log('✅ optimization tests passed'))
    .finally(() => {
        process.chdir(originalCwd);
        server.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
