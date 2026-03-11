import './style.css';

import { PROJECTS } from './attribution/contractRegistry';
import { RoninDataLayer } from './data/roninDataLayer';
import { RoninCityRenderer } from './render/cityRenderer';
import { RoninHighwayRenderer } from './render/highwayRenderer';
import type { ChainStats, ProjectActivity, TrackedBlock, VisualizationMode } from './types';

type ActivityMap = Record<string, ProjectActivity>;

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App root not found');
}

app.innerHTML = `
  <div id="city-root">
    <canvas id="city-canvas" aria-label="Ronin City live canvas"></canvas>
    <div class="overlay overlay-title">
      <h1 id="title-main">Ronin City</h1>
      <p id="title-sub">Living blockchain pixel city</p>
    </div>
    <div class="overlay overlay-mode-switch" role="group" aria-label="Visualization mode">
      <button id="mode-city" type="button" class="mode-button">City</button>
      <button id="mode-highway" type="button" class="mode-button">Highway</button>
    </div>
    <div class="overlay overlay-stats" id="stats-panel">
      <div class="stat-row"><span>Block</span><strong id="stat-block">-</strong></div>
      <div class="stat-row"><span>Gas</span><strong id="stat-gas">-</strong></div>
      <div class="stat-row"><span>Tx / block</span><strong id="stat-tx">-</strong></div>
      <div class="stat-row"><span>Infra filtered</span><strong id="stat-filtered">-</strong></div>
      <div class="stat-row"><span>Buses on screen</span><strong id="stat-buses">-</strong></div>
      <div class="stat-row"><span>Blocks processed</span><strong id="stat-blocks-processed">0</strong></div>
      <div class="stat-row"><span>Status</span><strong id="stat-status">Booting...</strong></div>
    </div>
    <div id="tooltip"></div>
  </div>
`;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>('#city-canvas');
const tooltip = requireElement<HTMLDivElement>('#tooltip');

const titleMain = requireElement<HTMLElement>('#title-main');
const titleSub = requireElement<HTMLElement>('#title-sub');

const modeCityButton = requireElement<HTMLButtonElement>('#mode-city');
const modeHighwayButton = requireElement<HTMLButtonElement>('#mode-highway');

const statBlock = requireElement<HTMLElement>('#stat-block');
const statGas = requireElement<HTMLElement>('#stat-gas');
const statTx = requireElement<HTMLElement>('#stat-tx');
const statFiltered = requireElement<HTMLElement>('#stat-filtered');
const statBuses = requireElement<HTMLElement>('#stat-buses');
const statBlocksProcessed = requireElement<HTMLElement>('#stat-blocks-processed');
const statStatus = requireElement<HTMLElement>('#stat-status');

let cityRenderer: RoninCityRenderer | null = null;
let highwayRenderer: RoninHighwayRenderer | null = null;
let currentMode: VisualizationMode = 'city';

const activities: ActivityMap = Object.fromEntries(
  PROJECTS.map((project) => [
    project.id,
    {
      recentTx: 0,
      latestTx: 0,
      pulse: 0,
      totalTx: 0,
    },
  ]),
) as ActivityMap;

const stats: ChainStats = {
  currentBlock: 0,
  gasPriceGwei: 0,
  latestTxCount: 0,
  latestFilteredTxCount: 0,
  lastUpdatedAt: Date.now(),
};

const recentBlocks: TrackedBlock[] = [];
const MAX_TRACKED_BLOCKS = 220;

let busesOnScreen = 0;
let totalBlocksProcessed = 0;

let simulationClockMs = performance.now();
let previousFrameMs = simulationClockMs;
let animationHandle = 0;
let lastErrorMessage = '';
let lastOverlayRefreshMs = 0;

function setRendererMode(mode: VisualizationMode): void {
  if (mode === 'city') {
    if (highwayRenderer) {
      highwayRenderer.destroy();
      highwayRenderer = null;
    }

    if (!cityRenderer) {
      cityRenderer = new RoninCityRenderer(canvas, tooltip, PROJECTS);
    }
  } else {
    if (cityRenderer) {
      cityRenderer.destroy();
      cityRenderer = null;
    }

    if (!highwayRenderer) {
      highwayRenderer = new RoninHighwayRenderer(canvas, tooltip, PROJECTS);
    }
  }
}

