import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  CloudUpload,
  Database,
  Download,
  Flag,
  Grape,
  History,
  Link2,
  PackagePlus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  ShieldCheck,
  Thermometer,
  Truck,
  UserRoundPlus,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  Contract,
  ContractFactory,
  type ContractTransactionResponse,
  id,
  type InterfaceAbi,
  JsonRpcProvider,
} from "ethers";
import {
  ACTOR_REGISTRY_ARTIFACT,
  GRAPE_TRACEABILITY_ARTIFACT,
} from "virtual:contract-artifacts";
import {
  QUALITY_NAMES,
  ROLE,
  ROLE_NAMES,
  RPC_URL,
  STATUS_NAMES,
} from "./contracts";
import {
  type BrowserEvidence,
  processTemperatureEvidence,
} from "./evidence";

const ACTOR_REGISTRY_ABI = ACTOR_REGISTRY_ARTIFACT.abi as InterfaceAbi;
const GRAPE_TRACEABILITY_ABI = GRAPE_TRACEABILITY_ARTIFACT.abi as InterfaceAbi;

type StepId =
  | "deploy"
  | "actors"
  | "batch"
  | "custody"
  | "quality"
  | "flag"
  | "recall"
  | "query";

interface DemoContext {
  provider: JsonRpcProvider;
  accounts: string[];
}

interface ActorState {
  address: string;
  role: number;
  active: boolean;
}

interface BatchState {
  externalId: string;
  productType: string;
  producer: string;
  currentCustodian: string;
  harvestDate: bigint;
  createdAt: bigint;
  transferCount: number;
  qualityRecordCount: number;
  status: number;
}

interface CustodyRecord {
  from: string;
  to: string;
  transferredAt: bigint;
  deliveryEvidenceHash: string;
}

interface QualityRecord {
  recordType: number;
  evidenceHash: string;
  summaryHash: string;
  uri: string;
  submittedBy: string;
  submittedAt: bigint;
  thresholdBreached: boolean;
}

interface RawCustodyRecord {
  0: string;
  1: string;
  2: bigint;
  3: string;
}

interface RawQualityRecord {
  0: bigint;
  1: string;
  2: string;
  3: string;
  4: string;
  5: bigint;
  6: boolean;
}

interface ActivityItem {
  id: number;
  status: "success" | "error" | "info";
  title: string;
  detail: string;
  transactionHash?: string;
  blockNumber?: number;
}

interface SavedDeployment {
  chainId: string;
  actorRegistry?: string;
  grapeTraceability?: string;
}

interface StepDefinition {
  id: StepId;
  label: string;
  contract: string;
  icon: LucideIcon;
}

const STORAGE_KEY = "fresh-grape-browser-deployment";
const EXPECTED_ROLES = [
  ROLE.Administrator,
  ROLE.Regulator,
  ROLE.Producer,
  ROLE.Transporter,
  ROLE.Retailer,
];

const STEPS: StepDefinition[] = [
  { id: "deploy", label: "Deploy contracts", contract: "ContractFactory", icon: Rocket },
  { id: "actors", label: "Register actors", contract: "ActorRegistry", icon: UserRoundPlus },
  { id: "batch", label: "Create batch", contract: "createBatch", icon: PackagePlus },
  { id: "custody", label: "Transfer custody", contract: "transferCustody", icon: Truck },
  { id: "quality", label: "Submit quality", contract: "addQualityRecord", icon: Thermometer },
  { id: "flag", label: "Flag contamination", contract: "flagContaminated", icon: Flag },
  { id: "recall", label: "Recall batch", contract: "markRecalled", icon: RotateCcw },
  { id: "query", label: "Query history", contract: "Read-only getters", icon: Search },
];

function shortAddress(value: string): string {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not deployed";
}

function shortHash(value: string): string {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : "Not available";
}

function formatTimestamp(value: bigint): string {
  return new Date(Number(value) * 1000).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      shortMessage?: string;
      reason?: string;
      message?: string;
      revert?: { name?: string };
      info?: { error?: { message?: string } };
    };
    return (
      candidate.revert?.name ??
      candidate.shortMessage ??
      candidate.reason ??
      candidate.info?.error?.message ??
      candidate.message ??
      "Unknown error"
    );
  }
  return String(error);
}

function hashEvidence(value: string): string {
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed : id(trimmed);
}

function defaultHarvestDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default function App() {
  const contextRef = useRef<DemoContext | null>(null);
  const activityIdRef = useRef(0);
  const connectStartedRef = useRef(false);

  const [connection, setConnection] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [connectionMessage, setConnectionMessage] = useState("Connecting to Hardhat node");
  const [chainId, setChainId] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [actors, setActors] = useState<ActorState[]>([]);
  const [registryAddress, setRegistryAddress] = useState("");
  const [traceabilityAddress, setTraceabilityAddress] = useState("");
  const [selectedStep, setSelectedStep] = useState<StepId>("deploy");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);

  const [batchId, setBatchId] = useState("GRAPE-WEB-001");
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [custodyHistory, setCustodyHistory] = useState<CustodyRecord[]>([]);
  const [qualityHistory, setQualityHistory] = useState<QualityRecord[]>([]);

  const [registerCaller, setRegisterCaller] = useState(0);
  const [registerTarget, setRegisterTarget] = useState(1);
  const [registerRole, setRegisterRole] = useState<number>(ROLE.Regulator);

  const [batchCaller, setBatchCaller] = useState(2);
  const [productType, setProductType] = useState("Fresh table grapes");
  const [harvestDate, setHarvestDate] = useState(defaultHarvestDate);

  const [custodyCaller, setCustodyCaller] = useState(2);
  const [custodyTarget, setCustodyTarget] = useState(3);
  const [custodyEvidence, setCustodyEvidence] = useState("pickup:GRAPE-WEB-001");

  const [oracleCaller, setOracleCaller] = useState(3);
  const [sensorId, setSensorId] = useState("TEMP-SENSOR-17");
  const [allowedMin, setAllowedMin] = useState("0");
  const [allowedMax, setAllowedMax] = useState("8");
  const [temperatureValues, setTemperatureValues] = useState("4.2, 4.8, 5.1, 5.7, 5.3");
  const [evidence, setEvidence] = useState<BrowserEvidence | null>(null);

  const [flagCaller, setFlagCaller] = useState(4);
  const [flagReason, setFlagReason] = useState("inspection-failure");
  const [flagUri, setFlagUri] = useState("https://storage.example/inspection/failure.json");

  const [recallCaller, setRecallCaller] = useState(1);
  const [recallReason, setRecallReason] = useState("regulatory-recall-order");
  const [recallUri, setRecallUri] = useState("https://storage.example/recall/order.json");

  const addActivity = useCallback(
    (
      status: ActivityItem["status"],
      title: string,
      detail: string,
      transactionHash?: string,
      blockNumber?: number,
    ) => {
      activityIdRef.current += 1;
      setActivityItems((current) => [
        {
          id: activityIdRef.current,
          status,
          title,
          detail,
          transactionHash,
          blockNumber,
        },
        ...current,
      ].slice(0, 40));
    },
    [],
  );

  const requireContext = useCallback((): DemoContext => {
    if (!contextRef.current) throw new Error("Connect to the Hardhat node first");
    return contextRef.current;
  }, []);

  const requireRegistry = useCallback((): string => {
    if (!registryAddress) throw new Error("Deploy ActorRegistry first");
    return registryAddress;
  }, [registryAddress]);

  const requireTraceability = useCallback((): string => {
    if (!traceabilityAddress) throw new Error("Deploy GrapeTraceability first");
    return traceabilityAddress;
  }, [traceabilityAddress]);

  const signerAt = useCallback(
    async (index: number) => {
      const context = requireContext();
      if (!context.accounts[index]) throw new Error(`Account ${index} is not available`);
      return context.provider.getSigner(index);
    },
    [requireContext],
  );

  const persistDeployment = useCallback(
    (actorRegistry?: string, grapeTraceability?: string, nextChainId = chainId) => {
      const saved: SavedDeployment = {
        chainId: nextChainId,
        actorRegistry: actorRegistry || undefined,
        grapeTraceability: grapeTraceability || undefined,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    },
    [chainId],
  );

  const refreshActors = useCallback(
    async (context = requireContext(), address = registryAddress) => {
      if (!address) {
        setActors(context.accounts.map((account) => ({ address: account, role: 0, active: false })));
        return;
      }
      const registry = new Contract(address, ACTOR_REGISTRY_ABI, context.provider);
      const nextActors = await Promise.all(
        context.accounts.map(async (account) => ({
          address: account,
          role: Number(await registry.roleOf(account)),
          active: Boolean(await registry.isActive(account)),
        })),
      );
      setActors(nextActors);
    },
    [registryAddress, requireContext],
  );

  const refreshBatch = useCallback(
    async (targetBatchId = batchId, address = traceabilityAddress) => {
      if (!address) throw new Error("Deploy GrapeTraceability first");
      if (!targetBatchId.trim()) throw new Error("Enter a batch ID");
      const context = requireContext();
      const traceability = new Contract(address, GRAPE_TRACEABILITY_ABI, context.provider);
      const key = (await traceability.batchKey(targetBatchId.trim())) as string;
      if (!(await traceability.batchExists(key))) {
        setBatch(null);
        setCustodyHistory([]);
        setQualityHistory([]);
        addActivity("info", "Batch not found", targetBatchId.trim());
        return false;
      }

      const result = (await traceability.getBatch(key)) as unknown as BatchState;
      const custody = (await traceability.getCustodyHistory(key)) as unknown as RawCustodyRecord[];
      const quality = (await traceability.getQualityHistory(key)) as unknown as RawQualityRecord[];
      setBatch({
        externalId: result.externalId,
        productType: result.productType,
        producer: result.producer,
        currentCustodian: result.currentCustodian,
        harvestDate: result.harvestDate,
        createdAt: result.createdAt,
        transferCount: Number(result.transferCount),
        qualityRecordCount: Number(result.qualityRecordCount),
        status: Number(result.status),
      });
      setCustodyHistory(custody.map((record) => ({
        from: record[0],
        to: record[1],
        transferredAt: BigInt(record[2]),
        deliveryEvidenceHash: record[3],
      })));
      setQualityHistory(quality.map((record) => ({
        recordType: Number(record[0]),
        evidenceHash: record[1],
        summaryHash: record[2],
        uri: record[3],
        submittedBy: record[4],
        submittedAt: BigInt(record[5]),
        thresholdBreached: Boolean(record[6]),
      })));
      addActivity("info", "Trace refreshed", `${targetBatchId.trim()} is ${STATUS_NAMES[Number(result.status)]}`);
      return true;
    },
    [addActivity, batchId, requireContext, traceabilityAddress],
  );

  const connectNode = useCallback(async () => {
    setConnection("connecting");
    setConnectionMessage("Connecting to Hardhat node");
    try {
      const provider = new JsonRpcProvider(RPC_URL);
      const network = await provider.getNetwork();
      await provider.getBlockNumber();
      const signers = await provider.listAccounts();
      const nextAccounts = await Promise.all(
        signers.slice(0, 10).map((signer) => signer.getAddress()),
      );
      if (nextAccounts.length < 5) throw new Error("Hardhat must expose at least five accounts");

      const context = { provider, accounts: nextAccounts };
      contextRef.current = context;
      setAccounts(nextAccounts);
      setChainId(network.chainId.toString());
      setConnection("connected");
      setConnectionMessage(`Hardhat chain ${network.chainId.toString()}`);

      let savedRegistry = "";
      let savedTraceability = "";
      const savedText = localStorage.getItem(STORAGE_KEY);
      if (savedText) {
        const saved = JSON.parse(savedText) as SavedDeployment;
        if (saved.chainId === network.chainId.toString()) {
          if (saved.actorRegistry && await provider.getCode(saved.actorRegistry) !== "0x") {
            savedRegistry = saved.actorRegistry;
          }
          if (saved.grapeTraceability && await provider.getCode(saved.grapeTraceability) !== "0x") {
            savedTraceability = saved.grapeTraceability;
          }
        }
      }
      setRegistryAddress(savedRegistry);
      setTraceabilityAddress(savedTraceability);
      await refreshActors(context, savedRegistry);
      if (savedTraceability) {
        await refreshBatch(batchId, savedTraceability);
      }
      addActivity(
        "success",
        "Hardhat node connected",
        savedTraceability ? "Saved contracts restored" : `${nextAccounts.length} unlocked accounts available`,
      );
    } catch (error) {
      contextRef.current = null;
      setConnection("error");
      setConnectionMessage(errorMessage(error));
    }
  }, [addActivity, batchId, refreshActors, refreshBatch]);

  useEffect(() => {
    if (connectStartedRef.current) return;
    connectStartedRef.current = true;
    void connectNode();
  }, [connectNode]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (busyAction) return;
      setBusyAction(label);
      try {
        await action();
      } catch (error) {
        addActivity("error", `${label} rejected`, errorMessage(error));
      } finally {
        setBusyAction(null);
      }
    },
    [addActivity, busyAction],
  );

  const sendTransaction = useCallback(
    async (
      title: string,
      callerIndex: number,
      transactionPromise: Promise<ContractTransactionResponse>,
    ) => {
      const transaction = await transactionPromise;
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`${title} was not confirmed`);
      addActivity(
        "success",
        title,
        `Account ${callerIndex} confirmed in block ${receipt.blockNumber}`,
        transaction.hash,
        receipt.blockNumber,
      );
    },
    [addActivity],
  );

  const deployActorRegistry = useCallback(async () => {
    const context = requireContext();
    const signer = await signerAt(0);
    const factory = new ContractFactory(
      ACTOR_REGISTRY_ABI,
      ACTOR_REGISTRY_ARTIFACT.bytecode,
      signer,
    );
    const contract = await factory.deploy();
    const transaction = contract.deploymentTransaction();
    if (!transaction) throw new Error("ActorRegistry deployment transaction is unavailable");
    await contract.waitForDeployment();
    const receipt = await transaction.wait();
    const address = await contract.getAddress();
    setRegistryAddress(address);
    setTraceabilityAddress("");
    setBatch(null);
    setCustodyHistory([]);
    setQualityHistory([]);
    persistDeployment(address, "", chainId);
    await refreshActors(context, address);
    addActivity(
      "success",
      "ActorRegistry deployed",
      `Administrator is Account 0, block ${receipt?.blockNumber ?? "confirmed"}`,
      transaction.hash,
      receipt?.blockNumber,
    );
  }, [addActivity, chainId, persistDeployment, refreshActors, requireContext, signerAt]);

  const deployTraceability = useCallback(async () => {
    const actorRegistry = requireRegistry();
    const signer = await signerAt(0);
    const factory = new ContractFactory(
      GRAPE_TRACEABILITY_ABI,
      GRAPE_TRACEABILITY_ARTIFACT.bytecode,
      signer,
    );
    const contract = await factory.deploy(actorRegistry);
    const transaction = contract.deploymentTransaction();
    if (!transaction) throw new Error("GrapeTraceability deployment transaction is unavailable");
    await contract.waitForDeployment();
    const receipt = await transaction.wait();
    const address = await contract.getAddress();
    setTraceabilityAddress(address);
    persistDeployment(actorRegistry, address, chainId);
    addActivity(
      "success",
      "GrapeTraceability deployed",
      `ActorRegistry linked, block ${receipt?.blockNumber ?? "confirmed"}`,
      transaction.hash,
      receipt?.blockNumber,
    );
  }, [addActivity, chainId, persistDeployment, requireRegistry, signerAt]);

  const clearDeployment = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setRegistryAddress("");
    setTraceabilityAddress("");
    setBatch(null);
    setCustodyHistory([]);
    setQualityHistory([]);
    setEvidence(null);
    const context = contextRef.current;
    if (context) {
      setActors(context.accounts.map((address) => ({ address, role: 0, active: false })));
    }
    addActivity("info", "Saved deployment cleared", "Existing contracts remain on the local chain");
  }, [addActivity]);

  const registerActor = useCallback(async () => {
    const address = requireRegistry();
    const context = requireContext();
    if (registerCaller === registerTarget) throw new Error("Caller and target must be different accounts");
    const registry = new Contract(address, ACTOR_REGISTRY_ABI, await signerAt(registerCaller));
    await sendTransaction(
      `Register ${ROLE_NAMES[registerRole]}`,
      registerCaller,
      registry.registerActor(context.accounts[registerTarget], registerRole),
    );
    await refreshActors(context, address);
  }, [refreshActors, registerCaller, registerRole, registerTarget, requireContext, requireRegistry, sendTransaction, signerAt]);

  const createBatch = useCallback(async () => {
    const address = requireTraceability();
    const trimmedBatchId = batchId.trim();
    if (!trimmedBatchId || !productType.trim()) throw new Error("Batch ID and product type are required");
    const timestamp = Math.floor(new Date(harvestDate).getTime() / 1000);
    if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error("Enter a valid harvest date");
    const traceability = new Contract(address, GRAPE_TRACEABILITY_ABI, await signerAt(batchCaller));
    await sendTransaction(
      "Create grape batch",
      batchCaller,
      traceability.createBatch(trimmedBatchId, productType.trim(), timestamp),
    );
    await refreshBatch(trimmedBatchId, address);
  }, [batchCaller, batchId, harvestDate, productType, refreshBatch, requireTraceability, sendTransaction, signerAt]);

  const transferCustody = useCallback(async () => {
    const address = requireTraceability();
    const context = requireContext();
    if (custodyCaller === custodyTarget) throw new Error("Caller and new custodian must be different");
    if (!custodyEvidence.trim()) throw new Error("Enter delivery evidence or a bytes32 hash");
    const traceability = new Contract(address, GRAPE_TRACEABILITY_ABI, await signerAt(custodyCaller));
    const key = (await traceability.batchKey(batchId.trim())) as string;
    await sendTransaction(
      "Transfer batch custody",
      custodyCaller,
      traceability.transferCustody(
        key,
        context.accounts[custodyTarget],
        hashEvidence(custodyEvidence),
      ),
    );
    await refreshBatch(batchId.trim(), address);
  }, [batchId, custodyCaller, custodyEvidence, custodyTarget, refreshBatch, requireContext, requireTraceability, sendTransaction, signerAt]);

  const chooseCustodyRoute = useCallback((route: "pickup" | "delivery") => {
    if (route === "pickup") {
      setCustodyCaller(2);
      setCustodyTarget(3);
      setCustodyEvidence(`pickup:${batchId.trim()}`);
    } else {
      setCustodyCaller(3);
      setCustodyTarget(4);
      setCustodyEvidence(`delivery:${batchId.trim()}`);
    }
  }, [batchId]);

  const processTemperature = useCallback(async () => {
    const values = temperatureValues
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const nextEvidence = await processTemperatureEvidence(batchId.trim(), {
      sensorId,
      allowedMinC: Number(allowedMin),
      allowedMaxC: Number(allowedMax),
      values,
    });
    setEvidence(nextEvidence);
    addActivity(
      "success",
      "Off-chain temperature calculation",
      `${nextEvidence.summary.readingCount} readings, breached=${nextEvidence.summary.thresholdBreached}`,
    );
  }, [addActivity, allowedMax, allowedMin, batchId, sensorId, temperatureValues]);

  const submitTemperature = useCallback(async () => {
    const address = requireTraceability();
    if (!evidence || evidence.batchId !== batchId.trim()) {
      throw new Error("Process temperature evidence for the current batch first");
    }
    const traceability = new Contract(address, GRAPE_TRACEABILITY_ABI, await signerAt(oracleCaller));
    const key = (await traceability.batchKey(batchId.trim())) as string;
    await sendTransaction(
      "Submit temperature quality record",
      oracleCaller,
      traceability.addQualityRecord(
        key,
        0,
        evidence.evidenceHash,
        evidence.summaryHash,
        evidence.uri,
        evidence.summary.thresholdBreached,
      ),
    );
    await refreshBatch(batchId.trim(), address);
  }, [batchId, evidence, oracleCaller, refreshBatch, requireTraceability, sendTransaction, signerAt]);

  const flagContaminated = useCallback(async () => {
    const address = requireTraceability();
    if (!flagReason.trim() || !flagUri.trim()) throw new Error("Reason and evidence URI are required");
    const traceability = new Contract(address, GRAPE_TRACEABILITY_ABI, await signerAt(flagCaller));
    const key = (await traceability.batchKey(batchId.trim())) as string;
    await sendTransaction(
      "Flag batch as contaminated",
      flagCaller,
      traceability.flagContaminated(key, hashEvidence(flagReason), flagUri.trim()),
    );
    await refreshBatch(batchId.trim(), address);
  }, [batchId, flagCaller, flagReason, flagUri, refreshBatch, requireTraceability, sendTransaction, signerAt]);

  const recallBatch = useCallback(async () => {
    const address = requireTraceability();
    if (!recallReason.trim() || !recallUri.trim()) throw new Error("Reason and evidence URI are required");
    const traceability = new Contract(address, GRAPE_TRACEABILITY_ABI, await signerAt(recallCaller));
    const key = (await traceability.batchKey(batchId.trim())) as string;
    await sendTransaction(
      "Recall grape batch",
      recallCaller,
      traceability.markRecalled(key, hashEvidence(recallReason), recallUri.trim()),
    );
    await refreshBatch(batchId.trim(), address);
  }, [batchId, recallCaller, recallReason, recallUri, refreshBatch, requireTraceability, sendTransaction, signerAt]);

  const copyValue = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    addActivity("info", "Copied to clipboard", shortHash(value));
  }, [addActivity]);

  const downloadStoredFile = useCallback((storageKey: string, filename: string) => {
    const value = localStorage.getItem(storageKey);
    if (!value) throw new Error("The off-chain file is not available in browser storage");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([value], { type: "application/json" }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }, []);

  const accountName = useCallback((index: number): string => {
    const actor = actors[index];
    if (actor?.active && actor.role !== ROLE.None) return ROLE_NAMES[actor.role];
    return index === 0 ? "Deployer" : `Account ${index}`;
  }, [actors]);

  const accountOptions = useMemo(
    () => accounts.map((address, index) => (
      <option value={index} key={address}>
        {index}: {accountName(index)} - {shortAddress(address)}
      </option>
    )),
    [accountName, accounts],
  );

  const contractsReady = Boolean(registryAddress && traceabilityAddress);
  const actorsReady = EXPECTED_ROLES.every(
    (role, index) => actors[index]?.active && actors[index]?.role === role,
  );
  const stepComplete = useMemo<Record<StepId, boolean>>(() => ({
    deploy: contractsReady,
    actors: actorsReady,
    batch: Boolean(batch),
    custody: custodyHistory.length > 0,
    quality: qualityHistory.length > 0,
    flag: batch?.status === 4 || batch?.status === 5,
    recall: batch?.status === 5,
    query: Boolean(batch),
  }), [actorsReady, batch, contractsReady, custodyHistory.length, qualityHistory.length]);

  const renderAccountField = (
    idValue: string,
    label: string,
    value: number,
    onChange: (value: number) => void,
  ) => (
    <label className="field" htmlFor={idValue}>
      <span>{label}</span>
      <select
        id={idValue}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={Boolean(busyAction)}
      >
        {accountOptions}
      </select>
    </label>
  );

  const actionButton = (
    label: string,
    icon: LucideIcon,
    action: () => Promise<void>,
    disabled = false,
    danger = false,
  ) => {
    const Icon = icon;
    return (
      <button
        className={`command-button ${danger ? "danger" : ""}`}
        type="button"
        onClick={() => void runAction(label, action)}
        disabled={disabled || connection !== "connected" || Boolean(busyAction)}
      >
        {busyAction === label ? <RefreshCw className="spin" size={17} /> : <Icon size={17} />}
        {busyAction === label ? "Waiting for confirmation" : label}
      </button>
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Grape size={24} /></div>
          <div>
            <h1>Fresh Grape Traceability Console</h1>
            <p>Manual transaction workflow on Hardhat localhost</p>
          </div>
        </div>
        <div className="network-block">
          <span className={`connection-dot ${connection}`} />
          <div>
            <strong>{connection === "connected" ? `Chain ${chainId}` : "Local node"}</strong>
            <span>{connectionMessage}</span>
          </div>
          <button
            className="icon-button dark"
            type="button"
            title="Reconnect Hardhat node"
            aria-label="Reconnect Hardhat node"
            onClick={() => void connectNode()}
            disabled={Boolean(busyAction)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      {connection === "error" && (
        <div className="setup-banner" role="alert">
          <AlertTriangle size={18} />
          <span>{connectionMessage}</span>
          <code>pnpm node:local</code>
        </div>
      )}

      <main>
        <section className="context-bar">
          <label className="batch-context" htmlFor="global-batch-id">
            <span>Active batch ID</span>
            <input
              id="global-batch-id"
              value={batchId}
              onChange={(event) => {
                setBatchId(event.target.value);
                setEvidence(null);
              }}
              disabled={Boolean(busyAction)}
            />
          </label>
          <div className="context-status">
            <span>Registry</span>
            <button type="button" onClick={() => void copyValue(registryAddress)} disabled={!registryAddress}>
              {shortAddress(registryAddress)} <Clipboard size={13} />
            </button>
          </div>
          <div className="context-status">
            <span>Traceability</span>
            <button type="button" onClick={() => void copyValue(traceabilityAddress)} disabled={!traceabilityAddress}>
              {shortAddress(traceabilityAddress)} <Clipboard size={13} />
            </button>
          </div>
          <button
            className="query-button"
            type="button"
            onClick={() => void runAction("Query trace", async () => { await refreshBatch(); })}
            disabled={!contractsReady || Boolean(busyAction)}
          >
            <Search size={16} /> Query trace
          </button>
        </section>

        <div className="workspace-grid">
          <nav className="step-nav" aria-label="Demo transaction steps">
            <div className="step-nav-heading">
              <span>Transaction workflow</span>
              <strong>{Object.values(stepComplete).filter(Boolean).length}/8 complete</strong>
            </div>
            {STEPS.map(({ id: stepId, label, contract, icon: Icon }, index) => (
              <button
                type="button"
                className={`step-button ${selectedStep === stepId ? "selected" : ""}`}
                onClick={() => setSelectedStep(stepId)}
                key={stepId}
              >
                <span className={`step-index ${stepComplete[stepId] ? "complete" : ""}`}>
                  {stepComplete[stepId] ? <Check size={15} /> : index + 1}
                </span>
                <span>
                  <strong>{label}</strong>
                  <small>{contract}</small>
                </span>
                <Icon size={17} />
              </button>
            ))}
          </nav>

          <section className="workbench">
            {selectedStep === "deploy" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 1</span><h2>Deploy two smart contracts</h2></div>
                  <Rocket size={22} />
                </div>
                <div className="deployment-row">
                  <div className="deployment-copy">
                    <strong>ActorRegistry.sol</strong>
                    <span>Deployer and initial Administrator: Account 0</span>
                    <code>{registryAddress || "Awaiting deployment"}</code>
                  </div>
                  {actionButton("Deploy ActorRegistry", Rocket, deployActorRegistry)}
                </div>
                <div className="deployment-row">
                  <div className="deployment-copy">
                    <strong>GrapeTraceability.sol</strong>
                    <span>Constructor parameter: ActorRegistry address</span>
                    <code>{traceabilityAddress || "Awaiting deployment"}</code>
                  </div>
                  {actionButton("Deploy Traceability", Rocket, deployTraceability, !registryAddress)}
                </div>
                <div className="secondary-command-row">
                  <button type="button" onClick={clearDeployment} disabled={Boolean(busyAction)}>
                    <RotateCcw size={15} /> Clear saved addresses
                  </button>
                </div>
              </>
            )}

            {selectedStep === "actors" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 2</span><h2>Register a participant role</h2></div>
                  <ShieldCheck size={22} />
                </div>
                <div className="form-grid three-columns">
                  {renderAccountField("register-caller", "Caller account", registerCaller, setRegisterCaller)}
                  {renderAccountField("register-target", "Participant address", registerTarget, setRegisterTarget)}
                  <label className="field" htmlFor="register-role">
                    <span>Role to assign</span>
                    <select id="register-role" value={registerRole} onChange={(event) => setRegisterRole(Number(event.target.value))}>
                      {ROLE_NAMES.slice(1).map((name, index) => <option value={index + 1} key={name}>{name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="command-row">
                  {actionButton("Send registerActor transaction", UserRoundPlus, registerActor, !contractsReady)}
                </div>
              </>
            )}

            {selectedStep === "batch" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 3</span><h2>Register a grape batch</h2></div>
                  <PackagePlus size={22} />
                </div>
                <div className="form-grid two-columns">
                  {renderAccountField("batch-caller", "Caller account", batchCaller, setBatchCaller)}
                  <label className="field" htmlFor="batch-external-id">
                    <span>External batch ID</span>
                    <input id="batch-external-id" value={batchId} onChange={(event) => setBatchId(event.target.value)} />
                  </label>
                  <label className="field" htmlFor="product-type">
                    <span>Product type</span>
                    <input id="product-type" value={productType} onChange={(event) => setProductType(event.target.value)} />
                  </label>
                  <label className="field" htmlFor="harvest-date">
                    <span>Harvest date</span>
                    <input id="harvest-date" type="datetime-local" value={harvestDate} onChange={(event) => setHarvestDate(event.target.value)} />
                  </label>
                </div>
                <div className="command-row">
                  {actionButton("Send createBatch transaction", PackagePlus, createBatch, !contractsReady)}
                </div>
              </>
            )}

            {selectedStep === "custody" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 4</span><h2>Transfer batch custody</h2></div>
                  <Truck size={22} />
                </div>
                <div className="segmented-control" aria-label="Custody route preset">
                  <button type="button" onClick={() => chooseCustodyRoute("pickup")}>Producer to Transporter</button>
                  <button type="button" onClick={() => chooseCustodyRoute("delivery")}>Transporter to Retailer</button>
                </div>
                <div className="form-grid two-columns">
                  {renderAccountField("custody-caller", "Current custodian / caller", custodyCaller, setCustodyCaller)}
                  {renderAccountField("custody-target", "New custodian", custodyTarget, setCustodyTarget)}
                  <label className="field full-width" htmlFor="custody-evidence">
                    <span>Delivery evidence text or bytes32 hash</span>
                    <input id="custody-evidence" value={custodyEvidence} onChange={(event) => setCustodyEvidence(event.target.value)} />
                  </label>
                </div>
                <div className="parameter-preview"><span>Batch key source</span><code>{batchId || "Enter a batch ID"}</code></div>
                <div className="command-row">
                  {actionButton("Send transferCustody transaction", Truck, transferCustody, !contractsReady)}
                </div>
              </>
            )}

            {selectedStep === "quality" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 5</span><h2>Process and submit temperature evidence</h2></div>
                  <Thermometer size={22} />
                </div>
                <div className="form-grid three-columns">
                  <label className="field" htmlFor="sensor-id"><span>Sensor ID</span><input id="sensor-id" value={sensorId} onChange={(event) => setSensorId(event.target.value)} /></label>
                  <label className="field" htmlFor="allowed-min"><span>Allowed minimum C</span><input id="allowed-min" type="number" step="0.1" value={allowedMin} onChange={(event) => setAllowedMin(event.target.value)} /></label>
                  <label className="field" htmlFor="allowed-max"><span>Allowed maximum C</span><input id="allowed-max" type="number" step="0.1" value={allowedMax} onChange={(event) => setAllowedMax(event.target.value)} /></label>
                  <label className="field full-width" htmlFor="temperature-values"><span>Temperature readings, separated by commas</span><textarea id="temperature-values" value={temperatureValues} onChange={(event) => setTemperatureValues(event.target.value)} /></label>
                </div>
                <div className="command-row split">
                  {actionButton("Run off-chain calculation", Database, processTemperature, !contractsReady)}
                  {renderAccountField("oracle-caller", "Oracle submitter / caller", oracleCaller, setOracleCaller)}
                  {actionButton("Submit addQualityRecord", CloudUpload, submitTemperature, !evidence || !contractsReady)}
                </div>
                {evidence && (
                  <div className="evidence-output">
                    <div><span>Minimum</span><strong>{evidence.summary.minimumC} C</strong></div>
                    <div><span>Average</span><strong>{evidence.summary.averageC} C</strong></div>
                    <div><span>Maximum</span><strong>{evidence.summary.maximumC} C</strong></div>
                    <div><span>Breach</span><strong className={evidence.summary.thresholdBreached ? "bad" : "good"}>{String(evidence.summary.thresholdBreached)}</strong></div>
                    <div className="hash-output"><span>Evidence SHA-256</span><code>{evidence.evidenceHash}</code><button type="button" onClick={() => void copyValue(evidence.evidenceHash)}><Clipboard size={14} /></button></div>
                    <div className="hash-output"><span>Summary SHA-256</span><code>{evidence.summaryHash}</code><button type="button" onClick={() => void copyValue(evidence.summaryHash)}><Clipboard size={14} /></button></div>
                    <div className="download-row">
                      <button type="button" onClick={() => downloadStoredFile(evidence.rawStorageKey, `${batchId}-temperature.json`)}><Download size={15} /> Raw file</button>
                      <button type="button" onClick={() => downloadStoredFile(evidence.summaryStorageKey, `${batchId}-summary.json`)}><Download size={15} /> Summary file</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {selectedStep === "flag" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 6</span><h2>Flag a contaminated batch</h2></div>
                  <Flag size={22} />
                </div>
                <div className="form-grid two-columns">
                  {renderAccountField("flag-caller", "Retailer or Regulator caller", flagCaller, setFlagCaller)}
                  <label className="field" htmlFor="flag-reason"><span>Reason text or bytes32 hash</span><input id="flag-reason" value={flagReason} onChange={(event) => setFlagReason(event.target.value)} /></label>
                  <label className="field full-width" htmlFor="flag-uri"><span>Off-chain evidence URI</span><input id="flag-uri" value={flagUri} onChange={(event) => setFlagUri(event.target.value)} /></label>
                </div>
                <div className="command-row">
                  {actionButton("Send flagContaminated transaction", Flag, flagContaminated, !contractsReady, true)}
                </div>
              </>
            )}

            {selectedStep === "recall" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 7</span><h2>Recall an affected batch</h2></div>
                  <RotateCcw size={22} />
                </div>
                <div className="form-grid two-columns">
                  {renderAccountField("recall-caller", "Regulator or Retailer caller", recallCaller, setRecallCaller)}
                  <label className="field" htmlFor="recall-reason"><span>Recall reason text or bytes32 hash</span><input id="recall-reason" value={recallReason} onChange={(event) => setRecallReason(event.target.value)} /></label>
                  <label className="field full-width" htmlFor="recall-uri"><span>Recall document URI</span><input id="recall-uri" value={recallUri} onChange={(event) => setRecallUri(event.target.value)} /></label>
                </div>
                <div className="command-row">
                  {actionButton("Send markRecalled transaction", RotateCcw, recallBatch, !contractsReady, true)}
                </div>
              </>
            )}

            {selectedStep === "query" && (
              <>
                <div className="workbench-heading">
                  <div><span>Step 8</span><h2>Read the complete trace history</h2></div>
                  <History size={22} />
                </div>
                <div className="query-command">
                  <label className="field" htmlFor="query-batch-id"><span>Batch ID</span><input id="query-batch-id" value={batchId} onChange={(event) => setBatchId(event.target.value)} /></label>
                  {actionButton("Query read-only getters", Search, async () => { await refreshBatch(); }, !contractsReady)}
                </div>
                <div className="history-section">
                  <h3>Custody history</h3>
                  {custodyHistory.length === 0 ? <p className="empty-row">No custody records</p> : custodyHistory.map((record, index) => (
                    <div className="history-row" key={`${record.from}-${record.transferredAt}`}>
                      <span>{index + 1}</span>
                      <strong>{shortAddress(record.from)} to {shortAddress(record.to)}</strong>
                      <small>{formatTimestamp(record.transferredAt)}</small>
                      <code>{shortHash(record.deliveryEvidenceHash)}</code>
                    </div>
                  ))}
                </div>
                <div className="history-section">
                  <h3>Quality history</h3>
                  {qualityHistory.length === 0 ? <p className="empty-row">No quality records</p> : qualityHistory.map((record, index) => (
                    <div className="history-row" key={`${record.evidenceHash}-${index}`}>
                      <span>{index + 1}</span>
                      <strong>{QUALITY_NAMES[record.recordType]}</strong>
                      <small>{shortAddress(record.submittedBy)} / breached={String(record.thresholdBreached)}</small>
                      <code>{shortHash(record.evidenceHash)}</code>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className="state-monitor">
            <div className="monitor-heading"><span>Live contract state</span><Activity size={18} /></div>
            <div className="batch-state">
              <span>Batch</span>
              <strong>{batch?.externalId ?? "Not loaded"}</strong>
              <span className={`status-badge status-${batch?.status ?? 0}`}>{STATUS_NAMES[batch?.status ?? 0]}</span>
            </div>
            <dl className="state-list">
              <div><dt>Current custodian</dt><dd>{shortAddress(batch?.currentCustodian ?? "")}</dd></div>
              <div><dt>Producer</dt><dd>{shortAddress(batch?.producer ?? "")}</dd></div>
              <div><dt>Custody transfers</dt><dd>{batch?.transferCount ?? 0}</dd></div>
              <div><dt>Quality records</dt><dd>{batch?.qualityRecordCount ?? 0}</dd></div>
            </dl>
            <div className="monitor-heading actors-heading"><span>Local accounts</span><WalletCards size={18} /></div>
            <div className="account-list">
              {actors.slice(0, 6).map((actor, index) => (
                <div className="account-row" key={actor.address}>
                  <span>{index}</span>
                  <div><strong>{accountName(index)}</strong><small>{shortAddress(actor.address)}</small></div>
                  <em className={actor.active ? "active" : ""}>{actor.active ? "Active" : "Unregistered"}</em>
                </div>
              ))}
            </div>
            {evidence && (
              <div className={`oracle-state ${evidence.summary.thresholdBreached ? "breached" : "safe"}`}>
                {evidence.summary.thresholdBreached ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                <div><strong>Oracle result</strong><span>{evidence.summary.thresholdBreached ? "Temperature breached" : "Temperature accepted"}</span></div>
              </div>
            )}
          </aside>
        </div>

        <section className="activity-panel">
          <div className="activity-heading">
            <div><span>Confirmed transactions and local computation</span><h2>Activity log</h2></div>
            <button type="button" onClick={() => setActivityItems([])} disabled={activityItems.length === 0}><RotateCcw size={15} /> Clear</button>
          </div>
          <div className="activity-table">
            {activityItems.length === 0 ? (
              <div className="empty-activity">Actions will appear here after you click a command.</div>
            ) : activityItems.map((item) => (
              <div className={`activity-row ${item.status}`} key={item.id}>
                <span className="activity-icon">
                  {item.status === "success" ? <Check size={15} /> : item.status === "error" ? <AlertTriangle size={15} /> : <Link2 size={15} />}
                </span>
                <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                <span>{item.blockNumber ? `Block ${item.blockNumber}` : item.status}</span>
                <code>{item.transactionHash ? shortHash(item.transactionHash) : "-"}</code>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
