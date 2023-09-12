/* eslint-disable */
'use strict';

import { base64Decode } from '@subql/utils';
import http from 'http';
import https from 'https';
import {
  assert,
  assertArgument,
  decodeBase64,
  encodeBase64,
  hexlify,
  isBytesLike,
  toUtf8Bytes,
  toUtf8String,
} from 'ethers/lib.commonjs/utils';
// import { shallowCopy } from '@ethersproject/properties';

// import { Logger } from '@ethersproject/logger';
// import { version } from './_version';
// const logger = new Logger(version);

import { getUrl, GetUrlResponse, Options } from './geturl';

function staller(duration: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

function bodyify(value: any, type: string): string {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (isBytesLike(value)) {
    if (
      type &&
      (type.split('/')[0] === 'text' ||
        type.split(';')[0].trim() === 'application/json')
    ) {
      try {
        return toUtf8String(value);
      } catch (error) {}
    }
    return hexlify(value);
  }

  return value;
}

// Exported Types
export type ConnectionInfo = {
  url: string;
  headers?: { [key: string]: string | number };

  user?: string;
  password?: string;

  allowInsecureAuthentication?: boolean;
  allowGzip?: boolean;

  throttleLimit?: number;
  throttleSlotInterval?: number;
  throttleCallback?: (attempt: number, url: string) => Promise<boolean>;

  skipFetchSetup?: boolean;
  fetchOptions?: Record<string, string>;
  errorPassThrough?: boolean;

  timeout?: number;

  agents?: {
    http?: http.Agent;
    https?: https.Agent;
  };
};

export interface OnceBlockable {
  once(eventName: 'block', handler: () => void): void;
}

export interface OncePollable {
  once(eventName: 'poll', handler: () => void): void;
}

export type PollOptions = {
  timeout?: number;
  floor?: number;
  ceiling?: number;
  interval?: number;
  retryLimit?: number;
  onceBlock?: OnceBlockable;
  oncePoll?: OncePollable;
};

export type FetchJsonResponse = {
  statusCode: number;
  headers: { [header: string]: string };
};

type Header = { key: string; value: string };

function unpercent(value: string): Uint8Array {
  return toUtf8Bytes(
    value.replace(/%([0-9a-f][0-9a-f])/gi, (all, code) => {
      return String.fromCharCode(parseInt(code, 16));
    }),
  );
}

// This API is still a work in progress; the future changes will likely be:
// - ConnectionInfo => FetchDataRequest<T = any>
// - FetchDataRequest.body? = string | Uint8Array | { contentType: string, data: string | Uint8Array }
//   - If string => text/plain, Uint8Array => application/octet-stream (if content-type unspecified)
// - FetchDataRequest.processFunc = (body: Uint8Array, response: FetchDataResponse) => T
// For this reason, it should be considered internal until the API is finalized
export function _fetchData<T = Uint8Array>(
  connection: string | ConnectionInfo,
  body?: Uint8Array,
  processFunc?: (value: Uint8Array, response: FetchJsonResponse) => T,
): Promise<void | Awaited<T>> {
  // TODO unsure if this is right for change
  // How many times to retry in the event of a throttle
  const attemptLimit =
    typeof connection === 'object' && connection.throttleLimit != null
      ? connection.throttleLimit
      : 12;
  assertArgument(
    attemptLimit > 0 && attemptLimit % 1 === 0,
    'invalid connection throttle limit',
    'connection.throttleLimit',
    attemptLimit,
  );

  const throttleCallback =
    typeof connection === 'object' ? connection.throttleCallback : null;
  const throttleSlotInterval =
    typeof connection === 'object' &&
    typeof connection.throttleSlotInterval === 'number'
      ? connection.throttleSlotInterval
      : 100;
  assertArgument(
    throttleSlotInterval > 0 && throttleSlotInterval % 1 === 0,
    'invalid connection throttle slot interval',
    'connection.throttleSlotInterval',
    throttleSlotInterval,
  );

  const errorPassThrough =
    typeof connection === 'object' ? !!connection.errorPassThrough : false;

  const headers: { [key: string]: Header } = {};

  let url: string = null;

  // @TODO: Allow ConnectionInfo to override some of these values
  const options: Options = {
    method: 'GET',
  };

  let allow304 = false;

  let timeout = 2 * 60 * 1000;

  if (typeof connection === 'string') {
    url = connection;
  } else if (typeof connection === 'object') {
    if (connection == null || connection.url == null) {
      logger.throwArgumentError('missing URL', 'connection.url', connection);
    }

    url = connection.url;

    if (typeof connection.timeout === 'number' && connection.timeout > 0) {
      timeout = connection.timeout;
    }

    if (connection.headers) {
      for (const key in connection.headers) {
        headers[key.toLowerCase()] = {
          key: key,
          value: String(connection.headers[key]),
        };
        if (
          ['if-none-match', 'if-modified-since'].indexOf(key.toLowerCase()) >= 0
        ) {
          allow304 = true;
        }
      }
    }

    options.allowGzip = !!connection.allowGzip;

    if (connection.user != null && connection.password != null) {
      if (
        url.substring(0, 6) !== 'https:' &&
        connection.allowInsecureAuthentication !== true
      ) {
        assert(
          {
            argument: 'url',
            url: url,
            user: connection.user,
            password: '[REDACTED]',
          },
          'basic authentication requires a secure https url',
          'INVALID_ARGUMENT',
        );
      }
      const authorization = connection.user + ':' + connection.password;
      headers['authorization'] = {
        key: 'Authorization',
        value: 'Basic ' + encodeBase64(toUtf8Bytes(authorization)),
      };
    }

    if (connection.skipFetchSetup != null) {
      options.skipFetchSetup = !!connection.skipFetchSetup;
    }

    if (connection.fetchOptions != null) {
      options.fetchOptions = Object.assign(connection.fetchOptions);
    }

    if (connection.agents != null) {
      options.agents = connection.agents;
    }
  }

  const reData = new RegExp('^data:([^;:]*)?(;base64)?,(.*)$', 'i');
  const dataMatch = url ? url.match(reData) : null;
  if (dataMatch) {
    try {
      const response = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': dataMatch[1] || 'text/plain' },
        body: dataMatch[2]
          ? base64Decode(dataMatch[3])
          : unpercent(dataMatch[3]),
      };

      let result: T = <T>(<unknown>response.body);
      if (processFunc) {
        result = processFunc(response.body, response);
      }
      return Promise.resolve(<T>(<unknown>result));
    } catch (error) {
      assert(
        {
          body: bodyify(dataMatch[1], dataMatch[2]),
          error: error,
          requestBody: null,
          requestMethod: 'GET',
          url: url,
        },
        'processing response error',
        'SERVER_ERROR',
      );
    }
  }

  if (body) {
    options.method = 'POST';
    options.body = body;
    if (headers['content-type'] == null) {
      headers['content-type'] = {
        key: 'Content-Type',
        value: 'application/octet-stream',
      };
    }
    if (headers['content-length'] == null) {
      headers['content-length'] = {
        key: 'Content-Length',
        value: String(body.length),
      };
    }
  }

  const flatHeaders: { [key: string]: string } = {};
  Object.keys(headers).forEach((key) => {
    const header = headers[key];
    flatHeaders[header.key] = header.value;
  });
  options.headers = flatHeaders;

  const runningTimeout = (function () {
    let timer: NodeJS.Timer = null;
    const promise: Promise<never> = new Promise(function (resolve, reject) {
      if (timeout) {
        timer = setTimeout(() => {
          if (timer == null) {
            return;
          }
          timer = null;

          reject(
            assert(
              {
                requestBody: bodyify(options.body, flatHeaders['content-type']),
                requestMethod: options.method,
                timeout: timeout,
                url: url,
              },
              'timeout',
              'TIMEOUT',
            ),
          );
        }, timeout);
      }
    });

    const cancel = function () {
      if (timer == null) {
        return;
      }
      clearTimeout(timer);
      timer = null;
    };

    return { promise, cancel };
  })();

  const runningFetch = (async function () {
    for (let attempt = 0; attempt < attemptLimit; attempt++) {
      let response: GetUrlResponse = null;

      try {
        response = await getUrl(url, options);

        if (response.statusCode === 301 || response.statusCode === 302) {
          // Redirection; for now we only support absolute locataions
          const location = response.headers.location || '';
          if (options.method === 'GET' && location.match(/^https:/)) {
            url = response.headers.location;
            continue;
          }
        } else if (response.statusCode === 429) {
          // If it's the last attempt we throw an error with the response
          if (attempt == attemptLimit - 1) {
            const err = new Error('rate limited');
            (err as any).response = response;
            throw err;
          }

          // Exponential back-off throttling
          let tryAgain = true;
          if (throttleCallback) {
            tryAgain = await throttleCallback(attempt, url);
          }

          if (tryAgain) {
            let stall = 0;

            const retryAfter = response.headers['retry-after'];
            if (
              typeof retryAfter === 'string' &&
              retryAfter.match(/^[1-9][0-9]*$/)
            ) {
              stall = parseInt(retryAfter) * 1000;
            } else {
              stall =
                throttleSlotInterval *
                parseInt(String(Math.random() * Math.pow(2, attempt)));
            }

            //console.log("Stalling 429");
            await staller(stall);
            continue;
          }
        }
      } catch (error) {
        response = (<any>error).response;
        if (response == null) {
          runningTimeout.cancel();
          assert(
            {
              requestBody: bodyify(options.body, flatHeaders['content-type']),
              requestMethod: options.method,
              serverError: error,
              url: url,
            },
            'missing response',
            'SERVER_ERROR',
          );
        }
      }

      let body = response.body;

      if (allow304 && response.statusCode === 304) {
        body = null;
      } else if (
        !errorPassThrough &&
        (response.statusCode < 200 || response.statusCode >= 300)
      ) {
        runningTimeout.cancel();
        assert(
          {
            status: response.statusCode,
            headers: response.headers,
            body: bodyify(
              body,
              response.headers ? response.headers['content-type'] : null,
            ),
            requestBody: bodyify(options.body, flatHeaders['content-type']),
            requestMethod: options.method,
            url: url,
          },
          'bad response',
          'SERVER_ERROR',
        );
      }

      if (processFunc) {
        try {
          const result = await processFunc(body, response);
          runningTimeout.cancel();
          return result;
        } catch (error) {
          // Allow the processFunc to trigger a throttle
          if (error.throttleRetry && attempt < attemptLimit) {
            let tryAgain = true;
            if (throttleCallback) {
              tryAgain = await throttleCallback(attempt, url);
            }

            if (tryAgain) {
              const timeout =
                throttleSlotInterval *
                parseInt(String(Math.random() * Math.pow(2, attempt)));
              //console.log("Stalling callback");
              await staller(timeout);
              continue;
            }
          }

          runningTimeout.cancel();
          assert(
            {
              body: bodyify(
                body,
                response.headers ? response.headers['content-type'] : null,
              ),
              error: error,
              requestBody: bodyify(options.body, flatHeaders['content-type']),
              requestMethod: options.method,
              url: url,
            },
            'processing response error',
            'SERVER_ERROR',
          );
        }
      }

      runningTimeout.cancel();

      // If we had a processFunc, it either returned a T or threw above.
      // The "body" is now a Uint8Array.
      return <T>(<unknown>body);
    }

    return assert(
      {
        requestBody: bodyify(options.body, flatHeaders['content-type']),
        requestMethod: options.method,
        url: url,
      },
      'failed response',
      'SERVER_ERROR',
    );
  })();

  return Promise.race([runningTimeout.promise, runningFetch]);
}

