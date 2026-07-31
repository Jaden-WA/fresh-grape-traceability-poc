# Fresh Grape Traceability PoC

COMP6452 Project 2 Task 3 implementation of a blockchain-based fresh grape
supply-chain traceability system. The PoC uses two Solidity contracts, a
file-backed off-chain evidence store, and a temperature oracle script. It has no
traditional backend server. A lightweight React DApp and the Hardhat/ethers CLI
demo both call the same contracts and expose contract events and read-only getters.

## Task 3 coverage

| Requirement | Implementation |
| --- | --- |
| Interact with a blockchain | Hardhat local EVM and optional Sepolia deployment |
| Two smart contracts with business logic | `ActorRegistry.sol` and `GrapeTraceability.sol` |
| Off-chain computation | Temperature oracle computes min/max/average and threshold breaches |
| Off-chain storage | `FileEvidenceStore` stores detailed logs and summaries outside the EVM |
| Oracle | Authorised script submits hashes, summary hash, URI, and breach result on-chain |
| Presentation UI | React DApp calls the local blockchain directly through ethers.js |
| Testing | Role, state-machine, recall, privacy placement, oracle and integration tests |

## Architecture

- `ActorRegistry.sol` implements role-based enrolment, regulator limitations,
  role changes, suspension, and permission checks for Administrator, Producer,
  Transporter, Retailer, and Regulator.
- `GrapeTraceability.sol` implements batch registration, the valid custody route
  Producer -> Transporter -> Retailer, quality evidence, automatic flagging after
  a temperature breach, contamination reporting, recall, and trace getters.
- `scripts/lib/temperatureOracle.ts` reads detailed temperature data, validates
  it, computes a summary, and creates SHA-256 hashes.
- `scripts/lib/fileEvidenceStore.ts` is the off-chain storage adapter. It can be
  replaced by IPFS, cloud storage, or a shared database without changing the
  smart contract.
- `scripts/demo.ts` deploys and demonstrates the complete cross-component flow.
- `frontend/` provides a simple presentation DApp without a traditional backend.
  It uses the five unlocked Hardhat accounts as the five supply-chain actors.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the component and sequence views.

## On-chain and off-chain placement

On-chain:

- actor addresses, roles, active status, and enrolment events;
- batch ID, product type, producer, harvest date, current custodian and status;
- custody transfers and timestamps;
- quality evidence hash, summary hash, URI, breach result, flag and recall events.

Off-chain:

- detailed temperature readings;
- inspection documents and private logistics details;
- computed temperature summaries and original evidence files.

This placement gives an auditable proof of each file without exposing detailed
commercial or operational data on a public blockchain.

## Requirements

- Node.js 22.13.0 or later
- pnpm 11 or later

Hardhat 3 and pnpm support the Node.js version specified above. The exact package
versions are locked in `pnpm-lock.yaml`.

## Install and verify

```powershell
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Run the complete local demo

```powershell
pnpm demo
```

The demo performs these actions:

1. Deploys `ActorRegistry.sol` and `GrapeTraceability.sol`.
2. Administrator registers the regulator.
3. Regulator registers producer, transporter, and retailer.
4. Producer creates `GRAPE-2026-001`.
5. Producer transfers custody to the transporter.
6. The off-chain oracle processes temperature readings and stores detailed files.
7. Transporter submits only the hashes, URI, and breach result on-chain.
8. Transporter transfers the batch to the retailer, who adds inspection evidence.
9. Regulator recalls the batch and getters return the final trace history.

Runtime evidence is written under `offchain-storage/generated/`. This directory is
ignored by Git and must not be included in the final submission archive.

## Run the presentation DApp

Open three terminals in the project folder and run the following commands in
order. Keep the first and third terminals running.

```powershell
# Terminal 1: local blockchain
pnpm node:local

# Terminal 2: deploy both contracts and generate the frontend deployment file
pnpm deploy:localhost

# Terminal 3: presentation UI
pnpm frontend:dev
```

Open `http://127.0.0.1:5173` and select **Run full demo**. The page registers all
five roles, creates a grape batch, performs both custody transfers, computes real
SHA-256 evidence hashes in the browser, submits two quality records, recalls the
batch, and displays the final on-chain history.

The DApp uses the browser Web Crypto API for off-chain computation and
`localStorage` as its small presentation storage adapter. The CLI `pnpm demo`
continues to demonstrate the file-backed off-chain store required by the main
PoC architecture. See `FRONTEND_DEMO_GUIDE_CN.txt` for the classroom steps.

## Deploy to Sepolia

Use only a test wallet and never commit its private key.

```powershell
$env:SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_PROJECT_ID"
$env:SEPOLIA_PRIVATE_KEY="0xYOUR_TEST_WALLET_PRIVATE_KEY"
pnpm deploy:sepolia
```

The deployment script writes contract addresses to `addresses.txt`. It also
creates an ignored network deployment JSON used by the oracle script.

For a separate oracle wallet, register that wallet as the current custodian or as
a regulator, then run:

```powershell
$env:ORACLE_PRIVATE_KEY="0xYOUR_ORACLE_TEST_WALLET_PRIVATE_KEY"
$env:BATCH_ID="GRAPE-2026-001"
$env:ORACLE_INPUT="data/temperature-logs/GRAPE-2026-001.json"
pnpm oracle:sepolia
```

## Remix option

Both Solidity files can also be opened in Remix. Compile both files, deploy
`ActorRegistry.sol` first, then deploy `GrapeTraceability.sol` with the registry
address as its constructor argument. MetaMask can sign Sepolia transactions and
Sepolia Explorer can display emitted events and transaction status.

## Design patterns and code quality

- Role-Based Access Control in `ActorRegistry.sol`.
- State Machine and valid transition checks in `GrapeTraceability.sol`.
- Oracle pattern for off-chain computation and on-chain submission.
- Hash-reference privacy pattern for detailed off-chain evidence.
- Custom errors, events, immutable contract references, checks before effects,
  focused functions, NatSpec comments, and no external state-changing calls.

## Clean submission

Track only source, tests, configuration, slides, `readme.txt`, and `addresses.txt`.
Do not include `node_modules/`, `artifacts/`, `cache/`, generated TypeChain files,
runtime deployment JSON, `offchain-storage/generated/`, or `.env` files.

Run the tracked-file check before creating the final archive:

```powershell
pnpm submission:check
```

