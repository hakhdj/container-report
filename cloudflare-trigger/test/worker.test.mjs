import assert from "node:assert/strict";
import { checkAndDispatch } from "../src/index.js";

const realFetch = globalThis.fetch;

function tencentResponse(timestamp) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({ last_modify_time: timestamp })
      }]
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

const env = {
  GITHUB_TOKEN: "test-github-token",
  TENCENT_DOCS_TOKEN: "test-tencent-token",
  TENCENT_SMARTSHEET_FILE_ID: "test-file-id"
};

try {
  let dispatchCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (url.includes("docs.qq.com")) return tencentResponse("123");
    if (url.includes("/contents/.last_modify")) return new Response("123\n");
    if (url.endsWith("/dispatches")) {
      dispatchCount += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const unchanged = await checkAndDispatch(env);
  assert.equal(unchanged.status, "unchanged");
  assert.equal(dispatchCount, 0);

  globalThis.fetch = async (url, init = {}) => {
    if (url.includes("docs.qq.com")) return tencentResponse("456");
    if (url.includes("/contents/.last_modify")) return new Response("123\n");
    if (url.endsWith("/dispatches")) {
      assert.equal(init.method, "POST");
      dispatchCount += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const changed = await checkAndDispatch(env);
  assert.equal(changed.status, "dispatched");
  assert.equal(dispatchCount, 1);

  console.log("✅ Cloudflare Worker tests passed");
} finally {
  globalThis.fetch = realFetch;
}
