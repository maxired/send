7
/**
 * Module dependencies.
 */

var debug = require('debug')('send')
var deprecate = require('depd')('send')
var destroy = require('destroy')
var escapeHtml = require('escape-html'),
  Stream = require('stream'),
  mime = require('mime'),
  fresh = require('fresh'),
  path = require('path'),
  http = require('http'),
  fs = require('fs'),
  normalize = path.normalize,
  basename = path.basename,
  dirname = path.dirname,
  join = path.join
var etag = require('etag')
var EventEmitter = require('events').EventEmitter;
var ms = require('ms');
var onFinished = require('on-finished')

/**
 * Variables.
 */
var extname = path.extname
var maxMaxAge = 60 * 60 * 24 * 365 * 1000; // 1 year
var resolve = path.resolve
var sep = path.sep
var toString = Object.prototype.toString
var upPathRegexp = /(?:^|[\\\/])\.\.(?:[\\\/]|$)/

/**
 * Expose `send`.
 */

exports = module.exports = send;

/**
 * Expose mime module.
 */

exports.mime = mime;

/**
 * Shim EventEmitter.listenerCount for node.js < 0.10
 */

/* istanbul ignore next */
var listenerCount = EventEmitter.listenerCount || function(emitter, type) {
  return emitter.listeners(type).length;
};

/**
 * Return a `SendStream` for `req` and `path`.
 *
 * @param {Request} req
 * @param {String} path
 * @param {Object} options
 * @return {SendStream}
 * @api public
 */

function send(req, path, options) {
  return new SendStream(req, path, options);
}

/**
 * Initialize a `SendStream` with the given `path`.
 *
 * @param {Request} req
 * @param {String} path
 * @param {Object} options
 * @api private
 */

function SendStream(req, path, options) {

  var self = this;
  options = options || {};
  this.req = req;
  this.path = path;
  this.options = options;

  this._etag = options.etag !== undefined ? Boolean(options.etag) : true

  this._dotfiles = options.dotfiles !== undefined ? options.dotfiles : 'ignore'

  if (['allow', 'deny', 'ignore'].indexOf(this._dotfiles) === -1) {
    throw new TypeError('dotfiles option must be "allow", "deny", or "ignore"')
  }

  this._hidden = Boolean(options.hidden)

  if ('hidden' in options) {
    deprecate('hidden: use dotfiles: \'' + (this._hidden ? 'allow' : 'ignore') + '\' instead')
  }

  // legacy support
  if (!('dotfiles' in options)) {
    this._dotfiles = undefined
  }

  this._extensions = options.extensions !== undefined ? normalizeList(options.extensions) : []

  this._index = options.index !== undefined ? normalizeList(options.index) : ['index.html']

  this._lastModified = options.lastModified !== undefined ? Boolean(options.lastModified) : true

  this._maxage = options.maxAge || options.maxage
  this._maxage = typeof this._maxage === 'string' ? ms(this._maxage) : Number(this._maxage)
  this._maxage = !isNaN(this._maxage) ? Math.min(Math.max(0, this._maxage), maxMaxAge) : 0

  this._root = options.root ? resolve(options.root) : null

  if (!this._root && options.from) {
    this.from(options.from);
  }
}

/**
 * Inherits from `Stream.prototype`.
 */

SendStream.prototype.__proto__ = Stream.prototype;

/**
 * Enable or disable etag generation.
 *
 * @param {Boolean} val
 * @return {SendStream}
 * @api public
 */

SendStream.prototype.etag = deprecate.function(function etag(val) {
  val = Boolean(val);
  debug('etag %s', val);
  this._etag = val;
  return this;
}, 'send.etag: pass etag as option');

/**
 * Enable or disable "hidden" (dot) files.
 *
 * @param {Boolean} path
 * @return {SendStream}
 * @api public
 */

SendStream.prototype.hidden = deprecate.function(function hidden(val) {
  val = Boolean(val);
  debug('hidden %s', val);
  this._hidden = val;
  this._dotfiles = undefined
  return this;
}, 'send.hidden: use dotfiles option');

/**
 * Set index `paths`, set to a falsy
 * value to disable index support.
 *
 * @param {String|Boolean|Array} paths
 * @return {SendStream}
 * @api public
 */

SendStream.prototype.index = deprecate.function(function index(paths) {
  var index = !paths ? [] : normalizeList(paths);
  debug('index %o', paths);
  this._index = index;
  return this;
}, 'send.index: pass index as option');

/**
 * Set root `path`.
 *
 * @param {String} path
 * @return {SendStream}
 * @api public
 */

SendStream.prototype.root = function(path) {
  path = String(path);
  this._root = resolve(path)
  return this;
};

