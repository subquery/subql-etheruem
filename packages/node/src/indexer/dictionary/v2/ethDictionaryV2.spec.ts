// Copyright 2020-2024 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {
  NodeConfig,
  BlockHeightMap,
  IBlock,
  DictionaryResponse,
} from '@subql/node-core';
import {
  EthereumBlock,
  EthereumDatasourceKind,
  EthereumHandlerKind,
  SubqlDatasource,
  SubqlRuntimeDatasource,
} from '@subql/types-ethereum';
import {
  EthereumProjectDs,
  SubqueryProject,
} from '../../../configure/SubqueryProject';
import {
  buildDictionaryV2QueryEntry,
  DEFAULT_DICTIONARY,
  EthDictionaryV2,
} from './ethDictionaryV2';

const HTTP_ENDPOINT = 'https://polygon.api.onfinality.io/public';
const mockDs: EthereumProjectDs[] = [
  {
    kind: EthereumDatasourceKind.Runtime,
    assets: new Map(),
    startBlock: 3678215,
    mapping: {
      file: './dist/index.js',
      handlers: [
        {
          handler: 'handleTransaction',
          kind: EthereumHandlerKind.Call,
          filter: {
            function: 'approve(address spender, uint256 rawAmount)',
          },
        },
        {
          handler: 'handleLog',
          kind: EthereumHandlerKind.Event,
          filter: {
            topics: [
              'Transfer(address indexed from, address indexed to, uint256 amount)',
            ],
          },
        },
      ],
    },
  },
];

// tx to is null
const mockDs2: EthereumProjectDs[] = [
  {
    kind: EthereumDatasourceKind.Runtime,
    assets: new Map(),
    startBlock: 3678215,
    mapping: {
      file: './dist/index.js',
      handlers: [
        {
          handler: 'handleTransaction',
          kind: EthereumHandlerKind.Call,
          filter: {
            to: null,
          },
        },
      ],
    },
  },
];

const nodeConfig = new NodeConfig({
  subquery: 'polygon-starter',
  subqueryName: 'polygon-starter',
  dictionaryTimeout: 10,
  networkEndpoint: [HTTP_ENDPOINT],
  networkDictionary: [DEFAULT_DICTIONARY],
});

function makeBlockHeightMap(mockDs: SubqlDatasource[]): BlockHeightMap<any> {
  const m = new Map<number, any>();
  mockDs.forEach((ds, index, dataSources) => {
    m.set(ds.startBlock, dataSources.slice(0, index + 1));
  });
  return new BlockHeightMap(m);
}

// enable this once dictionary v2 is online
describe('eth dictionary v2', () => {
  let ethDictionaryV2: EthDictionaryV2;
  let ethBlock3678215: EthereumBlock;
  let ethBlock3678250: EthereumBlock;

  const dsMap = makeBlockHeightMap(mockDs);

  beforeEach(async () => {
    ethDictionaryV2 = await EthDictionaryV2.create(
      DEFAULT_DICTIONARY,
      nodeConfig,
      undefined,
      { network: { chainId: '10' } } as SubqueryProject,
      '10',
    );

    ethDictionaryV2.updateQueriesMap(dsMap);
  });

  it('convert ds to v2 dictionary queries', () => {
    //Polygon
    const query = (ethDictionaryV2 as any).queriesMap.get(3678215);
    expect(query.logs.length).toBe(1);
    expect(query.transactions.length).toBe(1);
  }, 50000);

  it('query response match with entries', async () => {
    //Polygon
    const ethBlocks = (await ethDictionaryV2.getData(
      3678215,
      (ethDictionaryV2 as any)._metadata.end,
      2,
    )) as DictionaryResponse<IBlock<EthereumBlock>>;

    expect(ethBlocks.batchBlocks.map((b) => b.block.number)).toStrictEqual([
      3678215, 3678250,
    ]);

    ethBlock3678215 = ethBlocks.batchBlocks[0].block;
    ethBlock3678250 = ethBlocks.batchBlocks[1].block;

    expect(ethBlock3678215.number).toBe(3678215);
    expect(ethBlock3678250.number).toBe(3678250);

    // To match with dictionaryQueryEntries[0].func
    expect(ethBlock3678215.transactions[0].input.indexOf('0x60806040')).toBe(0);

    expect(ethBlock3678250.logs.length).toBe(1);
    // This matches with dictionaryQueryEntries[0].topics
    expect(ethBlock3678250.logs[0].topics).toContain(
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    );
  }, 50000);

  it('able to convert raw v2 Blocks into eth blocks when getData', async () => {
    //Polygon
    const ethBlocks = (await ethDictionaryV2.getData(
      3678215,
      (ethDictionaryV2 as any)._metadata.end,
      2,
    )) as DictionaryResponse<IBlock<EthereumBlock>>;

    expect(ethBlocks.batchBlocks[0].block.number).toStrictEqual(3678215);
    expect(ethBlocks.lastBufferedHeight).toStrictEqual(3678250);

    // Can include input and hash
    // https://polygonscan.com/tx/0xb1b5f7882fa8d62d3650948c08066e928b7b5c9d607d2fe8c7e6ce57caf06774
    expect(ethBlocks.batchBlocks[1].block.transactions[1].hash).toBe(
      `0xb1b5f7882fa8d62d3650948c08066e928b7b5c9d607d2fe8c7e6ce57caf06774`,
    );
    expect(ethBlocks.batchBlocks[1].block.transactions[1].input).toBe(
      `0x23b872dd000000000000000000000000244a79a2e79e8d884d9c9cc425d88f9e2ed988ca000000000000000000000000d22c4c383ce5efa0364d5fab5ce1313c24a52bda0000000000000000000000000000000000000000000000000000000000000159`,
    );

    // relate logs
    // https://polygonscan.com/tx/0xb1b5f7882fa8d62d3650948c08066e928b7b5c9d607d2fe8c7e6ce57caf06774#eventlog
    expect(ethBlocks.batchBlocks[1].block.logs[0].data).toBe(`0x`);
  }, 50000);
});

