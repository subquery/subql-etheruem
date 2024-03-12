// Copyright 2020-2024 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable } from '@nestjs/common';
import { SubqlEthereumDataSource } from '@subql/common-ethereum';
import {
  NodeConfig,
  IProjectService,
  ProcessBlockResponse,
  ApiService,
  BaseWorkerService,
  IProjectUpgradeService,
  IBlock,
} from '@subql/node-core';
import { EthereumProjectDs } from '../../configure/SubqueryProject';
import { IndexerManager } from '../indexer.manager';
import { BlockContent } from '../types';

export type FetchBlockResponse = { parentHash: string } | undefined;

export type WorkerStatusResponse = {
  threadId: number;
  isIndexing: boolean;
  fetchedBlocks: number;
  toFetchBlocks: number;
};

@Injectable()
export class WorkerService extends BaseWorkerService<
  BlockContent,
  FetchBlockResponse,
  SubqlEthereumDataSource,
  {}
> {
  constructor(
    private apiService: ApiService<any, any, IBlock<any>[]>,
    private indexerManager: IndexerManager,
    @Inject('IProjectService')
    projectService: IProjectService<EthereumProjectDs>,
    @Inject('IProjectUpgradeService')
    projectUpgradeService: IProjectUpgradeService,
    nodeConfig: NodeConfig,
  ) {
    super(projectService, projectUpgradeService, nodeConfig);
  }

  protected async fetchChainBlock(
    heights: number,
    extra: {},
  ): Promise<BlockContent> {
    const [block] = await this.apiService.fetchBlocks([heights]);
    return block.block;
  }

  protected toBlockResponse(block: BlockContent): { parentHash: string } {
    return {
      parentHash: block.parentHash,
    };
  }

  protected async processFetchedBlock(
    block: BlockContent,
    dataSources: SubqlEthereumDataSource[],
  ): Promise<ProcessBlockResponse> {
    return this.indexerManager.indexBlock(block, dataSources);
  }
}