export function fetchJson(
  connection: string | ConnectionInfo,
  json?: string,
  processFunc?: (value: any, response: FetchJsonResponse) => any,
): Promise<any> {
  let processJsonFunc = (value: Uint8Array, response: FetchJsonResponse) => {
    let result: any = null;
    if (value != null) {
      try {
        result = JSON.parse(toUtf8String(value));
      } catch (error) {
        assert(
          {
            body: value,
            error: error,
          },
          'invalid JSON',
          'SERVER_ERROR',
        );
      }
    }

    if (processFunc) {
      result = processFunc(result, response);
    }

    return result;
  };

  // If we have json to send, we must
  // - add content-type of application/json (unless already overridden)
  // - convert the json to bytes
  let body: Uint8Array = null;
  if (json != null) {
    body = toUtf8Bytes(json);

    // Create a connection with the content-type set for JSON
    const updated: ConnectionInfo =
      typeof connection === 'string'
        ? { url: connection }
        : Object.assign(connection);
    if (updated.headers) {
      const hasContentType =
        Object.keys(updated.headers).filter(
          (k) => k.toLowerCase() === 'content-type',
        ).length !== 0;
      if (!hasContentType) {
        updated.headers = Object.assign(updated.headers);
        updated.headers['content-type'] = 'application/json';
      }
    } else {
      updated.headers = { 'content-type': 'application/json' };
    }
    connection = updated;
  }

  return _fetchData<any>(connection, body, processJsonFunc);
}

