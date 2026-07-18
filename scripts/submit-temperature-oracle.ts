import { readFile } from "node:fs/promises";
import path from "node:path";
import { Wallet } from "ethers";
import { network } from "hardhat";
import { processTemperatureLog } from "./lib/temperatureOracle.js";

interface DeploymentFile {
  grapeTraceability: string;
}

const { ethers, networkName } = await network.create();
const deploymentPath = path.join(process.cwd(), "deployments", `${networkName}.json`);
const deployment = JSON.parse(await readFile(deploymentPath, "utf8")) as DeploymentFile;

const [defaultSigner] = await ethers.getSigners();
const signer = process.env.ORACLE_PRIVATE_KEY
  ? new Wallet(process.env.ORACLE_PRIVATE_KEY, ethers.provider)
  : defaultSigner;

const inputPath = path.resolve(
  process.cwd(),
  process.env.ORACLE_INPUT ?? "data/temperature-logs/GRAPE-2026-001.json",
);
const evidence = await processTemperatureLog(
  inputPath,
  path.join(process.cwd(), "offchain-storage"),
);
const batchId = process.env.BATCH_ID ?? evidence.batchId;

if (batchId !== evidence.batchId) {
  throw new Error(`BATCH_ID ${batchId} does not match log batchId ${evidence.batchId}`);
}

const traceability = await ethers.getContractAt(
  "GrapeTraceability",
  deployment.grapeTraceability,
  signer,
);
const key = await traceability.batchKey(batchId);

console.log(`Submitting oracle evidence for ${batchId} on ${networkName}`);
console.log(`Oracle signer: ${await signer.getAddress()}`);
console.log(`Evidence hash: ${evidence.evidenceHash}`);
console.log(`Summary hash: ${evidence.summaryHash}`);

const transaction = await traceability.addQualityRecord(
  key,
  0,
  evidence.evidenceHash,
  evidence.summaryHash,
  evidence.uri,
  evidence.summary.thresholdBreached,
);
const receipt = await transaction.wait();
console.log(`Confirmed transaction: ${receipt?.hash}`);
