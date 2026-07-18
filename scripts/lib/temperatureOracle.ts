import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FileEvidenceStore } from "./fileEvidenceStore.js";

export interface TemperatureReading {
  timestamp: string;
  celsius: number;
}

export interface TemperatureLog {
  batchId: string;
  sensorId: string;
  allowedMinC: number;
  allowedMaxC: number;
  readings: TemperatureReading[];
}

export interface TemperatureSummary {
  batchId: string;
  sensorId: string;
  readingCount: number;
  minimumC: number;
  maximumC: number;
  averageC: number;
  allowedMinC: number;
  allowedMaxC: number;
  breachCount: number;
  thresholdBreached: boolean;
  firstReadingAt: string;
  lastReadingAt: string;
}

export interface ProcessedTemperatureEvidence {
  batchId: string;
  evidenceHash: `0x${string}`;
  summaryHash: `0x${string}`;
  uri: string;
  storedEvidencePath: string;
  storedSummaryPath: string;
  summary: TemperatureSummary;
}

export function sha256Bytes(value: Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function validateLog(log: TemperatureLog): void {
  if (!log.batchId || !log.sensorId) {
    throw new Error("Temperature log requires batchId and sensorId");
  }
  if (!Number.isFinite(log.allowedMinC) || !Number.isFinite(log.allowedMaxC)) {
    throw new Error("Temperature limits must be finite numbers");
  }
  if (log.allowedMinC >= log.allowedMaxC) {
    throw new Error("allowedMinC must be lower than allowedMaxC");
  }
  if (!Array.isArray(log.readings) || log.readings.length === 0) {
    throw new Error("Temperature log requires at least one reading");
  }

  for (const reading of log.readings) {
    if (!Number.isFinite(reading.celsius)) {
      throw new Error("Each temperature reading must be finite");
    }
    if (Number.isNaN(Date.parse(reading.timestamp))) {
      throw new Error(`Invalid reading timestamp: ${reading.timestamp}`);
    }
  }
}

export function computeTemperatureSummary(log: TemperatureLog): TemperatureSummary {
  validateLog(log);

  const readings = [...log.readings].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  const values = readings.map((reading) => reading.celsius);
  const total = values.reduce((sum, value) => sum + value, 0);
  const breachCount = values.filter(
    (value) => value < log.allowedMinC || value > log.allowedMaxC,
  ).length;

  return {
    batchId: log.batchId,
    sensorId: log.sensorId,
    readingCount: values.length,
    minimumC: Math.min(...values),
    maximumC: Math.max(...values),
    averageC: Number((total / values.length).toFixed(2)),
    allowedMinC: log.allowedMinC,
    allowedMaxC: log.allowedMaxC,
    breachCount,
    thresholdBreached: breachCount > 0,
    firstReadingAt: readings[0].timestamp,
    lastReadingAt: readings[readings.length - 1].timestamp,
  };
}

export async function processTemperatureLog(
  inputPath: string,
  storageRoot: string,
): Promise<ProcessedTemperatureEvidence> {
  const originalBytes = await readFile(inputPath);
  const parsed = JSON.parse(originalBytes.toString("utf8")) as TemperatureLog;
  const summary = computeTemperatureSummary(parsed);
  const evidenceHash = sha256Bytes(originalBytes);
  const summaryBytes = Buffer.from(JSON.stringify(summary), "utf8");
  const summaryHash = sha256Bytes(summaryBytes);

  const store = new FileEvidenceStore(storageRoot);
  const safeBatchId = parsed.batchId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const hashPrefix = evidenceHash.slice(2, 14);
  const storedEvidencePath = await store.storeBytes(
    "temperature-logs",
    `${safeBatchId}-${hashPrefix}.json`,
    originalBytes,
  );
  const storedSummaryPath = await store.storeJson(
    "temperature-summaries",
    `${safeBatchId}-${hashPrefix}.json`,
    summary,
  );

  return {
    batchId: parsed.batchId,
    evidenceHash,
    summaryHash,
    uri: `offchain://temperature/${safeBatchId}/${hashPrefix}`,
    storedEvidencePath: path.relative(process.cwd(), storedEvidencePath),
    storedSummaryPath: path.relative(process.cwd(), storedSummaryPath),
    summary,
  };
}
