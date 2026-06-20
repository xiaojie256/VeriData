const fs = require('fs');
const [,, input, output] = process.argv;

if (!input || !output) {
  console.error('用法: node scripts/convert-json.js <输入文件> <输出文件>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'));

if (!Array.isArray(data.records)) {
  console.error('输入 JSON 必须包含 records 数组');
  process.exit(1);
}

const result = {
  dataset: data.dataset,
  source: data.source,
  measurements: data.records.map((r, idx) => ({
    id: idx + 1,
    station: r.station_id,
    region: r.city,
    metrics: {
      pm25: r.pm25,
      pm10: r.pm10,
      temperature: r.temperature,
      humidity: r.humidity,
    },
    collectedAt: r.time,
  })),
};

fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
console.log(`已转换: ${input} -> ${output}`);
