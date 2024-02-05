// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {ApolloClient, ApolloLink, gql, HttpLink, InMemoryCache, NormalizedCacheObject} from '@apollo/client/core';
import {EventEmitter2} from '@nestjs/event-emitter';
import {dictHttpLink} from '@subql/apollo-links';
import {DictionaryQueryCondition, DictionaryQueryEntry as DictionaryV1QueryEntry} from '@subql/types-core';
import {buildQuery, GqlNode, GqlQuery, GqlVar, MetaData as DictionaryV1Metadata} from '@subql/utils';
import fetch from 'cross-fetch';
import {buildDictQueryFragment, DictionaryVersion, distinctErrorEscaped, startHeightEscaped} from '..';
import {NodeConfig} from '../../../configure';
import {IndexerEvent} from '../../../events';
import {getLogger} from '../../../logger';
import {profiler} from '../../../profiler';
import {timeout} from '../../../utils';
import {BlockHeightMap} from '../../../utils/blockHeightMap';
import {CoreDictionary} from '../coreDictionary';

import {DictionaryResponse} from '../types';

const logger = getLogger('dictionary v1');

export abstract class DictionaryV1<DS> extends CoreDictionary<DS, number> {
  queriesMap?: BlockHeightMap<DictionaryV1QueryEntry[]>;
  protected _metadata: DictionaryV1Metadata | undefined;
  private _client: ApolloClient<NormalizedCacheObject>;
  private useDistinct = true;
  private useStartHeight = true;

  constructor(
    readonly dictionaryEndpoint: string | undefined,
    protected chainId: string,
    protected readonly nodeConfig: NodeConfig,
    protected readonly eventEmitter: EventEmitter2,
    protected readonly metadataKeys = ['lastProcessedHeight', 'genesisHash'], // Cosmos uses chain instead of genesisHash
    protected buildQueryFragment: typeof buildDictQueryFragment = buildDictQueryFragment
  ) {
    super(dictionaryEndpoint, chainId, nodeConfig, eventEmitter);
    let link: ApolloLink;

    if (this.nodeConfig.dictionaryResolver) {
      const authHttpLink = dictHttpLink({
        authUrl: this.nodeConfig.dictionaryResolver,
        chainId,
        logger,
        httpOptions: {fetch},
        fallbackServiceUrl: dictionaryEndpoint,
      });
      link = authHttpLink.link;
    } else {
      link = new HttpLink({uri: dictionaryEndpoint, fetch});
    }

    this._client = new ApolloClient({
      cache: new InMemoryCache({resultCaching: true}),
      link,
      defaultOptions: {
        watchQuery: {
          fetchPolicy: 'no-cache',
        },
        query: {
          fetchPolicy: 'no-cache',
        },
      },
    });
    this._dictionaryVersion = DictionaryVersion.v1;
  }

  abstract buildDictionaryQueryEntries(dataSources: DS[]): DictionaryV1QueryEntry[];

  async initMetadata(): Promise<void> {
    const {query} = this.metadataQuery();
    try {
      const resp = await timeout(
        this.client.query({
          query: gql(query),
        }),
        this.nodeConfig.dictionaryTimeout,
        `Dictionary metadata query timeout in ${
          this.nodeConfig.dictionaryTimeout
        } seconds. Please increase --dictionary-timeout. ${this.nodeConfig.debug ? `\n GraphQL: ${query}` : ''}`
      );
      this._metadata = resp.data._metadata;
      this.setDictionaryStartHeight(this.metadata.startHeight);
    } catch (err: any) {
      if (JSON.stringify(err).includes(startHeightEscaped)) {
        this.useStartHeight = false;
        logger.warn(`Dictionary doesn't support validate start height.`);
        // Rerun the query now with distinct disabled
        await this.initMetadata();
      }
      logger.error(err, `Failed to get dictionary metadata`);
      return;
    }
  }

  private get metadata(): DictionaryV1Metadata {
    if (!this._metadata) {
      throw new Error(`dictionary _metadata haven't init yet`);
    }
    return this._metadata;
  }

  getQueryEndBlock(startBlockHeight: number, apiFinalizedHeight: number): number {
    return Math.min(
      startBlockHeight + this.nodeConfig.dictionaryQuerySize,
      apiFinalizedHeight,
      this.metadata.lastProcessedHeight
    );
  }

  protected get client(): ApolloClient<NormalizedCacheObject> {
    if (!this._client) {
      throw new Error('Dictionary service has not been initialized');
    }
    return this._client;
  }

  /**
   *
   * @param startBlock
   * @param queryEndBlock this block number will limit the max query range, increase dictionary query speed
   * @param batchSize
   * @param conditions
   */

