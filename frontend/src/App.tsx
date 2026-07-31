import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  CloudUpload,
  Database,
  FileCheck2,
  Grape,
  Link2,
  PackageCheck,
  PackagePlus,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Store,
  Thermometer,
  Truck,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import {
  Contract,
  type ContractTransactionResponse,
  id,
  JsonRpcProvider,
  ZeroHash,
} from "ethers";
import {
  ACTOR_REGISTRY_ABI,
  type DeploymentRecord,
  GRAPE_TRACEABILITY_ABI,
  QUALITY_NAMES,
  ROLE,
  ROLE_NAMES,
  RPC_URL,
  STATUS_NAMES,
} from "./contracts";
import {
  type BrowserEvidence,
  processInspectionEvidence,
  processTemperatureEvidence,
} from "./evidence";

interface DemoContext {
  provider: JsonRpcProvider;
  deployment: DeploymentRecord;
  accounts: string[];
}

interface ActorState {
  label: string;
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
}

const ACTOR_LABELS = ["Administrator", "Regulator", "Producer", "Transporter", "Retailer"];
const EXPECTED_ROLES = [
  ROLE.Administrator,
  ROLE.Regulator,
  ROLE.Producer,
  ROLE.Transporter,
  ROLE.Retailer,
];

function shortAddress(value: string): string {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not available";
}

function shortHash(value: string): string {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : "Not generated";
}

function formatTime(value: bigint): string {
  return new Date(Number(value) * 1000).toLocaleTimeString([], {
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
    };
    return candidate.shortMessage ?? candidate.reason ?? candidate.message ?? "Unknown error";
  }
  return String(error);
}

