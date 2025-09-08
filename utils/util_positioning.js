var OPENMEMORY_UI = (typeof OPENMEMORY_UI != 'undefined') ? OPENMEMORY_UI : {}; 

(function(ns) {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function watchForRemoval(node, onGone) {
        var obs = new MutationObserver(function () {
            if (!document.contains(node)) {
                try { obs.disconnect(); } catch(_) {} 
                onGone(); 
            }
        }); 
        obs.observe(document.documentElement, { childList: true, subtree: true }); 
        return obs; 
    }

    function watchSpaNavigation(callback, intervalMs) {
        intervalMs = typeof intervalMs === 'number' ? intervalMs : 500; 
        var href = location.href; 
        var i = setInterval(function () {
            if (location.href !== href) {
                href = location.href; 
                callback(); 
            }
        }, intervalMs); 
        window.addEventListener('popstate', callback); 
        var push = history.pushState; 
        var rep = history.replaceState; 
        history.pushState = function() { var r = push.apply(this, arguments); callback(); return r; }
        history.replaceState = function() { var r = rep.apply(this, arguments); callback(); return r; }
        return function () {
            clearInterval(i); 
            window.removeEventListener('popstate', callback); 
            history.pushState = push; 
            history.replaceState = rep; 
        }; 
    }

    ns.createShadowRootHost = function (className) {
        className = className || 'mem0-root'; 
        var host = document.createElement('div'); 
        host.className = className; 
        var shadow = host.attachShadow({ mode: 'open' }); 
        return { host: host, shadow: shadow }; 
    }

    ns.findAnchor = async function (candidates, timeoutMs, pollMs) {
        candidates = candidates || []; 
        timeoutMs = (typeof timeoutMs === 'number') ? timeoutMs : 2000; 
        pollMs = (typeof pollMs === 'number') ? pollMs : 250; 
        var deadline = Date.now() + timeoutMs; 

        while (Date.now() < deadline) {
            for (var i = 0; i < candidates.length; i++) {
                var cand = candidates[i]; 
                var el = null; 
                if (typeof cand === 'string') el = document.querySelector(cand); 
                else if (cand && typeof cand.find === 'function') el = cand.find(); 
                if (el) return el; 
            }
            await sleep(pollMs); 
        }
        return null; 
    }

    ns.applyPlacement = function (opts) {
        var container = opts.container; 
        var anchor = opts.anchor; 
        var p = opts.placement || {}; 

        if (!anchor) { document.body.appendChild(container); return function () {}; }

        switch (p.strategy) { 
            case 'inline': {
                var where = p.where || 'beforeend'; 
                anchor.insertAdjacentElement(where, container); 
                if (p.inlineAlign === 'end') container.style.marginLeft = 'auto'; 
                if (p.inlineClass) container.classList.add(p.inlineClass); 
                return function () {}; 
            }

            case 'dock': {
                var host = p.container
                    ? (typeof p.container === 'string' ? (anchor.closest(p.container) || anchor): p.container)
                    : anchor; 

                if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; 
                var side = p.side || 'bottom'; 
                var align = p.align || 'start'; 
                var gap = (p.gap != null) ? p.gap : 8; 

                var cs = container.style; 
                cs.position = 'absolute'; 
                cs.zIndex = '2147483647'; 

                function layout() {
                    host.getBoundingClientRect(); 
                    if (side === 'top')    { cs.top = (-container.offsetHeight - gap) + 'px'; cs.bottom = ''; }
                    if (side === 'bottom') { cs.top = (host.offsetHeight + gap) + 'px'; cs.bottom = ''; }
                    if (side === 'left')   { cs.left = (-container.offsetWidth - gap) + 'px'; cs.right = ''; cs.top = ''; }
                    if (side === 'right')  { cs.left = (host.offsetWidth + gap) + 'px'; cs.right = ''; cs.top = ''; }

                    var a = { start: '0px', center: '50%', end: '100%' }[align];
                    if (side === 'top' || side === 'bottom') {
                        cs.left = a; cs.transform = (align === 'center') ? 'translateX(-50%)' : '';
                    } else {
                        cs.top = a; cs.transform = (align === 'center') ? 'translateY(-50%)' : '';
                    }
                }

                host.appendChild(container);
                layout();
                var ro = new ResizeObserver(layout);
                ro.observe(host);
                var on = function () { layout(); };
                window.addEventListener('scroll', on, true);
                window.addEventListener('resize', on);
                return function () {
                    ro.disconnect();
                    window.removeEventListener('scroll', on, true);
                    window.removeEventListener('resize', on);
                };
            }

            case 'float': {
                var gap2 = (p.gap != null) ? p.gap : 8;
                function position() {
                    var r = anchor.getBoundingClientRect();
                    var cs2 = container.style;
                    cs2.position = 'fixed';
                    cs2.zIndex = '2147483647';
                    var parts = (p.placement || 'right-start').split('-');
                    var side2 = parts[0], align2 = parts[1] || 'start';
                    var set = function (x, y) { cs2.left = x + 'px'; cs2.top = y + 'px'; };
                    var y = { start: r.top, center: r.top + r.height / 2, end: r.bottom };
                    var x = { start: r.left, center: r.left + r.width / 2, end: r.right };
                    if (side2 === 'right') set(r.right + gap2, y[align2] || r.top);
                    if (side2 === 'left')  set(r.left - container.offsetWidth - gap2, y[align2] || r.top);
                    if (side2 === 'bottom') set(x[align2] || r.left, r.bottom + gap2);
                    if (side2 === 'top')    set(x[align2] || r.left, r.top - container.offsetHeight - gap2);
                }
                document.body.appendChild(container);
                position();
                var on2 = function () { position(); };
                window.addEventListener('scroll', on2, true);
                window.addEventListener('resize', on2);
                var ro2 = new ResizeObserver(on2); ro2.observe(anchor);
                return function () {
                    window.removeEventListener('scroll', on2, true);
                    window.removeEventListener('resize', on2);
                    ro2.disconnect();
                };
            }
            default: 
                anchor.appendChild(container); 
                return function () {}; 
        }
    };
    
    function validateCachedAnchor(sel, editor) {
        var el = sel ? document.querySelector(sel) : null; 
        if (!el || !el.isConnected || !document.contains(el)) return { ok: false, reason: 'missing' }; 
        // If an editor is provided, ensure relationship; otherwise skip relation check (useful on refresh before focus)
        if (editor && !(el === editor || el.contains(editor) || editor.contains(el))) return { ok:false, reason: 'mismatch'}; 
        var r = el.getBoundingClientRect(); 
        if ((r.width === 0 && r.height === 0)) return { ok: false, reason: 'invisible'}; 
        return { ok: true, el: el }; 
    }

    function selectorFor(el) {
        if (!el) return ''; 
        if (el.id) return '#' + el.id; 
        var tag = (el.tagName || '').toLowerCase(); 
        var cls = (el.className && typeof el.className === 'string')
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : ''; 
        var s = tag + cls; 
        var p = el.parentElement; 
        if (p && p.id) return "#" + p.id + " > " + s; 
        return s; 
    }

    function keyFor(opts) { return 'mem0_anchor_hint:' + (opts.learnKey || (location.host + ':' + location.pathname)); }
    function now() { return Date.now(); }
    function ver() { try { return chrome.runtime.getManifest().version; } catch(_) { return '0'; } }

    function getSession(k) { return new Promise(function(r){ try { chrome.storage.session.get(k, function(o){ r(o && o[k]); }); } catch(_) { r(null); } }); }
    function setSession(k,v){ return new Promise(function(r){ try { var o={}; o[k]=v; chrome.storage.session.set(o, r); } catch(_) { r(); } }); }
    function getLocal(k)  { return new Promise(function(r){ try { chrome.storage.local.get(k, function(o){ r(o && o[k]); }); } catch(_) { r(null); } }); }
    function setLocal(k,v){ return new Promise(function(r){ try { var o={}; o[k]=v; chrome.storage.local.set(o, r); } catch(_) { r(); } }); }
    function delLocal(k)  { return new Promise(function(r){ try { chrome.storage.local.remove(k, r); } catch(_) { r(); } }); }

    ns.resolveCachedAnchor = async function(opts, editor, ttlMs) {
        var k = keyFor(opts); 
        ttlMs = (typeof ttlMs === 'number') ? ttlMs : 24*60*60*1000; 

        var hint = await getSession(k); 
        if (hint && hint.sel) {
            var v = validateCachedAnchor(hint.sel, editor); 
            if (v.ok) return { el: v.el, placement: hint.placement }; 
        }

        hint = await getLocal(k); 
        if (hint && hint.sel && hint.ver === ver() && (now()-hint.ts) < ttlMs) {
            var v2 = validateCachedAnchor(hint.sel, editor); 
            if (v2.ok) return { el: v2.el, placement: hint.placement }; 
        } else if (hint) { 
            await delLocal(k); 
        }

        return null; 
    }

    ns.saveAnchorHint = async function(opts, anchorEl, placement, persist) { 
        var k = keyFor(opts); 
        var hint = { sel: selectorFor(anchorEl), placement: placement || null, ts: now(), ver: ver() }; 
        await setSession(k, hint); 
        if (persist) await setLocal(k, hint); 
    }

    ns.mountResilient = function (opts) {
        var cleanup = null; 
        var stopSpa = null; 
        var removal = null; 
        var host = null; 

        async function bootstrap() {
            try {
                if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
                if (removal) { try {removal.disconnect(); } catch (_) {} removal = null; }
                if (host && host.isConnected) host.remove(); 
                host = null; 

                var anchor = await ns.findAnchor(opts.anchors || [], opts.timeoutMs || 2000, opts.pollMs || 200); 
                var hs = ns.createShadowRootHost('mem0-root'); 
                host = hs.host; 
                var shadow = hs.shadow; 

                var unplace = function () {}; 
                if (anchor) {
                    unplace = ns.applyPlacement({ container: host, anchor: anchor, placement: opts.placement }); 
                } else if (opts.enableFloatingFallback) {
                    Object.assign(host.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647' }); 
                    document.body.appendChild(host); 
                } else {
                    return; 
                }

                var maybeCleanup = (typeof opts.render === 'function') ? opts.render(shadow, host, anchor) : null; 
                if (typeof maybeCleanup === 'function') cleanup = maybeCleanup; 

                var watchNode = anchor || host; 
                removal = watchForRemoval(watchNode, function () {
                    try { unplace(); } catch (_) {}
                    if (cleanup) try { cleanup(); } catch(_) {}
                    bootstrap();  
                }); 

                if (!stopSpa) stopSpa = watchSpaNavigation(function () { bootstrap(); });
            } catch (_) {
                setTimeout(function () { bootstrap(); }, 1500)
            }
        }

        bootstrap(); 

        return function () {
            if (cleanup) cleanup(); 
            if (stopSpa) stopSpa(); 
            if (removal) removal.disconnect(); 
            if (host && host.isConnected) host.remove(); 
        }; 
    }; 

    ns.mountOnEditorFocus = function(opts) {
        var used = false;
        var editorSelector = opts.editorSelector || 'textarea, [contenteditable="true"], input[type="text"]';
        var deriveAnchor = opts.deriveAnchor || function (editor) { return editor.closest('form') || editor.parentElement; };
        var guardSelector = (opts && opts.existingHostSelector) || '#mem0-icon-button, .mem0-root';

        function handleIntent(e) {
            if (used) return;
            try { if (guardSelector && document.querySelector(guardSelector)) return; } catch (_) {}
            var t = e.target;
            if (!t || !(t.matches && t.matches(editorSelector))) return;

            used = true;

            Promise.resolve()
                .then(function(){ return ns.resolveCachedAnchor(opts, t, opts.cacheTtlMs); })
                .then(async function(hit){
                    var anchor = hit && hit.el ? hit.el : deriveAnchor(t);
                    var placement = (hit && hit.placement) ? hit.placement : (opts.placement || { strategy: 'inline' });

                    if (!anchor && typeof opts.fallback === 'function') {
                        used = false;
                        return opts.fallback();
                    }
                    if (!anchor) { used = false; return; }

                    var hs = ns.createShadowRootHost('mem0-root');
                    var host = hs.host, shadow = hs.shadow;

                    var unplace = ns.applyPlacement({ container: host, anchor: anchor, placement: placement });
                    var cleanup = (typeof opts.render === 'function') ? opts.render(shadow, host, anchor) : null;

                    if (!hit || !hit.el) {
                        try { await ns.saveAnchorHint(opts, anchor, placement, opts.persistCache); } catch(_) {}
                    }

                    var removal = new MutationObserver(function () {
                        if (!document.contains(anchor) || !document.contains(host)) {
                            try { unplace(); } catch(_) {}
                            if (cleanup) try { cleanup(); } catch(_) {}
                            try { removal.disconnect(); } catch(_) {}
                            used = false;
                        }
                    });
                    removal.observe(document.documentElement, { childList: true, subtree: true });
                })
                .catch(function(){ used = false; });
        }

        window.addEventListener('focusin', handleIntent, true);
        window.addEventListener('keydown', handleIntent, true);
        window.addEventListener('pointerdown', handleIntent, true);

        return function stop() {
            window.removeEventListener('focusin', handleIntent, true);
            window.removeEventListener('keydown', handleIntent, true);
            window.removeEventListener('pointerdown', handleIntent, true);
        };
    };


})(OPENMEMORY_UI); 