/*!

  require-kernel

  Created by Chad Weider on 01/04/11.
  Released to the Public Domain on 17/01/12.

*/

var assert = require('assert');
var fs = require('fs');
var util = require('util');
var pathutil = require('path');
var requireForPaths = require('../mock_require').requireForPaths;

var modulesPath = pathutil.join(__dirname, 'modules');

describe("require.define", function () {
  it("should work", function () {
    var r = requireForPaths('/dev/null', '/dev/null');
    r.define("user/module.js", function (require, exports, module) {
      exports.value = module.id;
    });
    r.define("user/module.js", function (require, exports, module) {
      exports.value = "REDEFINED";
    });
    r.define({
      "user/module1.js": function (require, exports, module) {
        exports.value = module.id;
      }
    , "user/module2.js": function (require, exports, module) {
        exports.value = module.id;
      }
    , "user/module3.js": function (require, exports, module) {
        exports.value = module.id;
      }
    });

    assert.equal('user/module.js', r('user/module').value);
    assert.equal('user/module1.js', r('user/module1').value);
    assert.equal('user/module2.js', r('user/module2').value);
    assert.equal('user/module3.js', r('user/module3').value);
  });

  it("should validate parameters", function () {
    var r = requireForPaths('/dev/null', '/dev/null');
    assert.throws(function () {r.define()}, "ArgumentError");
    assert.throws(function () {r.define(null, null)}, "ArgumentError");
  });
});

describe('require', function () {
  var r = requireForPaths(modulesPath + '/root', modulesPath + '/library');
  it("should resolve libraries", function () {
    assert.equal('1.js', r('1.js').value);
    assert.equal('/1.js', r('/1.js').value);
  });

  it("should resolve suffixes", function () {
    assert.equal('/1.js', r('/1').value);
    assert.equal(r('/1.js'), r('/1'));
  });

  it("should handle spaces", function () {
    var r = requireForPaths(modulesPath + '/root', modulesPath + '/library');
    assert.equal('/spa ce s.js', r('/spa ce s.js').value);
  });

  it("should handle questionable \"extra\" relative paths", function () {
    var r = requireForPaths(modulesPath + '/root', modulesPath + '/library');
    assert.equal('/../root/1.js', r('/../root/1').value);
    assert.equal('/../library/1.js', r('../library/1').value);
  });

  it("should handle relative peths in library modules", function () {
    var r = requireForPaths('/dev/null', '/dev/null');
    r.define("main.js", function (require, exports, module) {
      exports.sibling = require('./sibling');
    });
    r.define("sibling.js", function (require, exports, module) {
    });
    assert.equal(r('main.js').sibling, r('sibling.js'));
  });

  it("should resolve indexes correctly", function () {
    var r = requireForPaths(modulesPath + '/index');
    assert.equal('/index.js', r('/').value);
    assert.equal('/index.js', r('/index').value);
    assert.equal('/index/index.js', r('/index/').value);
    assert.equal('/index/index.js', r('/index/index').value);
    assert.equal('/index/index.js', r('/index/index.js').value);
    assert.equal('/index/index/index.js', r('/index/index/').value);
    assert.equal('/index/index/index.js', r('/index/index/index.js').value);
  });

  it("should normalize paths", function () {
    var r = requireForPaths(modulesPath + '/index');
    assert.equal('/index.js', r('./index').value);
    assert.equal('/index.js', r('/./index').value);
    assert.equal('/index/index.js', r('/index/index/../').value);
    assert.equal('/index/index.js', r('/index/index/../../index/').value);
  });

  it("should validate parameters", function () {
    var r = requireForPaths('/dev/null', '/dev/null');
    assert.throws(function () {r(null)}, 'toString');
    assert.throws(function () {r('1', '1')}, 'ArgumentError');
    assert.throws(function () {r('1', '1', '1')}, 'ArgumentError');
  });

  it("should lookup nested libraries", function () {
    var r = requireForPaths('/dev/null', '/dev/null');
    r.setLibraryLookupComponent('node_modules');
    r.define({
      "thing0/index.js": function (require, exports, module) {
        exports.value = module.id;
      }
    , "thing1/index.js": function (require, exports, module) {
        exports.value = module.id;
      }
    , "/node_modules/thing1/index.js": function (require, exports, module) {
        exports.value = module.id;
      }
    , "/node_modules/thing/node_modules/thing2/index.js": function (require, exports, module) {
        exports.value = module.id;
      }
    , "/node_modules/thing/dir/node_modules/thing3/index.js": function (require, exports, module) {
        exports.value = module.id;
      }

    , "/node_modules/thing/dir/load_things.js": function (require, exports, module) {
        assert.equal(require('thing3').value, '/node_modules/thing/dir/node_modules/thing3/index.js');
        assert.equal(require('thing2').value, '/node_modules/thing/node_modules/thing2/index.js');
        assert.equal(require('thing1').value, '/node_modules/thing1/index.js');
        assert.equal(require('thing0').value, 'thing0/index.js');
      }
    });

    r('/node_modules/thing/dir/load_things.js');
  });

  it("should detect cycles", function () {
    var r = requireForPaths('/dev/null', '/dev/null');
    r.define({
      "one_cycle.js": function (require, exports, module) {
        exports.value = module.id;
        exports.one = require('one_cycle');
      }

    , "two_cycle.js": function (require, exports, module) {
        exports.two = require('two_cycle.1');
      }
    , "two_cycle.1.js": function (require, exports, module) {
        exports.value = module.id;
        exports.two = require('two_cycle.2');
      }
    , "two_cycle.2.js": function (require, exports, module) {
        exports.value = module.id;
        exports.one = require('two_cycle.1');
      }

    , "n_cycle.js": function (require, exports, module) {
        exports.two = require('n_cycle.1');
      }
    , "n_cycle.1.js": function (require, exports, module) {
        exports.value = module.id;
        exports.two = require('n_cycle.2');
      }
    , "n_cycle.2.js": function (require, exports, module) {
        exports.value = module.id;
        exports.three = require('n_cycle.3');
      }
    , "n_cycle.3.js": function (require, exports, module) {
        exports.value = module.id;
        exports.one = require('n_cycle.1');
      }
    });

    assert.throws(function () {r('one_cycle')}, 'CircularDependency');
    assert.throws(function () {r('two_cycle')}, 'CircularDependency');
    assert.throws(function () {r('n_cycle')}, 'CircularDependency');
  });

  it("should avoid avoidable cycles", function () {
    var r = requireForPaths();
    r.define({
      "non_cycle.js": function (require, exports, module) {
        exports.value = module.id;
        require("non_cycle.1.js");
      }
    , "non_cycle.1.js": function (require, exports, module) {
        exports.value = module.id;
        require("non_cycle.2.js", function (two) {exports.one = two});
      }
    , "non_cycle.2.js": function (require, exports, module) {
        exports.value = module.id;
        require("non_cycle.1.js", function (one) {exports.one = one});
      }
    });

    assert.doesNotThrow(function () {
      r("non_cycle.1.js");
    }, 'CircularDependency');
  });

});
