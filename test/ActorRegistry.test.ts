import { expect } from "chai";
import hre from "hardhat";
import type { ActorRegistry } from "../types/ethers-contracts/index.js";

const { ethers, networkHelpers } = await hre.network.create();

const Role = {
  None: 0,
  Administrator: 1,
  Producer: 2,
  Transporter: 3,
  Retailer: 4,
  Regulator: 5,
} as const;

describe("ActorRegistry", function () {
  async function deployRegistryFixture() {
    const [admin, regulator, producer, transporter, outsider] = await ethers.getSigners();
    const registry = (await ethers.deployContract("ActorRegistry")) as unknown as ActorRegistry;
    await registry.waitForDeployment();
    return { admin, regulator, producer, transporter, outsider, registry };
  }

  it("registers the deployer as the active system administrator", async function () {
    const { admin, registry } = await networkHelpers.loadFixture(deployRegistryFixture);
    const adminAddress = await admin.getAddress();

    expect(await registry.systemAdministrator()).to.equal(adminAddress);
    expect(await registry.hasRole(adminAddress, Role.Administrator)).to.equal(true);

    const actor = await registry.getActor(adminAddress);
    expect(actor.role).to.equal(BigInt(Role.Administrator));
    expect(actor.active).to.equal(true);
    expect(actor.registeredBy).to.equal(adminAddress);
  });

  it("allows an administrator to register all participant roles", async function () {
    const { regulator, producer, registry } = await networkHelpers.loadFixture(
      deployRegistryFixture,
    );

    await expect(
      registry.registerActor(await regulator.getAddress(), Role.Regulator),
    ).to.emit(registry, "ActorRegistered");
    await expect(
      registry.registerActor(await producer.getAddress(), Role.Producer),
    ).to.emit(registry, "ActorRegistered");

    expect(await registry.hasRole(await regulator.getAddress(), Role.Regulator)).to.equal(
      true,
    );
    expect(await registry.hasRole(await producer.getAddress(), Role.Producer)).to.equal(
      true,
    );
  });

  it("allows a regulator to enrol operational actors but not privileged roles", async function () {
    const { regulator, producer, transporter, registry } = await networkHelpers.loadFixture(
      deployRegistryFixture,
    );
    await (
      await registry.registerActor(await regulator.getAddress(), Role.Regulator)
    ).wait();

    await expect(
      registry
        .connect(regulator)
        .registerActor(await producer.getAddress(), Role.Producer),
    ).to.emit(registry, "ActorRegistered");

    await expect(
      registry
        .connect(regulator)
        .registerActor(await transporter.getAddress(), Role.Regulator),
    ).to.be.revertedWithCustomError(registry, "RoleAssignmentNotAllowed");
  });

  it("rejects enrolment by an unauthorised participant", async function () {
    const { producer, transporter, registry } = await networkHelpers.loadFixture(
      deployRegistryFixture,
    );

    await expect(
      registry
        .connect(producer)
        .registerActor(await transporter.getAddress(), Role.Transporter),
    )
      .to.be.revertedWithCustomError(registry, "NotEnrolmentAuthority")
      .withArgs(await producer.getAddress());
  });

  it("rejects duplicate registrations and invalid input", async function () {
    const { producer, registry } = await networkHelpers.loadFixture(deployRegistryFixture);
    const producerAddress = await producer.getAddress();
    await (await registry.registerActor(producerAddress, Role.Producer)).wait();

    await expect(
      registry.registerActor(producerAddress, Role.Producer),
    ).to.be.revertedWithCustomError(registry, "ActorAlreadyRegistered");
    await expect(
      registry.registerActor(ethers.ZeroAddress, Role.Producer),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    await expect(
      registry.registerActor(await producer.getAddress(), Role.None),
    ).to.be.revertedWithCustomError(registry, "InvalidRole");
  });

  it("supports role updates and suspension without deleting actor history", async function () {
    const { producer, registry } = await networkHelpers.loadFixture(deployRegistryFixture);
    const producerAddress = await producer.getAddress();
    await (await registry.registerActor(producerAddress, Role.Producer)).wait();

    await expect(registry.updateRole(producerAddress, Role.Transporter)).to.emit(
      registry,
      "ActorRoleUpdated",
    );
    expect(await registry.hasRole(producerAddress, Role.Transporter)).to.equal(true);

    await expect(registry.setActorActive(producerAddress, false)).to.emit(
      registry,
      "ActorStatusChanged",
    );
    expect(await registry.isActive(producerAddress)).to.equal(false);
    expect(await registry.hasRole(producerAddress, Role.Transporter)).to.equal(false);
    expect((await registry.getActor(producerAddress)).registeredAt).to.be.greaterThan(0n);
  });

  it("protects the system administrator from deactivation or role replacement", async function () {
    const { admin, registry } = await networkHelpers.loadFixture(deployRegistryFixture);
    const adminAddress = await admin.getAddress();

    await expect(
      registry.setActorActive(adminAddress, false),
    ).to.be.revertedWithCustomError(registry, "SystemAdministratorProtected");
    await expect(
      registry.updateRole(adminAddress, Role.Regulator),
    ).to.be.revertedWithCustomError(registry, "SystemAdministratorProtected");
  });
});
