// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NETWORK_FAMILY } from '@subql/common';
import { NodeConfig } from '@subql/node-core';
import { DictionaryService } from '@subql/node-core/indexer/dictionary/dictionary.service';
import { EthereumBlock, SubqlDatasource } from '@subql/types-ethereum';
import { SubqueryProject } from '../../configure/SubqueryProject';
import { EthDictionaryV1 } from './v1/ethDictionaryV1';
import { EthDictionaryV2, RawEthFatBlock } from './v2';

@Injectable()
export class EthDictionaryService extends DictionaryService<
  RawEthFatBlock,
  EthereumBlock,
  SubqlDatasource,
  EthDictionaryV1
> {
  async initDictionariesV1(): Promise<EthDictionaryV1[]> {
    if (!this.project) {
      throw new Error(`Project in Dictionary service not initialized `);
    }
    let dictionaries: EthDictionaryV1[] = [];
    const registryDictionary = await this.resolveDictionary(
      NETWORK_FAMILY.ethereum,
      this.project.network.chainId,
      this.nodeConfig.dictionaryRegistry,
    );
    if (registryDictionary !== undefined) {
      this._dictionaryV1Endpoints.push(registryDictionary);
    }

    // Current We now only accept either resolver dictionary or multiple dictionaries
    // TODO, this may move to core dictionary service
    if (this.nodeConfig.dictionaryResolver) {
      const resolverDictionary = await EthDictionaryV1.create(
        this.project,
        this.nodeConfig,
        this.eventEmitter,
      );
      dictionaries = [resolverDictionary];
    } else {
      dictionaries = [
        ...(await Promise.all(
          this._dictionaryV1Endpoints.map((endpoint) =>
            EthDictionaryV1.create(
              this.project,
              this.nodeConfig,
              this.eventEmitter,
              endpoint,
            ),
          ),
        )),
      ];
    }
    return dictionaries;
  }

  initDictionariesV2(): EthDictionaryV2[] {
    if (!this.project) {
      throw new Error(`Project in Dictionary service not initialized `);
    }
    const dictionaries = this._dictionaryV2Endpoints.map(
      (endpoint) =>
        new EthDictionaryV2(
          this.project,
          this.nodeConfig,
          this.eventEmitter,
          endpoint,
        ),
    );
    return dictionaries;
  }

  constructor(
    @Inject('ISubqueryProject') protected project: SubqueryProject,
    nodeConfig: NodeConfig,
    eventEmitter: EventEmitter2,
    chainId?: string,
  ) {
    super(chainId ?? project.network.chainId, nodeConfig, eventEmitter);
  }
}
