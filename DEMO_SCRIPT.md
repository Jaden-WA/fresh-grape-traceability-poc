# Presentation Demo Script

## Five-minute demo

1. Show the project folders and explain that there are two deployed contracts,
   one oracle script, and one off-chain storage adapter.
2. Run `pnpm demo`.
3. Point out actor registration: administrator registers the regulator, then the
   regulator registers the three operational actors.
4. Point out creation of `GRAPE-2026-001` and the two valid custody transfers.
5. Show the oracle output: temperature range, threshold result, evidence hash,
   summary hash, and generated off-chain file paths.
6. Point out that only hashes and URI are sent to `addQualityRecord`.
7. Show the regulator recall and final read-only trace view with status Recalled,
   two custody transfers, and two quality records.
8. Open `offchain-storage/generated/` to show that detailed records are outside
   the blockchain.

## Three-minute code walkthrough

1. `ActorRegistry.sol`: show `Role`, `registerActor`, regulator role limits, and
   `setActorActive`.
2. `GrapeTraceability.sol`: show `createBatch`, custody transition checks,
   `addQualityRecord`, automatic threshold flagging, and `markRecalled`.
3. `temperatureOracle.ts`: show validation, summary calculation and SHA-256.
4. `FileEvidenceStore`: show detailed file storage outside the chain.
5. `test/`: show permissions, state transitions, recall and oracle integration.

## Useful fallback commands

```powershell
pnpm build
pnpm test
pnpm demo
```

If Sepolia is unavailable during the presentation, use the local Hardhat EVM;
the same Solidity contracts, ethers calls, events and oracle flow are exercised.
