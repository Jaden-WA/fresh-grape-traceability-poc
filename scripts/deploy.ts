import { network } from "hardhat";
import { writeDeploymentFiles } from "./lib/deploymentFiles.js";

const { ethers, networkName } = await network.create();
const [deployer] = await ethers.getSigners();
const deployerAddress = await deployer.getAddress();

console.log(`Deploying contracts to ${networkName}...`);
console.log(`Deployer: ${deployerAddress}`);

const actorRegistry = await ethers.deployContract("ActorRegistry");
await actorRegistry.waitForDeployment();
const actorRegistryAddress = await actorRegistry.getAddress();

const grapeTraceability = await ethers.deployContract("GrapeTraceability", [
  actorRegistryAddress,
]);
await grapeTraceability.waitForDeployment();
const grapeTraceabilityAddress = await grapeTraceability.getAddress();

const chain = await ethers.provider.getNetwork();
await writeDeploymentFiles({
  network: networkName,
  chainId: Number(chain.chainId),
  deployer: deployerAddress,
  actorRegistry: actorRegistryAddress,
  grapeTraceability: grapeTraceabilityAddress,
  deployedAt: new Date().toISOString(),
});

console.log(`ActorRegistry.sol: ${actorRegistryAddress}`);
console.log(`GrapeTraceability.sol: ${grapeTraceabilityAddress}`);
console.log("Deployment details written to addresses.txt and deployments/<network>.json");
