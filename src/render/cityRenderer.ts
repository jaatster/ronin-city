import type { BlockBurst, ChainStats, ProjectActivity, ProjectConfig, TrackedBlock } from '../types';

interface LayoutSlot {
  x: number;
  row: 0 | 1 | 2;
}

interface BuildingFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  baseY: number;
  row: 0 | 1 | 2;
}

interface Star {
  x: number;
  y: number;
  size: number;
  phase: number;
}

interface BreakdownEntry {
  projectId: string;
  name: string;
  color: string;
  count: number;
  linkUrl: string | null;
}

interface RenderSnapshot {
  activities: Record<string, ProjectActivity>;
  stats: ChainStats;
  blocks: TrackedBlock[];
}

const FIXED_LAYOUT: LayoutSlot[] = [
  { x: 0.1, row: 0 },
  { x: 0.29, row: 0 },
  { x: 0.48, row: 0 },
  { x: 0.68, row: 0 },
  { x: 0.08, row: 1 },
  { x: 0.24, row: 1 },
  { x: 0.4, row: 1 },
  { x: 0.56, row: 1 },
  { x: 0.73, row: 1 },
  { x: 0.19, row: 2 },
  { x: 0.44, row: 2 },
  { x: 0.86, row: 0 },
  { x: 0.69, row: 2 },
];

const ROW_SCALE: Record<LayoutSlot['row'], number> = {
  0: 0.74,
  1: 0.88,
  2: 1,
};

const ROW_BASE_Y_FACTOR: Record<LayoutSlot['row'], number> = {
  0: 0.57,
  1: 0.71,
  2: 0.84,
};

