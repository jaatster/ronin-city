import { attributeBlockToProjects } from '../attribution/attributionEngine';
import type { RoninDataHandlers, RpcBlock } from '../types';
import { RoninRpcClient, blockHexToNumber, gasWeiHexToGwei } from './roninRpc';

export interface RoninDataLayerOptions {
  blockPollMs?: number;
  gasPollMs?: number;
  endpoint?: string;
}

export class RoninDataLayer {
  private readonly blockPollMs: number;
  private readonly gasPollMs: number;
  private readonly rpc: RoninRpcClient;
  private readonly handlers: RoninDataHandlers;

  private blockTimer: number | null = null;
  private gasTimer: number | null = null;
  private lastSeenBlock: number | null = null;
  private pollingBlocks = false;
  private pollingGas = false;

  constructor(handlers: RoninDataHandlers, options: RoninDataLayerOptions = {}) {
    this.handlers = handlers;
    this.blockPollMs = options.blockPollMs ?? 3_000;
    this.gasPollMs = options.gasPollMs ?? 15_000;
    this.rpc = new RoninRpcClient(options.endpoint);
  }

  start(): void {
    if (this.blockTimer !== null || this.gasTimer !== null) {
      return;
    }

    void this.pollBlocks();
    void this.pollGas();

    this.blockTimer = window.setInterval(() => {
      void this.pollBlocks();
    }, this.blockPollMs);

    this.gasTimer = window.setInterval(() => {
      void this.pollGas();
    }, this.gasPollMs);
  }

  stop(): void {
    if (this.blockTimer !== null) {
      window.clearInterval(this.blockTimer);
      this.blockTimer = null;
    }

    if (this.gasTimer !== null) {
      window.clearInterval(this.gasTimer);
      this.gasTimer = null;
    }
  }

  getLastSeenBlock(): number | null {
    return this.lastSeenBlock;
  }

  private async pollBlocks(): Promise<void> {
    if (this.pollingBlocks) {
      return;
    }

    this.pollingBlocks = true;

    try {
      const latestBlock = await this.rpc.getLatestBlock();
      const latestBlockNumber = blockHexToNumber(latestBlock.number);

      if (!Number.isFinite(latestBlockNumber)) {
        return;
      }

      if (this.lastSeenBlock === null) {
        this.processBlock(latestBlock);
        this.lastSeenBlock = latestBlockNumber;
        return;
      }

      if (latestBlockNumber <= this.lastSeenBlock) {
        return;
      }

      let highestProcessed = this.lastSeenBlock;

      for (let blockNumber = this.lastSeenBlock + 1; blockNumber <= latestBlockNumber; blockNumber += 1) {
        const block =
          blockNumber === latestBlockNumber ? latestBlock : await this.rpc.getBlockByNumber(blockNumber);

        this.processBlock(block);
        highestProcessed = blockHexToNumber(block.number);
      }

      this.lastSeenBlock = highestProcessed;
    } catch (error) {
      this.handlers.onError(error);
    } finally {
      this.pollingBlocks = false;
    }
  }

  private async pollGas(): Promise<void> {
    if (this.pollingGas) {
      return;
    }

    this.pollingGas = true;

    try {
      const gasPriceHex = await this.rpc.getGasPriceWeiHex();
      const gasPriceGwei = gasWeiHexToGwei(gasPriceHex);
      this.handlers.onGasPrice(gasPriceGwei);
    } catch (error) {
      this.handlers.onError(error);
    } finally {
      this.pollingGas = false;
    }
  }

  private processBlock(block: RpcBlock): void {
    const attribution = attributeBlockToProjects(block);
    this.handlers.onBlockAttribution(attribution);
  }
}