// TODO, check this
it.skip('able to get transaction with field to is null', async () => {
  const dsMap = makeBlockHeightMap(mockDs2);
  const ethDictionaryV2 = await EthDictionaryV2.create(
    DEFAULT_DICTIONARY,
    nodeConfig,
    undefined,
    { network: { chainId: '10' } } as SubqueryProject,
    '10',
  );
  ethDictionaryV2.updateQueriesMap(dsMap);

  const { conditions, queryEndBlock } = (
    ethDictionaryV2 as any
  ).getQueryConditions(3678215, (ethDictionaryV2 as any)._metadata.end);

  expect(conditions).toBe({ transactions: [{ to: null }] });
  const ethBlocks = (await ethDictionaryV2.getData(
    3678215,
    (ethDictionaryV2 as any)._metadata.end,
    2,
  )) as DictionaryResponse<IBlock<EthereumBlock>>;
}, 50000);

describe('buildDictionaryV2QueryEntry', () => {
  it('Build filter for !null', () => {
    const ds: SubqlRuntimeDatasource = {
      kind: EthereumDatasourceKind.Runtime,
      assets: new Map(),
      options: {
        abi: 'erc20',
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      },
      startBlock: 1,
      mapping: {
        file: '',
        handlers: [
          {
            handler: 'handleLog',
            kind: EthereumHandlerKind.Event,
            filter: {
              topics: [
                'Transfer(address, address, uint256)',
                undefined,
                undefined,
                '!null',
              ],
            },
          },
        ],
      },
    };
    const result = buildDictionaryV2QueryEntry([ds]);

    expect(result).toEqual({
      logs: [
        {
          address: ['0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'],
          topics0: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          ],
          topics3: [],
        },
      ],
    });
  });

  it('should unique QueryEntry for duplicate dataSources', () => {
    const ds: SubqlRuntimeDatasource = {
      kind: EthereumDatasourceKind.Runtime,
      assets: new Map(),
      options: {
        abi: 'erc20',
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      },
      startBlock: 1,
      mapping: {
        file: '',
        handlers: [
          {
            handler: 'handleLog',
            kind: EthereumHandlerKind.Event,
            filter: {
              topics: ['Transfer(address, address, uint256)'],
            },
          },
          {
            handler: 'handleLogSame',
            kind: EthereumHandlerKind.Event,
            filter: {
              topics: ['Transfer(address, address, uint256)'],
            },
          },
          {
            handler: 'handleTx',
            kind: EthereumHandlerKind.Call,
            filter: {
              function: 'setminimumStakingAmount(uint256 amount)',
              from: 'mockAddress',
            },
          },
          {
            handler: 'handleTxSame',
            kind: EthereumHandlerKind.Call,
            filter: {
              function: 'setminimumStakingAmount(uint256 amount)',
              from: 'mockAddress',
            },
          },
        ],
      },
    };
    const result = buildDictionaryV2QueryEntry([ds]);

    expect(result).toEqual({
      logs: [
        {
          address: ['0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'],
          topics0: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          ],
        },
      ],
      transactions: [
        {
          from: ['mockaddress'],
          function: ['0x7ef9ea98'],
        },
      ],
    });
  });
});