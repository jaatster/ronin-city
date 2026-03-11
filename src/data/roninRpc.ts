import type { RpcBlock } from '../types';

interface RpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export class RoninRpcClient {
  private requestId = 1;
  private readonly endpoint: string;

  constructor(endpoint = 'https://api.roninchain.com/rpc') {
    this.endpoint = endpoint;
  }

  async getLatestBlock(): Promise<RpcBlock> {
    const block = await this.request<RpcBlock>('eth_getBlockByNumber', ['latest', true]);
    return block;
  }

  async getBlockByNumber(blockNumber: number): Promise<RpcBlock> {
    const hex = `0x${blockNumber.toString(16)}`;
    const block = await this.request<RpcBlock>('eth_getBlockByNumber', [hex, true]);
    return block;
  }

  async getGasPriceWeiHex(): Promise<string> {
    const gasPrice = await this.request<string>('eth_gasPrice', []);
    return gasPrice;
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.requestId++,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ronin RPC HTTP ${response.status} for ${method}`);
    }

    const payload = (await response.json()) as RpcResponse<T>;

    if (payload.error) {
      throw new Error(`Ronin RPC ${method} failed: ${payload.error.code} ${payload.error.message}`);
    }

    if (payload.result === undefined) {
      throw new Error(`Ronin RPC ${method} returned no result`);
    }

    return payload.result;
  }
}

export function gasWeiHexToGwei(hexValue: string): number {
  const wei = Number.parseInt(hexValue, 16);
  return wei / 1_000_000_000;
}

export function blockHexToNumber(hexValue: string): number {
  return Number.parseInt(hexValue, 16);
}
