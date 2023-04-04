// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'fs';
import http from 'http';
import https from 'https';
import { Interface } from '@ethersproject/abi';
import { Block, TransactionReceipt } from '@ethersproject/abstract-provider';
import { WebSocketProvider } from '@ethersproject/providers';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RuntimeDataSourceV0_2_0 } from '@subql/common-ethereum';
import { getLogger } from '@subql/node-core';
import {
  ApiWrapper,
  BlockWrapper,
  EthereumBlockWrapper,
  EthereumTransaction,
  EthereumResult,
  EthereumLog,
} from '@subql/types-ethereum';
import CacheableLookup from 'cacheable-lookup';
import { hexDataSlice, hexValue } from 'ethers/lib/utils';
import { retryOnFailEth } from '../utils/project';
import { EthereumBlockWrapped } from './block.ethereum';
import { JsonRpcBatchProvider } from './ethers/json-rpc-batch-provider';
import { JsonRpcProvider } from './ethers/json-rpc-provider';
import { ConnectionInfo } from './ethers/web';
import SafeEthProvider from './safe-api';
import {
  formatBlock,
  formatLog,
  formatReceipt,
  formatTransaction,
} from './utils.ethereum';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: packageVersion } = require('../../package.json');

const logger = getLogger('api.ethereum');

async function loadAssets(
  ds: RuntimeDataSourceV0_2_0,
): Promise<Record<string, string>> {
  if (!ds.assets) {
    return {};
  }
  const res: Record<string, string> = {};

  for (const [name, { file }] of Object.entries(ds.assets)) {
    try {
      res[name] = await fs.promises.readFile(file, { encoding: 'utf8' });
    } catch (e) {
      throw new Error(`Failed to load datasource asset ${file}`);
    }
  }

  return res;
}

function getHttpAgents() {
  // By default Nodejs doesn't cache DNS lookups
  // https://httptoolkit.com/blog/configuring-nodejs-dns/
  const lookup = new CacheableLookup();

  const options: http.AgentOptions = {
    keepAlive: true,
    /*, maxSockets: 100*/
  };

  const httpAgent = new http.Agent(options);
  const httpsAgent = new https.Agent(options);

  lookup.install(httpAgent);
  lookup.install(httpsAgent);

  return {
    http: httpAgent,
    https: httpsAgent,
  };
}

export class EthereumApi implements ApiWrapper<EthereumBlockWrapper> {
  private client: JsonRpcProvider;
  private genesisBlock: Record<string, any>;
  private contractInterfaces: Record<string, Interface> = {};
  private chainId: number;

  // Ethereum POS
  private supportsFinalization = true;

