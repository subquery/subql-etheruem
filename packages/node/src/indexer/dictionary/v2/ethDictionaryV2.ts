// Copyright 2020-2024 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NodeConfig,
  DictionaryV2,
  RawDictionaryResponseData,
  DictionaryResponse,
  getLogger,
  IBlock,
} from '@subql/node-core';
import {
  EthereumBlock,
  EthereumHandlerKind,
  EthereumLogFilter,
  EthereumTransactionFilter,
  SubqlDatasource,
  SubqlEthereumProcessorOptions,
} from '@subql/types-ethereum';
import { utils } from 'ethers';
import { SubqueryProject } from '../../../configure/SubqueryProject';
import { eventToTopic, functionToSighash } from '../../../utils/string';
import { yargsOptions } from '../../../yargs';
import { ethFilterDs } from '../utils';
import { GroupedEthereumProjectDs } from '../v1';
import {
  RawEthBlock,
  EthDictionaryV2QueryEntry,
  EthDictionaryTxConditions,
  EthDictionaryLogConditions,
} from './types';
import { rawBlockToEthBlock } from './utils';

const MIN_FETCH_LIMIT = 200;
const BLOCKS_QUERY_METHOD = `subql_filterBlocks`;

const logger = getLogger('eth-dictionary v2');

function extractOptionAddresses(
  dsOptions: SubqlEthereumProcessorOptions | SubqlEthereumProcessorOptions[],
): string[] {
  const queryAddressLimit = yargsOptions.argv['query-address-limit'];
  const addressArray: string[] = [];
  if (Array.isArray(dsOptions)) {
    const addresses = dsOptions.map((option) => option.address).filter(Boolean);

    if (addresses.length > queryAddressLimit) {
      logger.warn(
        `Addresses length: ${addresses.length} is exceeding limit: ${queryAddressLimit}. Consider increasing this value with the flag --query-address-limit  `,
      );
    }
    if (addresses.length !== 0 && addresses.length <= queryAddressLimit) {
      addressArray.push(...addresses);
    }
  } else {
    if (dsOptions?.address) {
      addressArray.push(dsOptions.address.toLowerCase());
    }
  }
  return addressArray;
}

function callFilterToDictionaryCondition(
  filter: EthereumTransactionFilter,
  dsOptions: SubqlEthereumProcessorOptions,
): EthDictionaryTxConditions {
  const txConditions: EthDictionaryTxConditions = {};
  const toArray = [];
  const fromArray = [];
  const funcArray = [];

  if (filter.from) {
    fromArray.push(filter.from.toLowerCase());
  }
  const optionsAddresses = extractOptionAddresses(dsOptions);
  if (!optionsAddresses) {
    if (filter.to) {
      toArray.push(filter.to.toLowerCase());
    } else if (filter.to === null) {
      toArray.push(null); //TODO, is this correct?
    }
  } else if (optionsAddresses && (filter.to || filter.to === null)) {
    logger.warn(
      `TransactionFilter 'to' conflict with 'address' in data source options`,
    );
  }
  if (filter.function) {
    funcArray.push(functionToSighash(filter.function));
  }

  if (toArray.length !== 0) {
    txConditions.to = toArray;
  }
  if (fromArray.length !== 0) {
    txConditions.from = fromArray;
  }

  if (funcArray.length !== 0) {
    txConditions.function = funcArray;
  }

  return txConditions;
}

function eventFilterToDictionaryCondition(
  filter: EthereumLogFilter,
  dsOptions: SubqlEthereumProcessorOptions | SubqlEthereumProcessorOptions[],
): EthDictionaryLogConditions {
  const logConditions: EthDictionaryLogConditions = {};
  logConditions.address = extractOptionAddresses(dsOptions);
  if (filter.topics) {
    for (let i = 0; i < Math.min(filter.topics.length, 4); i++) {
      const topic = filter.topics[i];
      if (!topic) {
        continue;
      }
      const field = `topics${i}`;
      // Initialized
      if (!logConditions[field]) {
        logConditions[field] = [];
      }
      if (topic === '!null') {
        logConditions[field] = []; // TODO, check if !null
      } else {
        logConditions[field].push(eventToTopic(topic));
      }
    }
  }
  return logConditions;
}

