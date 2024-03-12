// Copyright 2020-2024 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NETWORK_FAMILY } from '@subql/common';
import { NodeConfig, DictionaryService } from '@subql/node-core';
import { EthereumBlock, SubqlDatasource } from '@subql/types-ethereum';
import { SubqueryProject } from '../../configure/SubqueryProject';
import { EthDictionaryV1 } from './v1';
import { EthDictionaryV2 } from './v2';

@Injectable()
export class EthDictionaryService extends DictionaryService<
  SubqlDatasource,
  EthereumBlock
> {
  async initDictionaries(): Promise<void> {
    let dictionaryV1Endpoints: string[] = [];
    const dictionariesV2: EthDictionaryV2[] = [];

    if (!this.project) {
      throw new Error(`Project in Dictionary service not initialized `);
    }
    const registryDictionaries = await this.resolveDictionary(
      NETWORK_FAMILY.substrate,
      this.project.network.chainId,
      this.nodeConfig.dictionaryRegistry,
    );

    const dictionaryEndpoints: string[] = (
      !Array.isArray(this.project.network.dictionary)
        ? !this.project.network.dictionary
          ? []
          : [this.project.network.dictionary]
        : this.project.network.dictionary
    ).concat(registryDictionaries);

    for (const endpoint of dictionaryEndpoints) {
      try {
        const dictionaryV2 = await EthDictionaryV2.create(
          endpoint,
          this.nodeConfig,
          this.eventEmitter,
          this.project,
          this.project.network.chainId,
        );
        dictionariesV2.push(dictionaryV2);
      } catch (e) {
        dictionaryV1Endpoints.push(endpoint);
      }
    }

    if (this.nodeConfig.dictionaryResolver) {
      // Create a v1 dictionary with dictionary resolver
      // future resolver should a URL, and fetched from registryDictionaries
      dictionaryV1Endpoints = dictionaryV1Endpoints.concat([undefined]);
    }
    // v2 should be prioritised
    this.init([
      ...dictionariesV2,
      ...(await Promise.all(
        dictionaryV1Endpoints.map((endpoint) =>
          EthDictionaryV1.create(
            this.project,
            this.nodeConfig,
            this.eventEmitter,
            endpoint,
          ),
        ),
      )),
    ]);
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
