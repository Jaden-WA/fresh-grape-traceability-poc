# Presentation Demo Script

## Remix evidence versus the main demo

- Remix screenshots are contract-level validation evidence. They show that the
  Solidity functions compile, deploy and enforce roles, parameters, custody
  transitions, recall rules and revert conditions under different accounts.
- `pnpm demo` is the main end-to-end integration demonstration. It deploys both
  contracts, registers all five actors, sends confirmed blockchain transactions,
  performs off-chain temperature computation, stores evidence files, submits the
  oracle result and reads the final trace.
- Remix is therefore supporting evidence, not a replacement for the integrated
  demo. The two views exercise the same Solidity business logic.

## Recommended speaker split

- Speaker 1, on-chain (2.5 minutes): briefly show one or two successful Remix
  screenshots, then use `[1/9]` to `[5/9]` and the final trace from `pnpm demo`
  to explain deployment, actor registration, batch creation and custody.
- Speaker 2, off-chain (2.5 minutes): use `[6/9]` to `[9/9]` to explain the
  temperature summary, real SHA-256 hashes, generated files, oracle submission,
  inspection, recall and final requirement evidence.

## Five-minute demo

1. Show the project folders and explain that there are two deployed contracts,
   one oracle script, and one off-chain storage adapter.
2. Run `pnpm demo`.
3. Point out actor registration: administrator registers the regulator, then the
   regulator registers the three operational actors. Each transaction now shows
   its caller, contract function, transaction hash and confirmation block.
4. Point out creation of `GRAPE-2026-001` and the two valid custody transfers.
5. Show the oracle output: temperature range, threshold result, evidence hash,
   summary hash, and generated off-chain file paths.
6. Point out that only hashes and URI are sent to `addQualityRecord`.
7. Show the regulator recall and final read-only trace view with status Recalled,
   two custody transfers, and two quality records.
8. Point out the final Task 3 requirement checklist and ten confirmed business
   transactions, then open `offchain-storage/generated/` to show that detailed
   records are outside the blockchain.

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