  @profiler()
  async getData(
    startBlock: number,
    queryEndBlock: number,
    batchSize: number
  ): Promise<DictionaryResponse<number> | undefined> {
    const queryDetails = this.queriesMap?.getDetails(startBlock);
    const conditions = queryDetails?.value ?? [];
    queryEndBlock =
      queryDetails?.endHeight && queryDetails?.endHeight < queryEndBlock ? queryDetails.endHeight : queryEndBlock;

    if (!conditions) {
      return undefined;
    }

    const {query, variables} = this.dictionaryQuery(startBlock, queryEndBlock, batchSize, conditions);

    logger.debug(`query: ${query}`);
    logger.debug(`variables: ${JSON.stringify(variables, null, 2)}`);
    try {
      const resp = await timeout(
        this.client.query({
          query: gql(query),
          variables,
        }),
        this.nodeConfig.dictionaryTimeout,
        `Dictionary query timeout in ${
          this.nodeConfig.dictionaryTimeout
        } seconds. Please increase --dictionary-timeout. ${
          this.nodeConfig.debug ? `\n GraphQL: ${query}, \n Variables: ${variables}` : ''
        }`
      );
      const blockHeightSet = new Set<number>();
      const entityEndBlock: {[entity: string]: number} = {};
      for (const entity of Object.keys(resp.data)) {
        if (entity !== '_metadata' && resp.data[entity].nodes.length >= 0) {
          for (const node of resp.data[entity].nodes) {
            blockHeightSet.add(Number(node.blockHeight));
            entityEndBlock[entity] = Number(node.blockHeight); //last added event blockHeight
          }
        }
      }
      const _metadata = resp.data._metadata;
      const endBlock = Math.min(...Object.values(entityEndBlock).map((height) => (isNaN(height) ? Infinity : height)));
      const batchBlocks = Array.from(blockHeightSet)
        .filter((block) => block <= endBlock)
        .sort((n1, n2) => n1 - n2);

      if (!this.dictionaryValidation(_metadata, startBlock)) {
        return undefined;
      }

      return {
        lastBufferedHeight: endBlock,
        batchBlocks,
      };
    } catch (err: any) {
      // Check if the error is about distinct argument and disable distinct if so
      if (JSON.stringify(err).includes(distinctErrorEscaped)) {
        this.useDistinct = false;
        logger.warn(`Dictionary doesn't support distinct query.`);
        // Rerun the qeury now with distinct disabled
        return this.getData(startBlock, queryEndBlock, batchSize);
      }
      logger.warn(err, `failed to fetch dictionary result`);
      return undefined;
    }
  }

  queryMapValidByHeight(height: number): boolean {
    return !!this.queriesMap?.get(height)?.length;
  }

  protected dictionaryValidation(metaData?: DictionaryV1Metadata, startBlockHeight?: number): boolean {
    const validate = (): boolean => {
      try {
        if (!metaData) {
          return false;
        }

        if (startBlockHeight !== undefined && metaData.lastProcessedHeight < startBlockHeight) {
          logger.warn(`Dictionary indexed block is behind current indexing block height`);
          return false;
        }
        return true;
      } catch (e: any) {
        logger.error(e, 'Unable to validate dictionary metadata');
        return false;
      }
    };

    const valid = validate();

    this.metadataValid = valid;
    this.eventEmitter.emit(IndexerEvent.UsingDictionary, {
      value: Number(this.useDictionary),
    });
    this.eventEmitter.emit(IndexerEvent.SkipDictionary);

    return valid;
  }

  private dictionaryQuery(
    startBlock: number,
    queryEndBlock: number,
    batchSize: number,
    conditions: DictionaryV1QueryEntry[]
  ): GqlQuery {
    const mapped = conditions.reduce<Record<string, DictionaryQueryCondition[][]>>((acc, c) => {
      acc[c.entity] = acc[c.entity] || [];
      acc[c.entity].push(c.conditions);
      return acc;
    }, {});

    // assemble
    const vars: GqlVar[] = [];
    const nodes: GqlNode[] = [
      {
        entity: '_metadata',
        project: this.useStartHeight ? this.metadataKeys : this.metadataKeys.filter((obj) => obj !== 'startHeight'),
      },
    ];
    for (const entity of Object.keys(mapped)) {
      const [pVars, node] = this.buildQueryFragment(
        entity,
        startBlock,
        queryEndBlock,
        mapped[entity],
        batchSize,
        this.useDistinct
      );
      nodes.push(node);
      vars.push(...pVars);
    }
    return buildQuery(vars, nodes);
  }

  private metadataQuery(): GqlQuery {
    const nodes: GqlNode[] = [
      {
        entity: '_metadata',
        project: this.useStartHeight ? [...this.metadataKeys, 'startHeight'] : this.metadataKeys,
      },
    ];
    return buildQuery([], nodes);
  }
}
