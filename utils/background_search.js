var OPENMEMORY_SEARCH = (typeof OPENMEMORY_SEARCH != 'undefined') ? OPENMEMORY_SEARCH: {}; 

OPENMEMORY_SEARCH.normalizeQuery = function (s) {
    if (!s) return ""; 
    return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); 
}; 

OPENMEMORY_SEARCH.createOrchestrator = function (options) {
    var fetchFn = options && options.fetch
    if (typeof fetchFn !== 'function') {
        throw new Error("OPENMEMORY_SEARCH.createOrchestrator requires options.fetch(query, { signal })");
    }

    var onStart = options.onStart || function () {}; 
    var onSuccess = options.onSuccess || function () {}; 
    var onError = options.onError || function () {}; 
    var onFinally = options.onFinally || function () {}; 

    var minLength = typeof options.minLength === 'number' ? options.minLength : 3; 
    var debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs: 300; 
    var cacheTTL = typeof options.cacheTTL === 'number' ? options.cacheTTL: 60000;
    var useCache = options.useCache !== false; 
    var refreshOnCache = !!options.refreshOnCache;  

    var latestText = ""; 
    var lastCompletedQuery = ""; 
    var lastResult = null; 

    var inFlightQuery = null; 
    var abortController = null; 

    var timerId = null; 
    var seq = 0; 

    var cache = new Map(); 

    function getState() {
        return {
            latestText: latestText, 
            lastCompletedQuery: lastCompletedQuery, 
            lastResult: lastResult, 
            inFlightQuery: inFlightQuery, 
            isInFlight: !!inFlightQuery, 
            cacheSize: cache.size
        }
    }

    function setOptions(newOpts) {
        if (!newOpts) return;
        if (typeof newOpts.minLength === 'number') minLength = newOpts.minLength;
        if (typeof newOpts.debounceMs === 'number') debounceMs = newOpts.debounceMs;
        if (typeof newOpts.cacheTTL === 'number') cacheTTL = newOpts.cacheTTL;
        if (typeof newOpts.useCache === 'boolean') useCache = newOpts.useCache;
        if (typeof newOpts.refreshOnCache === 'boolean') refreshOnCache = newOpts.refreshOnCache;
    }

    function clearTimer() {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
    }

    function clearCache() {
        cache.clear();
    }

    function getCached(normQuery) {
        if (!useCache) return null; 
        var v = cache.get(normQuery); 
        if (!v) return null; 
        if (Date.now() - v.ts > cacheTTL) {
            cache.delete(normQuery); 
            return null; 
        }
        return v.result; 
    }

    function setCached(normQuery, result) { 
        cache.set(normQuery, { ts: Date.now(), result: result }); 
    }

    function cancel() {
        clearTimer(); 
        if (abortController) {
            try { abortController.abort(); } catch (_) {}
        }
        inFlightQuery = null; 
        abortController = null; 
    }

    function run(query) {
        var raw = ( query != null ) ? String(query): latestText; 
        var norm = OPENMEMORY_SEARCH.normalizeQuery(raw); 
        if (!norm || norm.length < minLength) return; 

        var cached = getCached(norm); 
        if (cached) {
            onSuccess(norm, cached, { fromCache: true }); 
            if (!refreshOnCache) return; 
        }

        if (inFlightQuery && inFlightQuery === norm) return; 
        if (inFlightQuery && inFlightQuery !== norm && abortController) {
            try { abortController.abort(); } catch (_) {}
        }

        inFlightQuery = norm; 
        abortController = (typeof AbortController != 'undefined') ? new AbortController() : null;
        var mySeq = ++seq; 
        
        onStart(norm); 

        Promise.resolve()
            .then(function() {
                return fetchFn(norm, { signal: abortController ? abortController.signal : undefined }); 
            })
            .then(function (result) {
                if (inFlightQuery !== norm || mySeq != seq) return; 

                setCached(norm, result); 
                lastCompletedQuery = norm; 
                lastResult = result; 
                onSuccess(norm, result, { fromCache: false }); 
            })
            .catch(function (err) {
                var aborted = (abortController && abortController.signal && abortController.signal.aborted) || (err && err.name === 'AbortError'); 
                if (mySeq !== seq) return; 
                if (!aborted) {
                    onError(norm, err); 
                }
            })
            .finally(function() {
                if (mySeq !== seq) return; 
                inFlightQuery = null; 
                abortController = null; 
                onFinally(norm); 
            }); 
    }

    function schedule() {
        clearTimer(); 
        if (!latestText || OPENMEMORY_SEARCH.normalizeQuery(latestText).length < minLength) return; 
        timerId = setTimeout(function () {
            timerId = null;
            run(latestText);
        }, debounceMs);
    }

    return {
        setText: function (text) {
          latestText = (text == null) ? "" : String(text);
          schedule();
        },
        runImmediate: function (text) {
          if (text != null) latestText = String(text);
          clearTimer();
          run(latestText);
        },
        cancel: cancel,
        getState: getState,
        setOptions: setOptions,
        clearCache: clearCache
    };
}