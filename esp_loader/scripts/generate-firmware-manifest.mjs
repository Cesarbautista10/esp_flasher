import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firmwareDir = path.resolve(__dirname, "../public/firmware");
const manifestPath = path.join(firmwareDir, "manifest.json");

async function main() {
  const entries = await fs.readdir(firmwareDir, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".bin"))
    .sort((a, b) => a.localeCompare(b));

  const payload = {
    files,
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Firmware manifest updated: ${manifestPath}`);
}

main().catch((error) => {
  console.error("Failed to generate firmware manifest:", error);
  process.exitCode = 1;
});
