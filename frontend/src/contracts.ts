export const RPC_URL = "http://127.0.0.1:8545";

export const ROLE = {
  None: 0,
  Administrator: 1,
  Producer: 2,
  Transporter: 3,
  Retailer: 4,
  Regulator: 5,
} as const;

export const ROLE_NAMES = [
  "None",
  "Administrator",
  "Producer",
  "Transporter",
  "Retailer",
  "Regulator",
] as const;

export const STATUS_NAMES = [
  "None",
  "Created",
  "In Transit",
  "Delivered",
  "Flagged",
  "Recalled",
] as const;

export const QUALITY_NAMES = ["Temperature", "Inspection", "Delivery"] as const;

export const ACTOR_REGISTRY_ABI = [
  "function systemAdministrator() view returns (address)",
  "function registerActor(address account, uint8 role)",
  "function updateRole(address account, uint8 newRole)",
  "function setActorActive(address account, bool active)",
  "function getActor(address account) view returns (tuple(uint8 role, bool active, uint64 registeredAt, address registeredBy))",
  "function roleOf(address account) view returns (uint8)",
  "function isActive(address account) view returns (bool)",
  "function hasRole(address account, uint8 role) view returns (bool)",
  "event ActorRegistered(address indexed account, uint8 indexed role, address indexed registeredBy, uint64 registeredAt)",
  "event ActorRoleUpdated(address indexed account, uint8 indexed oldRole, uint8 indexed newRole)",
  "event ActorStatusChanged(address indexed account, bool active)",
];

export const GRAPE_TRACEABILITY_ABI = [
  "function actorRegistry() view returns (address)",
  "function createBatch(string externalId, string productType, uint64 harvestDate) returns (bytes32 key)",
  "function transferCustody(bytes32 key, address newCustodian, bytes32 deliveryEvidenceHash)",
  "function addQualityRecord(bytes32 key, uint8 recordType, bytes32 evidenceHash, bytes32 summaryHash, string uri, bool thresholdBreached)",
  "function flagContaminated(bytes32 key, bytes32 reasonHash, string uri)",
  "function markRecalled(bytes32 key, bytes32 reasonHash, string uri)",
  "function getBatch(bytes32 key) view returns (tuple(string externalId, string productType, address producer, address currentCustodian, uint64 harvestDate, uint64 createdAt, uint32 transferCount, uint32 qualityRecordCount, uint8 status))",
  "function getCustodyHistory(bytes32 key) view returns (tuple(address from, address to, uint64 transferredAt, bytes32 deliveryEvidenceHash)[])",
  "function getQualityHistory(bytes32 key) view returns (tuple(uint8 recordType, bytes32 evidenceHash, bytes32 summaryHash, string uri, address submittedBy, uint64 submittedAt, bool thresholdBreached)[])",
  "function batchExists(bytes32 key) view returns (bool)",
  "function batchKey(string externalId) pure returns (bytes32)",
  "event BatchCreated(bytes32 indexed batchKey, string externalId, address indexed producer, string productType, uint64 harvestDate, uint64 createdAt)",
  "event CustodyTransferred(bytes32 indexed batchKey, address indexed from, address indexed to, bytes32 deliveryEvidenceHash, uint8 newStatus, uint64 transferredAt)",
  "event QualityAdded(bytes32 indexed batchKey, uint8 indexed recordType, bytes32 indexed evidenceHash, bytes32 summaryHash, string uri, address submittedBy, bool thresholdBreached, uint64 submittedAt)",
  "event BatchFlagged(bytes32 indexed batchKey, address indexed flaggedBy, bytes32 indexed reasonHash, string uri, uint64 flaggedAt)",
  "event BatchRecalled(bytes32 indexed batchKey, address indexed recalledBy, bytes32 indexed reasonHash, string uri, uint64 recalledAt)",
];

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  actorRegistry: string;
  grapeTraceability: string;
  deployedAt: string;
}

