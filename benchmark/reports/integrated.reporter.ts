import * as fs from 'fs';
import * as path from 'path';
import { IntegratedSuiteResult } from '../schemas/integrated.schema';
import { generateTechnicalReport } from './integrated-technical.reporter';
import { generateExecutiveSummary } from './integrated-executive.reporter';

export interface SavedIntegratedReports {
  jsonPath: string;
  technicalReportPath: string;
  executiveSummaryPath: string;
}

export function saveIntegratedReports(
  result: IntegratedSuiteResult,
  outputDir: string,
  baseFileName?: string,
): SavedIntegratedReports {
  const dir = path.resolve(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const prefix =
    baseFileName ||
    `integrated-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const jsonPath = path.join(dir, `${prefix}.json`);
  const technicalReportPath = path.join(dir, `${prefix}-technical.md`);
  const executiveSummaryPath = path.join(dir, `${prefix}-executive.md`);

  const technicalMd = generateTechnicalReport(result);
  const executiveMd = generateExecutiveSummary(result);

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(technicalReportPath, technicalMd, 'utf8');
  fs.writeFileSync(executiveSummaryPath, executiveMd, 'utf8');

  return {
    jsonPath,
    technicalReportPath,
    executiveSummaryPath,
  };
}
