// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { DbModule, ForceCleanService } from '@subql/node-core';
import { ConfigureModule } from '../configure/configure.module';

@Module({
  providers: [ForceCleanService],
  controllers: [],
})
export class ForceCleanFeatureModule {}

@Module({
  imports: [
    DbModule.forRoot(),
    ConfigureModule.register(),
    ForceCleanFeatureModule,
  ],
  controllers: [],
})
export class ForceCleanModule {}
