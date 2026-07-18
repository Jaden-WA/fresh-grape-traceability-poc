import { expect } from "chai";
import { performance } from "node:perf_hooks";
import hre from "hardhat";
import type {
  ActorRegistry,
  GrapeTraceability,
} from "../types/ethers-contracts/index.js";

const { ethers, networkHelpers } = await hre.network.create();

describe("PoC NFR acceptance checks", function () {
  async function deployNfrFixture() {
    const [admin, producer, transporter] = await ethers.getSigners();
    const registry = (await ethers.deployContract(
      "ActorRegistry",
    )) as unknown as ActorRegistry;
    await registry.waitForDeployment();
    await (await registry.registerActor(await producer.getAddress(), 2)).wait();
    await (await registry.registerActor(await transporter.getAddress(), 3)).wait();

    const traceability = (await ethers.deployContract("GrapeTraceability", [
      await registry.getAddress(),
    ])) as unknown as GrapeTraceability;
    await traceability.waitForDeployment();

    return { admin, producer, transporter, traceability };
  }

  it("confirms registration and custody transactions within 30 seconds locally", async function () {
    const fixture = await networkHelpers.loadFixture(deployNfrFixture);
    const latestBlock = await ethers.provider.getBlock("latest");
    const harvestDate = BigInt((latestBlock?.timestamp ?? 1) - 3_600);

    const createStartedAt = performance.now();
    await (
      await fixture.traceability
        .connect(fixture.producer)
        .createBatch("GRAPE-NFR-001", "Fresh table grapes", harvestDate)
    ).wait();
    const createDurationMs = performance.now() - createStartedAt;

    const key = await fixture.traceability.batchKey("GRAPE-NFR-001");
    const transferStartedAt = performance.now();
    await (
      await fixture.traceability
        .connect(fixture.producer)
        .transferCustody(
          key,
          await fixture.transporter.getAddress(),
          ethers.id("nfr-pickup"),
        )
    ).wait();
    const transferDurationMs = performance.now() - transferStartedAt;

    expect(createDurationMs).to.be.lessThan(30_000);
    expect(transferDurationMs).to.be.lessThan(30_000);
  });

  it("returns at least 95% of trace queries within 3 seconds with 99% success", async function () {
    const fixture = await networkHelpers.loadFixture(deployNfrFixture);
    const latestBlock = await ethers.provider.getBlock("latest");
    const harvestDate = BigInt((latestBlock?.timestamp ?? 1) - 3_600);
    await (
      await fixture.traceability
        .connect(fixture.producer)
        .createBatch("GRAPE-NFR-QUERY", "Fresh table grapes", harvestDate)
    ).wait();
    const key = await fixture.traceability.batchKey("GRAPE-NFR-QUERY");

    let successfulQueries = 0;
    let queriesWithinTarget = 0;
    const queryCount = 100;

    for (let index = 0; index < queryCount; index += 1) {
      const startedAt = performance.now();
      const batch = await fixture.traceability.getBatch(key);
      const durationMs = performance.now() - startedAt;
      if (batch.externalId === "GRAPE-NFR-QUERY") successfulQueries += 1;
      if (durationMs < 3_000) queriesWithinTarget += 1;
    }

    expect(successfulQueries / queryCount).to.be.at.least(0.99);
    expect(queriesWithinTarget / queryCount).to.be.at.least(0.95);
  });
});
