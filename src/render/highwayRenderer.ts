import type { ChainStats, ProjectConfig, TrackedBlock } from '../types';

interface HighwayRenderSnapshot {
  stats: ChainStats;
  blocks: TrackedBlock[];
}

interface Star {
  x: number;
  y: number;
  size: number;
  phase: number;
}

interface LaneGeometry {
  baselineY: number;
  busHeight: number;
  scale: number;
}

interface BusFrame {
  block: TrackedBlock;
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
  freshness: number;
}

interface BreakdownEntry {
  projectId: string;
  name: string;
  color: string;
  count: number;
}

const LANE_COUNT = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
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

export class RoninHighwayRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly tooltip: HTMLDivElement;
  private readonly projectById = new Map<string, ProjectConfig>();

  private viewportWidth = 0;
  private viewportHeight = 0;
  private pixelSize = 3;

  private stars: Star[] = [];
  private visibleBusFrames: BusFrame[] = [];
  private blockByNumber = new Map<number, TrackedBlock>();

  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;
  private hoveredBlockNumber: number | null = null;

  private busesOnScreenCount = 0;

  private readonly onPointerMove = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = event.clientX - rect.left;
    this.pointerY = event.clientY - rect.top;
    this.pointerActive = true;

    this.hoveredBlockNumber = this.hitTest(this.pointerX, this.pointerY);
    this.canvas.style.cursor = this.hoveredBlockNumber !== null ? 'pointer' : 'default';
  };

  private readonly onPointerLeave = (): void => {
    this.pointerActive = false;
    this.hoveredBlockNumber = null;
    this.canvas.style.cursor = 'default';
    this.tooltip.style.opacity = '0';
  };

  constructor(canvas: HTMLCanvasElement, tooltip: HTMLDivElement, projects: ProjectConfig[]) {
    this.canvas = canvas;
    this.tooltip = tooltip;

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
    this.tooltip.style.opacity = '0';
  }

  render(snapshot: HighwayRenderSnapshot, nowMs: number): void {
    this.blockByNumber = new Map(snapshot.blocks.map((block) => [block.blockNumber, block]));

    this.drawSky(snapshot.stats.gasPriceGwei, nowMs);
    this.drawParallax(nowMs);
    this.drawRoad(nowMs);

    this.visibleBusFrames = this.computeBusFrames(snapshot.blocks, nowMs);
    this.busesOnScreenCount = this.visibleBusFrames.length;

    for (const frame of this.visibleBusFrames) {
      this.drawBus(frame);
    }

    this.updateTooltip();
  }

  getHoveredBlockNumber(): number | null {
    return this.hoveredBlockNumber;
  }

  getSelectedBlockNumber(): number | null {
    return null;
  }

  getBusesOnScreenCount(): number {
    return this.busesOnScreenCount;
  }

  private computeBusFrames(blocks: TrackedBlock[], nowMs: number): BusFrame[] {
    const result: BusFrame[] = [];
    const candidates = blocks.slice(-120);
    const speedPxPerSecond = this.getScrollSpeedPxPerSecond();
    const spawnX = -(this.pixelSize * 8);

    for (const block of candidates) {
      const elapsedMs = nowMs - block.receivedAtMs;
      if (elapsedMs < -100) {
        continue;
      }

      const lane = Math.abs(block.blockNumber) % LANE_COUNT;
      const geometry = this.getLaneGeometry(lane);

      const baseWidth = this.computeBusWidth(block.totalTxCount);
      const rawX = spawnX + (elapsedMs / 1000) * speedPxPerSecond;
      const freshness = clamp(1 - (rawX / (this.viewportWidth + baseWidth)), 0, 1);

      const width = baseWidth * (0.9 + freshness * 0.18) * geometry.scale;
      const height = geometry.busHeight * (0.9 + freshness * 0.12) * geometry.scale;
      const x = rawX;
      const y = geometry.baselineY - height;

      const isVisible = x + width > -this.pixelSize * 16 && x < this.viewportWidth + this.pixelSize * 24;
      if (!isVisible) {
        continue;
      }

      result.push({
        block,
        lane,
        x,
        y,
        width,
        height,
        freshness,
      });
    }

    result.sort((frameA, frameB) => {
      if (frameA.lane !== frameB.lane) {
        return frameA.lane - frameB.lane;
      }
      return frameA.x - frameB.x;
    });

    return result;
  }

  private getLaneGeometry(lane: number): LaneGeometry {
    const roadTop = this.getRoadTop();
    const roadHeight = this.viewportHeight - roadTop;
    const laneHeight = roadHeight / LANE_COUNT;

    const depth = lane / (LANE_COUNT - 1);
    const scale = 0.86 + depth * 0.2;

    return {
      baselineY: roadTop + laneHeight * (lane + 0.72),
      busHeight: laneHeight * 0.34,
      scale,
    };
  }

  private getRoadTop(): number {
    return this.viewportHeight * 0.6;
  }

  private getScrollSpeedPxPerSecond(): number {
    return Math.max(28, this.viewportWidth / 44);
  }

  private computeBusWidth(totalTxCount: number): number {
    const txNormalized = clamp(Math.log1p(totalTxCount) / Math.log(260), 0, 1);
    return this.pixelSize * (18 + txNormalized * 24);
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
      const twinkle = 0.35 + 0.65 * Math.sin(nowMs * 0.0017 + star.phase);
      this.context.fillStyle = `rgba(210,230,255,${0.2 + twinkle * 0.45})`;
      this.context.fillRect(
        Math.floor(star.x * this.viewportWidth),
        Math.floor(star.y * this.viewportHeight),
        star.size,
        star.size,
      );
    }
  }

  private drawParallax(nowMs: number): void {
    const roadTop = this.getRoadTop();

    this.drawSkylineLayer({
      nowMs,
      baseY: roadTop - this.pixelSize * 6,
      height: this.viewportHeight * 0.17,
      segmentWidth: this.pixelSize * 9,
      speed: 0.02,
      color: 'rgba(15, 32, 82, 0.7)',
    });

    this.drawSkylineLayer({
      nowMs,
      baseY: roadTop - this.pixelSize * 2,
      height: this.viewportHeight * 0.12,
      segmentWidth: this.pixelSize * 6,
      speed: 0.035,
      color: 'rgba(26, 47, 114, 0.82)',
    });

    this.drawRoadsidePosts(nowMs, roadTop);
  }

  private drawSkylineLayer(options: {
    nowMs: number;
    baseY: number;
    height: number;
    segmentWidth: number;
    speed: number;
    color: string;
  }): void {
    const { nowMs, baseY, height, segmentWidth, speed, color } = options;

    const period = segmentWidth * 16;
    const scroll = (nowMs * speed) % period;

    const worldStart = Math.floor((-scroll - segmentWidth * 4) / segmentWidth);
    const worldEnd = Math.ceil((this.viewportWidth - scroll + segmentWidth * 4) / segmentWidth);

    this.context.fillStyle = color;

    for (let worldIndex = worldStart; worldIndex <= worldEnd; worldIndex += 1) {
      const screenX = worldIndex * segmentWidth + scroll;
      const seed = fract(Math.sin(worldIndex * 12.9898 + 21.131) * 43_758.5453);
      const heightUnits = Math.floor((0.3 + seed * 0.7) * (height / this.pixelSize));
      const columnHeight = Math.max(this.pixelSize * 2, heightUnits * this.pixelSize);

      this.context.fillRect(
        Math.floor(screenX),
        Math.floor(baseY - columnHeight),
        Math.ceil(segmentWidth * 0.84),
        columnHeight,
      );
    }
  }

  private drawRoadsidePosts(nowMs: number, roadTop: number): void {
    const spacing = this.pixelSize * 24;
    const move = (nowMs * this.getScrollSpeedPxPerSecond() * 0.16) % spacing;

    for (let x = -spacing; x < this.viewportWidth + spacing; x += spacing) {
      const postX = Math.floor(x + move);
      this.context.fillStyle = 'rgba(65, 99, 170, 0.9)';
      this.context.fillRect(postX, roadTop - this.pixelSize * 9, this.pixelSize, this.pixelSize * 9);

      this.context.fillStyle = 'rgba(124, 184, 255, 0.78)';
      this.context.fillRect(postX - this.pixelSize, roadTop - this.pixelSize * 10, this.pixelSize * 3, this.pixelSize);
    }
  }

  private drawRoad(nowMs: number): void {
    const roadTop = this.getRoadTop();
    const roadHeight = this.viewportHeight - roadTop;

    this.context.fillStyle = '#1a1f31';
    this.context.fillRect(0, roadTop, this.viewportWidth, roadHeight);

    this.context.fillStyle = 'rgba(75, 95, 138, 0.55)';
    this.context.fillRect(0, roadTop, this.viewportWidth, this.pixelSize * 2);

    this.context.fillStyle = 'rgba(20, 24, 36, 0.92)';
    this.context.fillRect(0, this.viewportHeight - this.pixelSize * 8, this.viewportWidth, this.pixelSize * 8);

    const laneHeight = roadHeight / LANE_COUNT;
    const dashLength = this.pixelSize * 8;
    const dashGap = this.pixelSize * 10;
    const offset = ((nowMs * this.getScrollSpeedPxPerSecond() * 0.35) / 10) % (dashLength + dashGap);

    this.context.fillStyle = 'rgba(245, 247, 255, 0.8)';

    for (let lane = 1; lane < LANE_COUNT; lane += 1) {
      const laneY = roadTop + laneHeight * lane;
      for (let x = -dashLength; x < this.viewportWidth + dashLength; x += dashLength + dashGap) {
        const dashX = x + offset;
        this.context.fillRect(dashX, laneY - this.pixelSize / 2, dashLength, this.pixelSize);
      }
    }
  }

  private drawBus(frame: BusFrame): void {
    const { block, x, y, width, height, freshness } = frame;
    const ctx = this.context;

    const wheelRadius = Math.max(this.pixelSize * 1.4, height * 0.12);

    const bodyY = y + height * 0.24;
    const bodyHeight = height * 0.56;

    const shellColor = mixHexColor('#255cc8', '#75b6ff', 0.22 + freshness * 0.58);
    const roofColor = mixHexColor('#1a3d8f', '#88ccff', 0.18 + freshness * 0.52);
    const trimColor = mixHexColor('#0d224e', '#4072cb', 0.25 + freshness * 0.45);

    ctx.globalAlpha = 0.4 + freshness * 0.6;

    ctx.fillStyle = `rgba(98, 178, 255, ${0.12 + freshness * 0.2})`;
    ctx.fillRect(x - this.pixelSize * 2, bodyY - this.pixelSize * 2, width + this.pixelSize * 4, bodyHeight + this.pixelSize * 4);

    ctx.fillStyle = shellColor;
    ctx.fillRect(x, bodyY, width, bodyHeight);

    ctx.fillStyle = roofColor;
    ctx.fillRect(x + width * 0.08, y + height * 0.08, width * 0.78, height * 0.2);

    ctx.fillStyle = trimColor;
    ctx.fillRect(x, bodyY + bodyHeight - this.pixelSize * 2, width, this.pixelSize * 2);

    const windowX = x + width * 0.12;
    const windowY = bodyY + bodyHeight * 0.2;
    const windowWidth = width * 0.74;
    const windowHeight = bodyHeight * 0.46;

    ctx.fillStyle = 'rgba(9, 20, 54, 0.92)';
    ctx.fillRect(windowX, windowY, windowWidth, windowHeight);

    this.drawWindowSegments(frame, windowX, windowY, windowWidth, windowHeight);

    const separators = Math.max(4, Math.floor(windowWidth / (this.pixelSize * 3.4)));
    ctx.fillStyle = 'rgba(194, 222, 255, 0.28)';
    for (let index = 1; index < separators; index += 1) {
      const separatorX = windowX + (windowWidth / separators) * index;
      ctx.fillRect(separatorX, windowY, this.pixelSize * 0.4, windowHeight);
    }

    ctx.fillStyle = '#141821';
    ctx.fillRect(x + width * 0.22 - wheelRadius, bodyY + bodyHeight - wheelRadius * 0.3, wheelRadius * 2, wheelRadius * 2);
    ctx.fillRect(x + width * 0.72 - wheelRadius, bodyY + bodyHeight - wheelRadius * 0.3, wheelRadius * 2, wheelRadius * 2);

    ctx.fillStyle = '#7b9ee0';
    ctx.fillRect(x + width * 0.22 - wheelRadius * 0.45, bodyY + bodyHeight + wheelRadius * 0.22, wheelRadius * 0.9, wheelRadius * 0.9);
    ctx.fillRect(x + width * 0.72 - wheelRadius * 0.45, bodyY + bodyHeight + wheelRadius * 0.22, wheelRadius * 0.9, wheelRadius * 0.9);

    ctx.font = `700 ${Math.max(9, Math.floor(this.pixelSize * 1.9))}px Inter, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(248, 252, 255, 0.95)';
    ctx.fillText(`#${block.blockNumber.toLocaleString()}`, x + width * 0.5, y - this.pixelSize);

    ctx.globalAlpha = 1;
  }

  private drawWindowSegments(frame: BusFrame, x: number, y: number, width: number, height: number): void {
    const breakdown = this.getBreakdown(frame.block);
    const totalTx = Math.max(1, frame.block.totalTxCount);

    const gasUsedRatio = frame.block.gasUsedRatio > 0 ? frame.block.gasUsedRatio : clamp(frame.block.totalTxCount / 130, 0.08, 0.92);
    const usedWidth = width * clamp(gasUsedRatio, 0.06, 0.98);

    let cursor = x;

    for (const entry of breakdown) {
      const proportionalWidth = (entry.count / totalTx) * usedWidth;
      if (proportionalWidth < this.pixelSize * 0.5) {
        continue;
      }

      this.context.fillStyle = entry.color;
      this.context.fillRect(cursor, y, proportionalWidth, height);
      cursor += proportionalWidth;
    }

    if (cursor < x + usedWidth) {
      this.context.fillStyle = 'rgba(112, 146, 204, 0.55)';
      this.context.fillRect(cursor, y, x + usedWidth - cursor, height);
    }

    this.context.fillStyle = 'rgba(126, 134, 150, 0.45)';
    this.context.fillRect(x + usedWidth, y, width - usedWidth, height);
  }

  private updateTooltip(): void {
    if (!this.pointerActive || this.hoveredBlockNumber === null) {
      this.tooltip.style.opacity = '0';
      return;
    }

    const block = this.blockByNumber.get(this.hoveredBlockNumber);
    const busFrame = this.visibleBusFrames.find((frame) => frame.block.blockNumber === this.hoveredBlockNumber);

    if (!block || !busFrame) {
      this.tooltip.style.opacity = '0';
      return;
    }

    const breakdown = this.getBreakdown(block);
    const gasText = block.gasLimit > 0 ? `${(block.gasUsedRatio * 100).toFixed(1)}%` : 'n/a';

    let breakdownHtml = breakdown
      .map((entry) => {
        const pct = block.totalTxCount > 0 ? ((entry.count / block.totalTxCount) * 100).toFixed(1) : '0';
        return `<span style="color:${entry.color}">●</span> <strong>${entry.name}</strong>: ${entry.count.toLocaleString()} tx (${pct}%)`;
      })
      .join('<br />');

    if (Object.keys(block.otherAddresses).length > 0) {
      const addrLines = Object.entries(block.otherAddresses)
        .sort((a, b) => b[1] - a[1])
        .map(([address, count]) => {
          const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
          return `&nbsp;&nbsp;<span title="${address}" style="color:#8ab8ff;font-size:0.85em">${short}</span>: ${count.toLocaleString()} tx`;
        })
        .join('<br />');
      breakdownHtml += `<br /><span style="color:#6a8cc7;font-size:0.85em">── Other addresses ──</span><br />${addrLines}`;
    }

    if (block.filteredInfraTxCount > 0) {
      breakdownHtml += `<br /><span style="color:#555e75">Infra (filtered): ${block.filteredInfraTxCount.toLocaleString()} tx</span>`;
    }

    this.tooltip.innerHTML = `<strong>Block #${block.blockNumber.toLocaleString()}</strong><br />Tx: ${block.totalTxCount.toLocaleString()} &nbsp;|&nbsp; Gas: ${gasText}<br /><hr style="border:none;border-top:1px solid rgba(108,174,255,0.3);margin:4px 0" />${breakdownHtml}`;

    this.tooltip.style.opacity = '1';

    const tooltipWidth = this.tooltip.offsetWidth || 280;
    const tooltipHeight = this.tooltip.offsetHeight || 120;

    const maxX = Math.max(8, this.viewportWidth - tooltipWidth - 8);
    const maxY = Math.max(4, this.viewportHeight - tooltipHeight - 4);

    const x = clamp(busFrame.x + busFrame.width / 2 - tooltipWidth / 2, 8, maxX);
    const y = clamp(busFrame.y - tooltipHeight - 8, 4, maxY);

    this.tooltip.style.transform = `translate(${x}px, ${y}px)`;
  }

  private hitTest(x: number, y: number): number | null {
    for (let index = this.visibleBusFrames.length - 1; index >= 0; index -= 1) {
      const frame = this.visibleBusFrames[index];
      const inside = x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
      if (inside) {
        return frame.block.blockNumber;
      }
    }

    return null;
  }

  private getBreakdown(block: TrackedBlock): BreakdownEntry[] {
    const entries: BreakdownEntry[] = [];

    for (const [projectId, count] of Object.entries(block.countsByProject)) {
      if (count <= 0) {
        continue;
      }

      const project = this.projectById.get(projectId);
      entries.push({
        projectId,
        count,
        name: project?.name ?? projectId,
        color: project?.style.accentColor ?? '#8ab8ff',
      });
    }

    entries.sort((entryA, entryB) => entryB.count - entryA.count || entryA.projectId.localeCompare(entryB.projectId));

    return entries;
  }

  private buildStarField(): void {
    const starCount = Math.max(35, Math.floor(this.viewportWidth / 28));
    const stars: Star[] = [];

    for (let index = 0; index < starCount; index += 1) {
      const seed = fract(Math.sin(index * 12.9898 + 78.233) * 43_758.5453);
      const seedB = fract(Math.sin(index * 98.211 + 17.127) * 12_531.6697);

      stars.push({
        x: 0.01 + seed * 0.98,
        y: 0.03 + seedB * 0.42,
        size: 1 + Math.floor(seed * 2),
        phase: seedB * Math.PI * 2,
      });
    }

    this.stars = stars;
  }
}
