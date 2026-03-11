import { CONTRACT_TO_PROJECT, INFRA_DENYLIST, OTHER_PROJECT_ID, PROJECTS, normalizeAddress } from './contractRegistry';
import type { BlockAttribution, RpcBlock } from '../types';

function hexToNumber(hexValue: string | undefined): number {
  if (!hexValue) {
    return 0;
  }

  const parsed = Number.parseInt(hexValue, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSystemLikeAddress(address: string): boolean {
  return /^0x0{36,}[0-9a-f]{4}$/.test(address);
}

export function createEmptyProjectCounter(): Record<string, number> {
  const counter: Record<string, number> = {};
  for (const project of PROJECTS) {
    counter[project.id] = 0;
  }
  return counter;
}

export function attributeBlockToProjects(block: RpcBlock): BlockAttribution {
  const counts = createEmptyProjectCounter();
  const otherAddresses: Record<string, number> = {};
  let filteredInfraTxCount = 0;
  let unattributedCount = 0;

  for (const tx of block.transactions) {
    if (!tx.to) {
      unattributedCount += 1;
      continue;
    }

    const address = normalizeAddress(tx.to);
    const directProject = CONTRACT_TO_PROJECT.get(address);

    if (directProject) {
      counts[directProject] += 1;
      continue;
    }

    if (INFRA_DENYLIST.has(address) || isSystemLikeAddress(address)) {
      filteredInfraTxCount += 1;
      continue;
    }

    unattributedCount += 1;
    otherAddresses[address] = (otherAddresses[address] ?? 0) + 1;
  }

  counts[OTHER_PROJECT_ID] += unattributedCount;

  const activeProjectIds = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([projectId]) => projectId);

  const gasUsed = hexToNumber(block.gasUsed);
  const gasLimitRaw = hexToNumber(block.gasLimit);
  const gasLimit = gasLimitRaw > 0 ? gasLimitRaw : gasUsed;
  const gasUsedRatio = gasLimit > 0 ? Math.min(1, Math.max(0, gasUsed / gasLimit)) : 0;

  return {
    blockNumber: hexToNumber(block.number),
    blockTimestamp: hexToNumber(block.timestamp),
    totalTxCount: block.transactions.length,
    filteredInfraTxCount,
    countsByProject: counts,
    activeProjectIds,
    gasUsed,
    gasLimit,
    gasUsedRatio,
    otherAddresses,
  };
}
