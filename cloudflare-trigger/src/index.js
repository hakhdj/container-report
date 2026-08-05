const GITHUB_OWNER = "hakhdj";
const GITHUB_REPO = "container-report";
const GITHUB_API_VERSION = "2022-11-28";
const TENCENT_MCP_URL = "https://docs.qq.com/openapi/mcp";
const MAX_ATTEMPTS = 3;

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`缺少 Worker Secret: ${name}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, init, attempts = MAX_ATTEMPTS) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export async function getTencentLastModify(env) {
  const token = requireEnv(env, "TENCENT_DOCS_TOKEN");
  const fileId = requireEnv(env, "TENCENT_SMARTSHEET_FILE_ID");

  const response = await fetchWithRetry(TENCENT_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "manage.query_file_info",
        arguments: { file_id: fileId }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`腾讯文档接口 HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const rpc = await response.json();
  if (rpc.error) {
    throw new Error(`腾讯文档 MCP 错误: ${JSON.stringify(rpc.error)}`);
  }

  const content = rpc.result?.content;
  if (!Array.isArray(content)) {
    throw new Error("腾讯文档返回内容格式错误");
  }

  for (const item of content) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    try {
      const info = JSON.parse(item.text);
      const value = String(info.last_modify_time || "").trim();
      if (/^\d+$/.test(value) && Number(value) > 0) return value;
    } catch {
      // MCP 可能返回多段文本，继续尝试下一段。
    }
  }

  throw new Error("未取得有效的 last_modify_time");
}

export async function getGithubLastModify(env) {
  const token = requireEnv(env, "GITHUB_TOKEN");
  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
    "/contents/.last_modify?ref=main";

  const response = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "container-report-cloudflare-worker",
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`读取 GitHub .last_modify 失败: HTTP ${response.status}`);
  }

  const value = (await response.text()).trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`GitHub .last_modify 内容无效: ${value.slice(0, 100)}`);
  }
  return value;
}

export async function dispatchGithub(env) {
  const token = requireEnv(env, "GITHUB_TOKEN");
  const url =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "container-report-cloudflare-worker"
    },
    body: JSON.stringify({ event_type: "update-report" })
  });

  if (response.status !== 204) {
    throw new Error(
      `触发 GitHub Actions 失败: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`
    );
  }
}

export async function checkAndDispatch(env) {
  const [current, previous] = await Promise.all([
    getTencentLastModify(env),
    getGithubLastModify(env)
  ]);

  if (current === previous) {
    return {
      status: "unchanged",
      message: "腾讯文档没有更新，不启动 GitHub Actions",
      last_modify: current
    };
  }

  await dispatchGithub(env);
  return {
    status: "dispatched",
    message: "检测到更新，已触发 GitHub Actions",
    previous,
    current
  };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      checkAndDispatch(env)
        .then((result) => console.log(JSON.stringify({
          cron: controller.cron,
          scheduledTime: controller.scheduledTime,
          ...result
        })))
        .catch((error) => {
          console.error(`定时检查失败: ${error.stack || error.message}`);
          throw error;
        })
    );
  },

  async fetch() {
    return Response.json({
      status: "running",
      message: "container-report 定时检查服务运行正常"
    });
  }
};
