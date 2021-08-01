/*
 * require-kernel
 *
 * Created by Chad Weider on 01/04/11.
 * Released to the Public Domain on 17/01/12.
 */

const fs = require('fs');
const pathutil = require('path');
const urlutil = require('url');
const events = require('events');

const kernelPath = pathutil.join(__dirname, 'kernel.js');
const kernel = fs.readFileSync(kernelPath, 'utf8');

const buildKernel = require('vm').runInThisContext(
    `(function (XMLHttpRequest) {return ${kernel}})`, kernelPath);

/* Cheap URL request implementation */
const fs_client = (new function () {
  const STATUS_MESSAGES = {
    403: '403: Access denied.',
    404: '404: File not found.',
    405: '405: Only the HEAD or GET methods are allowed.',
    500: '500: Error reading file.',
  };

  function request(options, callback) {
    const path = fsPathForURIPath(options.path);
    const method = options.method;

    const response = new (require('events').EventEmitter)();
    response.setEncoding = function (encoding) { this._encoding = encoding; };
    response.statusCode = 504;
    response.headers = {};

    const request = new (require('events').EventEmitter)();
    request.end = function () {
      if (options.method != 'HEAD' && options.method != 'GET') {
        response.statusCode = 405;
        response.headers.Allow = 'HEAD, GET';

        callback(response);
        response.emit('data', STATUS_MESSAGES[response.statusCode]);
        response.emit('end');
      } else {
        fs.stat(path, (error, stats) => {
          if (error) {
            if (error.code == 'ENOENT') {
              response.StatusCode = 404;
            } else if (error.code == 'EACCESS') {
              response.StatusCode = 403;
            } else {
              response.StatusCode = 502;
            }
          } else if (stats.isFile()) {
            const date = new Date();
            const modifiedLast = new Date(stats.mtime);
            const modifiedSince = (options.headers || {})['if-modified-since'];

            response.headers.Date = date.toUTCString();
            response.headers['Last-Modified'] = modifiedLast.toUTCString();

            if (modifiedSince && modifiedLast &&
                modifiedSince >= modifiedLast) {
              response.StatusCode = 304;
            } else {
              response.statusCode = 200;
            }
          } else {
            response.StatusCode = 404;
          }

          if (method == 'HEAD') {
            callback(response);
            response.emit('end');
          } else if (response.statusCode != 200) {
            response.headers['Content-Type'] = 'text/plain; charset=utf-8';

            callback(response);
            response.emit('data', STATUS_MESSAGES[response.statusCode]);
            response.emit('end');
          } else {
            fs.readFile(path, (error, text) => {
              if (error) {
                if (error.code == 'ENOENT') {
                  response.statusCode = 404;
                } else if (error.code == 'EACCESS') {
                  response.statusCode = 403;
                } else {
                  response.statusCode = 502;
                }
                response.headers['Content-Type'] = 'text/plain; charset=utf-8';

                callback(response);
                response.emit('data', STATUS_MESSAGES[response.statusCode]);
                response.emit('end');
              } else {
                response.statusCode = 200;
                response.headers['Content-Type'] =
                    'application/javascript; charset=utf-8';

                callback(response);
                response.emit('data', text);
                response.emit('end');
              }
            });
          }
        });
      }
    };
    return request;
  }
  this.request = request;
}());

function requestURL(url, method, headers, callback) {
  const parsedURL = urlutil.parse(url);
  let client = undefined;
  if (parsedURL.protocol == 'file:') {
    client = fs_client;
  } else if (parsedURL.protocol == 'http:') {
    client = require('http');
  } else if (parsedURL.protocol == 'https:') {
    client = require('https');
  }
  if (client) {
    const request = client.request({
      host: parsedURL.host,
      port: parsedURL.port,
      path: parsedURL.path,
      method,
      headers,
    }, (response) => {
      let buffer = undefined;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer = buffer || '';
        buffer += chunk;
      });
      response.on('close', () => {
        callback(502, {});
      });
      response.on('end', () => {
        callback(response.statusCode, response.headers, buffer);
      });
    });
    request.on('error', () => {
      callback(502, {});
    });
    request.end();
  }
}

function fsPathForURIPath(path) {
  path = decodeURIComponent(path);
  if (path.charAt(0) == '/') { // Account for '/C:\Windows' type of paths.
    path = pathutil.resolve('/', path.slice(1));
  }
  path = pathutil.normalize(path);
  return path;
}

function normalizePathAsURI(path) {
  const parsedUrl = urlutil.parse(path);
  if (parsedUrl.protocol == null) {
    parsedUrl.protocol = 'file:';
    parsedUrl.path = pathutil.resolve(parsedUrl.path);
  }
  return urlutil.format(parsedUrl);
}

const buildMockXMLHttpRequestClass = function () {
  const emitter = new events.EventEmitter();
  let requestCount = 0;
  let idleTimer = undefined;
  const idleHandler = function () {
    emitter.emit('idle');
  };
  const requested = function (info) {
    clearTimeout(idleTimer);
    requestCount++;
    emitter.emit('requested', info);
  };
  const responded = function (info) {
    emitter.emit('responded', info);
    requestCount--;
    if (requestCount == 0) {
      idleTimer = setTimeout(idleHandler, 0);
    }
  };

  const MockXMLHttpRequest = function () {
  };
  MockXMLHttpRequest.prototype = new function () {
    this.open = function (method, url, async) {
      this.async = async;
      this.url = normalizePathAsURI(url);
    };
    this.withCredentials = false; // Pass CORS capability checks.
    this.send = function () {
      const parsedURL = urlutil.parse(this.url);

      const info = {
        async: !!this.async,
        url: this.url,
      };

      if (!this.async) {
        if (parsedURL.protocol == 'file:') {
          requested(info);
          try {
            this.status = 200;
            const path = fsPathForURIPath(parsedURL.pathname);
            this.responseText = fs.readFileSync(path);
          } catch (e) {
            this.status = 404;
          }
          this.readyState = 4;
          responded(info);
        } else {
          throw `The resource at ${JSON.stringify(this.url)
          } cannot be retrieved synchronously.`;
        }
      } else {
        const self = this;
        requestURL(this.url, 'GET', {},
            (status, headers, content) => {
              self.status = status;
              self.responseText = content;
              self.readyState = 4;
              const handler = self.onreadystatechange;
              handler && handler();
              responded(info);
            }
        );
        requested(info);
      }
    };
  }();
  MockXMLHttpRequest.emitter = emitter;

  return MockXMLHttpRequest;
};

function requireForPaths(rootPath, libraryPath) {
  const MockXMLHttpRequest = buildMockXMLHttpRequestClass();
  const mockRequire = buildKernel(MockXMLHttpRequest);

  if (rootPath !== undefined) {
    mockRequire.setRootURI(normalizePathAsURI(rootPath));
  }
  if (libraryPath != undefined) {
    mockRequire.setLibraryURI(normalizePathAsURI(libraryPath));
  }

  mockRequire.emitter = MockXMLHttpRequest.emitter;

  mockRequire._compileFunction = function (code, filename) {
    return require('vm').runInThisContext(`(function () {${
      code}\n` +
      '})', filename);
  };

  return mockRequire;
}

exports.kernelSource = kernel;
exports.requireForPaths = requireForPaths;