const CITY_TOOLTIP_RECENT_BLOCK_WINDOW = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mixHexColor(colorA: string, colorB: string, factor: number): string {
  const cleanA = colorA.replace('#', '');
  const cleanB = colorB.replace('#', '');

  const redA = Number.parseInt(cleanA.slice(0, 2), 16);
  const greenA = Number.parseInt(cleanA.slice(2, 4), 16);
  const blueA = Number.parseInt(cleanA.slice(4, 6), 16);

  const redB = Number.parseInt(cleanB.slice(0, 2), 16);
  const greenB = Number.parseInt(cleanB.slice(2, 4), 16);
  const blueB = Number.parseInt(cleanB.slice(4, 6), 16);

  const t = clamp(factor, 0, 1);
  const red = Math.round(redA + (redB - redA) * t);
  const green = Math.round(greenA + (greenB - greenA) * t);
  const blue = Math.round(blueA + (blueB - blueA) * t);

  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue
    .toString(16)
    .padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class RoninCityRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly tooltip: HTMLDivElement;
  private readonly projects: ProjectConfig[];
  private readonly projectById = new Map<string, ProjectConfig>();

  private readonly frames = new Map<string, BuildingFrame>();
  private frameOrder: string[] = [];
  private stars: Star[] = [];
  private bursts: BlockBurst[] = [];

  private pixelSize = 3;
  private viewportWidth = 0;
  private viewportHeight = 0;

  private pointerActive = false;
  private hoveredProjectId: string | null = null;

  private readonly onPointerMove = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    this.pointerActive = true;
    this.hoveredProjectId = this.hitTest(pointerX, pointerY);
    this.canvas.style.cursor = this.hoveredProjectId ? 'pointer' : 'default';
  };

  private readonly onPointerLeave = (event: MouseEvent): void => {
    if (this.isEventIntoTooltip(event)) {
      return;
    }

    this.clearPointerState();
  };

  private readonly onTooltipLeave = (event: MouseEvent): void => {
    if (this.isEventIntoCanvas(event)) {
      return;
    }

    this.clearPointerState();
  };

  private readonly onPointerClick = (): void => {
    if (!this.hoveredProjectId) {
      return;
    }

    const project = this.projectById.get(this.hoveredProjectId);
    if (!project) {
      return;
    }

    const targetUrl = project.explorerUrl || project.websiteUrl;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  constructor(canvas: HTMLCanvasElement, tooltip: HTMLDivElement, projects: ProjectConfig[]) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.projects = projects;

    for (const project of projects) {
      this.projectById.set(project.id, project);
    }

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is unavailable');
    }

    this.context = context;

    this.canvas.addEventListener('mousemove', this.onPointerMove);
    this.canvas.addEventListener('mouseleave', this.onPointerLeave);
    this.canvas.addEventListener('click', this.onPointerClick);
    this.tooltip.addEventListener('mouseleave', this.onTooltipLeave);

    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.viewportWidth = Math.floor(this.canvas.clientWidth);
    this.viewportHeight = Math.floor(this.canvas.clientHeight);

    this.canvas.width = Math.max(1, Math.floor(this.viewportWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.viewportHeight * dpr));

    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.scale(dpr, dpr);
    this.context.imageSmoothingEnabled = false;

    const baseline = Math.min(this.viewportWidth, this.viewportHeight);
    this.pixelSize = Math.max(2, Math.floor(baseline / 260));

    this.buildStarField();
  }

  destroy(): void {
    this.canvas.removeEventListener('mousemove', this.onPointerMove);
    this.canvas.removeEventListener('mouseleave', this.onPointerLeave);
    this.canvas.removeEventListener('click', this.onPointerClick);
    this.tooltip.removeEventListener('mouseleave', this.onTooltipLeave);
    this.tooltip.style.opacity = '0';
    this.tooltip.style.pointerEvents = 'none';
  }

  enqueueBlockBursts(activeProjectIds: string[], blockNumber: number, nowMs: number): void {
    for (const projectId of activeProjectIds) {
      this.bursts.push({
        id: `${projectId}-${blockNumber}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        blockNumber,
        spawnedAt: nowMs,
        lifespanMs: 1500,
      });
    }

    if (this.bursts.length > 180) {
      this.bursts = this.bursts.slice(-180);
    }
  }

  render(snapshot: RenderSnapshot, nowMs: number): void {
    this.frames.clear();
    this.frameOrder = [];

    this.drawSky(snapshot.stats.gasPriceGwei, nowMs);
    this.drawGround();

    const sortedIndexes = this.projects
      .map((_, index) => index)
      .sort((indexA, indexB) => this.getLayoutSlot(indexA).row - this.getLayoutSlot(indexB).row);

    for (const projectIndex of sortedIndexes) {
      const project = this.projects[projectIndex];
      const activity = snapshot.activities[project.id];
      const frame = this.computeFrame(projectIndex, project, activity);

      this.frames.set(project.id, frame);
      this.frameOrder.push(project.id);

      this.drawBuilding(project, activity, frame, nowMs);
    }

    this.drawRoadLights(nowMs);
    this.drawBursts(nowMs);
    this.drawLabels(snapshot.activities);
    this.updateTooltip(snapshot.activities, snapshot.blocks);
  }

  getHoveredProjectId(): string | null {
    return this.hoveredProjectId;
  }

  private drawSky(gasPriceGwei: number, nowMs: number): void {
    const gasNormalized = clamp((gasPriceGwei - 8) / 90, 0, 1);
    const topColor = mixHexColor('#123d9a', '#cb6336', gasNormalized);
    const bottomColor = mixHexColor('#0a0e27', '#2b1230', gasNormalized * 0.85);

    const gradient = this.context.createLinearGradient(0, 0, 0, this.viewportHeight);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);

    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    for (const star of this.stars) {
      const twinkle = 0.35 + 0.65 * Math.sin(nowMs * 0.0018 + star.phase);
      this.context.fillStyle = `rgba(210,230,255,${0.2 + twinkle * 0.45})`;
      this.context.fillRect(
        Math.floor(star.x * this.viewportWidth),
        Math.floor(star.y * this.viewportHeight),
        star.size,
        star.size,
      );
    }
  }

  private drawGround(): void {
    const horizonY = this.viewportHeight * 0.46;

    this.context.fillStyle = 'rgba(8, 11, 32, 0.92)';
    this.context.fillRect(0, horizonY, this.viewportWidth, this.viewportHeight - horizonY);

    this.context.fillStyle = 'rgba(14, 22, 62, 0.88)';
    this.context.fillRect(0, this.viewportHeight * 0.8, this.viewportWidth, this.viewportHeight * 0.2);

    this.context.strokeStyle = 'rgba(95, 145, 255, 0.18)';
    this.context.lineWidth = this.pixelSize;
    this.context.beginPath();
    this.context.moveTo(0, horizonY);
    this.context.lineTo(this.viewportWidth, horizonY);
    this.context.stroke();
  }

  private drawRoadLights(nowMs: number): void {
    const lanesY = [0.83, 0.89, 0.95].map((factor) => factor * this.viewportHeight);

    for (const laneY of lanesY) {
      for (let index = 0; index < 24; index += 1) {
        const x = (index / 23) * this.viewportWidth;
        const phase = (nowMs * 0.006 + index * 0.55) % (Math.PI * 2);
        const glow = 0.25 + Math.sin(phase) * 0.2;
        this.context.fillStyle = `rgba(116, 176, 255, ${0.2 + glow})`;
        this.context.fillRect(x, laneY, this.pixelSize * 2, this.pixelSize);
      }
    }
  }

  private drawBuilding(
    project: ProjectConfig,
    activity: ProjectActivity,
    frame: BuildingFrame,
    nowMs: number,
  ): void {
    const activityNormalized = clamp(Math.log1p(activity.recentTx) / Math.log(18), 0, 1);
    const pulse = clamp(activity.pulse, 0, 1);

    const bodyColor = mixHexColor(project.style.baseColor, '#ffffff', 0.08 + activityNormalized * 0.2);
    const sideColor = mixHexColor(project.style.baseColor, '#0a0e27', 0.42);

    const glowAlpha = 0.12 + activityNormalized * 0.26 + pulse * 0.28;
    if (glowAlpha > 0.14) {
      this.context.fillStyle = `${project.style.glowColor}${Math.floor(clamp(glowAlpha, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0')}`;
      const radius = Math.max(frame.width * 0.9, frame.height * 0.45);
      this.context.beginPath();
      this.context.arc(frame.x + frame.width / 2, frame.y + frame.height * 0.35, radius, 0, Math.PI * 2);
      this.context.fill();
    }

    this.context.fillStyle = bodyColor;
    this.context.fillRect(frame.x, frame.y, frame.width, frame.height);

    this.context.fillStyle = sideColor;
    this.context.fillRect(frame.x + frame.width - this.pixelSize * 2, frame.y, this.pixelSize * 2, frame.height);

    const roofVariant = hashString(project.id) % 3;
    const roofColor = mixHexColor(project.style.accentColor, '#ffffff', 0.08 + pulse * 0.1);
    this.context.fillStyle = roofColor;

    if (project.id === 'angry-dynomites-lab') {
      const roofBaseY = frame.y - this.pixelSize * 3;
      this.context.fillRect(frame.x + this.pixelSize, roofBaseY, frame.width - this.pixelSize * 2, this.pixelSize * 3);

      const toothCount = Math.max(4, Math.floor((frame.width - this.pixelSize * 4) / (this.pixelSize * 3)));
      for (let toothIndex = 0; toothIndex < toothCount; toothIndex += 1) {
        const toothX = frame.x + this.pixelSize * 2 + toothIndex * this.pixelSize * 3;
        const toothHeight = toothIndex % 2 === 0 ? this.pixelSize * 2 : this.pixelSize;
        this.context.fillRect(toothX, roofBaseY - toothHeight, this.pixelSize * 2, toothHeight);
      }

      const stackX = frame.x + frame.width * 0.68;
      this.context.fillRect(stackX, roofBaseY - this.pixelSize * 6, this.pixelSize * 2, this.pixelSize * 6);
      this.context.fillStyle = mixHexColor(project.style.glowColor, '#fff5b8', 0.42 + pulse * 0.18);
      this.context.fillRect(stackX - this.pixelSize, roofBaseY - this.pixelSize * 7, this.pixelSize * 4, this.pixelSize);
      this.context.fillStyle = roofColor;
    } else if (roofVariant === 0) {
      this.context.fillRect(frame.x + this.pixelSize * 2, frame.y - this.pixelSize * 2, frame.width * 0.55, this.pixelSize * 2);
      this.context.fillRect(frame.x + this.pixelSize * 5, frame.y - this.pixelSize * 4, frame.width * 0.18, this.pixelSize * 2);
    } else if (roofVariant === 1) {
      this.context.fillRect(frame.x + frame.width * 0.18, frame.y - this.pixelSize * 2, frame.width * 0.64, this.pixelSize * 2);
      this.context.fillRect(frame.x + frame.width * 0.46, frame.y - this.pixelSize * 8, this.pixelSize * 2, this.pixelSize * 6);
    } else {
      this.context.fillRect(frame.x + this.pixelSize * 2, frame.y - this.pixelSize * 3, frame.width - this.pixelSize * 4, this.pixelSize * 3);
    }

    const windowWidth = Math.max(2, this.pixelSize);
    const windowHeight = Math.max(2, this.pixelSize + (frame.row === 2 ? 1 : 0));
    const stepX = windowWidth * 2 + this.pixelSize;
    const stepY = windowHeight * 2 + this.pixelSize;

    const windowsStartX = frame.x + this.pixelSize * 2;
    const windowsEndX = frame.x + frame.width - this.pixelSize * 3;
    const windowsStartY = frame.y + this.pixelSize * 3;
    const windowsEndY = frame.baseY - this.pixelSize * 3;

    let localXIndex = 0;
    for (let x = windowsStartX; x <= windowsEndX; x += stepX) {
      let localYIndex = 0;
      for (let y = windowsStartY; y <= windowsEndY; y += stepY) {
        const noise = Math.abs(
          Math.sin(nowMs * 0.001 + localXIndex * 2.3 + localYIndex * 3.1 + hashString(project.id) * 0.00007),
        );
        const litChance = 0.17 + activityNormalized * 0.55 + pulse * 0.18;
        this.context.fillStyle = noise < litChance ? project.style.accentColor : 'rgba(9, 18, 52, 0.86)';
        this.context.fillRect(x, y, windowWidth, windowHeight);
        localYIndex += 1;
      }
      localXIndex += 1;
    }
  }

  private drawLabels(activities: Record<string, ProjectActivity>): void {
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';

    for (const project of this.projects) {
      const frame = this.frames.get(project.id);
      if (!frame) {
        continue;
      }

      const activity = activities[project.id];
      const labelY = frame.baseY + this.pixelSize * 3;
      const fontSize = Math.max(10, Math.floor(this.pixelSize * (frame.row === 2 ? 2.35 : 2)));

      this.context.font = `700 ${fontSize}px Inter, Segoe UI, sans-serif`;
      this.context.fillStyle = 'rgba(245,250,255,0.95)';
      this.context.fillText(project.name, frame.x + frame.width / 2, labelY);

      this.context.font = `600 ${Math.max(9, fontSize - 2)}px Inter, Segoe UI, sans-serif`;
      this.context.fillStyle = 'rgba(142,186,255,0.9)';
      this.context.fillText(`recent ${activity.recentTx.toFixed(1)} tx`, frame.x + frame.width / 2, labelY + fontSize + 1);
    }
  }

  private drawBursts(nowMs: number): void {
    this.bursts = this.bursts.filter((burst) => nowMs - burst.spawnedAt <= burst.lifespanMs);

    for (const burst of this.bursts) {
      const frame = this.frames.get(burst.projectId);
      if (!frame) {
        continue;
      }

      const project = this.projects.find((entry) => entry.id === burst.projectId);
      if (!project) {
        continue;
      }

      const age = nowMs - burst.spawnedAt;
      const progress = clamp(age / burst.lifespanMs, 0, 1);
      const alpha = 1 - progress;
      const pulseSize = this.pixelSize * (4 + progress * 18);

      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y - this.pixelSize * 2;

      this.context.strokeStyle = `${project.style.glowColor}${Math.floor(alpha * 180)
        .toString(16)
        .padStart(2, '0')}`;
      this.context.lineWidth = Math.max(1, this.pixelSize * 0.7);
      this.context.strokeRect(centerX - pulseSize / 2, centerY - pulseSize / 2, pulseSize, pulseSize);

      this.context.fillStyle = `${project.style.accentColor}${Math.floor(alpha * 220)
        .toString(16)
        .padStart(2, '0')}`;
      this.context.font = `700 ${Math.max(9, this.pixelSize * 2)}px Inter, Segoe UI, sans-serif`;
      this.context.textAlign = 'center';
      this.context.textBaseline = 'bottom';
      this.context.fillText(`#${burst.blockNumber}`, centerX, centerY - pulseSize * 0.45);

      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2 + progress * 2.8;
        const radius = this.pixelSize * (6 + progress * 10);
        const particleX = centerX + Math.cos(angle) * radius;
        const particleY = centerY + Math.sin(angle) * radius - progress * this.pixelSize * 14;
        this.context.fillRect(particleX, particleY, this.pixelSize, this.pixelSize);
      }
    }
  }

  private updateTooltip(activities: Record<string, ProjectActivity>, blocks: TrackedBlock[]): void {
    if (!this.pointerActive || !this.hoveredProjectId) {
      this.tooltip.style.opacity = '0';
      this.tooltip.style.pointerEvents = 'none';
      return;
    }

    const project = this.projectById.get(this.hoveredProjectId);
    const frame = this.frames.get(this.hoveredProjectId);

    if (!project || !frame) {
      this.tooltip.style.opacity = '0';
      this.tooltip.style.pointerEvents = 'none';
      return;
    }

    const activity = activities[project.id];
    if (!activity) {
      this.tooltip.style.opacity = '0';
      this.tooltip.style.pointerEvents = 'none';
      return;
    }

    const recentBreakdown = this.getRecentBreakdown(blocks);
    const recentBreakdownTotal = recentBreakdown.reduce((sum, entry) => sum + entry.count, 0);
    const recentProjectWindowCount = recentBreakdown.find((entry) => entry.projectId === project.id)?.count ?? 0;

    const breakdownHtml =
      recentBreakdown.length === 0
        ? '<span style="color:#8aa0cf">No recent project activity in current window.</span>'
        : recentBreakdown
            .map((entry) => {
              const pct = recentBreakdownTotal > 0 ? ((entry.count / recentBreakdownTotal) * 100).toFixed(1) : '0';
              const projectLabel = entry.linkUrl
                ? `<a class="tooltip-link" href="${escapeHtml(entry.linkUrl)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(entry.name)}</strong></a>`
                : `<strong>${escapeHtml(entry.name)}</strong>`;

              return `<span style="color:${entry.color}">●</span> ${projectLabel}: ${entry.count.toLocaleString()} tx (${pct}%)`;
            })
            .join('<br />');

    let otherAddressesHtml = '';
    if (project.id === 'other-ronin-activity') {
      const otherAddressRows = this.getRecentOtherAddressBreakdown(blocks)
        .map(([address, count]) => {
          const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
          const addressUrl = `https://app.roninchain.com/address/${address}`;
          return `&nbsp;&nbsp;<a class="tooltip-link" href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(address)}" style="color:#8ab8ff;font-size:0.85em">${escapeHtml(short)}</a>: ${count.toLocaleString()} tx`;
        })
        .join('<br />');

      if (otherAddressRows.length > 0) {
        otherAddressesHtml = `<br /><span style="color:#6a8cc7;font-size:0.85em">── Other addresses ──</span><br />${otherAddressRows}`;
      }
    }

    this.tooltip.innerHTML = `<strong>${project.name}</strong><br />Recent tx (signal): ${activity.recentTx.toFixed(
      2,
    )} &nbsp;|&nbsp; Recent tx (window): ${recentProjectWindowCount.toLocaleString()}<br />Total tx: ${activity.totalTx.toLocaleString()} &nbsp;|&nbsp; Latest block: ${activity.latestTx.toLocaleString()}<br /><hr style="border:none;border-top:1px solid rgba(108,174,255,0.3);margin:4px 0" /><span style="color:#9ab9f5;font-size:0.85em">Recent mix (last ${Math.min(
      CITY_TOOLTIP_RECENT_BLOCK_WINDOW,
      blocks.length,
    )} blocks)</span><br />${breakdownHtml}${otherAddressesHtml}`;

    this.tooltip.style.opacity = '1';
    this.tooltip.style.pointerEvents = 'auto';

    const tooltipWidth = this.tooltip.offsetWidth || 280;
    const tooltipHeight = this.tooltip.offsetHeight || 120;

    const maxX = Math.max(8, this.viewportWidth - tooltipWidth - 8);
    const maxY = Math.max(4, this.viewportHeight - tooltipHeight - 4);

    const x = clamp(frame.x + frame.width / 2 - tooltipWidth / 2, 8, maxX);
    const y = clamp(frame.y - tooltipHeight - 8, 4, maxY);

    this.tooltip.style.transform = `translate(${x}px, ${y}px)`;
  }

  private clearPointerState(): void {
    this.pointerActive = false;
    this.hoveredProjectId = null;
    this.canvas.style.cursor = 'default';
    this.tooltip.style.opacity = '0';
    this.tooltip.style.pointerEvents = 'none';
  }

  private isEventIntoTooltip(event: MouseEvent): boolean {
    const nextTarget = event.relatedTarget;
    return nextTarget instanceof Node && this.tooltip.contains(nextTarget);
  }

  private isEventIntoCanvas(event: MouseEvent): boolean {
    const nextTarget = event.relatedTarget;
    return nextTarget instanceof Node && this.canvas.contains(nextTarget);
  }

  private getRecentBreakdown(blocks: TrackedBlock[]): BreakdownEntry[] {
    const totals = new Map<string, number>();
    const recentBlocks = blocks.slice(-CITY_TOOLTIP_RECENT_BLOCK_WINDOW);

    for (const block of recentBlocks) {
      for (const [projectId, count] of Object.entries(block.countsByProject)) {
        if (count <= 0) {
          continue;
        }

        totals.set(projectId, (totals.get(projectId) ?? 0) + count);
      }
    }

    const entries: BreakdownEntry[] = [];
    for (const [projectId, count] of totals.entries()) {
      const project = this.projectById.get(projectId);
      entries.push({
        projectId,
        name: project?.name ?? projectId,
        color: project?.style.accentColor ?? '#8ab8ff',
        count,
        linkUrl: project?.explorerUrl || project?.websiteUrl || null,
      });
    }

    entries.sort((a, b) => b.count - a.count || a.projectId.localeCompare(b.projectId));
    return entries;
  }

  private getRecentOtherAddressBreakdown(blocks: TrackedBlock[]): Array<[string, number]> {
    const totals = new Map<string, number>();
    const recentBlocks = blocks.slice(-CITY_TOOLTIP_RECENT_BLOCK_WINDOW);

    for (const block of recentBlocks) {
      for (const [address, count] of Object.entries(block.otherAddresses)) {
        if (count <= 0) {
          continue;
        }

        totals.set(address, (totals.get(address) ?? 0) + count);
      }
    }

    return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  private hitTest(x: number, y: number): string | null {
    for (let index = this.frameOrder.length - 1; index >= 0; index -= 1) {
      const projectId = this.frameOrder[index];
      const frame = this.frames.get(projectId);
      if (!frame) {
        continue;
      }

      const isInside = x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.baseY;
      if (isInside) {
        return projectId;
      }
    }

    return null;
  }

  private computeFrame(projectIndex: number, project: ProjectConfig, activity: ProjectActivity): BuildingFrame {
    const slot = this.getLayoutSlot(projectIndex);
    const rowScale = ROW_SCALE[slot.row];

    const centerX = this.viewportWidth * slot.x;
    const baseY = this.viewportHeight * ROW_BASE_Y_FACTOR[slot.row];

    const activityNormalized = clamp(Math.log1p(activity.recentTx) / Math.log(18), 0, 1);
    const pulse = clamp(activity.pulse, 0, 1);

    const width = Math.max(
      this.pixelSize * 8,
      Math.floor(project.style.widthUnits * this.pixelSize * (0.92 + rowScale * 0.18)),
    );

    const dynamicFactor = 0.72 + project.weight * 0.44 + activityNormalized * 0.18 + pulse * 0.13;
    const height = Math.max(
      this.pixelSize * 16,
      Math.floor(project.style.heightUnits * this.pixelSize * rowScale * dynamicFactor),
    );

    const x = Math.floor(centerX - width / 2);
    const y = Math.floor(baseY - height);

    return {
      x,
      y,
      width,
      height,
      baseY,
      row: slot.row,
    };
  }

  private getLayoutSlot(projectIndex: number): LayoutSlot {
    const slot = FIXED_LAYOUT[projectIndex];
    if (slot) {
      return slot;
    }

    const columns = 4;
    const row = Math.min(2, Math.floor(projectIndex / columns)) as 0 | 1 | 2;
    const col = projectIndex % columns;
    return {
      x: 0.14 + col * 0.2,
      row,
    };
  }

  private buildStarField(): void {
    const starCount = Math.max(35, Math.floor(this.viewportWidth / 30));
    const nextStars: Star[] = [];

    for (let index = 0; index < starCount; index += 1) {
      const seed = hashString(`star-${index}`);
      const x = ((seed % 10_000) / 10_000) * 0.98 + 0.01;
      const y = (((seed >> 6) % 10_000) / 10_000) * 0.42 + 0.02;
      const size = 1 + (seed % 2);
      const phase = ((seed >> 12) % 10_000) / 1000;

      nextStars.push({ x, y, size, phase });
    }

    this.stars = nextStars;
  }
}
