export interface BuildingStyle {
  baseColor: string;
  accentColor: string;
  glowColor: string;
  widthUnits: number;
  heightUnits: number;
}

export interface ProjectConfig {
  id: string;
  name: string;
  websiteUrl: string;
  explorerUrl: string;
  contracts: string[];
  style: BuildingStyle;
  weight: number;
}

export interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
}

export interface RpcBlock {
  number: string;
  timestamp: string;
  gasUsed?: string;
  gasLimit?: string;
  transactions: RpcTransaction[];
}

export interface BlockAttribution {
  blockNumber: number;
  blockTimestamp: number;
  totalTxCount: number;
  filteredInfraTxCount: number;
  countsByProject: Record<string, number>;
  activeProjectIds: string[];
  gasUsed: number;
  gasLimit: number;
  gasUsedRatio: number;
  /** Individual unattributed "to" addresses with their tx counts */
  otherAddresses: Record<string, number>;
}

export interface TrackedBlock {
  blockNumber: number;
  blockTimestamp: number;
  totalTxCount: number;
  filteredInfraTxCount: number;
  countsByProject: Record<string, number>;
  gasUsed: number;
  gasLimit: number;
  gasUsedRatio: number;
  receivedAtMs: number;
  /** Individual unattributed "to" addresses with their tx counts */
  otherAddresses: Record<string, number>;
}

export interface ProjectActivity {
  recentTx: number;
  latestTx: number;
  pulse: number;
  totalTx: number;
}

export interface ChainStats {
  currentBlock: number;
  gasPriceGwei: number;
  latestTxCount: number;
  latestFilteredTxCount: number;
  lastUpdatedAt: number;
}

export interface BlockBurst {
  id: string;
  projectId: string;
  blockNumber: number;
  spawnedAt: number;
  lifespanMs: number;
}

export type VisualizationMode = 'city' | 'highway';

export interface RoninDataHandlers {
  onBlockAttribution: (payload: BlockAttribution) => void;
  onGasPrice: (gasPriceGwei: number) => void;
  onError: (error: unknown) => void;
}
