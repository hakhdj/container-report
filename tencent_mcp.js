'use strict';

const https = require('https');
const http = require('http');

const DEFAULT_MCP_URL = 'https://docs.qq.com/openapi/mcp';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(error) {
    if (!error || typeof error !== 'object') return false;
    if (!error.statusCode) return true;
    return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
}

function requestJson(url, body, token, timeoutMs) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'http:' ? http : https;
        const payload = JSON.stringify(body);
        const req = transport.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || undefined,
            path: target.pathname + target.search,
            method: 'POST',
            headers: {
                Authorization: token,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'User-Agent': 'container-report-github-actions'
            }
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('error', reject);
            res.on('data', chunk => {
                data += chunk;
                if (data.length > 10 * 1024 * 1024) {
                    req.destroy(new Error('腾讯文档接口返回内容超过 10MB'));
                }
            });
            res.on('end', () => {
                const statusCode = res.statusCode || 0;
                if (statusCode < 200 || statusCode >= 300) {
                    const error = new Error(
                        `腾讯文档接口返回 HTTP ${statusCode}: ${data.slice(0, 500)}`
                    );
                    error.statusCode = statusCode;
                    reject(error);
                    return;
                }

                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error(`腾讯文档接口返回了无效 JSON: ${error.message}`));
                }
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`腾讯文档接口请求超过 ${timeoutMs}ms`));
        });
        req.on('error', reject);
        req.end(payload);
    });
}

async function callMCP(name, args, options = {}) {
    const token = options.token || process.env.TENCENT_DOCS_TOKEN;
    if (!token) throw new Error('缺少 TENCENT_DOCS_TOKEN');

    const url = options.url || process.env.TENCENT_MCP_URL || DEFAULT_MCP_URL;
    const timeoutMs = Number(options.timeoutMs || process.env.TENCENT_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const retries = Number(options.retries ?? process.env.TENCENT_MCP_RETRIES ?? DEFAULT_RETRIES);
    const requestBody = {
        jsonrpc: '2.0',
        id: `${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
        method: 'tools/call',
        params: { name, arguments: args }
    };

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const response = await requestJson(url, requestBody, token, timeoutMs);
            if (response.error) {
                const error = new Error(`腾讯文档 MCP 错误: ${JSON.stringify(response.error)}`);
                error.statusCode = response.error.code;
                throw error;
            }
            return response;
        } catch (error) {
            lastError = error;
            if (attempt >= retries || !shouldRetry(error)) break;
            const delayMs = Math.min(1000 * (2 ** (attempt - 1)), 5000);
            console.warn(`⚠️ 腾讯文档请求失败，第 ${attempt}/${retries} 次，${delayMs}ms 后重试：${error.message}`);
            await sleep(delayMs);
        }
    }

    throw lastError;
}

function extractTextJson(response) {
    const content = response?.result?.content;
    if (!Array.isArray(content) || content.length === 0) {
        throw new Error('腾讯文档 MCP 返回内容为空');
    }

    for (const item of content) {
        if (item?.type !== 'text' || typeof item.text !== 'string') continue;
        try {
            return JSON.parse(item.text);
        } catch {
            // MCP 可能返回多段文本，继续尝试下一段。
        }
    }

    throw new Error('无法解析腾讯文档 MCP 文本结果');
}

module.exports = {
    callMCP,
    extractTextJson,
    requestJson,
    shouldRetry
};
