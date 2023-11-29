// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import assert from 'assert';
import { Injectable } from '@nestjs/common';
import {
  NodeConfig,
  FatDictionaryResponse,
  FatDictionaryService,
  RawFatDictionaryResponseData,
} from '@subql/node-core';
import { EthereumBlock } from '@subql/types-ethereum';
import { RawEthFatBlock, EthFatDictionaryQueryEntry } from './types';
import { rawFatBlockToEthBlock } from './utils';

const MIN_FAT_FETCH_LIMIT = 200;
const FAT_BLOCKS_QUERY_METHOD = `subql_filterBlocks`;

@Injectable()
export class EthFatDictionaryService extends FatDictionaryService<
  RawEthFatBlock,
  EthereumBlock
> {
  constructor(nodeConfig: NodeConfig) {
    super(nodeConfig);
  }

  get dictionaryEndpoint(): string {
    assert(this.nodeConfig.fatDictionary, 'fat dictionary not in node config');
    return this.nodeConfig.fatDictionary;
  }

  /**
   *
   * @param startBlock
   * @param queryEndBlock this block number will limit the max query range, increase dictionary query speed
   * @param batchSize
   * @param conditions
   */
  async queryFatDictionary(
    startBlock: number,
    queryEndBlock: number,
    limit = MIN_FAT_FETCH_LIMIT,
    conditions?: EthFatDictionaryQueryEntry,
  ): Promise<RawFatDictionaryResponseData<RawEthFatBlock> | undefined> {
    if (!conditions) {
      return undefined;
    }
    const requestData = {
      jsonrpc: '2.0',
      method: FAT_BLOCKS_QUERY_METHOD,
      id: 1,
      params: [
        startBlock,
        queryEndBlock,
        limit,
        conditions,
        { blockHeader: true, logs: true, transactions: { data: true } },
      ],
    };

    try {
      const response = await this.dictionaryApi.post(
        this.dictionaryEndpoint,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data
        .result as RawFatDictionaryResponseData<RawEthFatBlock>;
    } catch (error) {
      // Handle the error as needed
      throw new Error(`Fat dictionary get capacity failed ${error}`);
    }
  }

  convertResponseBlocks(
    data: RawFatDictionaryResponseData<RawEthFatBlock>,
  ): FatDictionaryResponse<EthereumBlock> | undefined {
    const blocks: EthereumBlock[] = [];
    for (const block of data.Blocks) {
      blocks.push(rawFatBlockToEthBlock(block));
    }
    if (blocks.length !== 0) {
      return {
        blocks: blocks,
        start: blocks[0].number,
        end: blocks[blocks.length - 1].number,
      };
    } else {
      return undefined;
    }
  }
}
