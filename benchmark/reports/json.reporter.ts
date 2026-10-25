import * as fs from 'fs';
import * as path from 'path';
import { RetrievalSuiteResult } from '../runners/retrieval.runner';

export function saveJsonReport(
  suiteResult: RetrievalSuiteResult,
  outputDir: string,
  fileName?: string,
): string {
  const dir = path.resolve(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const name =
    fileName ||
    `retrieval-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fullPath = path.join(dir, name);

  fs.writeFileSync(fullPath, JSON.stringify(suiteResult, null, 2), 'utf8');
  return fullPath;
}
