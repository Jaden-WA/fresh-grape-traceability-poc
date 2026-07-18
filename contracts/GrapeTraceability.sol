// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ActorRegistry} from "./ActorRegistry.sol";

/// @title GrapeTraceability
/// @notice Tracks grape batches, custody, quality evidence and safety actions.
contract GrapeTraceability {
    enum BatchStatus {
        None,
        Created,
        InTransit,
        Delivered,
        Flagged,
        Recalled
    }

    enum QualityType {
        TemperatureSummary,
        Inspection,
        Delivery
    }

    struct Batch {
        string externalId;
        string productType;
        address producer;
        address currentCustodian;
        uint64 harvestDate;
        uint64 createdAt;
        uint32 transferCount;
        uint32 qualityRecordCount;
        BatchStatus status;
    }

    struct CustodyRecord {
        address from;
        address to;
        uint64 transferredAt;
        bytes32 deliveryEvidenceHash;
    }

    struct QualityRecord {
        QualityType recordType;
        bytes32 evidenceHash;
        bytes32 summaryHash;
        string uri;
        address submittedBy;
        uint64 submittedAt;
        bool thresholdBreached;
    }

    ActorRegistry public immutable actorRegistry;

    mapping(bytes32 batchKey => Batch batch) private batches;
    mapping(bytes32 batchKey => CustodyRecord[] records) private custodyHistory;
    mapping(bytes32 batchKey => QualityRecord[] records) private qualityHistory;

    event BatchCreated(
        bytes32 indexed batchKey,
        string externalId,
        address indexed producer,
        string productType,
        uint64 harvestDate,
        uint64 createdAt
    );
    event CustodyTransferred(
        bytes32 indexed batchKey,
        address indexed from,
        address indexed to,
        bytes32 deliveryEvidenceHash,
        BatchStatus newStatus,
        uint64 transferredAt
    );
    event QualityAdded(
        bytes32 indexed batchKey,
        QualityType indexed recordType,
        bytes32 indexed evidenceHash,
        bytes32 summaryHash,
        string uri,
        address submittedBy,
        bool thresholdBreached,
        uint64 submittedAt
    );
    event BatchFlagged(
        bytes32 indexed batchKey,
        address indexed flaggedBy,
        bytes32 indexed reasonHash,
        string uri,
        uint64 flaggedAt
    );
    event BatchRecalled(
        bytes32 indexed batchKey,
        address indexed recalledBy,
        bytes32 indexed reasonHash,
        string uri,
        uint64 recalledAt
    );

    error ZeroAddress();
    error EmptyValue();
    error InvalidHarvestDate(uint64 harvestDate);
    error BatchAlreadyExists(bytes32 batchKey);
    error BatchDoesNotExist(bytes32 batchKey);
    error ActorNotActive(address account);
    error RequiredRole(address account, ActorRegistry.Role requiredRole);
    error NotCurrentCustodian(address caller, address currentCustodian);
    error InvalidCustodyTransition(ActorRegistry.Role fromRole, ActorRegistry.Role toRole);
    error BatchLocked(bytes32 batchKey, BatchStatus status);
    error InvalidEvidenceHash();
    error NotQualityWriter(address caller);
    error NotSafetyAuthority(address caller);
    error AlreadyFlagged(bytes32 batchKey);
    error AlreadyRecalled(bytes32 batchKey);

    constructor(address actorRegistryAddress) {
        if (actorRegistryAddress == address(0)) revert ZeroAddress();
        actorRegistry = ActorRegistry(actorRegistryAddress);
    }

    modifier onlyRole(ActorRegistry.Role role) {
        if (!actorRegistry.hasRole(msg.sender, role)) {
            revert RequiredRole(msg.sender, role);
        }
        _;
    }

    /// @notice Registers a new grape batch. Only active producers may call it.
    function createBatch(
        string calldata externalId,
        string calldata productType,
        uint64 harvestDate
    ) external onlyRole(ActorRegistry.Role.Producer) returns (bytes32 key) {
        if (bytes(externalId).length == 0 || bytes(productType).length == 0) {
            revert EmptyValue();
        }
        if (harvestDate == 0 || harvestDate > block.timestamp) {
            revert InvalidHarvestDate(harvestDate);
        }

        key = batchKey(externalId);
        if (batches[key].createdAt != 0) revert BatchAlreadyExists(key);

        uint64 createdAt = uint64(block.timestamp);
        batches[key] = Batch({
            externalId: externalId,
            productType: productType,
            producer: msg.sender,
            currentCustodian: msg.sender,
            harvestDate: harvestDate,
            createdAt: createdAt,
            transferCount: 0,
            qualityRecordCount: 0,
            status: BatchStatus.Created
        });

        emit BatchCreated(
            key,
            externalId,
            msg.sender,
            productType,
            harvestDate,
            createdAt
        );
    }

    /// @notice Transfers custody along the PoC route Producer -> Transporter -> Retailer.
    function transferCustody(
        bytes32 key,
        address newCustodian,
        bytes32 deliveryEvidenceHash
    ) external {
        if (newCustodian == address(0)) revert ZeroAddress();

        Batch storage batch = _getBatch(key);
        if (batch.currentCustodian != msg.sender) {
            revert NotCurrentCustodian(msg.sender, batch.currentCustodian);
        }
        if (
            batch.status == BatchStatus.Delivered ||
            batch.status == BatchStatus.Flagged ||
            batch.status == BatchStatus.Recalled
        ) {
            revert BatchLocked(key, batch.status);
        }

        ActorRegistry.Role fromRole = _activeRole(msg.sender);
        ActorRegistry.Role toRole = _activeRole(newCustodian);
        BatchStatus newStatus;

        if (
            fromRole == ActorRegistry.Role.Producer &&
            toRole == ActorRegistry.Role.Transporter
        ) {
            newStatus = BatchStatus.InTransit;
        } else if (
            fromRole == ActorRegistry.Role.Transporter &&
            toRole == ActorRegistry.Role.Retailer
        ) {
            newStatus = BatchStatus.Delivered;
        } else {
            revert InvalidCustodyTransition(fromRole, toRole);
        }

        uint64 transferredAt = uint64(block.timestamp);
        custodyHistory[key].push(
            CustodyRecord({
                from: msg.sender,
                to: newCustodian,
                transferredAt: transferredAt,
                deliveryEvidenceHash: deliveryEvidenceHash
            })
        );

        batch.currentCustodian = newCustodian;
        batch.status = newStatus;
        unchecked {
            batch.transferCount += 1;
        }

        emit CustodyTransferred(
            key,
            msg.sender,
            newCustodian,
            deliveryEvidenceHash,
            newStatus,
            transferredAt
        );
    }

    /// @notice Stores only verifiable hashes and a URI; detailed files remain off-chain.
    /// A threshold breach automatically flags the batch.
    function addQualityRecord(
        bytes32 key,
        QualityType recordType,
        bytes32 evidenceHash,
        bytes32 summaryHash,
        string calldata uri,
        bool thresholdBreached
    ) external {
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (bytes(uri).length == 0) revert EmptyValue();

        Batch storage batch = _getBatch(key);
        ActorRegistry.Role callerRole = _activeRole(msg.sender);
        bool isOperationalRole =
            callerRole == ActorRegistry.Role.Producer ||
            callerRole == ActorRegistry.Role.Transporter ||
            callerRole == ActorRegistry.Role.Retailer;
        bool isRegulator = callerRole == ActorRegistry.Role.Regulator;

        if (
            (!isOperationalRole || batch.currentCustodian != msg.sender) &&
            !isRegulator
        ) {
            revert NotQualityWriter(msg.sender);
        }

        uint64 submittedAt = uint64(block.timestamp);
        qualityHistory[key].push(
            QualityRecord({
                recordType: recordType,
                evidenceHash: evidenceHash,
                summaryHash: summaryHash,
                uri: uri,
                submittedBy: msg.sender,
                submittedAt: submittedAt,
                thresholdBreached: thresholdBreached
            })
        );
        unchecked {
            batch.qualityRecordCount += 1;
        }

        emit QualityAdded(
            key,
            recordType,
            evidenceHash,
            summaryHash,
            uri,
            msg.sender,
            thresholdBreached,
            submittedAt
        );

        if (
            thresholdBreached &&
            batch.status != BatchStatus.Flagged &&
            batch.status != BatchStatus.Recalled
        ) {
            batch.status = BatchStatus.Flagged;
            emit BatchFlagged(key, msg.sender, evidenceHash, uri, submittedAt);
        }
    }

    function flagContaminated(
        bytes32 key,
        bytes32 reasonHash,
        string calldata uri
    ) external {
        if (reasonHash == bytes32(0)) revert InvalidEvidenceHash();
        if (bytes(uri).length == 0) revert EmptyValue();

        Batch storage batch = _getBatch(key);
        _requireSafetyAuthority(batch);
        if (batch.status == BatchStatus.Recalled) revert AlreadyRecalled(key);
        if (batch.status == BatchStatus.Flagged) revert AlreadyFlagged(key);

        batch.status = BatchStatus.Flagged;
        emit BatchFlagged(key, msg.sender, reasonHash, uri, uint64(block.timestamp));
    }

    function markRecalled(
        bytes32 key,
        bytes32 reasonHash,
        string calldata uri
    ) external {
        if (reasonHash == bytes32(0)) revert InvalidEvidenceHash();
        if (bytes(uri).length == 0) revert EmptyValue();

        Batch storage batch = _getBatch(key);
        _requireSafetyAuthority(batch);
        if (batch.status == BatchStatus.Recalled) revert AlreadyRecalled(key);

        batch.status = BatchStatus.Recalled;
        emit BatchRecalled(key, msg.sender, reasonHash, uri, uint64(block.timestamp));
    }

    function getBatch(bytes32 key) external view returns (Batch memory) {
        return _getBatch(key);
    }

    function getBatchByExternalId(string calldata externalId) external view returns (Batch memory) {
        return _getBatch(batchKey(externalId));
    }

    function getCustodyHistory(bytes32 key) external view returns (CustodyRecord[] memory) {
        _getBatch(key);
        return custodyHistory[key];
    }

    function getQualityHistory(bytes32 key) external view returns (QualityRecord[] memory) {
        _getBatch(key);
        return qualityHistory[key];
    }

    function batchExists(bytes32 key) external view returns (bool) {
        return batches[key].createdAt != 0;
    }

    function batchKey(string memory externalId) public pure returns (bytes32) {
        return keccak256(bytes(externalId));
    }

    function _getBatch(bytes32 key) internal view returns (Batch storage batch) {
        batch = batches[key];
        if (batch.createdAt == 0) revert BatchDoesNotExist(key);
    }

    function _activeRole(address account) internal view returns (ActorRegistry.Role role) {
        if (!actorRegistry.isActive(account)) revert ActorNotActive(account);
        role = actorRegistry.roleOf(account);
    }

    function _requireSafetyAuthority(Batch storage batch) internal view {
        ActorRegistry.Role callerRole = _activeRole(msg.sender);
        bool isRegulator = callerRole == ActorRegistry.Role.Regulator;
        bool isCurrentRetailer =
            callerRole == ActorRegistry.Role.Retailer &&
            batch.currentCustodian == msg.sender;
        if (!isRegulator && !isCurrentRetailer) {
            revert NotSafetyAuthority(msg.sender);
        }
    }
}
