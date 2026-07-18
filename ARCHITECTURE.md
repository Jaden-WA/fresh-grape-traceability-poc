# Final Architecture

## Component-connector view

```mermaid
flowchart TB
    actors[Administrator / Producer / Transporter / Retailer / Regulator]
    interaction[Remix or Hardhat scripts + ethers.js + wallet]
    registry[ActorRegistry.sol]
    trace[GrapeTraceability.sol]
    events[Solidity events and read-only getters]
    oracle[Temperature oracle script]
    storage[FileEvidenceStore: logs and documents]
    chain[Hardhat local EVM or Sepolia]

    actors --> interaction
    interaction --> registry
    interaction --> trace
    registry -->|role and active checks| trace
    trace --> events
    oracle -->|hash + summary hash + URI| trace
    oracle --> storage
    registry --> chain
    trace --> chain
```

There is no traditional backend server. Hardhat/ethers scripts or Remix call the
contracts directly, and a wallet signs transactions on a public testnet.

## Main sequence

```mermaid
sequenceDiagram
    participant A as Administrator
    participant R as Regulator
    participant P as Producer
    participant T as Transporter
    participant O as Oracle script
    participant S as Off-chain store
    participant C as Solidity contracts
    participant L as Retailer

    A->>C: Register regulator
    R->>C: Register producer, transporter, retailer
    P->>C: Create grape batch
    P->>C: Transfer custody to transporter
    O->>S: Store detailed temperature log and summary
    O->>C: Submit hashes, URI and breach result as transporter
    T->>C: Transfer custody to retailer
    L->>C: Add inspection hash
    R->>C: Mark batch recalled
    L->>C: Read batch, custody and quality history
```

## FR mapping

| FR | Implementation |
| --- | --- |
| FR1 actor registration | `ActorRegistry.registerActor`, role limits and status management |
| FR2 batch registration | `GrapeTraceability.createBatch` restricted to active producers |
| FR3 custody transfer | `transferCustody` with current-custodian and role-transition checks |
| FR4 quality records | `addQualityRecord` stores hashes and URI, not detailed files |
| FR5 retrieve history | `getBatch`, `getCustodyHistory`, `getQualityHistory`, and events |
| FR6 flag and recall | `flagContaminated`, automatic breach flag, and `markRecalled` |

## NFR mapping

| NFR | Architecture response |
| --- | --- |
| Integrity and auditability | Immutable transactions, hashes, custody history and Solidity events |
| Privacy | Detailed logs and documents stay off-chain; only verification references are public |
| Transaction performance | Small on-chain records and no large documents reduce gas and confirmation work |
| Query performance | Direct getters return current state and bounded PoC histories |
| Reliability | Contract state and events remain available on the selected blockchain network |

## Task 2 feedback reflected in the final design

- Scope is limited to Producer -> Transporter -> Retailer, with Administrator and
  Regulator supporting enrolment and safety actions.
- FR1 actor enrolment and FR6 recall are implemented explicitly.
- "Authorised" is concrete: every write checks an active role and, where needed,
  current custody.
- Privacy is concrete: detailed evidence stays off-chain and hashes stay on-chain.
- The implementation is a deployable Solidity PoC rather than a traditional
  backend application.