SendStream.prototype.from = deprecate.function(SendStream.prototype.root,
  'send.from: pass root as option');

SendStream.prototype.root = deprecate.function(SendStream.prototype.root,
  'send.root: pass root as option');

/**
 * Set max-age to `maxAge`.
 *
 * @param {Number} maxAge
 * @return {SendStream}
 * @api public
 */

SendStream.prototype.maxage = deprecate.function(function maxage(maxAge) {
  maxAge = typeof maxAge === 'string' ? ms(maxAge) : Number(maxAge);
  if (isNaN(maxAge)) maxAge = 0;
  if (Infinity == maxAge) maxAge = 60 * 60 * 24 * 365 * 1000;
  debug('max-age %d', maxAge);
  this._maxage = maxAge;
  return this;
}, 'send.maxage: pass maxAge as option');

/**
 * Emit error with `status`.
 *
 * @param {Number} status
 * @api private
 */

SendStream.prototype.error = function(status, err) {
  var res = this.res;
  var msg = http.STATUS_CODES[status];

  err = err || new Error(msg);
  err.status = status;

  // emit if listeners instead of responding
  if (listenerCount(this, 'error') !== 0) {
    return this.emit('error', err);
  }

  // wipe all existing headers
  res._headers = undefined;

  res.statusCode = err.status;
  res.end(msg);
};

/**
 * Check if the pathname ends with "/".
 *
 * @return {Boolean}
 * @api private
 */

SendStream.prototype.hasTrailingSlash = function() {
  return '/' == this.path[this.path.length - 1];
};

/**
 * Check if this is a conditional GET request.
 *
 * @return {Boolean}
 * @api private
 */

SendStream.prototype.isConditionalGET = function() {
  return this.req.headers['if-none-match'] || this.req.headers['if-modified-since'];
};

/**
 * Strip content-* header fields.
 *
 * @api private
 */

SendStream.prototype.removeContentHeaderFields = function() {
  var res = this.res;
  Object.keys(res._headers).forEach(function(field) {
    if (0 == field.indexOf('content')) {
      res.removeHeader(field);
    }
  });
};

/**
 * Respond with 304 not modified.
 *
 * @api private
 */

SendStream.prototype.notModified = function() {
  var res = this.res;
  debug('not modified');
  this.removeContentHeaderFields();
  res.statusCode = 304;
  res.end();
};

/**
 * Raise error that headers already sent.
 *
 * @api private
 */

SendStream.prototype.headersAlreadySent = function headersAlreadySent() {
  var err = new Error('Can\'t set headers after they are sent.');
  debug('headers already sent');
  this.error(500, err);
};

/**
 * Check if the request is cacheable, aka
 * responded with 2xx or 304 (see RFC 2616 section 14.2{5,6}).
 *
 * @return {Boolean}
 * @api private
 */

SendStream.prototype.isCachable = function() {
  var res = this.res;
  return (res.statusCode >= 200 && res.statusCode < 300) || 304 == res.statusCode;
};

/**
 * Handle stat() error.
 *
 * @param {Error} err
 * @api private
 */

SendStream.prototype.onStatError = function(err) {
  var notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR'];
  if (~notfound.indexOf(err.code)) return this.error(404, err);
  this.error(500, err);
};

/**
 * Check if the cache is fresh.
 *
 * @return {Boolean}
 * @api private
 */

SendStream.prototype.isFresh = function() {
  return fresh(this.req.headers, this.res._headers);
};



/**
 * Redirect to `path`.
 *
 * @param {String} path
 * @api private
 */

SendStream.prototype.redirect = function(path) {

  if (listenerCount(this, 'directory') !== 0) {
    return this.emit('directory');
  }

  if (this.hasTrailingSlash()) {
    return this.error(403);
  }
  var res = this.res;
  path += '/';
  res.statusCode = 301;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Location', path);
  res.end('Redirecting to <a href="' + escapeHtml(path) + '">' + escapeHtml(path) + '</a>\n');
};

/**
 * Pipe to `res.
 *
 * @param {Stream} res
 * @return {Stream} res
 * @api public
 */

