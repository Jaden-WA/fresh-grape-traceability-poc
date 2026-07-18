import { readFile } from "node:fs/promises";
import path from "node:path";
import { network } from "hardhat";
import { writeDeploymentFiles } from "./lib/deploymentFiles.js";
import { processTemperatureLog, sha256Bytes } from "./lib/temperatureOracle.js";
import type {
  ActorRegistry,
  GrapeTraceability,
} from "../types/ethers-contracts/index.js";

const Role = {
  Administrator: 1,
  Producer: 2,
  Transporter: 3,
  Retailer: 4,
  Regulator: 5,
} as const;

const QualityType = {
  TemperatureSummary: 0,
  Inspection: 1,
} as const;

const statusNames = ["None", "Created", "InTransit", "Delivered", "Flagged", "Recalled"];

const { ethers, networkName } = await network.create();
const [admin, producer, transporter, retailer, regulator] = await ethers.getSigners();

console.log("Fresh Grape Traceability PoC Demo");
console.log(`Network: ${networkName}`);

console.log("\n[1/9] Deploying two smart contracts");
const registry = (await ethers.deployContract("ActorRegistry")) as unknown as ActorRegistry;
await registry.waitForDeployment();
const registryAddress = await registry.getAddress();
const traceability = (await ethers.deployContract("GrapeTraceability", [
  registryAddress,
])) as unknown as GrapeTraceability;
await traceability.waitForDeployment();
const traceabilityAddress = await traceability.getAddress();

const chain = await ethers.provider.getNetwork();
await writeDeploymentFiles({
  network: networkName,
  chainId: Number(chain.chainId),
  deployer: await admin.getAddress(),
  actorRegistry: registryAddress,
  grapeTraceability: traceabilityAddress,
  deployedAt: new Date().toISOString(),
});

console.log(`ActorRegistry.sol: ${registryAddress}`);
console.log(`GrapeTraceability.sol: ${traceabilityAddress}`);

console.log("\n[2/9] Administrator registers the regulator");
await (
  await registry.registerActor(await regulator.getAddress(), Role.Regulator)
).wait();

console.log("[3/9] Regulator registers producer, transporter, and retailer");
for (const [signer, role] of [
  [producer, Role.Producer],
  [transporter, Role.Transporter],
  [retailer, Role.Retailer],
] as const) {
  await (
    await registry.connect(regulator).registerActor(await signer.getAddress(), role)
  ).wait();
}

const batchId = "GRAPE-2026-001";
const harvestDate = Math.floor(Date.now() / 1000) - 86_400;
console.log(`\n[4/9] Producer creates batch ${batchId}`);
await (
  await traceability
    .connect(producer)
    .createBatch(batchId, "Fresh table grapes", harvestDate)
).wait();
const key = await traceability.batchKey(batchId);

console.log("[5/9] Producer transfers custody to transporter");
await (
  await traceability
    .connect(producer)
    .transferCustody(key, await transporter.getAddress(), ethers.id("pickup-GRAPE-2026-001"))
).wait();

console.log("[6/9] Off-chain oracle computes a temperature summary and file hashes");
const temperatureEvidence = await processTemperatureLog(
  path.join(process.cwd(), "data", "temperature-logs", `${batchId}.json`),
  path.join(process.cwd(), "offchain-storage"),
);
console.log(
  `Temperature range: ${temperatureEvidence.summary.minimumC}C to ${temperatureEvidence.summary.maximumC}C`,
);
console.log(`Threshold breached: ${temperatureEvidence.summary.thresholdBreached}`);
console.log(`Raw evidence stored at: ${temperatureEvidence.storedEvidencePath}`);
console.log(`Summary stored at: ${temperatureEvidence.storedSummaryPath}`);

console.log("[7/9] Transporter submits only the hash, summary hash, and URI on-chain");
await (
  await traceability.connect(transporter).addQualityRecord(
    key,
    QualityType.TemperatureSummary,
    temperatureEvidence.evidenceHash,
    temperatureEvidence.summaryHash,
    temperatureEvidence.uri,
    temperatureEvidence.summary.thresholdBreached,
  )
).wait();

console.log("[8/9] Transporter transfers custody to retailer, who records inspection evidence");
await (
  await traceability
    .connect(transporter)
    .transferCustody(key, await retailer.getAddress(), ethers.id("delivery-GRAPE-2026-001"))
).wait();

const inspectionPath = path.join(
  process.cwd(),
  "data",
  "inspection-documents",
  `${batchId}.json`,
);
const inspectionHash = sha256Bytes(await readFile(inspectionPath));
await (
  await traceability.connect(retailer).addQualityRecord(
    key,
    QualityType.Inspection,
    inspectionHash,
    ethers.ZeroHash,
    `offchain://inspection/${batchId}`,
    false,
  )
).wait();

console.log("[9/9] Regulator recalls the batch and the trace view reads final state");
await (
  await traceability
    .connect(regulator)
    .markRecalled(key, inspectionHash, `offchain://recall/${batchId}`)
).wait();

const batch = await traceability.getBatch(key);
const custodyRecords = await traceability.getCustodyHistory(key);
const qualityRecords = await traceability.getQualityHistory(key);

console.log("\nFinal read-only trace view");
console.log(`Batch: ${batch.externalId}`);
console.log(`Status: ${statusNames[Number(batch.status)]}`);
console.log(`Current custodian: ${batch.currentCustodian}`);
console.log(`Custody transfers: ${custodyRecords.length}`);
console.log(`Quality records: ${qualityRecords.length}`);
console.log("Demo completed successfully.");
