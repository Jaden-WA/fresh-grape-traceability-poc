import { expect } from "chai";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import hre from "hardhat";
import { processTemperatureLog } from "../scripts/lib/temperatureOracle.js";
import type {
  ActorRegistry,
  GrapeTraceability,
} from "../types/ethers-contracts/index.js";

const { ethers, networkHelpers } = await hre.network.create();

const Role = {
  Producer: 2,
  Transporter: 3,
  Retailer: 4,
  Regulator: 5,
} as const;

const Status = {
  Created: 1n,
  InTransit: 2n,
  Delivered: 3n,
  Flagged: 4n,
  Recalled: 5n,
} as const;

const BATCH_ID = "GRAPE-TEST-001";

describe("GrapeTraceability", function () {
  async function deploySystemFixture() {
    const [admin, producer, transporter, retailer, regulator, outsider] =
      await ethers.getSigners();
    const registry = (await ethers.deployContract("ActorRegistry")) as unknown as ActorRegistry;
    await registry.waitForDeployment();

    await (
      await registry.registerActor(await regulator.getAddress(), Role.Regulator)
    ).wait();
    await (
      await registry
        .connect(regulator)
        .registerActor(await producer.getAddress(), Role.Producer)
    ).wait();
    await (
      await registry
        .connect(regulator)
        .registerActor(await transporter.getAddress(), Role.Transporter)
    ).wait();
    await (
      await registry
        .connect(regulator)
        .registerActor(await retailer.getAddress(), Role.Retailer)
    ).wait();

    const traceability = (await ethers.deployContract("GrapeTraceability", [
      await registry.getAddress(),
    ])) as unknown as GrapeTraceability;
    await traceability.waitForDeployment();

    return {
      admin,
      producer,
      transporter,
      retailer,
      regulator,
      outsider,
      registry,
      traceability,
    };
  }

  async function createDefaultBatch(fixture: Awaited<ReturnType<typeof deploySystemFixture>>) {
    const latestBlock = await ethers.provider.getBlock("latest");
    const harvestDate = BigInt((latestBlock?.timestamp ?? 1) - 3_600);
    await (
      await fixture.traceability
        .connect(fixture.producer)
        .createBatch(BATCH_ID, "Fresh table grapes", harvestDate)
    ).wait();
    return fixture.traceability.batchKey(BATCH_ID);
  }

  it("allows only an active producer to create a batch", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, outsider, traceability } = fixture;
    const latestBlock = await ethers.provider.getBlock("latest");
    const harvestDate = BigInt((latestBlock?.timestamp ?? 1) - 3_600);

    await expect(
      traceability
        .connect(producer)
        .createBatch(BATCH_ID, "Fresh table grapes", harvestDate),
    ).to.emit(traceability, "BatchCreated");

    const key = await traceability.batchKey(BATCH_ID);
    const batch = await traceability.getBatch(key);
    expect(batch.externalId).to.equal(BATCH_ID);
    expect(batch.producer).to.equal(await producer.getAddress());
    expect(batch.currentCustodian).to.equal(await producer.getAddress());
    expect(batch.status).to.equal(Status.Created);

    await expect(
      traceability
        .connect(outsider)
        .createBatch("GRAPE-TEST-002", "Fresh table grapes", harvestDate),
    ).to.be.revertedWithCustomError(traceability, "RequiredRole");
  });

  it("rejects duplicate batches and future harvest dates", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, traceability } = fixture;
    const key = await createDefaultBatch(fixture);
    expect(await traceability.batchExists(key)).to.equal(true);

    const latestBlock = await ethers.provider.getBlock("latest");
    const validHarvestDate = BigInt((latestBlock?.timestamp ?? 1) - 3_600);
    const futureHarvestDate = BigInt((latestBlock?.timestamp ?? 1) + 3_600);

    await expect(
      traceability
        .connect(producer)
        .createBatch(BATCH_ID, "Fresh table grapes", validHarvestDate),
    ).to.be.revertedWithCustomError(traceability, "BatchAlreadyExists");
    await expect(
      traceability
        .connect(producer)
        .createBatch("GRAPE-FUTURE", "Fresh table grapes", futureHarvestDate),
    ).to.be.revertedWithCustomError(traceability, "InvalidHarvestDate");
  });

  it("enforces the Producer -> Transporter -> Retailer custody route", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, transporter, retailer, traceability } = fixture;
    const key = await createDefaultBatch(fixture);

    await expect(
      traceability
        .connect(producer)
        .transferCustody(key, await transporter.getAddress(), ethers.id("pickup")),
    ).to.emit(traceability, "CustodyTransferred");
    expect((await traceability.getBatch(key)).status).to.equal(Status.InTransit);

    await expect(
      traceability
        .connect(transporter)
        .transferCustody(key, await retailer.getAddress(), ethers.id("delivery")),
    ).to.emit(traceability, "CustodyTransferred");

    const batch = await traceability.getBatch(key);
    const history = await traceability.getCustodyHistory(key);
    expect(batch.status).to.equal(Status.Delivered);
    expect(batch.currentCustodian).to.equal(await retailer.getAddress());
    expect(batch.transferCount).to.equal(2n);
    expect(history).to.have.length(2);
    expect(history[0].from).to.equal(await producer.getAddress());
    expect(history[1].to).to.equal(await retailer.getAddress());
  });

  it("rejects invalid destinations and calls by a non-custodian", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, transporter, retailer, outsider, traceability } = fixture;
    const key = await createDefaultBatch(fixture);

    await expect(
      traceability
        .connect(producer)
        .transferCustody(key, await retailer.getAddress(), ethers.ZeroHash),
    ).to.be.revertedWithCustomError(traceability, "InvalidCustodyTransition");

    await expect(
      traceability
        .connect(outsider)
        .transferCustody(key, await transporter.getAddress(), ethers.ZeroHash),
    ).to.be.revertedWithCustomError(traceability, "NotCurrentCustodian");
  });

  it("stores only quality hashes and references on-chain", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, transporter, traceability } = fixture;
    const key = await createDefaultBatch(fixture);
    await (
      await traceability
        .connect(producer)
        .transferCustody(key, await transporter.getAddress(), ethers.id("pickup"))
    ).wait();

    const evidenceHash = ethers.id("temperature-file");
    const summaryHash = ethers.id("temperature-summary");
    await expect(
      traceability
        .connect(transporter)
        .addQualityRecord(
          key,
          0,
          evidenceHash,
          summaryHash,
          "offchain://temperature/GRAPE-TEST-001",
          false,
        ),
    ).to.emit(traceability, "QualityAdded");

    const quality = await traceability.getQualityHistory(key);
    expect(quality).to.have.length(1);
    expect(quality[0].evidenceHash).to.equal(evidenceHash);
    expect(quality[0].summaryHash).to.equal(summaryHash);
    expect((await traceability.getBatch(key)).qualityRecordCount).to.equal(1n);
  });

  it("connects the off-chain oracle output to the on-chain quality record", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, transporter, traceability } = fixture;
    const key = await createDefaultBatch(fixture);
    await (
      await traceability
        .connect(producer)
        .transferCustody(key, await transporter.getAddress(), ethers.id("pickup"))
    ).wait();

    const temporaryStore = await mkdtemp(path.join(tmpdir(), "grape-oracle-test-"));
    try {
      const evidence = await processTemperatureLog(
        path.join(process.cwd(), "data", "temperature-logs", "GRAPE-2026-001.json"),
        temporaryStore,
      );

      await (
        await traceability.connect(transporter).addQualityRecord(
          key,
          0,
          evidence.evidenceHash,
          evidence.summaryHash,
          evidence.uri,
          evidence.summary.thresholdBreached,
        )
      ).wait();

      const [record] = await traceability.getQualityHistory(key);
      expect(record.evidenceHash).to.equal(evidence.evidenceHash);
      expect(record.summaryHash).to.equal(evidence.summaryHash);
      expect(record.thresholdBreached).to.equal(false);
    } finally {
      await rm(temporaryStore, { recursive: true, force: true });
    }
  });

  it("automatically flags a batch when an oracle reports a threshold breach", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, transporter, retailer, traceability } = fixture;
    const key = await createDefaultBatch(fixture);
    await (
      await traceability
        .connect(producer)
        .transferCustody(key, await transporter.getAddress(), ethers.id("pickup"))
    ).wait();

    await expect(
      traceability.connect(transporter).addQualityRecord(
        key,
        0,
        ethers.id("breached-file"),
        ethers.id("breached-summary"),
        "offchain://temperature/breach",
        true,
      ),
    ).to.emit(traceability, "BatchFlagged");
    expect((await traceability.getBatch(key)).status).to.equal(Status.Flagged);

    await expect(
      traceability
        .connect(transporter)
        .transferCustody(key, await retailer.getAddress(), ethers.id("delivery")),
    ).to.be.revertedWithCustomError(traceability, "BatchLocked");
  });

  it("allows the regulator or current retailer to recall a batch", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { producer, transporter, retailer, regulator, traceability } = fixture;
    const key = await createDefaultBatch(fixture);
    await (
      await traceability
        .connect(producer)
        .transferCustody(key, await transporter.getAddress(), ethers.id("pickup"))
    ).wait();
    await (
      await traceability
        .connect(transporter)
        .transferCustody(key, await retailer.getAddress(), ethers.id("delivery"))
    ).wait();

    await expect(
      traceability
        .connect(retailer)
        .flagContaminated(key, ethers.id("inspection-failure"), "offchain://inspection/failure"),
    ).to.emit(traceability, "BatchFlagged");
    await expect(
      traceability
        .connect(regulator)
        .markRecalled(key, ethers.id("recall-order"), "offchain://recall/order"),
    ).to.emit(traceability, "BatchRecalled");
    expect((await traceability.getBatch(key)).status).to.equal(Status.Recalled);
  });

  it("rejects safety actions from unauthorised users", async function () {
    const fixture = await networkHelpers.loadFixture(deploySystemFixture);
    const { outsider, traceability } = fixture;
    const key = await createDefaultBatch(fixture);

    await expect(
      traceability
        .connect(outsider)
        .markRecalled(key, ethers.id("fake"), "offchain://fake"),
    ).to.be.revertedWithCustomError(traceability, "ActorNotActive");
  });
});
