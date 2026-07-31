import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContractTransactionResponse } from "ethers";
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

const roleNames = [
  "None",
  "Administrator",
  "Producer",
  "Transporter",
  "Retailer",
  "Regulator",
];
const statusNames = ["None", "Created", "In Transit", "Delivered", "Flagged", "Recalled"];
const qualityNames = ["Temperature", "Inspection", "Delivery"];

const { ethers, networkName } = await network.create();
const [admin, producer, transporter, retailer, regulator] = await ethers.getSigners();
const addresses = {
  Administrator: await admin.getAddress(),
  Producer: await producer.getAddress(),
  Transporter: await transporter.getAddress(),
  Retailer: await retailer.getAddress(),
  Regulator: await regulator.getAddress(),
};
const actorNamesByAddress = new Map(
  Object.entries(addresses).map(([name, address]) => [address.toLowerCase(), name]),
);
let confirmedBusinessTransactions = 0;

function actorName(address: string): string {
  return actorNamesByAddress.get(address.toLowerCase()) ?? "Unknown actor";
}

function printDivider(): void {
  console.log("-".repeat(78));
}

async function confirmTransaction(
  call: string,
  transactionPromise: Promise<ContractTransactionResponse>,
): Promise<void> {
  console.log(`  Contract call : ${call}`);
  const transaction = await transactionPromise;
  console.log(`  Transaction   : ${transaction.hash}`);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${call} was not confirmed successfully`);
  }
  confirmedBusinessTransactions += 1;
  console.log(`  Confirmation  : block ${receipt.blockNumber}, status SUCCESS`);
}

async function printRegisteredActor(
  registry: ActorRegistry,
  label: keyof typeof addresses,
): Promise<void> {
  const address = addresses[label];
  const role = Number(await registry.roleOf(address));
  const active = await registry.isActive(address);
  console.log(
    `  Registered    : ${label} | role=${roleNames[role]} | active=${active} | ${address}`,
  );
}

console.log("\n" + "=".repeat(78));
console.log("FRESH GRAPE TRACEABILITY POC - COMPLETE INTEGRATION DEMO");
console.log("=".repeat(78));
console.log(`Network          : ${networkName}`);
console.log("Architecture     : Solidity contracts + off-chain files + oracle script");
console.log("Traditional API  : none; ethers.js calls the blockchain directly");
console.log("\nDemo accounts (unlocked local test accounts)");
for (const [label, address] of Object.entries(addresses)) {
  console.log(`  ${label.padEnd(14)}: ${address}`);
}

console.log("\n[1/9] DEPLOY TWO SMART CONTRACTS");
printDivider();
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
  deployer: addresses.Administrator,
  actorRegistry: registryAddress,
  grapeTraceability: traceabilityAddress,
  deployedAt: new Date().toISOString(),
});

console.log(`  Chain ID       : ${chain.chainId}`);
console.log(`  ActorRegistry  : ${registryAddress}`);
console.log(`  Traceability   : ${traceabilityAddress}`);
console.log("  Deployment     : addresses.txt and deployment record generated");
console.log("  Constructor    : deployer automatically registered as Administrator");
await printRegisteredActor(registry, "Administrator");

console.log("\n[2/9] ADMINISTRATOR REGISTERS THE REGULATOR");
printDivider();
console.log(`  Caller         : Administrator (${addresses.Administrator})`);
await confirmTransaction(
  "ActorRegistry.registerActor(regulator, Regulator)",
  registry.registerActor(addresses.Regulator, Role.Regulator),
);
await printRegisteredActor(registry, "Regulator");

console.log("\n[3/9] REGULATOR REGISTERS OPERATIONAL PARTICIPANTS");
printDivider();
console.log(`  Caller         : Regulator (${addresses.Regulator})`);
for (const [label, signer, role] of [
  ["Producer", producer, Role.Producer],
  ["Transporter", transporter, Role.Transporter],
  ["Retailer", retailer, Role.Retailer],
] as const) {
  await confirmTransaction(
    `ActorRegistry.registerActor(${label.toLowerCase()}, ${label})`,
    registry.connect(regulator).registerActor(await signer.getAddress(), role),
  );
  await printRegisteredActor(registry, label);
}

const batchId = "GRAPE-2026-001";
const harvestDate = Math.floor(Date.now() / 1000) - 86_400;
console.log(`\n[4/9] PRODUCER CREATES BATCH ${batchId}`);
printDivider();
console.log(`  Caller         : Producer (${addresses.Producer})`);
console.log("  Product        : Fresh table grapes");
console.log(`  Harvest date   : ${new Date(harvestDate * 1000).toISOString()}`);
await confirmTransaction(
  "GrapeTraceability.createBatch(externalId, productType, harvestDate)",
  traceability
    .connect(producer)
    .createBatch(batchId, "Fresh table grapes", harvestDate),
);
const key = await traceability.batchKey(batchId);
console.log(`  Batch key      : ${key}`);
console.log("  On-chain state : status=Created, current custodian=Producer");

console.log("\n[5/9] PRODUCER TRANSFERS CUSTODY TO TRANSPORTER");
printDivider();
const pickupEvidenceHash = ethers.id(`pickup:${batchId}`);
console.log(`  Route          : Producer -> Transporter`);
console.log(`  Evidence hash  : ${pickupEvidenceHash}`);
await confirmTransaction(
  "GrapeTraceability.transferCustody(batchKey, transporter, pickupHash)",
  traceability
    .connect(producer)
    .transferCustody(key, addresses.Transporter, pickupEvidenceHash),
);
console.log("  On-chain state : status=In Transit, current custodian=Transporter");

console.log("\n[6/9] OFF-CHAIN ORACLE PROCESSES TEMPERATURE EVIDENCE");
printDivider();
const temperatureInputPath = path.join(
  process.cwd(),
  "data",
  "temperature-logs",
  `${batchId}.json`,
);
console.log(`  Input file     : ${path.relative(process.cwd(), temperatureInputPath)}`);
const temperatureEvidence = await processTemperatureLog(
  temperatureInputPath,
  path.join(process.cwd(), "offchain-storage"),
);
console.log(`  Sensor         : ${temperatureEvidence.summary.sensorId}`);
console.log(`  Readings       : ${temperatureEvidence.summary.readingCount}`);
console.log(
  `  Allowed range : ${temperatureEvidence.summary.allowedMinC}C to ${temperatureEvidence.summary.allowedMaxC}C`,
);
console.log(
  `  Computed      : min=${temperatureEvidence.summary.minimumC}C | avg=${temperatureEvidence.summary.averageC}C | max=${temperatureEvidence.summary.maximumC}C`,
);
console.log(
  `  Threshold     : breached=${temperatureEvidence.summary.thresholdBreached} | breach count=${temperatureEvidence.summary.breachCount}`,
);
console.log(`  Evidence hash  : ${temperatureEvidence.evidenceHash}`);
console.log(`  Summary hash   : ${temperatureEvidence.summaryHash}`);
console.log(`  Evidence URI   : ${temperatureEvidence.uri}`);
console.log(`  Raw file       : ${temperatureEvidence.storedEvidencePath}`);
console.log(`  Summary file   : ${temperatureEvidence.storedSummaryPath}`);
console.log("  Privacy rule   : detailed readings remain off-chain");

console.log("\n[7/9] TRANSPORTER SUBMITS THE ORACLE RESULT ON-CHAIN");
printDivider();
console.log(`  Caller         : Transporter (${addresses.Transporter})`);
console.log("  On-chain data  : evidence hash, summary hash, URI, threshold result");
await confirmTransaction(
  "GrapeTraceability.addQualityRecord(batchKey, Temperature, hashes, URI, breach)",
  traceability.connect(transporter).addQualityRecord(
    key,
    QualityType.TemperatureSummary,
    temperatureEvidence.evidenceHash,
    temperatureEvidence.summaryHash,
    temperatureEvidence.uri,
    temperatureEvidence.summary.thresholdBreached,
  ),
);
console.log("  Event emitted  : QualityAdded");

console.log("\n[8/9] DELIVERY TO RETAILER AND INSPECTION RECORD");
printDivider();
const deliveryEvidenceHash = ethers.id(`delivery:${batchId}`);
console.log("  Route          : Transporter -> Retailer");
console.log(`  Evidence hash  : ${deliveryEvidenceHash}`);
await confirmTransaction(
  "GrapeTraceability.transferCustody(batchKey, retailer, deliveryHash)",
  traceability
    .connect(transporter)
    .transferCustody(key, addresses.Retailer, deliveryEvidenceHash),
);

const inspectionPath = path.join(
  process.cwd(),
  "data",
  "inspection-documents",
  `${batchId}.json`,
);
const inspectionHash = sha256Bytes(await readFile(inspectionPath));
const inspectionUri = `offchain://inspection/${batchId}`;
console.log(`  Inspection file: ${path.relative(process.cwd(), inspectionPath)}`);
console.log(`  Inspection hash: ${inspectionHash}`);
console.log(`  Inspection URI : ${inspectionUri}`);
console.log(`  Caller         : Retailer (${addresses.Retailer})`);
await confirmTransaction(
  "GrapeTraceability.addQualityRecord(batchKey, Inspection, hash, URI)",
  traceability.connect(retailer).addQualityRecord(
    key,
    QualityType.Inspection,
    inspectionHash,
    ethers.ZeroHash,
    inspectionUri,
    false,
  ),
);
console.log("  On-chain state : status=Delivered, current custodian=Retailer");

console.log("\n[9/9] REGULATOR RECALLS THE BATCH AND READS THE FINAL TRACE");
printDivider();
console.log(`  Caller         : Regulator (${addresses.Regulator})`);
await confirmTransaction(
  "GrapeTraceability.markRecalled(batchKey, reasonHash, URI)",
  traceability
    .connect(regulator)
    .markRecalled(key, inspectionHash, `offchain://recall/${batchId}`),
);
console.log("  Event emitted  : BatchRecalled");

const batch = await traceability.getBatch(key);
const custodyRecords = await traceability.getCustodyHistory(key);
const qualityRecords = await traceability.getQualityHistory(key);

console.log("\n" + "=".repeat(78));
console.log("FINAL READ-ONLY TRACE VIEW");
console.log("=".repeat(78));
console.log(`Batch ID         : ${batch.externalId}`);
console.log(`Product          : ${batch.productType}`);
console.log(`Producer         : ${actorName(batch.producer)} (${batch.producer})`);
console.log(
  `Current custodian: ${actorName(batch.currentCustodian)} (${batch.currentCustodian})`,
);
console.log(`Status           : ${statusNames[Number(batch.status)]}`);
console.log(`Custody transfers: ${custodyRecords.length}`);
for (const [index, record] of custodyRecords.entries()) {
  console.log(
    `  ${index + 1}. ${actorName(record.from)} -> ${actorName(record.to)} | ${record.deliveryEvidenceHash}`,
  );
}
console.log(`Quality records  : ${qualityRecords.length}`);
for (const [index, record] of qualityRecords.entries()) {
  console.log(
    `  ${index + 1}. ${qualityNames[Number(record.recordType)]} | submitted by ${actorName(record.submittedBy)}`,
  );
  console.log(`     Evidence    : ${record.evidenceHash}`);
  console.log(`     URI         : ${record.uri}`);
  console.log(`     Breached    : ${record.thresholdBreached}`);
}

console.log("\nRequirement evidence");
console.log("  [OK] Blockchain interaction and confirmed transactions");
console.log("  [OK] ActorRegistry.sol business logic and role checks");
console.log("  [OK] GrapeTraceability.sol custody, quality, and recall logic");
console.log("  [OK] Off-chain temperature computation");
console.log("  [OK] File-backed off-chain evidence storage");
console.log("  [OK] Oracle result submitted as hashes and URI");
console.log(`  [OK] ${confirmedBusinessTransactions} confirmed business transactions`);
console.log("\nDEMO COMPLETED SUCCESSFULLY\n");

