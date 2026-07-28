import { expect } from "chai";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeTemperatureSummary,
  processTemperatureLog,
  type TemperatureLog,
} from "../scripts/lib/temperatureOracle.js";

describe("Temperature oracle and off-chain storage", function () {
  it("computes a deterministic summary and detects safe temperatures", function () {
    const log: TemperatureLog = {
      batchId: "BATCH-A",
      sensorId: "SENSOR-A",
      allowedMinC: 0,
      allowedMaxC: 8,
      readings: [
        { timestamp: "2026-07-01T02:00:00Z", celsius: 6 },
        { timestamp: "2026-07-01T00:00:00Z", celsius: 2 },
        { timestamp: "2026-07-01T01:00:00Z", celsius: 4 },
      ],
    };

    const summary = computeTemperatureSummary(log);
    expect(summary.minimumC).to.equal(2);
    expect(summary.maximumC).to.equal(6);
    expect(summary.averageC).to.equal(4);
    expect(summary.breachCount).to.equal(0);
    expect(summary.thresholdBreached).to.equal(false);
    expect(summary.firstReadingAt).to.equal("2026-07-01T00:00:00Z");
  });

  it("detects readings outside the configured threshold", function () {
    const summary = computeTemperatureSummary({
      batchId: "BATCH-B",
      sensorId: "SENSOR-B",
      allowedMinC: 0,
      allowedMaxC: 8,
      readings: [
        { timestamp: "2026-07-01T00:00:00Z", celsius: -0.5 },
        { timestamp: "2026-07-01T01:00:00Z", celsius: 9.2 },
      ],
    });

    expect(summary.breachCount).to.equal(2);
    expect(summary.thresholdBreached).to.equal(true);
  });

  it("rejects malformed logs", function () {
    expect(() =>
      computeTemperatureSummary({
        batchId: "BATCH-C",
        sensorId: "SENSOR-C",
        allowedMinC: 8,
        allowedMaxC: 0,
        readings: [{ timestamp: "not-a-date", celsius: 4 }],
      }),
    ).to.throw("allowedMinC must be lower than allowedMaxC");
  });

  it("stores raw evidence and summary files off-chain", async function () {
    const temporaryStore = await mkdtemp(path.join(tmpdir(), "grape-store-test-"));
    try {
      const inputPath = path.join(
        process.cwd(),
        "data",
        "temperature-logs",
        "GRAPE-2026-001.json",
      );
      const result = await processTemperatureLog(
        inputPath,
        temporaryStore,
      );
      const originalBytes = await readFile(inputPath);
      const expectedEvidenceHash = `0x${createHash("sha256")
        .update(originalBytes)
        .digest("hex")}`;
      const expectedSummaryHash = `0x${createHash("sha256")
        .update(JSON.stringify(result.summary), "utf8")
        .digest("hex")}`;

      expect(result.evidenceHash).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.summaryHash).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.evidenceHash).to.equal(expectedEvidenceHash);
      expect(result.summaryHash).to.equal(expectedSummaryHash);
      expect(result.uri).to.match(/^offchain:\/\/temperature\//);
      expect(result.summary.thresholdBreached).to.equal(false);
      await access(path.resolve(process.cwd(), result.storedEvidencePath));
      await access(path.resolve(process.cwd(), result.storedSummaryPath));
    } finally {
      await rm(temporaryStore, { recursive: true, force: true });
    }
  });
});
