'use strict';

/*
 * require-kernel
 *
 * Created by Chad Weider on 01/04/11.
 * Released to the Public Domain on 17/01/12.
 */

const assert = require('assert');
const pathutil = require('path');
const requireForPaths = require('../mock_require').requireForPaths;

const modulesPath = pathutil.join(__dirname, 'modules');

describe('require.define', function () {
  it('should work', async function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.define('user/module.js', (r, e, m) => {
      e.value = m.id;
    });
    r.define('user/module.js', (r, e, m) => {
      e.value = 'REDEFINED';
    });
    r.define({
      'user/module1.js'(r, e, m) {
        e.value = m.id;
      },
      'user/module2.js'(r, e, m) {
        e.value = m.id;
      },
      'user/module3.js'(r, e, m) {
        e.value = m.id;
      },
    });

    assert.equal('user/module.js', r('user/module').value);
    assert.equal('user/module1.js', r('user/module1').value);
    assert.equal('user/module2.js', r('user/module2').value);
    assert.equal('user/module3.js', r('user/module3').value);
  });

  it('should validate parameters', async function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    assert.throws(() => { r.define(); }, 'ArgumentError');
    assert.throws(() => { r.define(null, null); }, 'ArgumentError');
  });
});

describe('require', function () {
  const r = requireForPaths(`${modulesPath}/root`, `${modulesPath}/library`);
  it('should resolve libraries', async function () {
    assert.equal('1.js', r('1.js').value);
    assert.equal('/1.js', r('/1.js').value);
  });

  it('should resolve suffixes', async function () {
    assert.equal('/1.js', r('/1').value);
    assert.equal(r('/1.js'), r('/1'));
  });

  it('should handle spaces', async function () {
    const r = requireForPaths(`${modulesPath}/root`, `${modulesPath}/library`);
    assert.equal('/spa ce s.js', r('/spa ce s.js').value);
  });

  it('should handle questionable "extra" relative paths', async function () {
    const r = requireForPaths(`${modulesPath}/root`, `${modulesPath}/library`);
    assert.equal('/../root/1.js', r('/../root/1').value);
    assert.equal('/../library/1.js', r('../library/1').value);
  });

  it('should handle relative peths in library modules', async function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.define('main.js', (r, e, m) => {
      e.sibling = r('./sibling');
    });
    r.define('sibling.js', (r, e, m) => {
    });
    assert.equal(r('main.js').sibling, r('sibling.js'));
  });

  it('should resolve indexes correctly', async function () {
    const r = requireForPaths(`${modulesPath}/index`);
    assert.equal('/index.js', r('/').value);
    assert.equal('/index.js', r('/index').value);
    assert.equal('/index/index.js', r('/index/').value);
    assert.equal('/index/index.js', r('/index/index').value);
    assert.equal('/index/index.js', r('/index/index.js').value);
    assert.equal('/index/index/index.js', r('/index/index/').value);
    assert.equal('/index/index/index.js', r('/index/index/index.js').value);
  });

  it('should normalize paths', async function () {
    const r = requireForPaths(`${modulesPath}/index`);
    assert.equal('/index.js', r('./index').value);
    assert.equal('/index.js', r('/./index').value);
    assert.equal('/index/index.js', r('/index/index/../').value);
    assert.equal('/index/index.js', r('/index/index/../../index/').value);
  });

  it('should validate parameters', async function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    assert.throws(() => { r(null); }, 'toString');
    assert.throws(() => { r('1', '1'); }, 'ArgumentError');
    assert.throws(() => { r('1', '1', '1'); }, 'ArgumentError');
  });

  it('should lookup nested libraries', async function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.setLibraryLookupComponent('node_modules');
    r.define({
      'thing0/index.js'(r, e, m) {
        e.value = m.id;
      },
      'thing1/index.js'(r, e, m) {
        e.value = m.id;
      },
      '/node_modules/thing1/index.js'(r, e, m) {
        e.value = m.id;
      },
      '/node_modules/thing/node_modules/thing2/index.js'(r, e, m) {
        e.value = m.id;
      },
      '/node_modules/thing/dir/node_modules/thing3/index.js'(r, e, m) {
        e.value = m.id;
      },

      '/node_modules/thing/dir/load_things.js'(r, e, m) {
        assert.equal(r('thing3').value, '/node_modules/thing/dir/node_modules/thing3/index.js');
        assert.equal(r('thing2').value, '/node_modules/thing/node_modules/thing2/index.js');
        assert.equal(r('thing1').value, '/node_modules/thing1/index.js');
        assert.equal(r('thing0').value, 'thing0/index.js');
      },
    });

    r('/node_modules/thing/dir/load_things.js');
  });

  it('should detect cycles', async function () {
    const r = requireForPaths('/dev/null', '/dev/null');
    r.define({
      'one_cycle.js'(r, e, m) {
        e.value = m.id;
        e.one = r('one_cycle');
      },

      'two_cycle.js'(r, e, m) {
        e.two = r('two_cycle.1');
      },
      'two_cycle.1.js'(r, e, m) {
        e.value = m.id;
        e.two = r('two_cycle.2');
      },
      'two_cycle.2.js'(r, e, m) {
        e.value = m.id;
        e.one = r('two_cycle.1');
      },

      'n_cycle.js'(r, e, m) {
        e.two = r('n_cycle.1');
      },
      'n_cycle.1.js'(r, e, m) {
        e.value = m.id;
        e.two = r('n_cycle.2');
      },
      'n_cycle.2.js'(r, e, m) {
        e.value = m.id;
        e.three = r('n_cycle.3');
      },
      'n_cycle.3.js'(r, e, m) {
        e.value = m.id;
        e.one = r('n_cycle.1');
      },
    });

    assert.throws(() => { r('one_cycle'); }, 'CircularDependency');
    assert.throws(() => { r('two_cycle'); }, 'CircularDependency');
    assert.throws(() => { r('n_cycle'); }, 'CircularDependency');
  });

  it('should avoid avoidable cycles', async function () {
    const r = requireForPaths();
    r.define({
      'non_cycle.js'(r, e, m) {
        e.value = m.id;
        r('non_cycle.1.js');
      },
      'non_cycle.1.js'(r, e, m) {
        e.value = m.id;
        r('non_cycle.2.js', (two) => { e.one = two; });
      },
      'non_cycle.2.js'(r, e, m) {
        e.value = m.id;
        r('non_cycle.1.js', (one) => { e.one = one; });
      },
    });

    assert.doesNotThrow(() => {
      r('non_cycle.1.js');
    }, 'CircularDependency');
  });
});
