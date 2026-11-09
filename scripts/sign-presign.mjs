import OSS from "ali-oss";
import { randomUUID } from "node:crypto";

const required = [
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_BUCKET",
  "OSS_REGION",
  "OSS_ENDPOINT"
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`缺少环境变量：${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  const client = new OSS({
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    region: process.env.OSS_REGION,
    endpoint: process.env.OSS_ENDPOINT
  });
  const keys = new Map([
    ["worklog/manifest.json", { count: 20, contentType: "application/json" }]
  ]);
  for (const name of ["tasks", "attachments", "status_history", "devices"]) {
    keys.set(`worklog/${name}.json`, { count: 3, contentType: "application/json" });
  }
  const currentMonth = new Date();
  for (let offset = 0; offset < 12; offset += 1) {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + offset,
      1
    );
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    keys.set(`worklog/archive/${month}.json`, {
      count: 1,
      contentType: "application/json"
    });
  }
  const remainingAttachmentUrls = 50 -
    [...keys.values()].reduce((total, entry) => total + entry.count, 0);
  const fileTypes = [
    ["report.pdf", "application/pdf"],
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["record.txt", "text/plain"],
    ["document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["archive.zip", "application/zip"]
  ];
  for (let index = 0; index < remainingAttachmentUrls; index += 1) {
    const [fileName, contentType] = fileTypes[index % fileTypes.length];
    keys.set(`worklog/attachments/${randomUUID()}-${fileName}`, {
      count: 1,
      contentType
    });
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const entries = [];
  for (const [key, entry] of keys) {
    for (let index = 0; index < entry.count; index += 1) {
      for (const type of ["put", "get"]) {
        const url = await client.signatureUrl(key, {
          method: type.toUpperCase(),
          expires: 24 * 60 * 60,
          ...(type === "put" ? { "Content-Type": entry.contentType } : {})
        });
        entries.push({
          type,
          url,
          key,
          expiresAt,
          ...(type === "put" ? { contentType: entry.contentType } : {})
        });
      }
    }
  }
  process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  console.error("复制以上 JSON 到 PWA 设置页。预签名 URL 有效期 24 小时。");
}
