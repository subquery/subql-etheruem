// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import path from 'path';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  getLogger,
  NodeConfig,
  Worker,
  SmartBatchService,
  StoreService,
  PoiService,
  StoreCacheService,
  IProjectService,
  IDynamicDsService,
  HostStore,
  HostDynamicDS,
  WorkerBlockDispatcher,
  IUnfinalizedBlocksService,
  ConnectionPoolStateManager,
  connectionPoolStateHostFunctions,
  baseWorkerFunctions,
  storeHostFunctions,
  dynamicDsHostFunctions,
  IProjectUpgradeService,
  HostUnfinalizedBlocks,
} from '@subql/node-core';
import { Store } from '@subql/types-ethereum';
import {
  EthereumProjectDs,
  SubqueryProject,
} from '../../configure/SubqueryProject';
import { EthereumApiConnection } from '../../ethereum/api.connection';

import { EthereumBlockWrapped } from '../../ethereum/block.ethereum';
import { DynamicDsService } from '../dynamic-ds.service';
import { UnfinalizedBlocksService } from '../unfinalizedBlocks.service';
import { IIndexerWorker, IInitIndexerWorker } from '../worker/worker';
// import { HostUnfinalizedBlocks } from '../worker/worker.unfinalizedBlocks.service';

const logger = getLogger('WorkerBlockDispatcherService');

type IndexerWorker = IIndexerWorker & {
  terminate: () => Promise<number>;
};

async function createIndexerWorker(
  store: Store,
  dynamicDsService: IDynamicDsService<EthereumProjectDs>,
  unfinalizedBlocksService: IUnfinalizedBlocksService<EthereumBlockWrapped>,
  connectionPoolState: ConnectionPoolStateManager<EthereumApiConnection>,

  root: string,
): Promise<IndexerWorker> {
  const indexerWorker = Worker.create<
    IInitIndexerWorker,
    HostDynamicDS<EthereumProjectDs> & HostStore & HostUnfinalizedBlocks
  >(
    path.resolve(__dirname, '../../../dist/indexer/worker/worker.js'),
    [...baseWorkerFunctions, 'initWorker'],
    {
      ...storeHostFunctions(store),
      ...dynamicDsHostFunctions(dynamicDsService),
      unfinalizedBlocksProcess:
        unfinalizedBlocksService.processUnfinalizedBlockHeader.bind(
          unfinalizedBlocksService,
        ),
      ...connectionPoolStateHostFunctions(connectionPoolState),
    },
    root,
  );

  await indexerWorker.initWorker();

  return indexerWorker;
}

@Injectable()
export class WorkerBlockDispatcherService
  extends WorkerBlockDispatcher<EthereumProjectDs, IndexerWorker>
  implements OnApplicationShutdown
{
  constructor(
    nodeConfig: NodeConfig,
    eventEmitter: EventEmitter2,
    @Inject('IProjectService')
    projectService: IProjectService<EthereumProjectDs>,
    @Inject('IProjectUpgradeService')
    projectUpgadeService: IProjectUpgradeService,
    smartBatchService: SmartBatchService,
    storeService: StoreService,
    storeCacheService: StoreCacheService,
    poiService: PoiService,
    @Inject('ISubqueryProject') project: SubqueryProject,
    dynamicDsService: DynamicDsService,
    unfinalizedBlocksSevice: UnfinalizedBlocksService,
    connectionPoolState: ConnectionPoolStateManager<EthereumApiConnection>,
  ) {
    super(
      nodeConfig,
      eventEmitter,
      projectService,
      projectUpgadeService,
      smartBatchService,
      storeService,
      storeCacheService,
      poiService,
      project,
      dynamicDsService,
      () =>
        createIndexerWorker(
          storeService.getStore(),
          dynamicDsService,
          unfinalizedBlocksSevice,
          connectionPoolState,
          project.root,
        ),
    );
  }

  protected async fetchBlock(
    worker: IndexerWorker,
    height: number,
  ): Promise<void> {
    const start = new Date();
    await worker.fetchBlock(height, null);
    const end = new Date();

    // const waitTime = end.getTime() - start.getTime();
    // if (waitTime > 1000) {
    //   logger.info(
    //     `Waiting to fetch block ${height}: ${chalk.red(`${waitTime}ms`)}`,
    //   );
    // } else if (waitTime > 200) {
    //   logger.info(
    //     `Waiting to fetch block ${height}: ${chalk.yellow(`${waitTime}ms`)}`,
    //   );
    // }
  }
}
