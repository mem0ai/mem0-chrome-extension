(function () {
  let sidebarVisible = false;

  function initializeMem0Sidebar() {
    // Listen for messages from the extension
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "toggleSidebar") {
        chrome.storage.sync.get(["apiKey", "access_token"], function (data) {
          if (data.apiKey || data.access_token) {
            toggleSidebar();
          } else {
            chrome.runtime.sendMessage({ action: "openPopup" });
          }
        });
      }
    });
  }

  function toggleSidebar() {
    let sidebar = document.getElementById("mem0-sidebar");
    if (sidebar) {
      // If sidebar exists, toggle its visibility
      sidebarVisible = !sidebarVisible;
      sidebar.style.right = sidebarVisible ? "0px" : "-600px";

      // Add or remove click listener based on sidebar visibility
      if (sidebarVisible) {
        document.addEventListener("click", handleOutsideClick);
        document.addEventListener("keydown", handleEscapeKey);
        fetchMemoriesAndCount();
      } else {
        document.removeEventListener("click", handleOutsideClick);
        document.removeEventListener("keydown", handleEscapeKey);
      }
    } else {
      // If sidebar doesn't exist, create it
      createSidebar();
      sidebarVisible = true;
      document.addEventListener("click", handleOutsideClick);
      document.addEventListener("keydown", handleEscapeKey);
    }
  }

  function handleEscapeKey(event) {
    if (event.key === "Escape") {
      const searchInput = document.querySelector(".search-memory");

      if (searchInput) {
        closeSearchInput();
      } else {
        toggleSidebar();
      }
    }
  }

  function handleOutsideClick(event) {
    let sidebar = document.getElementById("mem0-sidebar");
    if (
      sidebar &&
      !sidebar.contains(event.target) &&
      !event.target.closest(".mem0-toggle-btn")
    ) {
      toggleSidebar();
    }
  }

  function createSidebar() {
    if (document.getElementById("mem0-sidebar")) {
      return;
    }

    const sidebarContainer = document.createElement("div");
    sidebarContainer.id = "mem0-sidebar";

    // Create fixed header
    const fixedHeader = document.createElement("div");
    fixedHeader.className = "fixed-header";
    fixedHeader.innerHTML = `
        <div class="header">
          <div class="logo-container">
            <img src=${chrome.runtime.getURL("icons/mem0-claude-icon.png")} class="openmemory-icon" alt="OpenMemory Logo">
            <span class="openmemory-logo">OpenMemory</span>
          </div>
          <div class="header-buttons">
            <button id="closeBtn" class="close-button" title="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      `;

    // Create a container for search inputs
    const inputContainer = document.createElement("div");
    inputContainer.className = "input-container";
    fixedHeader.appendChild(inputContainer);

    sidebarContainer.appendChild(fixedHeader);

    // Create content container
    const contentContainer = document.createElement("div");
    contentContainer.className = "content";
    
    // Create memory count display
    const memoryCountContainer = document.createElement("div");
    memoryCountContainer.className = "total-memories";
    memoryCountContainer.innerHTML = `
      <div class="total-memories-content">
        <div>
          <p class="total-memories-label">Total Memories</p>
          <h3 class="memory-count loading">Loading...</h3>
        </div>
        <button id="openDashboardBtn" class="dashboard-button">
          Open Dashboard
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="external-link-icon">
            <path d="M7 17L17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 7H17V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
    contentContainer.appendChild(memoryCountContainer);

    // Create toggle section with section header and description
    const toggleSection = document.createElement("div");
    toggleSection.className = "section";
    toggleSection.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Memory Suggestions</h2>
        <label class="switch">
          <input type="checkbox" id="mem0Toggle">
          <span class="slider"></span>
        </label>
      </div>
      <p class="section-description">Get relevant memories suggested while interacting with AI Agents</p>
    `;
    contentContainer.appendChild(toggleSection);
    
    // Add memories section
    const memoriesSection = document.createElement("div");
    memoriesSection.className = "section";
    memoriesSection.innerHTML = `
      <h2 class="section-title">Recent Memories</h2>
      <div class="memory-cards">
        <div class="memory-loader">
          <div class="loader"></div>
        </div>
      </div>
    `;
    contentContainer.appendChild(memoriesSection);
    
    sidebarContainer.appendChild(contentContainer);

    // Create footer with shortcut and logout
    const footerToggle = document.createElement("div");
    footerToggle.className = "footer";
    footerToggle.innerHTML = `
      <div class="shortcut">Shortcut : ^ + M</div>
      <button id="logoutBtn" class="logout-button"><span>Logout</span></button>
    `;
    
    chrome.storage.sync.get(["memory_enabled"], function (result) {
      const toggleCheckbox = toggleSection.querySelector("#mem0Toggle");
      toggleCheckbox.checked = result.memory_enabled !== false;
    });
    
    sidebarContainer.appendChild(footerToggle);

    // Add event listener for the close button
    const closeBtn = fixedHeader.querySelector("#closeBtn");
    closeBtn.addEventListener("click", toggleSidebar);

    // Add event listeners for dashboard and logout
    const openDashboardBtn = memoryCountContainer.querySelector("#openDashboardBtn");
    openDashboardBtn.addEventListener("click", openDashboard);

    const logoutBtn = footerToggle.querySelector("#logoutBtn");
    logoutBtn.addEventListener("click", logout);

    // Add event listener for the toggle
    const toggleCheckbox = toggleSection.querySelector("#mem0Toggle");
    toggleCheckbox.addEventListener("change", function () {
      // Send toggle event to API
      chrome.storage.sync.get(["memory_enabled", "apiKey", "access_token"], function (data) {
        const headers = getHeaders(data.apiKey, data.access_token);
        fetch(`https://api.mem0.ai/v1/extension/`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            event_type: "extension_toggle_button",
            additional_data: { "status": toggleCheckbox.checked },
          }),
        }).catch(error => {
          console.error("Error sending toggle event:", error);
        });
      });
      chrome.runtime.sendMessage({
        action: "toggleMem0",
        enabled: this.checked,
      });
      // Update the memory_enabled state when the toggle changes
      chrome.storage.sync.set({ memory_enabled: this.checked });
    });

    document.body.appendChild(sidebarContainer);

    // Slide in the sidebar immediately after creation
    setTimeout(() => {
      sidebarContainer.style.right = "0";
    }, 0);

    // Prevent clicks within the sidebar from closing it
    sidebarContainer.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    // Add styles
    addStyles();
    
    // Fetch memories and count
    fetchMemoriesAndCount();
  }

  function fetchMemoriesAndCount() {
    chrome.storage.sync.get(
      ["apiKey", "userId", "access_token"],
      function (data) {
        if (data.apiKey || data.access_token) {
          const headers = getHeaders(data.apiKey, data.access_token);
          const userId = "chrome-extension-user";
          fetch(`https://api.mem0.ai/v1/memories/?user_id=${userId}&page=1&page_size=20`, {
            method: "GET",
            headers: headers,
          })
            .then((response) => response.json())
            .then((data) => {
              // Update count and display memories
              updateMemoryCount(data.count || 0);
              displayMemories(data.results || []);
            })
            .catch((error) => {
              console.error("Error fetching memories:", error);
              updateMemoryCount("Error");
              displayErrorMessage();
            });
        } else {
          updateMemoryCount("Login required");
          displayErrorMessage("Login required to view memories");
        }
      }
    );
  }

  function updateMemoryCount(count) {
    const countDisplay = document.querySelector(".memory-count");
    if (countDisplay) {
      countDisplay.classList.remove("loading");
      countDisplay.textContent = typeof count === 'number' ? 
        new Intl.NumberFormat().format(count) + " Memories" : 
        count;
    }
  }

  function getHeaders(apiKey, accessToken) {
    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Token ${apiKey}`;
    } else if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    return headers;
  }

  function closeSearchInput() {
    const inputContainer = document.querySelector(".input-container");
    const existingSearchInput = inputContainer.querySelector(".search-memory");
    const searchBtn = document.getElementById("searchBtn");

    if (existingSearchInput) {
      existingSearchInput.remove();
      searchBtn.classList.remove("active");
      // Remove filter when search is closed
      filterMemories("");
    }
  }

  function filterMemories(searchTerm) {
    const memoryItems = document.querySelectorAll(".memory-item");

    memoryItems.forEach((item) => {
      const memoryText = item
        .querySelector(".memory-text")
        .textContent.toLowerCase();
      if (memoryText.includes(searchTerm)) {
        item.style.display = "flex";
      } else {
        item.style.display = "none";
      }
    });

    // Add this line to maintain the width of the sidebar
    document.getElementById("mem0-sidebar").style.width = "400px";
  }

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        :root {
          --bg-dark: #18181b;
          --bg-card: #27272a;
          --bg-button: #3b3b3f;
          --bg-button-hover: #4b4b4f;
          --text-white: #ffffff;
          --text-gray: #a1a1aa;
          --purple: #7a5bf7;
          --border-color: #27272a;
          --tag-bg: #3b3b3f;
          --scrollbar-bg: #18181b;
          --scrollbar-thumb: #3b3b3f;
          --success-color: #22c55e;
        }
        
        #mem0-sidebar {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          position: fixed; 
          top: 60px;
          right: 50px;
          width: 400px;
          height: auto;
          max-height: 85vh;
          background: var(--bg-dark);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          padding: 0px;
          color: var(--text-white);
          z-index: 2147483647;
          transition: right 0.3s ease-in-out;
          overflow: hidden;
          box-shadow: 0px 4px 20px rgba(0, 0, 0, 0.5);
        }
        
        .fixed-header {
          box-sizing: border-box;
          width: 100%;
          background: var(--bg-dark);
          border-bottom: 1px solid var(--border-color);
        }
        
        .header {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          width: 100%;
          height: 62px;
        }
        
        .logo-container {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 0px;
          gap: 8px;
          height: 24px;
        }
        
        .openmemory-icon {
          width: 24px;
          height: 24px;
        }
        
        .openmemory-logo {
          height: 24px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-style: normal;
          font-weight: 600;
          font-size: 20px;
          line-height: 24px;
          letter-spacing: -0.03em;
          color: var(--text-white);
        }
        
        .header-buttons {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 0px;
          gap: 16px;
          height: 30px;
        }
        
        .close-button {
          background: none;
          border: none;
          width: 24px;
          height: 24px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-gray);
          font-size: 20px;
          transition: color 0.2s ease;
        }
        
        .close-button:hover {
          color: var(--text-white);
        }
        
        /* Custom scrollbar styles */
        .content {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          overflow-y: auto;
          max-height: calc(85vh - 62px - 60px); /* Subtract header and footer heights */
          
          /* Firefox */
          scrollbar-width: thin;
          scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-bg);
        }
        
        /* WebKit browsers (Chrome, Safari, Edge) */
        .content::-webkit-scrollbar {
          width: 4px;
        }
        
        .content::-webkit-scrollbar-track {
          background: var(--scrollbar-bg);
        }
        
        .content::-webkit-scrollbar-thumb {
          background-color: var(--scrollbar-thumb);
          border-radius: 4px;
          border: none;
        }
        
        .total-memories {
          background-color: var(--bg-card);
          border-radius: 8px;
          padding: 16px;
        }
        
        .total-memories-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .total-memories-label {
          color: var(--text-gray);
          font-size: 14px;
          margin-bottom: 4px;
        }
        
        .memory-count {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-style: normal;
          font-weight: 500;
          font-size: 18px;
          line-height: 140%;
          letter-spacing: -0.03em;
          color: var(--text-white);
        }
        
        .memory-count.loading {
          color: var(--text-gray);
          font-size: 16px;
        }
        
        .dashboard-button {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 4px 8px;
          gap: 4px;
          background: var(--bg-button);
          background-opacity: 0.5;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          color: var(--text-white);
          font-size: 14px;
        }
        
        .dashboard-button:hover {
          background: var(--bg-button-hover);
        }
        
        .external-link-icon {
          width: 14px;
          height: 14px;
        }
        
        .section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
        }
        
        .section-title {
          font-size: 18px;
          font-weight: 500;
          color: var(--text-white);
        }
        
        .section-description {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-style: normal;
          font-weight: 400;
          font-size: 14px;
          line-height: 140%;
          letter-spacing: -0.03em;
          color: var(--text-gray);
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 22px;
        }
        
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--bg-card);
          transition: .4s;
          border-radius: 34px;
        }
        
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 2px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        
        input:checked + .slider {
          background-color: var(--purple);
        }
        
        input:focus + .slider {
          box-shadow: 0 0 1px var(--purple);
        }
        
        input:checked + .slider:before {
          transform: translateX(20px);
        }
        
        .memory-cards {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .memory-card {
          background-color: var(--bg-card);
          border-radius: 8px;
          padding: 12px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        
        .memory-content {
          flex: 1;
          padding-right: 8px;
        }
        
        .memory-text {
          color: var(--text-gray);
          font-size: 14px;
          margin: 0 0 8px 0;
        }
        
        .memory-categories {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        
        .memory-category {
          background-color: var(--tag-bg);
          color: var(--text-white);
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
        }
        
        .memory-actions {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
        }
        
        .memory-action-button {
          background: none;
          border: none;
          color: var(--text-gray);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s;
          width: 24px;
          height: 24px;
          border-radius: 4px;
        }
        
        .memory-action-button:hover {
          color: var(--text-white);
          background-color: var(--bg-button);
        }
        
        .memory-action-button.copied {
          color: var(--success-color);
        }
        
        .memory-loader {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px 0;
        }
        
        .no-memories, .memory-error {
          color: var(--text-gray);
          text-align: center;
          font-style: italic;
          padding: 20px 0;
        }
        
        .footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-top: 1px solid var(--border-color);
        }
        
        .shortcut {
          padding: 6px 12px;
          background-color: var(--bg-card);
          color: var(--text-gray);
          border-radius: 8px;
          font-size: 14px;
        }
        
        .logout-button {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 6px 16px;
          background: var(--bg-button);
          border-radius: 8px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          color: var(--text-white);
          font-size: 14px;
        }
        
        .logout-button:hover {
          background: var(--bg-button-hover);
        }
        
        .loader {
          border: 2px solid var(--bg-button);
          border-top: 2px solid var(--purple);
          border-radius: 50%;
          width: 20px;
          height: 20px;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .input-container {
          width: 100%;
          padding: 0;
          box-sizing: border-box;
        }
        
        .search-memory {
          width: 100%;
          box-sizing: border-box;
          margin-top: 16px;
        }
    `;
    document.head.appendChild(style);
  }

  function logout() {
    chrome.storage.sync.get(["apiKey", "access_token"], function (data) {
      const headers = getHeaders(data.apiKey, data.access_token);
      fetch("https://api.mem0.ai/v1/extension/", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          event_type: "extension_logout"
        })
      }).catch(error => {
        console.error("Error sending logout event:", error);
      });
    });
    chrome.storage.sync.remove(
      ["apiKey", "userId", "access_token"],
      function () {
        const sidebar = document.getElementById("mem0-sidebar");
        if (sidebar) {
          sidebar.style.right = "-500px";
        }
      }
    );
  }

  function openDashboard() {
    chrome.storage.sync.get(["userId"], function (data) {
      const userId = "chrome-extension-user";
      chrome.runtime.sendMessage({
        action: "openDashboard",
        url: `https://app.mem0.ai/dashboard/requests`,
      });
    });
  }

  // Add function to display memories
  function displayMemories(memories) {
    const memoryCardsContainer = document.querySelector(".memory-cards");
    
    if (!memoryCardsContainer) return;
    
    // Clear loading indicator
    memoryCardsContainer.innerHTML = '';
    
    if (!memories || memories.length === 0) {
      memoryCardsContainer.innerHTML = '<p class="no-memories">No memories found</p>';
      return;
    }
    
    // Add memory cards
    memories.forEach(memory => {
      // Extract memory content from the new format
      const memoryContent = memory.memory || ""; 
      
      // Truncate long text
      const truncatedContent = memoryContent.length > 120 ? 
        memoryContent.substring(0, 120) + '...' : 
        memoryContent;
      
      // Get categories if available
      const categories = memory.categories || [];
      const categoryTags = categories.length > 0 
        ? `<div class="memory-categories">${categories.map(cat => `<span class="memory-category">${cat}</span>`).join('')}</div>` 
        : '';
      
      const memoryCard = document.createElement('div');
      memoryCard.className = 'memory-card';
      memoryCard.innerHTML = `
        <div class="memory-content">
          <p class="memory-text">${truncatedContent}</p>
          ${categoryTags}
        </div>
        <div class="memory-actions">
          <button class="memory-action-button copy-button" title="Copy Memory" data-content="${encodeURIComponent(memoryContent)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
          <button class="memory-action-button view-button" title="View Memory" data-id="${memory.id || ''}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      `;
      
      memoryCardsContainer.appendChild(memoryCard);
    });
    
    // Add event listener for the copy button
    document.querySelectorAll('.copy-button').forEach(button => {
      button.addEventListener('click', function(e) {
        e.stopPropagation();
        const content = decodeURIComponent(this.getAttribute('data-content'));
        
        // Copy to clipboard
        navigator.clipboard.writeText(content)
          .then(() => {
            // Visual feedback for copy
            const originalTitle = this.getAttribute('title');
            this.setAttribute('title', 'Copied!');
            this.classList.add('copied');
            
            // Reset after a short delay
            setTimeout(() => {
              this.setAttribute('title', originalTitle);
              this.classList.remove('copied');
            }, 2000);
          })
          .catch(err => {
            console.error('Failed to copy: ', err);
          });
      });
    });
    
    // Add event listener for the view button
    document.querySelectorAll('.view-button').forEach(button => {
      button.addEventListener('click', function(e) {
        e.stopPropagation();
        const memoryId = this.getAttribute('data-id');
        if (memoryId) {
          chrome.storage.sync.get(["userId"], function (data) {
            const userId = "chrome-extension-user";
            chrome.runtime.sendMessage({
              action: "openDashboard",
              url: `https://app.mem0.ai/dashboard/user/${userId}?memoryId=${memoryId}`,
            });
          });
        }
      });
    });
  }

  // Add function to display error message
  function displayErrorMessage(message = "Error loading memories") {
    const memoryCardsContainer = document.querySelector(".memory-cards");
    
    if (!memoryCardsContainer) return;
    
    memoryCardsContainer.innerHTML = `<p class="memory-error">${message}</p>`;
  }

  // Initialize the listener when the script loads
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeMem0Sidebar);
  } else {
    initializeMem0Sidebar();
  }
})();