function updateModeUi(): void {
  const isCity = currentMode === 'city';

  modeCityButton.classList.toggle('active', isCity);
  modeCityButton.setAttribute('aria-pressed', isCity ? 'true' : 'false');

  modeHighwayButton.classList.toggle('active', !isCity);
  modeHighwayButton.setAttribute('aria-pressed', !isCity ? 'true' : 'false');

  titleMain.textContent = isCity ? 'Ronin City' : 'Ronin Highway';
  titleSub.textContent = isCity ? 'Living blockchain pixel city' : 'Blocks as retro side-scrolling buses';
}

function setMode(mode: VisualizationMode): void {
  if (mode === currentMode) {
    return;
  }

  tooltip.style.opacity = '0';
  tooltip.style.pointerEvents = 'none';
  currentMode = mode;
  setRendererMode(mode);
  updateModeUi();
  renderFrame();
  updateStatsPanel();
}

modeCityButton.addEventListener('click', () => {
  setMode('city');
});

modeHighwayButton.addEventListener('click', () => {
  setMode('highway');
});

function updateSimulation(deltaMs: number): void {
  const recentDecay = Math.pow(0.88, deltaMs / 1000);

  for (const project of PROJECTS) {
    const activity = activities[project.id];
    activity.recentTx *= recentDecay;
    activity.pulse = Math.max(0, activity.pulse - deltaMs / 850);
  }
}

function renderFrame(): void {
  if (currentMode === 'city') {
    cityRenderer?.render(
      {
        activities,
        stats,
        blocks: recentBlocks,
      },
      simulationClockMs,
    );
    busesOnScreen = 0;
    return;
  }

  highwayRenderer?.render(
    {
      stats,
      blocks: recentBlocks,
    },
    simulationClockMs,
  );

  busesOnScreen = highwayRenderer?.getBusesOnScreenCount() ?? 0;
}

function updateStatsPanel(): void {
  statBlock.textContent = stats.currentBlock > 0 ? `#${stats.currentBlock.toLocaleString()}` : '-';
  statGas.textContent = stats.gasPriceGwei > 0 ? `${stats.gasPriceGwei.toFixed(2)} gwei` : '-';
  statTx.textContent = stats.latestTxCount > 0 ? stats.latestTxCount.toLocaleString() : '0';
  statFiltered.textContent = stats.latestFilteredTxCount.toLocaleString();
  statBuses.textContent = currentMode === 'highway' ? busesOnScreen.toLocaleString() : '-';
  statBlocksProcessed.textContent = totalBlocksProcessed.toLocaleString();

  if (lastErrorMessage.length > 0) {
    statStatus.textContent = 'RPC warning';
    statStatus.title = lastErrorMessage;
  } else if (stats.currentBlock > 0) {
    statStatus.textContent = 'Live';
    statStatus.title = 'Connected to Ronin RPC';
  } else {
    statStatus.textContent = 'Connecting';
    statStatus.title = '';
  }
}

function onAnimationFrame(frameMs: number): void {
  const deltaMs = Math.min(140, frameMs - previousFrameMs);
  previousFrameMs = frameMs;
  simulationClockMs += deltaMs;

  updateSimulation(deltaMs);
  renderFrame();

  if (frameMs - lastOverlayRefreshMs > 180) {
    updateStatsPanel();
    lastOverlayRefreshMs = frameMs;
  }

  animationHandle = window.requestAnimationFrame(onAnimationFrame);
}

