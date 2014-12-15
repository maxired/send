
process.env.NO_DEPRECATION = 'send';

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');
var request = require('supertest');
var send = require('..')
var should = require('should');

// test server

var dateRegExp = /^\w{3}, \d+ \w+ \d+ \d+:\d+:\d+ \w+$/;
var fixtures = path.join(__dirname, 'fixtures');
var app = http.createServer(function(req, res){
  function error(err) {
    res.statusCode = err.status;
    res.end(http.STATUS_CODES[err.status]);
  }

  function redirect() {
    res.statusCode = 301;
    res.setHeader('Location', req.url + '/');
    res.end('Redirecting to ' + req.url + '/');
  }

  send(req, req.url, {root: fixtures})
  .on('error', error)
  .on('directory', redirect)
  .pipe(res);
});

describe('send.mime', function(){
  it('should be exposed', function(){
    assert(send.mime);
  })
})

describe('send(file).pipe(res)', function(){
  it('should stream the file contents', function(done){
    request(app)
    .get('/fixtures.zip/name.txt')
    .expect('Content-Length', '4')
    .expect(200, 'tobi', done)
  })

  it('should decode the given path as a URI', function(done){
    request(app)
    .get('/fixtures.zip/some%20thing.txt')
    .expect(200, 'hey', done)
  })

  it('should serve files with dots in name', function(done){
    request(app)
    .get('/fixtures.zip/do..ts.txt')
    .expect(200, '...', done)
  })

  it('should treat a malformed URI as a bad request', function(done){
    request(app)
    .get('/some%99thing.txt')
    .expect(400, 'Bad Request', done)
  })

  it('should 400 on NULL bytes', function(done){
    request(app)
    .get('/fixtures.zip/some%00thing.txt')
    .expect(400, 'Bad Request', done)
  })

  it('should treat an ENAMETOOLONG as a 404', function(done){
    var path = Array(100).join('foobar');
    request(app)
    .get('/' + path)
    .expect(404, done);
  })

  it('should handle headers already sent error', function(done){
    var app = http.createServer(function(req, res){
      res.write('0');
      send(req, req.url, {root: fixtures})
      .on('error', function(err){ res.end(' - ' + err.message) })
      .pipe(res);
    });
    request(app)
    .get('/fixtures.zip/nums')
    .expect(200, '0 - Can\'t set headers after they are sent.', done);
  })

  it('should support HEAD', function(done){
    request(app)
    .head('/fixtures.zip/name.txt')
    .expect('Content-Length', '4')
    .expect(200, '', done)
  })

  it('should add a Date header field', function(done){
    request(app)
    .get('/fixtures.zip/name.txt')
    .expect('date', dateRegExp, done)
  })

  it('should add a Last-Modified header field', function(done){
    request(app)
    .get('/fixtures.zip/name.txt')
    .expect('last-modified', dateRegExp, done)
  })

  it('should 404 if the file does not exist', function(done){
    request(app)
    .get('/fixtures.zip/meow')
    .expect(404, 'Not Found', done)
  })

  it('should 301 if the directory exists', function(done){
    request(app)
    .get('/fixtures.zip/pets')
    .expect('Location', '/fixtures.zip/pets/')
    .expect(301, 'Redirecting to /fixtures.zip/pets/', done)
  })

  it('should not override content-type', function(done){
    var app = http.createServer(function(req, res){
      res.setHeader('Content-Type', 'application/x-custom')
      send(req, req.url, {root: fixtures}).pipe(res)
    });
    request(app)
    .get('/fixtures.zip/nums')
    .expect('Content-Type', 'application/x-custom', done);
  })

  it('should set Content-Type via mime map', function(done){
    request(app)
    .get('/fixtures.zip/name.txt')
    .expect('Content-Type', 'text/plain; charset=UTF-8')
    .expect(200, function(err){
      if (err) return done(err)
      request(app)
      .get('/fixtures.zip/tobi.html')
      .expect('Content-Type', 'text/html; charset=UTF-8')
      .expect(200, done)
    });
  })

  it('should 404 if file disappears after stat, before open', function(done){
    var app = http.createServer(function(req, res){
      send(req, req.url, {root: 'test/fixtures'})
      .on('file', function(){
        // simulate file ENOENT after on open, after stat
        var fn = this.send;
        this.send = function(path, inzip,stat){
          path += '__xxx_no_exist';
          fn.call(this, path, inzip, stat);
        };
      })
      .pipe(res);
    });

    request(app)
    .get('/fixtures.zip/name.txt')
    .expect(404, done);
  })
/*
  it('should 500 on file stream error', function(done){
    var app = http.createServer(function(req, res){
      send(req, req.url, {root: 'test/fixtures'})
      .on('stream', function(stream){
        // simulate file error
        process.nextTick(function(){
          stream.emit('error', new Error('boom!'));
        });
      })
      .pipe(res);
    });

    request(app)
    .get('/fixtures.zip/name.txt')
    .expect(500, done);
  })
*/

  describe('"headers" event', function () {
    var args
    var fn
    var headers
    var server
    before(function () {
      server = http.createServer(function (req, res) {
        send(req, req.url, {root: fixtures})
        .on('headers', function () {
          args = arguments
          headers = true
          fn && fn.apply(this, arguments)
        })
        .pipe(res)
      })
    })
    beforeEach(function () {
      args = undefined
      fn = undefined
      headers = false
    })

    it('should fire when sending file', function (done) {
      request(server)
      .get('/fixtures.zip/nums')
      .expect(200, '123456789', function (err, res) {
        if (err) return done(err)
        headers.should.be.true
        done()
      })
    })

    it('should not fire on 404', function (done) {
      request(server)
      .get('/fixtures.zip/bogusi')
      .expect(404, function (err, res) {
        if (err) return done(err)
        headers.should.be.false
        done()
      })
    })

    it('should fire on indexe', function (done) {
      request(server)
      .get('/fixtures.zip/pets/')
      .expect(200, /tobi/, function (err, res) {
        console.log(err);
        if (err) return done(err)
        headers.should.be.true
        done()
      })
    })

    it('should not fire on redirect', function (done) {
      request(server)
      .get('/fixtures.zip/pets')
      .expect(301, function (err, res) {
        if (err) return done(err)
        headers.should.be.false
        done()
      })
    })

    it('should provide path', function (done) {
      request(server)
      .get('/fixtures.zip/nums')
      .expect(200, '123456789', function (err, res) {
        if (err) return done(err)
        headers.should.be.true
        args[1].should.endWith('nums')
        done()
      })
    })

    it('should provide stat', function (done) {
      request(server)
      .get('/fixtures.zip/nums')
      .expect(200, '123456789', function (err, res) {
        if (err) return done(err)
        headers.should.be.true
        args[2].should.have.property('mtime')
        done()
      })
    })

  })

  describe('when no "directory" listeners are present', function(){
    var server
    before(function(){
      server = http.createServer(function(req, res){
        send(req, req.url, {root: 'test/fixtures'})
        .pipe(res)
      })
    })

    it('should respond with an HTML redirect', function(done){
      request(server)
      .get('/fixtures.zip/pets')
      .expect('Location', '/fixtures.zip/pets/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect(301, 'Redirecting to <a href="/fixtures.zip/pets/">/fixtures.zip/pets/</a>\n', done)
    })
  })

  describe('when no "error" listeners are present', function(){
    it('should respond to errors directly', function(done){
      var app = http.createServer(function(req, res){
        send(req, 'test/fixtures' + req.url).pipe(res);
      });
      
      request(app)
      .get('/fixtures.zip/foobar')
      .expect(404, 'Not Found', done)
    })
  })

 
    describe('.from()', function(){
    it('should set with deprecated from', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url)
        .from(__dirname + '/fixtures')
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/../name.txt')
      .expect(200, 'tobi', done)
    })
  })

  describe('.hidden()', function(){
    it('should default support sending hidden files', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures})
        .hidden(true)
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/.hidden')
      .expect(200, /secret/, done);
    })
  })

  describe('.index()', function(){
    it('should be configurable', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures})
        .index('tobi.html')
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/')
      .expect(200, '<p>tobi</p>', done);
    })

    it('should support disabling', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures})
        .index(false)
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/')
      .expect(403, done);
    })

    it('should support fallbacks', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures})
        .index(['default.htm', 'index.html'])
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/')
      .expect(200, "tobi\nloki\njane", done)
    })
  })

  
  describe('.root()', function(){
    it('should set root', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url)
        .root(__dirname + '/fixtures')
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/../name.txt')
      .expect(200, 'tobi', done)
    })
  })
})

