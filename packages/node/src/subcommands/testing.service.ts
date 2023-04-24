// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import { Inject, Injectable } from '@nestjs/common';
import {
  ApiService,
  NodeConfig,
  StoreService,
  getLogger,
  TestingService as BaseTestingService,
} from '@subql/node-core';
import { EthereumBlockWrapper } from '@subql/types-ethereum';
import { Sequelize } from 'sequelize';
import { SubqlProjectDs, SubqueryProject } from '../configure/SubqueryProject';
import { IndexerManager } from '../indexer/indexer.manager';

const logger = getLogger('subql-testing');

@Injectable()
export class TestingService extends BaseTestingService<
  EthereumBlockWrapper,
  SubqlProjectDs
> {
  constructor(
    sequelize: Sequelize,
    nodeConfig: NodeConfig,
    storeService: StoreService,
    @Inject('ISubqueryProject') project: SubqueryProject,
    apiService: ApiService,
    indexerManager: IndexerManager,
  ) {
    super(
      sequelize,
      nodeConfig,
      storeService,
      project,
      apiService,
      indexerManager,
    );
  }

  async indexBlock(
    block: EthereumBlockWrapper,
    handler: string,
  ): Promise<void> {
    await this.indexerManager.indexBlock(block, this.getDsWithHandler(handler));
  }
}