export function poll<T>(
  func: () => Promise<T>,
  options?: PollOptions,
): Promise<T> {
  if (!options) {
    options = {};
  }
  options = Object.assign(options);
  if (options.floor == null) {
    options.floor = 0;
  }
  if (options.ceiling == null) {
    options.ceiling = 10000;
  }
  if (options.interval == null) {
    options.interval = 250;
  }

  return new Promise(function (resolve, reject) {
    let timer: NodeJS.Timer = null;
    let done: boolean = false;

    // Returns true if cancel was successful. Unsuccessful cancel means we're already done.
    const cancel = (): boolean => {
      if (done) {
        return false;
      }
      done = true;
      if (timer) {
        clearTimeout(timer);
      }
      return true;
    };

    if (options.timeout) {
      timer = setTimeout(() => {
        if (cancel()) {
          reject(new Error('timeout'));
        }
      }, options.timeout);
    }

    const retryLimit = options.retryLimit;

    let attempt = 0;
    function check() {
      return func().then(
        function (result) {
          // If we have a result, or are allowed null then we're done
          if (result !== undefined) {
            if (cancel()) {
              resolve(result);
            }
          } else if (options.oncePoll) {
            options.oncePoll.once('poll', check);
          } else if (options.onceBlock) {
            options.onceBlock.once('block', check);

            // Otherwise, exponential back-off (up to 10s) our next request
          } else if (!done) {
            attempt++;
            if (attempt > retryLimit) {
              if (cancel()) {
                reject(new Error('retry limit reached'));
              }
              return;
            }

            let timeout =
              options.interval *
              parseInt(String(Math.random() * Math.pow(2, attempt)));
            if (timeout < options.floor) {
              timeout = options.floor;
            }
            if (timeout > options.ceiling) {
              timeout = options.ceiling;
            }

            setTimeout(check, timeout);
          }

          return null;
        },
        function (error) {
          if (cancel()) {
            reject(error);
          }
        },
      );
    }
    check();
  });
}
