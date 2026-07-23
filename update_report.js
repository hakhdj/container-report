// update_report.js - 从 WPS 数据自动更新 HTML 报表
const fs = require('fs');

// 读取 WPS webhook 返回的数据
const resp = JSON.parse(fs.readFileSync('wps_response.json', 'utf-8'));
const dataStr = resp.data.result;
const records = JSON.parse(dataStr);

console.log(`获取到 ${records.length} 条数据`);

// 区域映射
const zoneMap = { '科技': 'tech', '智能': 'intel', '智造港': 'mfg', 'C2南': 'c2' };
// 容器类别映射
const catMap = {
  '胶框': 'box', '可折叠胶框': 'box',
  '架子': 'rack', '轮胎架子': 'rack',
  '托盘': 'pallet', '隔板': 'iron',
  'PE折叠箱': 'iron', 'PE 折叠箱': 'iron',
  '可折叠铁框': 'iron', '可折叠铁框（雨棚下方）': 'iron',
  '铁笼筐（雨棚下方）': 'iron',
};

// 特殊容器类别 - 需要在 item 中保留原始 cat 名称
const specialCatDisplay = {
  '可折叠胶框': '可折叠胶框',
  '轮胎架子': '轮胎架子',
  '可折叠铁框': '可折叠铁框',
  'PE折叠箱': 'PE 折叠箱',
  'PE折叠箱': 'PE 折叠箱',
  '隔板': '隔板',
};

// 构建 TIMELINE 数据
const TIMELINE = {};

// 按日期分组
const dateGroups = {};
records.forEach(r => {
  const dateStr = r['日期'];
  if (!dateStr) return;
  // 转换日期格式: "7月22日" -> "07-22"
  const m = dateStr.match(/(\d+)月(\d+)日/);
  if (!m) return;
  const month = m[1].padStart(2, '0');
  const day = m[2].padStart(2, '0');
  const key = `${month}-${day}`;
  if (!dateGroups[key]) dateGroups[key] = [];
  dateGroups[key].push(r);
});

// 按日期构建 TIMELINE 结构
for (const [dateKey, items] of Object.entries(dateGroups)) {
  const dateObj = {};

  items.forEach(r => {
    const zone = zoneMap[r['区域']];
    const cat = catMap[r['容器类别']];
    if (!zone || !cat) {
      console.log(`未映射: 区域=${r['区域']}, 容器类别=${r['容器类别']}`);
      return;
    }

    if (!dateObj[zone]) dateObj[zone] = { box: [], rack: [], pallet: [], iron: [] };

    const item = {
      supplier: r['供应商'],
      qty: typeof r['数量'] === 'number' ? r['数量'] : parseInt(r['数量']) || 0
    };

    // 如果容器类别是特殊类别，保留显示名称
    if (specialCatDisplay[r['容器类别']] && cat !== r['容器类别']) {
      item.cat = specialCatDisplay[r['容器类别']];
    }

    // 添加标准线
    const stdLine = r['标准线'];
    if (stdLine && stdLine !== '' && stdLine !== null) {
      item.limit = typeof stdLine === 'number' ? stdLine : parseInt(stdLine) || 0;
    }

    dateObj[zone][cat].push(item);
  });

  TIMELINE[dateKey] = dateObj;
}

// 读取 HTML 文件
const html = fs.readFileSync('index.html', 'utf-8');

// 用正则替换 TIMELINE 数据块
const timelineStart = '// =====================================================================\n// 多天数据\n// =====================================================================\nconst TIMELINE = {';
const timelineEnd = '};\n\n// =====================================================================\n// 标准值';

const startIdx = html.indexOf(timelineStart);
const endIdx = html.indexOf(timelineEnd, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.log('找不到 TIMELINE 数据块，尝试其他匹配方式');
  // 尝试简单匹配
  const s2 = 'const TIMELINE = {';
  const e2 = '};\n\n// =====================================================================\n// 标准值';
  const si2 = html.indexOf(s2);
  const ei2 = html.indexOf(e2, si2);
  if (si2 === -1 || ei2 === -1) {
    console.error('无法找到 TIMELINE 块，退出');
    process.exit(1);
  }
  startIdx = si2;
  endIdx = ei2 + 2; // 包含 };
}

// 生成新的 TIMELINE 代码
const timelineCode = 'const TIMELINE = ' + JSON.stringify(TIMELINE, null, 4)
  .replace(/"supplier":/g, 'supplier:')
  .replace(/"qty":/g, 'qty:')
  .replace(/"cat":/g, 'cat:')
  .replace(/"limit":/g, 'limit:')
  + ';\n';

// 替换
const newHtml = html.substring(0, startIdx) + timelineCode + '\n' + html.substring(endIdx + 2);

// 写入更新后的 HTML
fs.writeFileSync('index.html', newHtml, 'utf-8');
console.log('HTML 报表已更新');

// 验证更新
const dates = Object.keys(TIMELINE).sort();
console.log(`包含日期: ${dates.join(', ')}`);
for (const d of dates) {
  let total = 0;
  for (const z of Object.keys(TIMELINE[d])) {
    for (const c of Object.keys(TIMELINE[d][z])) {
      total += TIMELINE[d][z][c].length;
    }
  }
  console.log(`  ${d}: ${total} 条数据`);
}