describe('send(file, options)', function(){
 
  describe('extensions', function () {
    it('should be not be enabled by default', function (done) {
      var server = createServer({root: fixtures});

      request(server)
      .get('/fixtures.zip/tobi')
      .expect(404, done)
    })

    it('should be configurable', function (done) {
      var server = createServer({extensions: 'txt', root: fixtures})

      request(server)
      .get('/fixtures.zip/name')
      .expect(200, 'tobi', done)
    })

    it('should support disabling extensions', function (done) {
      var server = createServer({extensions: false, root: fixtures})

      request(server)
      .get('/fixtures.zip/name')
      .expect(404, done)
    })

    it('should support fallbacks', function (done) {
      var server = createServer({extensions: ['htm', 'html', 'txt'], root: fixtures})

      request(server)
      .get('/fixtures.zip/name')
      .expect(200, '<p>tobi</p>', done)
    })

    it('should 404 if nothing found', function (done) {
      var server = createServer({extensions: ['htm', 'html', 'txt'], root: fixtures})

      request(server)
      .get('/fixtures.zip/bob')
      .expect(404, done)
    })

    it('should skip directories', function (done) {
      var server = createServer({extensions: ['file', 'dir'], root: fixtures})

      request(server)
      .get('/fixtures.zip/name')
      .expect(404, done)
    })

    it('should not search if file has extension', function (done) {
      var server = createServer({extensions: 'html', root: fixtures})

      request(server)
      .get('/fixtures.zip/thing.html')
      .expect(404, done)
    })
  })

  describe('lastModified', function () {
    it('should support disabling last-modified', function (done) {
      var app = http.createServer(function(req, res){
        send(req, req.url, {lastModified: false, root: fixtures})
        .pipe(res)
      })

      request(app)
      .get('/fixtures.zip/nums')
      .expect(200, function (err, res) {
        if (err) return done(err)
        res.headers.should.not.have.property('last-modified')
        done()
      })
    })
  })

  describe('from', function(){
    it('should set with deprecated from', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {from: __dirname + '/fixtures'})
        .pipe(res)
      });

      request(app)
      .get('/fixtures.zip/pets/../name.txt')
      .expect(200, 'tobi', done)
    })
  })

  
  describe('index', function(){
    it('should default to index.html', function(done){
      request(app)
      .get('/fixtures.zip/pets/')
      .expect("tobi\nloki\njane", done)
    })

    it('should be configurable', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures, index: 'tobi.html'})
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/')
      .expect(200, '<p>tobi</p>', done);
    })

    it('should support disabling', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures, index: false})
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/')
      .expect(403, done);
    })

    it('should support fallbacks', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures, index: ['default.htm', 'index.html']})
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/')
      .expect(200, "tobi\nloki\njane", done)
    })

    it('should 404 if no index file found (file)', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures, index: 'default.htm'})
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/pets/')
      .expect(404, done)
    })

    it('should 404 if no index file found (dir)', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures, index: 'pets'})
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/')
      .expect(404, done)
    })

    it('should not follow directories', function(done){
      var app = http.createServer(function(req, res){
        send(req, req.url, {root: fixtures, index: ['pets', 'name.txt']})
        .pipe(res);
      });

      request(app)
      .get('/fixtures.zip/')
      .expect(200, 'tobi', done)
    })
  })

  describe('root', function(){
    describe('when given', function(){
      it('should join root', function(done){
        var app = http.createServer(function(req, res){
          send(req, req.url, {root: __dirname + '/fixtures'})
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/pets/../name.txt')
        .expect(200, 'tobi', done)
      })

      it('should work with trailing slash', function(done){
        var app = http.createServer(function(req, res){
          send(req, req.url, {root: __dirname + '/fixtures/'})
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/name.txt')
        .expect(200, 'tobi', done)
      })

      it('should work with empty path', function(done){
        var app = http.createServer(function(req, res){
          send(req, '', {root: __dirname + '/fixtures'})
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/name.txt')
        .expect(301, /Redirecting to/, done)
      })

      it('should restrict paths to within root', function(done){
        var app = http.createServer(function(req, res){
          send(req, req.url, {root: __dirname + '/fixtures'})
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/pets/../../../send.js')
        .expect(403, done)
      })

      it('should allow .. in root', function(done){
        var app = http.createServer(function(req, res){
          send(req, req.url, {root: __dirname + '/fixtures/../fixtures'})
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/pets/../../../send.js')
        .expect(403, done)
      })

      it('should not allow root transversal', function(done){
        var app = http.createServer(function(req, res){
          send(req, req.url, {root: __dirname + '/fixtures/name.d'})
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/../../name.dir/name.txt')
        .expect(403, done)
      })
    })

    describe('when missing', function(){
      it('should consider .. malicious', function(done){
        var app = http.createServer(function(req, res){
          send(req, fixtures + req.url)
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/../send.js')
        .expect(403, done)
      })

      it('should still serve files with dots in name', function(done){
        var app = http.createServer(function(req, res){
          send(req, fixtures + req.url)
          .pipe(res);
        });

        request(app)
        .get('/fixtures.zip/do..ts.txt')
        .expect(200, '...', done);
      })
    })
  })
})

function createServer(opts) {
  return http.createServer(function onRequest(req, res) {
    try {
      send(req, req.url, opts).pipe(res)
    } catch (err) {
      res.statusCode = 500
      res.end(err.message)
    }
  })
}