  constructor(private endpoint: string, private eventEmitter: EventEmitter2) {
    const { hostname, protocol, searchParams } = new URL(endpoint);

    const protocolStr = protocol.replace(':', '');

    logger.info(`Api host: ${hostname}, method: ${protocolStr}`);
    if (protocolStr === 'https' || protocolStr === 'http') {
      const connection: ConnectionInfo = {
        url: this.endpoint.split('?')[0],
        headers: {
          'User-Agent': `Subquery-Node ${packageVersion}`,
        },
        allowGzip: true,
        throttleLimit: 5,
        throttleSlotInterval: 1,
        agents: getHttpAgents(),
      };
      searchParams.forEach((value, name, searchParams) => {
        (connection.headers as any)[name] = value;
      });
      this.client = new JsonRpcBatchProvider(connection);
    } else if (protocolStr === 'ws' || protocolStr === 'wss') {
      this.client = new WebSocketProvider(this.endpoint);
    } else {
      throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  async init(): Promise<void> {
    this.injectClient();
    this.genesisBlock = await this.client.getBlock(0);

    const network = await this.client.getNetwork();
    this.chainId = network.chainId;
  }

  private injectClient(): void {
    const orig = this.client.send.bind(this.client);
    Object.defineProperty(this.client, 'send', {
      value: (...args) => {
        this.eventEmitter.emit('rpcCall');
        return orig(...args);
      },
    });
  }

  async getFinalizedBlockHeight(): Promise<number> {
    try {
      if (this.supportsFinalization) {
        return (await this.client.getBlock('finalized')).number;
      } else {
        // TODO make number of blocks finalised configurable
        return (await this.getBestBlockHeight()) - 15; // Consider 15 blocks finalized
      }
    } catch (e) {
      // TODO handle specific error for this
      this.supportsFinalization = false;
      return this.getFinalizedBlockHeight();
    }
  }

  async getBestBlockHeight(): Promise<number> {
    const tag = this.supportsFinalization ? 'safe' : 'latest';
    return (await this.client.getBlock(tag)).number;
  }

  getRuntimeChain(): string {
    return 'ethereum';
  }

  getChainId(): number {
    return this.chainId;
  }

  getGenesisHash(): string {
    return this.genesisBlock.hash;
  }

  getSpecName(): string {
    return 'ethereum';
  }

  async getBlockByHeightOrHash(heightOrHash: number | string): Promise<Block> {
    if (typeof heightOrHash === 'number') {
      heightOrHash = hexValue(heightOrHash);
    }
    return this.client.getBlock(heightOrHash);
  }

  private async getBlockPromise(num: number, includeTx = true): Promise<any> {
    const rawBlock = await this.client.send('eth_getBlockByNumber', [
      hexValue(num),
      includeTx,
    ]);

    const block = formatBlock(rawBlock);

    block.stateRoot = this.client.formatter.hash(block.stateRoot);

    return block;
  }

  async getTransactionReceipt(
    transactionHash: string | Promise<string>,
  ): Promise<TransactionReceipt> {
    return retryOnFailEth<TransactionReceipt>(
      this.client.getTransactionReceipt.bind(this.client, transactionHash),
    );
  }

  async fetchBlock(
    blockNumber: number,
    includeTx?: boolean,
  ): Promise<EthereumBlockWrapped> {
    const [block, logs] = await Promise.all([
      this.getBlockPromise(blockNumber, includeTx),
      this.client.getLogs({
        fromBlock: hexValue(blockNumber),
        toBlock: hexValue(blockNumber),
      }),
    ]);

    const ret = new EthereumBlockWrapped(
      block,
      includeTx
        ? block.transactions.map((tx) => ({
            ...formatTransaction(tx),
            // TODO memoise
            receipt: () =>
              this.getTransactionReceipt(tx).then((r) =>
                formatReceipt(r, block),
              ),
          }))
        : [],
      logs.map((l) => formatLog(l, block)),
    );
    this.eventEmitter.emit('fetchBlock');
    return ret;
  }

  async fetchBlocks(bufferBlocks: number[]): Promise<EthereumBlockWrapper[]> {
    return Promise.all(
      bufferBlocks.map(async (num) => this.fetchBlock(num, true)),
    );
  }

  freezeApi(processor: any, blockContent: BlockWrapper): void {
    processor.freeze(
      new SafeEthProvider(this.client, blockContent.blockHeight),
      'api',
    );
  }

  private buildInterface(
    abiName: string,
    assets: Record<string, string>,
  ): Interface | undefined {
    if (!assets[abiName]) {
      throw new Error(`ABI named "${abiName}" not referenced in assets`);
    }

    // This assumes that all datasources have a different abi name or they are the same abi
    if (!this.contractInterfaces[abiName]) {
      // Constructing the interface validates the ABI
      try {
        let abiObj = JSON.parse(assets[abiName]);

        /*
         * Allows parsing JSON artifacts as well as ABIs
         * https://trufflesuite.github.io/artifact-updates/background.html#what-are-artifacts
         */
        if (!Array.isArray(abiObj) && abiObj.abi) {
          abiObj = abiObj.abi;
        }

        this.contractInterfaces[abiName] = new Interface(abiObj);
      } catch (e) {
        logger.error(`Unable to parse ABI: ${e.message}`);
        throw new Error('ABI is invalid');
      }
    }

    return this.contractInterfaces[abiName];
  }

  async parseLog<T extends EthereumResult = EthereumResult>(
    log: EthereumLog,
    ds: RuntimeDataSourceV0_2_0,
  ): Promise<EthereumLog<T> | EthereumLog> {
    try {
      if (!ds?.options?.abi) {
        logger.warn('No ABI provided for datasource');
        return log;
      }
      const iface = this.buildInterface(ds.options.abi, await loadAssets(ds));
      return {
        ...log,
        args: iface?.parseLog(log).args as T,
      };
    } catch (e) {
      logger.warn(`Failed to parse log data: ${e.message}`);
      return log;
    }
  }

  async parseTransaction<T extends EthereumResult = EthereumResult>(
    transaction: EthereumTransaction,
    ds: RuntimeDataSourceV0_2_0,
  ): Promise<EthereumTransaction<T> | EthereumTransaction> {
    try {
      if (!ds?.options?.abi) {
        logger.warn('No ABI provided for datasource');
        return transaction;
      }
      const assets = await loadAssets(ds);
      const iface = this.buildInterface(ds.options.abi, assets);
      const func = iface.getFunction(hexDataSlice(transaction.input, 0, 4));
      const args = iface.decodeFunctionData(func, transaction.input) as T;
      return {
        ...transaction,
        args,
      };
    } catch (e) {
      logger.warn(`Failed to parse transaction data: ${e.message}`);
      return transaction;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async connect(): Promise<void> {
    logger.error('Ethereum API connect is not implemented');
    throw new Error('Not implemented');
  }

  async disconnect(): Promise<void> {
    if (this.client instanceof WebSocketProvider) {
      await this.client.destroy();
    } else {
      logger.warn('Disconnect called on HTTP provider');
    }
  }
}
