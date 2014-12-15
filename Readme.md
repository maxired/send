# send-inzi

[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build Status][travis-image]][travis-url]
[![Test Coverage][coveralls-image]][coveralls-url]
[![Gittip][gittip-image]][gittip-url]

  Send-inzip is a fork of connect, allwogin to serve file included inside a '.zip'.
  this has beed developpe to serve resources fraom APK files, but stating from connect, we hope that it could be of a more general use

## Installation

```bash
$ npm install send
```

## API

```js
var sendinzip = require('send-inziê')
```

### sendinzi(req, path, [options])

Create a new `SendStream` for the given path to send to a `res`. The `req` is
the Node.js HTTP request and the `path` is a urlencoded path to send (urlencoded,
not the actual file-system path).

#### Options

##### extensions

  If a given file doesn't exist, try appending one of the given extensions,
  in the given order. By default, this is disabled (set to `false`). An
  example value that will serve extension-less HTML files: `['html', 'htm']`.
  This is skipped if the requested file already has an extension.

##### index

  By default send supports "index.html" files, to disable this
  set `false` or to supply a new index pass a string or an array
  in preferred order.

##### root

  Serve files relative to `path`. This should be a folder, not a zip file.

### Events

The `SendStream` is an event emitter and will emit the following events:

  - `error` an error occurred `(err)`
  - `directory` a directory was requested
  - `file` a file was requested `(path, stat)`
  - `headers` the headers are about to be set on a file `(res, path, stat)`
  - `stream` file streaming has started `(stream)`
  - `end` streaming has completed

### .pipe

The `pipe` method is used to pipe the response into the Node.js HTTP response
object, typically `send(req, path, options).pipe(res)`.

## Error-handling

  By default when no `error` listeners are present an automatic response will be made, otherwise you have full control over the response, aka you may show a 5xx page etc.

## Debugging

 To enable `debug()` instrumentation output export __DEBUG__:

```
$ DEBUG=send node app
```

## Running tests

```
$ npm install
$ npm test
```

## Examples

  Small:

```js
var http = require('http');
var send = require('send');

var app = http.createServer(function(req, res){
  send(req, req.url).pipe(res);
}).listen(3000);
```

  Serving from a root directory with custom error-handling:

```js
var http = require('http');
var send = require('send');
var url = require('url');

var app = http.createServer(function(req, res){
  // your custom error-handling logic:
  function error(err) {
    res.statusCode = err.status || 500;
    res.end(err.message);
  }

  // your custom headers
  function headers(res, path, stat) {
    // serve all files for download
    res.setHeader('Content-Disposition', 'attachment');
  }

  // your custom directory handling logic:
  function redirect() {
    res.statusCode = 301;
    res.setHeader('Location', req.url + '/');
    res.end('Redirecting to ' + req.url + '/');
  }

  // transfer arbitrary files from within
  // /www/example.com/public/*
  send(req, url.parse(req.url).pathname, {root: '/www/example.com/public'})
  .on('error', error)
  .on('directory', redirect)
  .on('headers', headers)
  .pipe(res);
}).listen(3000);
```

## License 

[MIT](LICENSE)

[npm-image]: https://img.shields.io/npm/v/send.svg?style=flat
[npm-url]: https://npmjs.org/package/send
[travis-image]: https://img.shields.io/travis/tj/send.svg?style=flat
[travis-url]: https://travis-ci.org/tj/send
[coveralls-image]: https://img.shields.io/coveralls/tj/send.svg?style=flat
[coveralls-url]: https://coveralls.io/r/tj/send?branch=master
[downloads-image]: https://img.shields.io/npm/dm/send.svg?style=flat
[downloads-url]: https://npmjs.org/package/send
[gittip-image]: https://img.shields.io/gittip/dougwilson.svg?style=flat
[gittip-url]: https://www.gittip.com/dougwilson/