SendStream.prototype.pipe = function(res) {
  var self = this,
    args = arguments,
    root = this._root;

  // references
  this.res = res;

  // decode the path
  var path = decode(this.path)
  if (path === -1) return this.error(400)

  // null byte(s)
  if (~path.indexOf('\0')) return this.error(400);

  var parts
  if (root !== null) {
    // join / normalize from optional root dir
    path = normalize(join(root, path))
    root = normalize(root + sep)

    // malicious path
    if ((path + sep).substr(0, root.length) !== root) {
      debug('malicious path "%s"', path)
      return this.error(403)
    }

    // explode path parts
    parts = path.substr(root.length).split(sep)
  } else {
    // ".." is malicious without "root"
    if (upPathRegexp.test(path)) {
      debug('malicious path "%s"', path)
      return this.error(403)
    }

    // explode path parts
    parts = normalize(path).split(sep)

    // resolve the path
    path = resolve(path)
  }

  // dotfile handling
  if (containsDotFile(parts)) {
    var access = this._dotfiles

    // legacy support
    if (access === undefined) {
      access = parts[parts.length - 1][0] === '.' ? (this._hidden ? 'allow' : 'ignore') : 'allow'
    }

    debug('%s dotfile "%s"', access, path)
    switch (access) {
      case 'allow':
        break
      case 'deny':
        return this.error(403)
      case 'ignore':
      default:
        return this.error(404)
    }
  }
  /*
    // index file support
    if (this._index.length && this.path[this.path.length - 1] === '/') {
      console.log("send index");
      this.sendIndex(path);
      return res;
    }
  */
  this.sendFile(path);
  return res;
};

/**
 * Transfer `path`.
 *
 * @param {String} path
 * @api public
 */

SendStream.prototype.send = function(path, inzip, stat) {
  // console.trace();
  var options = this.options;
  var len = stat.size;
  var res = this.res;
  var req = this.req;
  var ranges = req.headers.range;
  var offset = options.start || 0;

  if (res._header) {
    // impossible to send now
    return this.headersAlreadySent();
  }

  debug('pipe "%s"', path)

  this.stream(req, res, path, inzip, options, stat);
};



/**
 * Transfer file for `path`.
 *
 * @param {String} path
 * @api private
 */
SendStream.prototype.sendFile = function sendFile(path) {
  var i = 0
  var self = this

  //console.log("send file", path);
  debug('stat "%s"', path);
  findFile(path, function(err, path, inzip) {
    fs.stat(path, function onstat(err, stat) {
      if (err && err.code === 'ENOENT' && !extname(path) && path[path.length - 1] !== sep) {
        // not found, check extensions
        return next(err)
      }
      if (err) return self.onStatError(err)
      if (stat.isDirectory()) {
        return self.redirect(self.path)
      }
      self.emit('file', path, inzip, stat)
      self.send(path, inzip, stat)
    })
  })

  function next(err) {
    if (self._extensions.length <= i) {
      return err ? self.onStatError(err) : self.error(404)
    }

    var p = path + '.' + self._extensions[i++]

    debug('stat "%s"', p)
    fs.stat(p, function(err, stat) {
      if (err) return next(err)
      if (stat.isDirectory()) return next()
      self.emit('file', p, stat)
      self.send(p, '', stat)
    })
  }
}

/**
 * Transfer index for `path`.
 *
 * @param {String} path
 * @api private
 */
SendStream.prototype.sendIndex = function sendIndex(path) {
  var i = -1;
  var self = this;

  function next(err) {
    if (++i >= self._index.length) {
      if (err) return self.onStatError(err);
      return self.error(404);
    }

    var p = join(path, self._index[i]);

    debug('stat "%s"', p);
    fs.stat(p, function(err, stat) {
      if (err) return next(err);
      if (stat.isDirectory()) return next();
      self.emit('file', p, stat);
      self.send(p, stat);
    });
  }

  next();
};

/**
 * Stream `path` to the response.
 *
 * @param {String} path
 * @param {Object} options
 * @api private
 */
var unzip = require('unzip');

