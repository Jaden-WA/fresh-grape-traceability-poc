import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  actorRegistry: string;
  grapeTraceability: string;
  deployedAt: string;
}

export async function writeDeploymentFiles(record: DeploymentRecord): Promise<void> {
  const deploymentDirectory = path.join(process.cwd(), "deployments");
  await mkdir(deploymentDirectory, { recursive: true });

  const safeNetwork = record.network.replace(/[^a-zA-Z0-9._-]/g, "-");
  await writeFile(
    path.join(deploymentDirectory, `${safeNetwork}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );

  const addressesText = [
    "Fresh Grape Traceability PoC - Deployed Contract Addresses",
    `Network: ${record.network}`,
    `Chain ID: ${record.chainId}`,
    `Deployer: ${record.deployer}`,
    `ActorRegistry.sol: ${record.actorRegistry}`,
    `GrapeTraceability.sol: ${record.grapeTraceability}`,
    `Deployed at: ${record.deployedAt}`,
    "",
  ].join("\n");
  await writeFile(path.join(process.cwd(), "addresses.txt"), addressesText, "utf8");

  if (record.network === "localhost") {
    const frontendPublicDirectory = path.join(process.cwd(), "frontend", "public");
    await mkdir(frontendPublicDirectory, { recursive: true });
    await writeFile(
      path.join(frontendPublicDirectory, "deployment.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
  }
}

