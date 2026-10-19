import * as fs from 'fs';
import * as path from 'path';

const R2_PUBLIC_URL =
  process.env.R2_PUBLIC_URL ||
  'https://pub-5737c359e0b24ed9ae7fcae02ee90a69.r2.dev';

const TARGET_DIR = path.resolve(process.cwd(), '../data/gold/mining');

const FILES = [
  'graph_coauthorship.json',
  'association_rules.json',
  'clusters.json',
  'eda_summary.json',
  'mining_manifest.json',
  'trends_anomalies.json',
];

async function syncMiningArtifacts() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  console.log(`Syncing mining artifacts from R2 (${R2_PUBLIC_URL}) to: ${TARGET_DIR}`);

  for (const file of FILES) {
    const targetFile = path.join(TARGET_DIR, file);
    if (fs.existsSync(targetFile)) {
      console.log(`- ${file} already exists locally.`);
      continue;
    }

    const fileUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/gold/mining/${file}`;
    console.log(`- Fetching ${file} from ${fileUrl}...`);
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) {
        console.warn(`  Failed to fetch ${file}: ${res.status}`);
        continue;
      }
      const data = await res.arrayBuffer();
      fs.writeFileSync(targetFile, Buffer.from(data));
      console.log(`  Saved ${file} (${(data.byteLength / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.warn(`  Error fetching ${file}: ${(err as Error).message}`);
    }
  }

  console.log('Mining artifacts sync completed.');
}

syncMiningArtifacts().catch((err) => {
  console.error('Error in sync-r2:', err);
  process.exit(1);
});