const dataLayer = new RoninDataLayer({
  onBlockAttribution: (payload) => {
    lastErrorMessage = '';

    stats.currentBlock = payload.blockNumber;
    stats.latestTxCount = payload.totalTxCount;
    stats.latestFilteredTxCount = payload.filteredInfraTxCount;
    stats.lastUpdatedAt = Date.now();

    totalBlocksProcessed += 1;

    recentBlocks.push({
      blockNumber: payload.blockNumber,
      blockTimestamp: payload.blockTimestamp,
      totalTxCount: payload.totalTxCount,
      filteredInfraTxCount: payload.filteredInfraTxCount,
      countsByProject: { ...payload.countsByProject },
      gasUsed: payload.gasUsed,
      gasLimit: payload.gasLimit,
      gasUsedRatio: payload.gasUsedRatio,
      receivedAtMs: simulationClockMs,
      otherAddresses: { ...payload.otherAddresses },
    });

    if (recentBlocks.length > MAX_TRACKED_BLOCKS) {
      recentBlocks.splice(0, recentBlocks.length - MAX_TRACKED_BLOCKS);
    }

    const activeProjectIds: string[] = [];

    for (const project of PROJECTS) {
      const count = payload.countsByProject[project.id] ?? 0;
      const activity = activities[project.id];

      activity.latestTx = count;
      activity.totalTx += count;
      activity.recentTx = activity.recentTx * 0.72 + count;

      if (count > 0) {
        activity.pulse = Math.min(1.9, activity.pulse + 0.9);
        activeProjectIds.push(project.id);
      }
    }

    if (cityRenderer) {
      const burstProjects = activeProjectIds.filter((projectId) => projectId !== 'other-ronin-activity');
      cityRenderer.enqueueBlockBursts(burstProjects, payload.blockNumber, simulationClockMs);
    }

    updateStatsPanel();
  },
  onGasPrice: (gasPriceGwei) => {
    stats.gasPriceGwei = gasPriceGwei;
    stats.lastUpdatedAt = Date.now();
    updateStatsPanel();
  },
  onError: (error) => {
    const fallback = 'Unknown Ronin RPC error';
    lastErrorMessage = error instanceof Error ? error.message : fallback;
    updateStatsPanel();
    // eslint-disable-next-line no-console
    console.error('[Ronin City]', error);
  },
});

function renderGameToText(): string {
  const hoveredProjectId = currentMode === 'city' ? cityRenderer?.getHoveredProjectId() ?? null : null;
  const hoveredBlockNumber = currentMode === 'highway' ? highwayRenderer?.getHoveredBlockNumber() ?? null : null;
  const selectedBlockNumber = currentMode === 'highway' ? highwayRenderer?.getSelectedBlockNumber() ?? null : null;

  return JSON.stringify({
    mode: currentMode,
    coordinateSystem: {
      origin: 'top-left',
      xAxis: 'positive-right',
      yAxis: 'positive-down',
    },
    chain: {
      blockNumber: stats.currentBlock,
      gasPriceGwei: Number(stats.gasPriceGwei.toFixed(4)),
      latestTxCount: stats.latestTxCount,
      filteredInfraTxCount: stats.latestFilteredTxCount,
      totalBlocksProcessed,
      busesOnScreen,
    },
    hoveredProjectId,
    hoveredBlockNumber,
    selectedBlockNumber,
    projects: PROJECTS.map((project) => ({
      id: project.id,
      name: project.name,
      recentTx: Number(activities[project.id].recentTx.toFixed(3)),
      latestTx: activities[project.id].latestTx,
      totalTx: activities[project.id].totalTx,
    })),
    recentBlocks: recentBlocks.slice(-20).map((block) => ({
      blockNumber: block.blockNumber,
      totalTxCount: block.totalTxCount,
      gasUsedRatio: Number(block.gasUsedRatio.toFixed(4)),
      topProjects: Object.entries(block.countsByProject)
        .filter(([, count]) => count > 0)
        .sort(([, countA], [, countB]) => countB - countA)
        .slice(0, 4),
    })),
  });
}

function advanceTime(milliseconds: number): void {
  const fixedStepMs = 1000 / 60;
  const steps = Math.max(1, Math.round(milliseconds / fixedStepMs));

  for (let step = 0; step < steps; step += 1) {
    simulationClockMs += fixedStepMs;
    updateSimulation(fixedStepMs);
  }

  renderFrame();
  updateStatsPanel();
}

window.render_game_to_text = renderGameToText;
window.advanceTime = advanceTime;

setRendererMode(currentMode);
updateModeUi();

dataLayer.start();
updateStatsPanel();
renderFrame();
animationHandle = window.requestAnimationFrame(onAnimationFrame);

window.addEventListener('resize', () => {
  cityRenderer?.resize();
  highwayRenderer?.resize();
});

window.addEventListener('beforeunload', () => {
  window.cancelAnimationFrame(animationHandle);
  dataLayer.stop();
  cityRenderer?.destroy();
  highwayRenderer?.destroy();
});