SendStream.prototype.stream = function(req, res, path, inzip, options, stat) {
  // TODO: this is all lame, refactor meeee
  var finished = false;
  var self = this;
  var res = this.res;
  var req = this.req;

  // pipe
  var zipstream = fs.createReadStream(path, options);
  var found = false;

  var indexMatch = {};
  var extensionMatch = {};
  zipstream.pipe(unzip.Parse())
    .on('entry', function(entry) {
      if (found) {
        entry.autodrain();
        return;
      }
      //  console.log("etrye is" , entry);
      var fileName = entry.path;
      var type = entry.type; // 'Directory' or 'File'
      var size = entry.size;

      if (fileName === inzip && type != 'Directory') {
        found = true;

        entry.on('end', function onend() {
          self.emit('end');
        });

        entry.on('error', function onerror(err) {
          self.onStatError(err);
        })

        self.setHeader(path, inzip, stat);

        // conditional GET support
        if (self.isConditionalGET() && self.isCachable()) {
          return self.notModified();
        }

        this.emit('stream', entry);

        // set content-type
        self.type(inzip);

        // content-length
        res.setHeader('Content-Length', entry.size);
        // set header fields
        //stat are form the zip file


        // HEAD support
        if ('HEAD' == req.method) return res.end();

        entry.pipe(res);

        // end

      } else if (fileName.indexOf(inzip + '/') == 0) {
        found = true;
        self.redirect(self.path);
        entry.autodrain();
      } else {
        var index = self._index.some(function(index) {
          // console.log("searching index", fileName, inzip + '/' + index);
          if (inzip === '/' && fileName === index) {
            found = true;
            self.stream(req, res, path, fileName, options, stat);
            return true;
          } else if (inzip != '/' && fileName === inzip + index) {
            indexMatch[index] = fileName;
            return false;
          } else {
            return false;
          }
        })

        if (index || inzip.indexOf('.') > 0) return;

        var withExtension = self._extensions.some(function(ext) {
          // console.log("trying ext ", ext, fileName, inzip + '.' + ext);
          if (fileName === inzip + '.' + ext) {
            found = false;
            //maybe other file with a best extension will come, we should save the match and check later
            extensionMatch[ext] = fileName;
            return true;
          } else {
            return false;
          }

        });

        if (!withExtension) {
          entry.autodrain();
        };

      }

    }).on('close', function() {
      if (!found) {
        if (inzip[inzip.length - 1] == '/' && self._index.length == 0) {
          self.error(403);
        } else if (Object.keys(indexMatch).length > 0) {
          //we should get the best index
          self._index.some(function(index) {
            if (indexMatch[index] !== undefined) {
              self.stream(req, res, path, indexMatch[index], options, stat);
              return true;
            }
            return false;
          });

        } else if (Object.keys(extensionMatch).length > 0) {
          //we should get the best _extensions
          self._extensions.some(function(ext) {
            if (extensionMatch[ext] !== undefined) {
              self.stream(req, res, path, extensionMatch[ext], options, stat);
              return true;
            }
            return false;
          })
        } else {
          self.error(404);
        }
      }
    });

  // response finished, done with the fd
  onFinished(res, function onfinished() {
    finished = true;
    destroy(zipstream);
  });

  // error handling code-smell
  zipstream.on('error', function onerror(err) {
    // request already finished
    if (finished) return;

    // clean up stream
    finished = true;
    destroy(zipstream);

    // error
    self.onStatError(err);
  });



};

/**
 * Set content-type based on `path`
 * if it hasn't been explicitly set.
 *
 * @param {String} path
 * @api private
 */

SendStream.prototype.type = function(path) {
  var res = this.res;
  if (res.getHeader('Content-Type')) return;
  var type = mime.lookup(path);
  var charset = mime.charsets.lookup(type);
  debug('content-type %s', type);
  res.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
};

/**
 * Set response header fields, most
 * fields may be pre-defined.path
 *
 * @param {String} path
 * @param {Object} stat
 * @api private
 */

SendStream.prototype.setHeader = function setHeader(path, inzip, stat) {
  var res = this.res;
  this.emit('headers', res, join(path, inzip), stat);

  if (!res.getHeader('Date')) res.setHeader('Date', new Date().toUTCString());
  if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=' + Math.floor(this._maxage / 1000));

  if (this._lastModified && !res.getHeader('Last-Modified')) {
    var modified = stat.mtime.toUTCString()
    debug('modified %s', modified)
    res.setHeader('Last-Modified', modified)
  }

  if (this._etag && !res.getHeader('ETag')) {
    var val = etag(stat)
    debug('etag %s', val)
    res.setHeader('ETag', val)
  }
};

/**
 * Determine if path parts contain a dotfile.
 *
 * @api private
 */

function containsDotFile(parts) {
  for (var i = 0; i < parts.length; i++) {
    if (parts[i][0] === '.') {
      return true
    }
  }

  return false
}

/**
 * decodeURIComponent.
 *
 * Allows V8 to only deoptimize this fn instead of all
 * of send().
 *
 * @param {String} path
 * @api private
 */

function decode(path) {
  try {
    return decodeURIComponent(path)
  } catch (err) {
    return -1
  }
}

/**
 * Normalize the index option into an array.
 *
 * @param {boolean|string|array} val
 * @api private
 */

function normalizeList(val) {
  return [].concat(val || [])
}


function findFile(path, cb) {

  var findZipAndPath = function(path, inzip, cb) {
    fs.stat(path, function onstat(err, stat) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        //we shoudl go upper

        return findZipAndPath(dirname(path), join(basename(path), inzip), cb);
      } else {
        //zip file exist
        cb(null, path, inzip, stat);
      }
    });
  };

  if (path[path.length - 1] == '/') {
    return findZipAndPath(path.substr(0, path.length - 1), '/', cb);
  } else {
    return findZipAndPath(path, '', cb);
  }

}