export function buildDictionaryV2QueryEntry(
  dataSources: GroupedEthereumProjectDs[],
): EthDictionaryV2QueryEntry {
  const dictionaryConditions: EthDictionaryV2QueryEntry = {
    logs: [],
    transactions: [],
  };

  for (const ds of dataSources) {
    for (const handler of ds.mapping.handlers) {
      // No filters, cant use dictionary
      if (!handler.filter) return dictionaryConditions;

      switch (handler.kind) {
        case EthereumHandlerKind.Block:
          return dictionaryConditions;
        case EthereumHandlerKind.Call: {
          const filter = handler.filter as EthereumTransactionFilter;
          if (
            filter.from !== undefined ||
            filter.to !== undefined ||
            filter.function
          ) {
            dictionaryConditions.transactions.push(
              callFilterToDictionaryCondition(filter, ds.options),
            );
          } else {
            // do nothing;
          }
          break;
        }
        case EthereumHandlerKind.Event: {
          const filter = handler.filter as EthereumLogFilter;
          if (ds.groupedOptions) {
            dictionaryConditions.logs.push(
              eventFilterToDictionaryCondition(filter, ds.groupedOptions),
            );
          } else if (ds.options?.address || filter.topics) {
            dictionaryConditions.logs.push(
              eventFilterToDictionaryCondition(filter, ds.options),
            );
          } else {
            // do nothing;
          }
          break;
        }
        default:
      }
    }
  }

  if (!dictionaryConditions.logs.length) {
    delete dictionaryConditions.logs;
  }

  if (!dictionaryConditions.transactions.length) {
    delete dictionaryConditions.transactions;
  }

  //TODO, unique
  return dictionaryConditions;
  // return uniqBy(
  //   allDictionaryConditions,
  //   (item) =>
  //     `${item}|${JSON.stringify(
  //       sortBy(item.conditions, (c) => c.field),
  //     )}`,
  // );
}

export class EthDictionaryV2 extends DictionaryV2<
  EthereumBlock,
  SubqlDatasource,
  EthDictionaryV2QueryEntry
> {
  constructor(
    endpoint: string,
    nodeConfig: NodeConfig,
    eventEmitter: EventEmitter2,
    project: SubqueryProject,
    chainId?: string,
  ) {
    super(
      endpoint,
      chainId ?? project.network.chainId,
      nodeConfig,
      eventEmitter,
    );
  }

  static async create(
    endpoint: string,
    nodeConfig: NodeConfig,
    eventEmitter: EventEmitter2,
    project: SubqueryProject,
    chainId?: string,
  ): Promise<EthDictionaryV2> {
    const dictionary = new EthDictionaryV2(
      endpoint,
      nodeConfig,
      eventEmitter,
      project,
      chainId,
    );
    await dictionary.init();
    return dictionary;
  }

  buildDictionaryQueryEntries(
    dataSources: SubqlDatasource[],
  ): EthDictionaryV2QueryEntry {
    const filteredDs = ethFilterDs(dataSources);
    return buildDictionaryV2QueryEntry(filteredDs);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getData(
    startBlock: number,
    endBlock: number,
    limit: number = MIN_FETCH_LIMIT,
  ): Promise<DictionaryResponse<IBlock<EthereumBlock> | number> | undefined> {
    return super.getData(startBlock, endBlock, limit, {
      blockHeader: true,
      logs: { transaction: true },
      transactions: { log: true },
    });
  }

  convertResponseBlocks<RFB = RawEthBlock>(
    data: RawDictionaryResponseData<RFB>,
  ): DictionaryResponse<IBlock<EthereumBlock>> | undefined {
    try {
      const blocks: IBlock<EthereumBlock>[] = (
        (data.blocks as RawEthBlock[]) || []
      ).map(rawBlockToEthBlock);
      return {
        batchBlocks: blocks,
        lastBufferedHeight: blocks.length
          ? blocks[blocks.length - 1].block.number
          : undefined,
      };
    } catch (e) {
      logger.error(
        e,
        `Failed to handle block response ${JSON.stringify(data)}`,
      );
      throw e;
    }
  }
}
