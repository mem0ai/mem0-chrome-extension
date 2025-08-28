(function () {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type == "mem0:getSelectionContext") {
            try {
                const payload = {
                    selectionText: getSelectedText(),
                    pageTitle: document.title || "",
                    pageUrl: location.href
                };
                sendResponse({ type: "mem0:selectionContext", payload });
            } catch (e) {
                sendResponse({ type: "mem0:selectionContext", error: String(e) });
            }
            return true;
        }

        if (msg && msg.type === "mem0:toast") {
            const { message, variant = "success"} = msg.payload || {}; 
            showToast(message || "", variant); 
        }
    }); 

    function getSelectedText() {
        try {
            const sel = window.getSelection && window.getSelection(); 
            const text = sel ? sel.toString().trim() : ""; 
            return text; 
        } catch {
            return ""; 
        }
    }

    function showToast(message, variant) {
        try {
          const id = "mem0-context-toast";
          const existing = document.getElementById(id);
          if (existing) existing.remove();
    
          const el = document.createElement("div");
          el.id = id;
          el.textContent = message;
          el.style.cssText = `
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            background: ${variant === "error" ? "#7f1d1d" : "#14532d"};
            color: #fff;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 13px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.25);
            max-width: 360px;
          `;
          document.body.appendChild(el);
          setTimeout(() => { el.remove(); }, 2200);
        } catch {
          // no-op
        }
    }
})();