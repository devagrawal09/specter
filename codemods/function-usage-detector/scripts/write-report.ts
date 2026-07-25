import type { Codemod } from 'codemod:ast-grep'
import type TSX from 'codemod:ast-grep/langs/tsx'
import { acquireLock, getState, setState } from 'codemod:workflow'
import { relative, resolve } from 'path'
import {
  prepareReportDirectory,
  writeReportArtifact,
} from './report-path.ts'
import {
  buildReport,
  renderHtmlReport,
  renderJsonReport,
  REPORT_STATE_KEY,
  type FunctionUsageFinding,
} from './report.ts'

const REPORT_WRITTEN_STATE_KEY = 'function-usage-report-written'

const writeReport: Codemod<TSX> = async (_root, options) => {
  const release = acquireLock(REPORT_WRITTEN_STATE_KEY)

  try {
    if (getState<boolean>(REPORT_WRITTEN_STATE_KEY)) return null

    if (options.dryRun) {
      setState(REPORT_WRITTEN_STATE_KEY, true, false)
      console.warn(
        '[function-usage-detector] dry-run analyzed source files but skipped report artifacts; rerun without --dry-run to write JSON and HTML',
      )
      return null
    }

    const outputDirectory = prepareReportDirectory(
      options.targetDir,
      options.params.report_directory ?? '.codemod-reports/function-usage',
    )
    const report = buildReport({
      findings: getState<FunctionUsageFinding[]>(REPORT_STATE_KEY) ?? [],
      minimumCallSites: threshold(
        options.params.minimum_call_sites ?? '3',
        'minimum_call_sites',
      ),
      minimumLines: threshold(
        options.params.minimum_lines ?? '3',
        'minimum_lines',
      ),
      target: '.',
    })
    const jsonPath = resolve(outputDirectory, 'function-usage-report.json')
    const htmlPath = resolve(outputDirectory, 'function-usage-report.html')

    writeReportArtifact(
      outputDirectory,
      'function-usage-report.json',
      renderJsonReport(report),
    )
    writeReportArtifact(
      outputDirectory,
      'function-usage-report.html',
      renderHtmlReport(report),
    )
    setState(REPORT_WRITTEN_STATE_KEY, true, false)

    console.warn(
      `[function-usage-detector] wrote ${report.summary.findings} findings to ` +
        `${relative(options.targetDir, jsonPath)} and ${relative(options.targetDir, htmlPath)}`,
    )
  } finally {
    release()
  }

  return null
}

function threshold(value: string, parameter: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${parameter} must be a positive integer, received ${value}`)
  }
  return parsed
}

export default writeReport
