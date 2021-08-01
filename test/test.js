/* !

  require-kernel

  Created by Chad Weider on 01/04/11.
  Released to the Public Domain on 17/01/12.

*/

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const pathutil = require('path');
const requireForPaths = require('../mock_require').requireForPaths;

const modulesPath = pathutil.join(__dirname, 'modules');

describe('require.define', function () {
  it('should work', function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.define('user/module.js', (require, exports, module) => {
      exports.value = module.id;
    });
    r.define('user/module.js', (require, exports, module) => {
      exports.value = 'REDEFINED';
    });
    r.define({
      'user/module1.js'(require, exports, module) {
        exports.value = module.id;
      },
      'user/module2.js'(require, exports, module) {
        exports.value = module.id;
      },
      'user/module3.js'(require, exports, module) {
        exports.value = module.id;
      },
    });

    assert.equal('user/module.js', r('user/module').value);
    assert.equal('user/module1.js', r('user/module1').value);
    assert.equal('user/module2.js', r('user/module2').value);
    assert.equal('user/module3.js', r('user/module3').value);
  });

  it('should validate parameters', function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    assert.throws(() => { r.define(); }, 'ArgumentError');
    assert.throws(() => { r.define(null, null); }, 'ArgumentError');
  });
});

describe('require', function () {
  const r = requireForPaths(`${modulesPath}/root`, `${modulesPath}/library`);
  it('should resolve libraries', function () {
    assert.equal('1.js', r('1.js').value);
    assert.equal('/1.js', r('/1.js').value);
  });

  it('should resolve suffixes', function () {
    assert.equal('/1.js', r('/1').value);
    assert.equal(r('/1.js'), r('/1'));
  });

  it('should handle spaces', function () {
    const r = requireForPaths(`${modulesPath}/root`, `${modulesPath}/library`);
    assert.equal('/spa ce s.js', r('/spa ce s.js').value);
  });

  it('should handle questionable "extra" relative paths', function () {
    const r = requireForPaths(`${modulesPath}/root`, `${modulesPath}/library`);
    assert.equal('/../root/1.js', r('/../root/1').value);
    assert.equal('/../library/1.js', r('../library/1').value);
  });

  it('should handle relative peths in library modules', function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.define('main.js', (require, exports, module) => {
      exports.sibling = require('./sibling');
    });
    r.define('sibling.js', (require, exports, module) => {
    });
    assert.equal(r('main.js').sibling, r('sibling.js'));
  });

  it('should resolve indexes correctly', function () {
    const r = requireForPaths(`${modulesPath}/index`);
    assert.equal('/index.js', r('/').value);
    assert.equal('/index.js', r('/index').value);
    assert.equal('/index/index.js', r('/index/').value);
    assert.equal('/index/index.js', r('/index/index').value);
    assert.equal('/index/index.js', r('/index/index.js').value);
    assert.equal('/index/index/index.js', r('/index/index/').value);
    assert.equal('/index/index/index.js', r('/index/index/index.js').value);
  });

  it('should normalize paths', function () {
    const r = requireForPaths(`${modulesPath}/index`);
    assert.equal('/index.js', r('./index').value);
    assert.equal('/index.js', r('/./index').value);
    assert.equal('/index/index.js', r('/index/index/../').value);
    assert.equal('/index/index.js', r('/index/index/../../index/').value);
  });

  it('should validate parameters', function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    assert.throws(() => { r(null); }, 'toString');
    assert.throws(() => { r('1', '1'); }, 'ArgumentError');
    assert.throws(() => { r('1', '1', '1'); }, 'ArgumentError');
  });

  it('should lookup nested libraries', function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.setLibraryLookupComponent('node_modules');
    r.define({
      'thing0/index.js'(require, exports, module) {
        exports.value = module.id;
      },
      'thing1/index.js'(require, exports, module) {
        exports.value = module.id;
      },
      '/node_modules/thing1/index.js'(require, exports, module) {
        exports.value = module.id;
      },
      '/node_modules/thing/node_modules/thing2/index.js'(require, exports, module) {
        exports.value = module.id;
      },
      '/node_modules/thing/dir/node_modules/thing3/index.js'(require, exports, module) {
        exports.value = module.id;
      },

      '/node_modules/thing/dir/load_things.js'(require, exports, module) {
        assert.equal(require('thing3').value, '/node_modules/thing/dir/node_modules/thing3/index.js');
        assert.equal(require('thing2').value, '/node_modules/thing/node_modules/thing2/index.js');
        assert.equal(require('thing1').value, '/node_modules/thing1/index.js');
        assert.equal(require('thing0').value, 'thing0/index.js');
      },
    });

    r('/node_modules/thing/dir/load_things.js');
  });

  it('should detect cycles', function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.define({
      'one_cycle.js'(require, exports, module) {
        exports.value = module.id;
        exports.one = require('one_cycle');
      },

      'two_cycle.js'(require, exports, module) {
        exports.two = require('two_cycle.1');
      },
      'two_cycle.1.js'(require, exports, module) {
        exports.value = module.id;
        exports.two = require('two_cycle.2');
      },
      'two_cycle.2.js'(require, exports, module) {
        exports.value = module.id;
        exports.one = require('two_cycle.1');
      },

      'n_cycle.js'(require, exports, module) {
        exports.two = require('n_cycle.1');
      },
      'n_cycle.1.js'(require, exports, module) {
        exports.value = module.id;
        exports.two = require('n_cycle.2');
      },
      'n_cycle.2.js'(require, exports, module) {
        exports.value = module.id;
        exports.three = require('n_cycle.3');
      },
      'n_cycle.3.js'(require, exports, module) {
        exports.value = module.id;
        exports.one = require('n_cycle.1');
      },
    });

    assert.throws(() => { r('one_cycle'); }, 'CircularDependency');
    assert.throws(() => { r('two_cycle'); }, 'CircularDependency');
    assert.throws(() => { r('n_cycle'); }, 'CircularDependency');
  });

  it('should avoid avoidable cycles', function () {
    const r = requireForPaths();
    r.define({
      'non_cycle.js'(require, exports, module) {
        exports.value = module.id;
        require('non_cycle.1.js');
      },
      'non_cycle.1.js'(require, exports, module) {
        exports.value = module.id;
        require('non_cycle.2.js', (two) => { exports.one = two; });
      },
      'non_cycle.2.js'(require, exports, module) {
        exports.value = module.id;
        require('non_cycle.1.js', (one) => { exports.one = one; });
      },
    });

    assert.doesNotThrow(() => {
      r('non_cycle.1.js');
    }, 'CircularDependency');
  });
});
