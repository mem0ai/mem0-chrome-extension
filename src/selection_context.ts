import {
  MessageType,
  type SelectionContextMessage,
  type SelectionContextPayload,
  type SendResponse,
  ToastVariant,
} from './types/messages';

(function () {
  chrome.runtime.onMessage.addListener(
    (msg: SelectionContextMessage, _sender, sendResponse: SendResponse) => {
      if (msg && msg.type === MessageType.GET_SELECTION_CONTEXT) {
        try {
          const payload: SelectionContextPayload = {
            selection: getSelectedText(),
            title: document.title || '',
            url: location.href,
          };
          sendResponse({ type: MessageType.SELECTION_CONTEXT, payload });
        } catch (e) {
          sendResponse({ type: MessageType.SELECTION_CONTEXT, error: String(e) });
        }
        return true;
      }

      if (msg && msg.type === MessageType.TOAST) {
        const { message, variant = ToastVariant.SUCCESS } = msg.payload || {};
        showToast(message || '', variant);
      }
    }
  );

  function getSelectedText(): string {
    try {
      const sel = window.getSelection && window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      return text;
    } catch {
      return '';
    }
  }

  function showToast(message: string, variant: ToastVariant = ToastVariant.SUCCESS): void {
    try {
      const id = 'mem0-context-toast';
      const existing = document.getElementById(id);
      if (existing) {
        existing.remove();
      }

      const el = document.createElement('div');
      el.id = id;
      el.textContent = message;
      el.style.cssText = `
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            background: ${variant === ToastVariant.ERROR ? '#7f1d1d' : '#14532d'};
            color: #fff;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 13px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.25);
            max-width: 360px;
          `;
      document.body.appendChild(el);
      setTimeout(() => {
        el.remove();
      }, 2200);
    } catch {
      // no-op
    }
  }
})();
