import temperatureSource from "../../data/temperature-logs/GRAPE-2026-001.json?raw";
import inspectionSource from "../../data/inspection-documents/GRAPE-2026-001.json?raw";

interface TemperatureReading {
  timestamp: string;
  celsius: number;
}

interface TemperatureLog {
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

export interface TemperatureInput {
  sensorId: string;
  allowedMinC: number;
  allowedMaxC: number;
  values: number[];
}

export interface BrowserEvidence {
  batchId: string;
  evidenceHash: `0x${string}`;
  summaryHash: `0x${string}`;
  uri: string;
  rawStorageKey: string;
  summaryStorageKey: string;
  summary: TemperatureSummary;
}

const textEncoder = new TextEncoder();

async function sha256(value: Uint8Array): Promise<`0x${string}`> {
  const input = new Uint8Array(value.byteLength);
  input.set(value);
  const digest = await crypto.subtle.digest("SHA-256", input.buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function processTemperatureEvidence(
  batchId: string,
  input?: TemperatureInput,
): Promise<BrowserEvidence> {
  const source = JSON.parse(temperatureSource) as TemperatureLog;
  const values = input?.values ?? source.readings.map((reading) => reading.celsius);
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Temperature readings must contain at least one valid number");
  }
  if (
    input &&
    (!Number.isFinite(input.allowedMinC) ||
      !Number.isFinite(input.allowedMaxC) ||
      input.allowedMinC >= input.allowedMaxC)
  ) {
    throw new Error("The allowed minimum must be lower than the allowed maximum");
  }

  const baseTimestamp = Date.parse(source.readings[0]?.timestamp ?? new Date().toISOString());
  const log: TemperatureLog = {
    batchId,
    sensorId: input?.sensorId.trim() || source.sensorId,
    allowedMinC: input?.allowedMinC ?? source.allowedMinC,
    allowedMaxC: input?.allowedMaxC ?? source.allowedMaxC,
    readings: values.map((celsius, index) => ({
      timestamp:
        source.readings[index]?.timestamp ??
        new Date(baseTimestamp + index * 2 * 60 * 60 * 1000).toISOString(),
      celsius,
    })),
  };
  const readings = [...log.readings].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  const sortedValues = readings.map((reading) => reading.celsius);
  const total = sortedValues.reduce((sum, value) => sum + value, 0);
  const breachCount = sortedValues.filter(
    (value) => value < log.allowedMinC || value > log.allowedMaxC,
  ).length;
  const summary: TemperatureSummary = {
    batchId,
    sensorId: log.sensorId,
    readingCount: sortedValues.length,
    minimumC: Math.min(...sortedValues),
    maximumC: Math.max(...sortedValues),
    averageC: Number((total / sortedValues.length).toFixed(2)),
    allowedMinC: log.allowedMinC,
    allowedMaxC: log.allowedMaxC,
    breachCount,
    thresholdBreached: breachCount > 0,
    firstReadingAt: readings[0].timestamp,
    lastReadingAt: readings[readings.length - 1].timestamp,
  };

  const rawText = `${JSON.stringify(log, null, 2)}\n`;
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  const evidenceHash = await sha256(textEncoder.encode(rawText));
  const summaryHash = await sha256(textEncoder.encode(summaryText));
  const hashPrefix = evidenceHash.slice(2, 14);
  const rawStorageKey = `grape-evidence:${batchId}:${hashPrefix}:raw`;
  const summaryStorageKey = `grape-evidence:${batchId}:${hashPrefix}:summary`;

  localStorage.setItem(rawStorageKey, rawText);
  localStorage.setItem(summaryStorageKey, summaryText);

  return {
    batchId,
    evidenceHash,
    summaryHash,
    uri: `browser-storage://temperature/${batchId}/${hashPrefix}`,
    rawStorageKey,
    summaryStorageKey,
    summary,
  };
}

export async function processInspectionEvidence(batchId: string): Promise<{
  hash: `0x${string}`;
  uri: string;
  storageKey: string;
}> {
  const source = JSON.parse(inspectionSource) as Record<string, unknown>;
  const document = { ...source, batchId };
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const hash = await sha256(textEncoder.encode(text));
  const storageKey = `grape-evidence:${batchId}:inspection`;
  localStorage.setItem(storageKey, text);
  return { hash, uri: `browser-storage://inspection/${batchId}`, storageKey };
}