export default function App() {
  const contextRef = useRef<DemoContext | null>(null);
  const activityIdRef = useRef(0);
  const initialConnectStartedRef = useRef(false);
  const [connection, setConnection] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [connectionMessage, setConnectionMessage] = useState("Connecting to Hardhat localhost");
  const [deployment, setDeployment] = useState<DeploymentRecord | null>(null);
  const [actors, setActors] = useState<ActorState[]>([]);
  const [batchId, setBatchId] = useState("GRAPE-WEB-001");
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [custodyHistory, setCustodyHistory] = useState<CustodyRecord[]>([]);
  const [qualityHistory, setQualityHistory] = useState<QualityRecord[]>([]);
  const [evidence, setEvidence] = useState<BrowserEvidence | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);

  const addActivity = useCallback(
    (
      status: ActivityItem["status"],
      title: string,
      detail: string,
      transactionHash?: string,
    ) => {
      activityIdRef.current += 1;
      setActivityItems((current) =>
        [
          {
            id: activityIdRef.current,
            status,
            title,
            detail,
            transactionHash,
          },
          ...current,
        ].slice(0, 24),
      );
    },
    [],
  );

  const requireContext = useCallback((): DemoContext => {
    if (!contextRef.current) {
      throw new Error("Local contracts are not connected");
    }
    return contextRef.current;
  }, []);

  const sendTransaction = useCallback(
    async (title: string, transactionPromise: Promise<ContractTransactionResponse>) => {
      const transaction = await transactionPromise;
      const receipt = await transaction.wait();
      if (!receipt) {
        throw new Error(`${title} was not confirmed`);
      }
      addActivity(
        "success",
        title,
        `Confirmed in block ${receipt.blockNumber}`,
        transaction.hash,
      );
      return receipt;
    },
    [addActivity],
  );

  const refreshActors = useCallback(async (context = requireContext()) => {
    const registry = new Contract(
      context.deployment.actorRegistry,
      ACTOR_REGISTRY_ABI,
      context.provider,
    );
    const nextActors = await Promise.all(
      context.accounts.slice(0, 5).map(async (address, index) => ({
        label: ACTOR_LABELS[index],
        address,
        role: Number(await registry.roleOf(address)),
        active: Boolean(await registry.isActive(address)),
      })),
    );
    setActors(nextActors);
  }, [requireContext]);

  const refreshBatch = useCallback(
    async (targetBatchId = batchId, context = requireContext()) => {
      if (!targetBatchId.trim()) {
        setBatch(null);
        setCustodyHistory([]);
        setQualityHistory([]);
        return;
      }
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        context.provider,
      );
      const key = (await traceability.batchKey(targetBatchId)) as string;
      if (!(await traceability.batchExists(key))) {
        setBatch(null);
        setCustodyHistory([]);
        setQualityHistory([]);
        return;
      }

      const result = (await traceability.getBatch(key)) as unknown as BatchState;
      const custody = (await traceability.getCustodyHistory(
        key,
      )) as unknown as RawCustodyRecord[];
      const quality = (await traceability.getQualityHistory(
        key,
      )) as unknown as RawQualityRecord[];
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
      setCustodyHistory(
        custody.map((record) => ({
          from: record[0],
          to: record[1],
          transferredAt: BigInt(record[2]),
          deliveryEvidenceHash: record[3],
        })),
      );
      setQualityHistory(
        quality.map((record) => ({
          recordType: Number(record[0]),
          evidenceHash: record[1],
          summaryHash: record[2],
          uri: record[3],
          submittedBy: record[4],
          submittedAt: BigInt(record[5]),
          thresholdBreached: Boolean(record[6]),
        })),
      );
    },
    [batchId, requireContext],
  );

  const connect = useCallback(async () => {
    setConnection("connecting");
    setConnectionMessage("Connecting to Hardhat localhost");
    try {
      const response = await fetch(`/deployment.json?time=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Run pnpm deploy:localhost before opening the DApp");
      }
      const nextDeployment = (await response.json()) as DeploymentRecord;
      const provider = new JsonRpcProvider(RPC_URL);
      const network = await provider.getNetwork();
      const registryCode = await provider.getCode(nextDeployment.actorRegistry);
      const traceabilityCode = await provider.getCode(nextDeployment.grapeTraceability);
      if (registryCode === "0x" || traceabilityCode === "0x") {
        throw new Error("Deployment addresses do not exist on the current local node");
      }
      const signers = await provider.listAccounts();
      const accounts = await Promise.all(signers.slice(0, 5).map((signer) => signer.getAddress()));
      if (accounts.length < 5) {
        throw new Error("Hardhat localhost must expose at least five accounts");
      }
      const context = { provider, deployment: nextDeployment, accounts };
      contextRef.current = context;
      setDeployment(nextDeployment);
      setConnection("connected");
      setConnectionMessage(`Chain ${network.chainId.toString()} · ${nextDeployment.network}`);
      await refreshActors(context);
      addActivity("info", "Local contracts connected", `Chain ID ${network.chainId.toString()}`);
    } catch (error) {
      contextRef.current = null;
      setConnection("error");
      setConnectionMessage(errorMessage(error));
    }
  }, [addActivity, refreshActors]);

  useEffect(() => {
    if (initialConnectStartedRef.current) return;
    initialConnectStartedRef.current = true;
    void connect();
  }, [connect]);

  const ensureActors = useCallback(async () => {
    const context = requireContext();
    const registryRead = new Contract(
      context.deployment.actorRegistry,
      ACTOR_REGISTRY_ABI,
      context.provider,
    );
    const adminRegistry = new Contract(
      context.deployment.actorRegistry,
      ACTOR_REGISTRY_ABI,
      await context.provider.getSigner(0),
    );

    const regulatorRole = Number(await registryRead.roleOf(context.accounts[1]));
    if (regulatorRole === ROLE.None) {
      await sendTransaction(
        "Administrator registered Regulator",
        adminRegistry.registerActor(context.accounts[1], ROLE.Regulator),
      );
    } else if (regulatorRole !== ROLE.Regulator) {
      await sendTransaction(
        "Administrator corrected Regulator role",
        adminRegistry.updateRole(context.accounts[1], ROLE.Regulator),
      );
    }
    if (!(await registryRead.isActive(context.accounts[1]))) {
      await sendTransaction(
        "Administrator reactivated Regulator",
        adminRegistry.setActorActive(context.accounts[1], true),
      );
    }

    const regulatorRegistry = new Contract(
      context.deployment.actorRegistry,
      ACTOR_REGISTRY_ABI,
      await context.provider.getSigner(1),
    );
    for (const [accountIndex, role] of [
      [2, ROLE.Producer],
      [3, ROLE.Transporter],
      [4, ROLE.Retailer],
    ] as const) {
      const address = context.accounts[accountIndex];
      const currentRole = Number(await registryRead.roleOf(address));
      if (currentRole === ROLE.None) {
        await sendTransaction(
          `Regulator registered ${ROLE_NAMES[role]}`,
          regulatorRegistry.registerActor(address, role),
        );
      } else if (currentRole !== role) {
        await sendTransaction(
          `Administrator corrected ${ROLE_NAMES[role]} role`,
          adminRegistry.updateRole(address, role),
        );
      }
      if (!(await registryRead.isActive(address))) {
        await sendTransaction(
          `Administrator reactivated ${ROLE_NAMES[role]}`,
          adminRegistry.setActorActive(address, true),
        );
      }
    }
    await refreshActors(context);
  }, [refreshActors, requireContext, sendTransaction]);

  const createBatch = useCallback(
    async (targetBatchId: string) => {
      const context = requireContext();
      const traceabilityRead = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        context.provider,
      );
      const key = (await traceabilityRead.batchKey(targetBatchId)) as string;
      if (await traceabilityRead.batchExists(key)) {
        addActivity("info", "Batch already exists", targetBatchId);
        return key;
      }
      const producerTraceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        await context.provider.getSigner(2),
      );
      const harvestDate = Math.floor(Date.now() / 1000) - 86_400;
      await sendTransaction(
        "Producer created grape batch",
        producerTraceability.createBatch(targetBatchId, "Fresh table grapes", harvestDate),
      );
      await refreshBatch(targetBatchId, context);
      return key;
    },
    [addActivity, refreshBatch, requireContext, sendTransaction],
  );

  const transferToTransporter = useCallback(
    async (targetBatchId: string) => {
      const context = requireContext();
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        await context.provider.getSigner(2),
      );
      const key = (await traceability.batchKey(targetBatchId)) as string;
      await sendTransaction(
        "Producer transferred custody to Transporter",
        traceability.transferCustody(
          key,
          context.accounts[3],
          id(`pickup:${targetBatchId}`),
        ),
      );
      await refreshBatch(targetBatchId, context);
    },
    [refreshBatch, requireContext, sendTransaction],
  );

  const processEvidence = useCallback(async (targetBatchId: string) => {
    const nextEvidence = await processTemperatureEvidence(targetBatchId);
    setEvidence(nextEvidence);
    addActivity(
      "success",
      "Off-chain temperature evidence generated",
      `${nextEvidence.summary.minimumC}C–${nextEvidence.summary.maximumC}C · ${nextEvidence.summary.readingCount} readings`,
    );
    return nextEvidence;
  }, [addActivity]);

  const submitTemperatureEvidence = useCallback(
    async (targetBatchId: string, nextEvidence = evidence) => {
      if (!nextEvidence || nextEvidence.batchId !== targetBatchId) {
        throw new Error("Generate temperature evidence for this batch first");
      }
      const context = requireContext();
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        await context.provider.getSigner(3),
      );
      const key = (await traceability.batchKey(targetBatchId)) as string;
      await sendTransaction(
        "Transporter submitted oracle evidence on-chain",
        traceability.addQualityRecord(
          key,
          0,
          nextEvidence.evidenceHash,
          nextEvidence.summaryHash,
          nextEvidence.uri,
          nextEvidence.summary.thresholdBreached,
        ),
      );
      await refreshBatch(targetBatchId, context);
    },
    [evidence, refreshBatch, requireContext, sendTransaction],
  );

  const transferToRetailer = useCallback(
    async (targetBatchId: string) => {
      const context = requireContext();
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        await context.provider.getSigner(3),
      );
      const key = (await traceability.batchKey(targetBatchId)) as string;
      await sendTransaction(
        "Transporter delivered batch to Retailer",
        traceability.transferCustody(
          key,
          context.accounts[4],
          id(`delivery:${targetBatchId}`),
        ),
      );
      await refreshBatch(targetBatchId, context);
    },
    [refreshBatch, requireContext, sendTransaction],
  );

  const addInspection = useCallback(
    async (targetBatchId: string) => {
      const context = requireContext();
      const inspection = await processInspectionEvidence(targetBatchId);
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        await context.provider.getSigner(4),
      );
      const key = (await traceability.batchKey(targetBatchId)) as string;
      await sendTransaction(
        "Retailer recorded inspection evidence",
        traceability.addQualityRecord(
          key,
          1,
          inspection.hash,
          ZeroHash,
          inspection.uri,
          false,
        ),
      );
      await refreshBatch(targetBatchId, context);
    },
    [refreshBatch, requireContext, sendTransaction],
  );

  const recallBatch = useCallback(
    async (targetBatchId: string) => {
      const context = requireContext();
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        await context.provider.getSigner(1),
      );
      const key = (await traceability.batchKey(targetBatchId)) as string;
      await sendTransaction(
        "Regulator recalled batch",
        traceability.markRecalled(
          key,
          id(`recall:${targetBatchId}`),
          `browser-storage://recall/${targetBatchId}`,
        ),
      );
      await refreshBatch(targetBatchId, context);
    },
    [refreshBatch, requireContext, sendTransaction],
  );

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await action();
      } catch (error) {
        addActivity("error", "Action rejected", errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [addActivity, busy],
  );

  const runFullDemo = useCallback(async () => {
    await runAction(async () => {
      const context = requireContext();
      const traceability = new Contract(
        context.deployment.grapeTraceability,
        GRAPE_TRACEABILITY_ABI,
        context.provider,
      );
      let targetBatchId = batchId.trim() || "GRAPE-WEB-001";
      const currentKey = (await traceability.batchKey(targetBatchId)) as string;
      if (await traceability.batchExists(currentKey)) {
        targetBatchId = `GRAPE-WEB-${Date.now().toString().slice(-6)}`;
        setBatchId(targetBatchId);
      }
      setActivityItems([]);
      setEvidence(null);
      addActivity("info", "Full demo started", targetBatchId);
      await ensureActors();
      await createBatch(targetBatchId);
      await transferToTransporter(targetBatchId);
      const nextEvidence = await processEvidence(targetBatchId);
      await submitTemperatureEvidence(targetBatchId, nextEvidence);
      if (!nextEvidence.summary.thresholdBreached) {
        await transferToRetailer(targetBatchId);
        await addInspection(targetBatchId);
      }
      await recallBatch(targetBatchId);
      addActivity("success", "End-to-end demo completed", "Final trace is available below");
    });
  }, [
    addActivity,
    addInspection,
    batchId,
    createBatch,
    ensureActors,
    processEvidence,
    recallBatch,
    requireContext,
    runAction,
    submitTemperatureEvidence,
    transferToRetailer,
    transferToTransporter,
  ]);

  const actorsReady = useMemo(
    () =>
      actors.length === 5 &&
      actors.every((actor, index) => actor.active && actor.role === EXPECTED_ROLES[index]),
    [actors],
  );
  const workflowStage = batch?.status ?? 0;
  const connected = connection === "connected";
  const workflowSteps: Array<{
    label: string;
    complete: boolean;
    icon: LucideIcon;
  }> = [
    { label: "Actors", complete: actorsReady, icon: UserRoundPlus },
    { label: "Created", complete: workflowStage >= 1, icon: PackagePlus },
    { label: "In transit", complete: workflowStage >= 2, icon: Truck },
    { label: "Delivered", complete: workflowStage >= 3, icon: Store },
    { label: "Recalled", complete: workflowStage === 5, icon: RotateCcw },
  ];

  const copyValue = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    addActivity("info", "Copied to clipboard", shortHash(value));
  }, [addActivity]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Grape size={24} strokeWidth={2} />
          </div>
          <div>
            <h1>Fresh Grape Traceability</h1>
            <p>Hardhat localhost · Direct ethers.js DApp</p>
          </div>
        </div>
        <div className="connection-cluster">
          <span className={`connection-dot ${connection}`} aria-hidden="true" />
          <div>
            <strong>{connection === "connected" ? "Connected" : "Local node"}</strong>
            <span>{connectionMessage}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void connect()}
            title="Reconnect local contracts"
            aria-label="Reconnect local contracts"
            disabled={busy}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      {connection === "error" && (
        <div className="setup-banner" role="alert">
          <AlertTriangle size={19} />
          <span>{connectionMessage}</span>
          <code>pnpm node:local → pnpm deploy:localhost → pnpm frontend:dev</code>
        </div>
      )}

      <main>
        <section className="control-band" aria-label="Demo controls">
          <div className="batch-input-group">
            <label htmlFor="batch-id">Batch ID</label>
            <input
              id="batch-id"
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="primary-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void runFullDemo()}
              disabled={!connected || busy}
            >
              {busy ? <RefreshCw className="spin" size={17} /> : <Play size={17} fill="currentColor" />}
              {busy ? "Running" : "Run full demo"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void runAction(async () => refreshBatch())}
              disabled={!connected || busy}
            >
              <RefreshCw size={17} />
              Refresh trace
            </button>
          </div>
          <div className="contract-addresses">
            <div>
              <span>ActorRegistry</span>
              <strong>{shortAddress(deployment?.actorRegistry ?? "")}</strong>
            </div>
            <div>
              <span>GrapeTraceability</span>
              <strong>{shortAddress(deployment?.grapeTraceability ?? "")}</strong>
            </div>
          </div>
        </section>

        <section className="workflow" aria-label="Traceability workflow">
          {workflowSteps.map(({ label, complete, icon: Icon }, index) => (
            <div className="workflow-item" key={label}>
              <div className={`workflow-node ${complete ? "complete" : ""}`}>
                <Icon size={18} />
              </div>
              <span>{String(label)}</span>
              {index < 4 && <div className={`workflow-line ${complete ? "complete" : ""}`} />}
            </div>
          ))}
        </section>

        <div className="dashboard-grid">
          <section className="panel actors-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">Access control</span>
                <h2>Actors and roles</h2>
              </div>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => void runAction(ensureActors)}
                disabled={!connected || busy}
              >
                <ShieldCheck size={16} />
                Initialise
              </button>
            </div>
            <div className="actor-list">
              {actors.length === 0
                ? ACTOR_LABELS.map((label) => (
                    <div className="actor-row muted" key={label}>
                      <span className="actor-index">–</span>
                      <div><strong>{label}</strong><span>Waiting for local node</span></div>
                    </div>
                  ))
                : actors.map((actor, index) => (
                    <div className="actor-row" key={actor.address}>
                      <span className="actor-index">{index}</span>
                      <div>
                        <strong>{actor.label}</strong>
                        <span>{shortAddress(actor.address)}</span>
                      </div>
                      <span className={`role-state ${actor.active ? "active" : ""}`}>
                        {ROLE_NAMES[actor.role]}
                      </span>
                    </div>
                  ))}
            </div>
          </section>

          <section className="panel batch-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">On-chain state</span>
                <h2>{batch?.externalId ?? "No batch registered"}</h2>
              </div>
              <span className={`status-badge status-${batch?.status ?? 0}`}>
                {STATUS_NAMES[batch?.status ?? 0]}
              </span>
            </div>
            <div className="batch-metrics">
              <div><span>Custodian</span><strong>{shortAddress(batch?.currentCustodian ?? "")}</strong></div>
              <div><span>Transfers</span><strong>{batch?.transferCount ?? 0}</strong></div>
              <div><span>Quality records</span><strong>{batch?.qualityRecordCount ?? 0}</strong></div>
            </div>
            <div className="action-grid">
              <button type="button" onClick={() => void runAction(ensureActors)} disabled={!connected || busy}>
                <UserRoundPlus size={17} /> Register actors
              </button>
              <button type="button" onClick={() => void runAction(async () => { await createBatch(batchId); })} disabled={!connected || busy}>
                <PackagePlus size={17} /> Create batch
              </button>
              <button type="button" onClick={() => void runAction(async () => transferToTransporter(batchId))} disabled={!connected || busy}>
                <Truck size={17} /> Pickup
              </button>
              <button type="button" onClick={() => void runAction(async () => { await processEvidence(batchId); })} disabled={!connected || busy}>
                <Thermometer size={17} /> Process temperature
              </button>
              <button type="button" onClick={() => void runAction(async () => submitTemperatureEvidence(batchId))} disabled={!connected || busy}>
                <CloudUpload size={17} /> Submit oracle result
              </button>
              <button type="button" onClick={() => void runAction(async () => transferToRetailer(batchId))} disabled={!connected || busy}>
                <Store size={17} /> Deliver to retailer
              </button>
              <button type="button" onClick={() => void runAction(async () => addInspection(batchId))} disabled={!connected || busy}>
                <FileCheck2 size={17} /> Add inspection
              </button>
              <button className="danger-action" type="button" onClick={() => void runAction(async () => recallBatch(batchId))} disabled={!connected || busy}>
                <RotateCcw size={17} /> Recall batch
              </button>
            </div>
          </section>

          <section className="panel evidence-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">Off-chain evidence</span>
                <h2>Temperature oracle</h2>
              </div>
              <Database size={20} />
            </div>
            {evidence ? (
              <>
                <div className="temperature-metrics">
                  <div><span>Minimum</span><strong>{evidence.summary.minimumC}°C</strong></div>
                  <div><span>Average</span><strong>{evidence.summary.averageC}°C</strong></div>
                  <div><span>Maximum</span><strong>{evidence.summary.maximumC}°C</strong></div>
                </div>
                <div className="hash-list">
                  <div>
                    <span>Evidence SHA-256</span>
                    <code>{shortHash(evidence.evidenceHash)}</code>
                    <button className="icon-button" type="button" title="Copy evidence hash" aria-label="Copy evidence hash" onClick={() => void copyValue(evidence.evidenceHash)}><Clipboard size={15} /></button>
                  </div>
                  <div>
                    <span>Summary SHA-256</span>
                    <code>{shortHash(evidence.summaryHash)}</code>
                    <button className="icon-button" type="button" title="Copy summary hash" aria-label="Copy summary hash" onClick={() => void copyValue(evidence.summaryHash)}><Clipboard size={15} /></button>
                  </div>
                  <div>
                    <span>Evidence URI</span>
                    <code>{evidence.uri}</code>
                  </div>
                </div>
                <div className={`threshold-result ${evidence.summary.thresholdBreached ? "breached" : "safe"}`}>
                  {evidence.summary.thresholdBreached ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                  <span>{evidence.summary.thresholdBreached ? "Threshold breached" : "Temperature within threshold"}</span>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Thermometer size={28} />
                <strong>No evidence generated</strong>
                <span>Temperature evidence will appear during the demo.</span>
              </div>
            )}
          </section>
        </div>

        <div className="records-grid">
          <section className="panel records-panel">
            <div className="panel-heading">
              <div><span className="section-kicker">Immutable trace</span><h2>Custody history</h2></div>
              <Truck size={19} />
            </div>
            <div className="record-list">
              {custodyHistory.length === 0 ? (
                <div className="record-empty">No custody transfers recorded</div>
              ) : custodyHistory.map((record, index) => (
                <div className="record-row" key={`${record.from}-${record.transferredAt}`}>
                  <span className="record-number">{index + 1}</span>
                  <div><strong>{shortAddress(record.from)} → {shortAddress(record.to)}</strong><span>{formatTime(record.transferredAt)}</span></div>
                  <code>{shortHash(record.deliveryEvidenceHash)}</code>
                </div>
              ))}
            </div>
          </section>

          <section className="panel records-panel">
            <div className="panel-heading">
              <div><span className="section-kicker">Hash references</span><h2>Quality history</h2></div>
              <PackageCheck size={19} />
            </div>
            <div className="record-list">
              {qualityHistory.length === 0 ? (
                <div className="record-empty">No quality evidence recorded</div>
              ) : qualityHistory.map((record, index) => (
                <div className="record-row" key={`${record.evidenceHash}-${index}`}>
                  <span className="record-number">{index + 1}</span>
                  <div><strong>{QUALITY_NAMES[record.recordType]}</strong><span>{shortAddress(record.submittedBy)} · {formatTime(record.submittedAt)}</span></div>
                  <code>{shortHash(record.evidenceHash)}</code>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel activity-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">Live confirmations</span><h2>Blockchain activity</h2></div>
            <Activity size={19} />
          </div>
          <div className="activity-list">
            {activityItems.length === 0 ? (
              <div className="record-empty">Transactions and oracle actions will appear here</div>
            ) : activityItems.map((item) => (
              <div className={`activity-row ${item.status}`} key={item.id}>
                <span className="activity-icon">
                  {item.status === "success" ? <Check size={15} /> : item.status === "error" ? <AlertTriangle size={15} /> : <Link2 size={15} />}
                </span>
                <div><strong>{item.title}</strong><span>{item.detail}</span></div>
                {item.transactionHash && <code>{shortHash(item.transactionHash)}</code>}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

