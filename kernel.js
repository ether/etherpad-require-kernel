/* eslint-disable strict */ (function () {
  // The contents of this file are evaluated as the right-hand side of an assignment expression
  // (this file is not loaded as a module or in a <script> element). Because of this unusual
  // evaluation, strict mode cannot be enabled outside the IIFE.
  //
  // Note: Enabling strict mode here does not affect strict mode of code passed to a Function
  // constructor, so it does not cause modules to load in strict mode.
  //
  // Warning: Strict mode changes eval's behavior, and the behavior of the code evaluated, so the
  // require kernel must not use eval to load modules if strict mode is enabled.
  'use strict';

  /*
   * require-kernel
   *
   * Created by Chad Weider on 01/04/11.
   * Released to the Public Domain on 17/01/12.
   */

  /* Storage */
  let main = null; // Reference to main module in `modules`.
  const modules = {}; // Repository of module objects build from `definitions`.
  const definitions = {}; // Functions that construct `modules`.
  const loadingModules = {}; // Locks for detecting circular dependencies.
  const definitionWaiters = {}; // Locks for clearing duplicate requires.
  const fetchRequests = []; // Queue of pending requests.
  let currentRequests = 0; // Synchronization for parallel requests.
  let maximumRequests = 2; // The maximum number of parallel requests.
  const deferred = []; // A list of callbacks that can be evaluated eventually.
  let deferredScheduled = false; // If deferred functions will be executed.

  let syncLock = undefined;
  let globalKeyPath = undefined;

  let rootURI = undefined;
  let libraryURI = undefined;

  let libraryLookupComponent = undefined;

  const JSONP_TIMEOUT = 60 * 1000;

  function CircularDependencyError(message) {
    this.name = 'CircularDependencyError';
    this.message = message;
  }
  CircularDependencyError.prototype = Error.prototype;
  function ArgumentError(message) {
    this.name = 'ArgumentError';
    this.message = message;
  }
  ArgumentError.prototype = Error.prototype;

  /* Utility */
  function hasOwnProperty(object, key) {
    // Object-independent because an object may define `hasOwnProperty`.
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  /* Deferral */
  function defer(f_1, f_2, f_n) {
    deferred.push.apply(deferred, arguments);
  }

  function _flushDefer() {
    // Let exceptions happen, but don't allow them to break notification.
    try {
      while (deferred.length) {
        const continuation = deferred.shift();
        continuation();
      }
      deferredScheduled = false;
    } finally {
      deferredScheduled = deferred.length > 0;
      deferred.length && setTimeout(_flushDefer, 0);
    }
  }

  function flushDefer() {
    if (!deferredScheduled && deferred.length > 0) {
      if (syncLock) {
        // Only asynchronous operations will wait on this condition so schedule
        // and don't interfere with the synchronous operation in progress.
        deferredScheduled = true;
        setTimeout(_flushDefer, 0);
      } else {
        _flushDefer();
      }
    }
  }

  function flushDeferAfter(f) {
    try {
      deferredScheduled = true;
      f();
      deferredScheduled = false;
      flushDefer();
    } finally {
      deferredScheduled = false;
      deferred.length && setTimeout(flushDefer, 0);
    }
  }

  function normalizePath(path) {
    const pathComponents1 = path.split('/');
    const pathComponents2 = [];

    let component;
    for (let i = 0, ii = pathComponents1.length; i < ii; i++) {
      component = pathComponents1[i];
      switch (component) {
        case '':
          if (i == 0 || i == ii - 1) {
            // This indicates a leading or trailing slash.
            pathComponents2.push(component);
          }
          break;
        case '.':
          // Always skip.
          break;
        case '..':
          if (pathComponents2.length > 1 ||
            (pathComponents2.length == 1 &&
              pathComponents2[0] != '' &&
              pathComponents2[0] != '.')) {
            pathComponents2.pop();
            break;
          }
        default:
          pathComponents2.push(component);
      }
    }

    return pathComponents2.join('/');
  }

  function fullyQualifyPath(path, basePath) {
    let fullyQualifiedPath = path;
    if (path.charAt(0) == '.' &&
      (path.charAt(1) == '/' ||
        (path.charAt(1) == '.' && path.charAt(2) == '/'))) {
      if (!basePath) {
        basePath = '';
      } else if (basePath.charAt(basePath.length - 1) != '/') {
        basePath += '/';
      }
      fullyQualifiedPath = basePath + path;
    }
    return fullyQualifiedPath;
  }

  function setRootURI(URI) {
    if (!URI) {
      throw new ArgumentError('Invalid root URI.');
    }
    rootURI = (URI.charAt(URI.length - 1) == '/' ? URI.slice(0, -1) : URI);
  }

  function setLibraryURI(URI) {
    libraryURI = (URI.charAt(URI.length - 1) == '/' ? URI : `${URI}/`);
  }

  function setLibraryLookupComponent(component) {
    component = component && component.toString();
    if (!component) {
      libraryLookupComponent = undefined;
    } else if (component.match(/\//)) {
      throw new ArgumentError('Invalid path component.');
    } else {
      libraryLookupComponent = component;
    }
  }

  // If a `libraryLookupComponent` is defined, then library modules should
  // be looked at in every parent directory (roughly).
  function searchPathsForModulePath(path, basePath) {
    path = normalizePath(path);

    // Should look for nearby libarary modules.
    if (path.charAt(0) != '/' && libraryLookupComponent) {
      const paths = [];
      const components = basePath.split('/');

      while (components.length > 1) {
        if (components[components.length - 1] == libraryLookupComponent) {
          components.pop();
        }
        const searchPath = normalizePath(fullyQualifyPath(
            `./${libraryLookupComponent}/${path}`, `${components.join('/')}/`
        ));
        paths.push(searchPath);
        components.pop();
      }
      paths.push(path);
      return paths;
    } else {
      return [normalizePath(fullyQualifyPath(path, basePath))];
    }
  }

  function URIForModulePath(path) {
    const components = path.split('/');
    for (let i = 0, ii = components.length; i < ii; i++) {
      components[i] = encodeURIComponent(components[i]);
    }
    path = components.join('/');

    if (path.charAt(0) == '/') {
      if (!rootURI) {
        throw new Error(`${'Attempt to retrieve the root module ' +
          '"'}${path}" but no root URI is defined.`);
      }
      return rootURI + path;
    } else {
      if (!libraryURI) {
        throw new Error(`${'Attempt to retrieve the library module ' +
          '"'}${path}" but no libary URI is defined.`);
      }
      return libraryURI + path;
    }
  }

  function _compileFunction(code, filename) {
    return new Function(code);
  }

  function compileFunction(code, filename) {
    const compileFunction = rootRequire._compileFunction || _compileFunction;
    return compileFunction.apply(this, arguments);
  }

  /* Remote */
  function setRequestMaximum(value) {
    value = parseInt(value);
    if (value > 0) {
      maximumRequests = value;
      checkScheduledfetchDefines();
    } else {
      throw new ArgumentError('Value must be a positive integer.');
    }
  }

  function setGlobalKeyPath(value) {
    globalKeyPath = value;
  }

  let randomVersionString = null;
  const getRandomVersionString = () => {
    if (typeof window === 'undefined') return null;
    for (let win = window; randomVersionString == null; win = win.parent) {
      ({clientVars: {randomVersionString} = {}} = win);
      if (win === window.top) break;
    }
    return randomVersionString;
  };

  function getXHR(uri, async, callback) {
    if (getRandomVersionString()) {
      uri += `&v=${getRandomVersionString()}`;
    }
    const request = new XMLHttpRequest();
    function onComplete(request) {
      // Build module constructor.
      if (request.status == 200) {
        callback(undefined, request.responseText);
      } else {
        callback(true, undefined);
      }
    }

    request.open('GET', uri, !!(async));
    if (async) {
      request.onreadystatechange = function (event) {
        if (request.readyState == 4) {
          onComplete(request);
        }
      };
      request.send(null);
    } else {
      request.send(null);
      onComplete(request);
    }
  }

  function fetchDefineXHR(path, async) {
    // If cross domain and request doesn't support such requests, go straight
    // to mirroring.

    const _globalKeyPath = globalKeyPath;

    const callback = function (error, text) {
      if (error) {
        define(path, null);
      } else if (_globalKeyPath) {
        compileFunction(text, path)();
      } else {
        const definition = compileFunction(
            `return (function (require, exports, module) {${
              text}\n` +
            '})', path)();
        define(path, definition);
      }
    };

    let uri = URIForModulePath(path);
    if (_globalKeyPath) {
      uri += `?callback=${encodeURIComponent(`${globalKeyPath}.define`)}`;
    }
    getXHR(uri, async, callback);
  }

  function fetchDefineJSONP(path) {
    const head = document.head ||
      document.getElementsByTagName('head')[0] ||
      document.documentElement;
    const script = document.createElement('script');
    if (script.async !== undefined) {
      script.async = 'true';
    } else {
      script.defer = 'true';
    }
    script.type = 'application/javascript';
    script.src = `${URIForModulePath(path)
    }?callback=${encodeURIComponent(`${globalKeyPath}.define`)}`;

    // Handle failure of JSONP request.
    if (JSONP_TIMEOUT < Infinity) {
      const timeoutId = setTimeout(() => define(path, null), JSONP_TIMEOUT);
      definitionWaiters[path].unshift(() => clearTimeout(timeoutId));
    }

    head.insertBefore(script, head.firstChild);
  }

  /* Modules */
  function fetchModule(path, continuation) {
    if (hasOwnProperty(definitionWaiters, path)) {
      definitionWaiters[path].push(continuation);
    } else {
      definitionWaiters[path] = [continuation];
      schedulefetchDefine(path);
    }
  }

  function schedulefetchDefine(path) {
    fetchRequests.push(path);
    checkScheduledfetchDefines();
  }

  function checkScheduledfetchDefines() {
    if (fetchRequests.length > 0 && currentRequests < maximumRequests) {
      const fetchRequest = fetchRequests.pop();
      currentRequests++;
      definitionWaiters[fetchRequest].unshift(() => {
        currentRequests--;
        checkScheduledfetchDefines();
      });
      if (globalKeyPath &&
        typeof document !== 'undefined' &&
          document.readyState &&
            /^loaded|complete$/.test(document.readyState)) {
        fetchDefineJSONP(fetchRequest);
      } else {
        fetchDefineXHR(fetchRequest, true);
      }
    }
  }

  function fetchModuleSync(path, continuation) {
    fetchDefineXHR(path, false);
    continuation();
  }

  function moduleIsLoaded(path) {
    return hasOwnProperty(modules, path);
  }

  function loadModule(path, continuation) {
    // If it's a function then it hasn't been exported yet. Run function and
    //  then replace with exports result.
    if (!moduleIsLoaded(path)) {
      if (hasOwnProperty(loadingModules, path)) {
        throw new CircularDependencyError('Encountered circular dependency.');
      } else if (!moduleIsDefined(path)) {
        throw new Error('Attempt to load undefined module.');
      } else if (definitions[path] === null) {
        continuation(null);
      } else {
        const definition = definitions[path];
        const _module = {id: path, exports: {}};
        const _require = requireRelativeTo(path);
        if (!main) {
          main = _module;
        }
        try {
          loadingModules[path] = true;
          definition(_require, _module.exports, _module);
          modules[path] = _module;
          delete loadingModules[path];
          continuation(_module);
        } finally {
          delete loadingModules[path];
        }
      }
    } else {
      const module = modules[path];
      continuation(module);
    }
  }

  function _moduleAtPath(path, fetchFunc, continuation) {
    const suffixes =
        path.endsWith('.js') ? ['']
        : path.endsWith('/') ? ['index.js']
        : ['.js', '/index.js', ''];
    const i = 0; const
      ii = suffixes.length;
    var _find = function (i) {
      if (i < ii) {
        const path_ = path + suffixes[i];
        const after = function () {
          loadModule(path_, (module) => {
            if (module === null) {
              _find(i + 1);
            } else {
              continuation(module);
            }
          });
        };

        if (!moduleIsDefined(path_)) {
          fetchFunc(path_, after);
        } else {
          after();
        }
      } else {
        continuation(null);
      }
    };
    _find(0);
  }

  function moduleAtPath(path, continuation) {
    defer(() => {
      _moduleAtPath(path, fetchModule, continuation);
    });
  }

  function moduleAtPathSync(path) {
    let module;
    const oldSyncLock = syncLock;
    syncLock = true;

    // HACK TODO
    // This is completely the wrong way to do it but for now it shows it works
    if (path == 'async') {
      // console.warn("path is async and we're doing a ghetto fix");
      path = 'async/lib/async';
    }

    // HACK TODO
    // This is completely the wrong way to do it but for now it shows it works
    if (path == 'underscore') {
      // console.warn("path is async and we're doing a ghetto fix");
      path = 'underscore/underscore';
    }

    // HACK TODO
    // This is completely the wrong way to do it but for now it shows it works
    if (path == 'unorm') {
      // console.warn("path is async and we're doing a ghetto fix");
      path = 'unorm/lib/unorm';
    }

    try {
      _moduleAtPath(path, fetchModuleSync, (_module) => {
        module = _module;
      });
    } finally {
      syncLock = oldSyncLock;
    }
    return module;
  }

  /* Definition */
  function moduleIsDefined(path) {
    return hasOwnProperty(definitions, path);
  }

  function defineModule(path, module) {
    if (typeof path !== 'string' ||
      !((typeof module === 'function') || module === null)) {
      throw new ArgumentError(
          'Definition must be a (string, function) pair.');
    }

    if (moduleIsDefined(path)) {
      // Drop import silently
    } else {
      definitions[path] = module;
    }
  }

  function defineModules(moduleMap) {
    if (typeof moduleMap !== 'object') {
      throw new ArgumentError('Mapping must be an object.');
    }
    for (const path in moduleMap) {
      if (hasOwnProperty(moduleMap, path)) {
        defineModule(path, moduleMap[path]);
      }
    }
  }

  function define(fullyQualifiedPathOrModuleMap, module) {
    let moduleMap;
    if (arguments.length == 1) {
      moduleMap = fullyQualifiedPathOrModuleMap;
      defineModules(moduleMap);
    } else if (arguments.length == 2) {
      var path = fullyQualifiedPathOrModuleMap;
      defineModule(fullyQualifiedPathOrModuleMap, module);
      moduleMap = {};
      moduleMap[path] = module;
    } else {
      throw new ArgumentError(`Expected 1 or 2 arguments, but got ${
        arguments.length}.`);
    }

    // With all modules installed satisfy those conditions for all waiters.
    for (var path in moduleMap) {
      if (hasOwnProperty(moduleMap, path) &&
        hasOwnProperty(definitionWaiters, path)) {
        defer.apply(this, definitionWaiters[path]);
        delete definitionWaiters[path];
      }
    }

    flushDefer();
  }

  /* Require */
  function _designatedRequire(path, continuation, relativeTo) {
    const paths = searchPathsForModulePath(path, relativeTo);

    if (continuation === undefined) {
      let module;
      for (let i = 0, ii = paths.length; i < ii && !module; i++) {
        var path = paths[i];
        module = moduleAtPathSync(path);
      }
      if (!module) {
        throw new Error(`The module at "${path}" does not exist.`);
      }
      return module.exports;
    } else {
      if (!(typeof continuation === 'function')) {
        throw new ArgumentError('Continuation must be a function.');
      }

      flushDeferAfter(() => {
        function search() {
          const path = paths.shift();
          return moduleAtPath(path, (module) => {
            if (module || paths.length == 0) {
              continuation(module && module.exports);
            } else {
              search();
            }
          });
        }
        search();
      });
    }
  }

  function designatedRequire(path, continuation) {
    const designatedRequire =
        rootRequire._designatedRequire || _designatedRequire;
    return designatedRequire.apply(this, arguments);
  }

  function requireRelative(basePath, qualifiedPath, continuation) {
    qualifiedPath = qualifiedPath.toString();
    const path = normalizePath(fullyQualifyPath(qualifiedPath, basePath));
    return designatedRequire(path, continuation, basePath);
  }

  function requireRelativeN(basePath, qualifiedPaths, continuation) {
    if (!(typeof continuation === 'function')) {
      throw new ArgumentError('Final argument must be a continuation.');
    } else {
      // Copy and validate parameters
      const _qualifiedPaths = [];
      for (var i = 0, ii = qualifiedPaths.length; i < ii; i++) {
        _qualifiedPaths[i] = qualifiedPaths[i].toString();
      }
      const results = [];
      function _require(result) {
        results.push(result);
        if (qualifiedPaths.length > 0) {
          requireRelative(basePath, qualifiedPaths.shift(), _require);
        } else {
          continuation.apply(this, results);
        }
      }
      for (var i = 0, ii = qualifiedPaths.length; i < ii; i++) {
        requireRelative(basePath, _qualifiedPaths[i], _require);
      }
    }
  }

  var requireRelativeTo = function (basePath) {
    basePath = basePath.replace(/[^\/]+$/, '');
    function require(qualifiedPath, continuation) {
      if (arguments.length > 2) {
        const qualifiedPaths = Array.prototype.slice.call(arguments, 0, -1);
        var continuation = arguments[arguments.length - 1];
        return requireRelativeN(basePath, qualifiedPaths, continuation);
      } else {
        return requireRelative(basePath, qualifiedPath, continuation);
      }
    }
    require.main = main;

    return require;
  };

  var rootRequire = requireRelativeTo('/');

  /* Private internals */
  rootRequire._modules = modules;
  rootRequire._definitions = definitions;
  rootRequire._designatedRequire = _designatedRequire;
  rootRequire._compileFunction = _compileFunction;

  /* Public interface */
  rootRequire.define = define;
  rootRequire.setRequestMaximum = setRequestMaximum;
  rootRequire.setGlobalKeyPath = setGlobalKeyPath;
  rootRequire.setRootURI = setRootURI;
  rootRequire.setLibraryURI = setLibraryURI;
  rootRequire.setLibraryLookupComponent = setLibraryLookupComponent;

  return rootRequire;
}()); /* eslint-enable strict */
