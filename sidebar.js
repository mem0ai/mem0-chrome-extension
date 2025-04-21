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
        fetchMemoryCount();
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

  // Add this new function
  function handleEscapeKey(event) {
    if (event.key === "Escape") {
      const searchInput = document.querySelector(".search-memory");
      const addInput = document.querySelector(".add-memory");

      if (searchInput) {
        closeSearchInput();
      } else if (addInput) {
        closeAddMemoryInput();
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
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" class="openmemory-icon">
              <path d="M6.02 2.33L6.93 1.42C8.52 -0.16 11.1 -0.16 12.69 1.42C14.28 3.01 14.28 5.59 12.69 7.18L11.78 8.09" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M11.78 9.91L12.69 9C14.28 7.41 14.28 4.83 12.69 3.24" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9.05 12.64L8.14 13.55C6.55 15.14 3.97 15.14 2.38 13.55C0.79 11.96 0.79 9.38 2.38 7.79L3.29 6.88" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.29 4.87L2.38 5.78C0.79 7.37 0.79 9.95 2.38 11.54" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M6.88 6.88L11.79 11.79" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="openmemory-logo">Openmemory</span>
          </div>
          <div class="header-buttons">
            <button id="addMemoryBtn" class="add-new-memory-btn" title="Add New Memory">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="plus-icon">
                <path d="M6 1.5V10.5" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M1.5 6H10.5" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>Add New Memory</span>
            </button>
            <button id="closeBtn" class="close-button" title="Close">
              <span>×</span>
            </button>
          </div>
        </div>
      `;

    // Create a container for search and add inputs
    const inputContainer = document.createElement("div");
    inputContainer.className = "input-container";
    fixedHeader.appendChild(inputContainer);

    sidebarContainer.appendChild(fixedHeader);

    // Create memory count display
    const memoryCountContainer = document.createElement("div");
    memoryCountContainer.className = "memory-count-container";
    memoryCountContainer.innerHTML = `
      <div class="memory-count-display">
        <div class="memory-count-content">
          <div class="memory-count-title">Total Memories</div>
          <div class="memory-count loading">Loading...</div>
        </div>
        <button id="openDashboardBtn" class="dashboard-button">
          <span>Open Dashboard</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="external-link-icon">
            <path d="M9.75 6.375V9.75C9.75 10.1642 9.41421 10.5 9 10.5H2.25C1.83579 10.5 1.5 10.1642 1.5 9.75V3C1.5 2.58579 1.83579 2.25 2.25 2.25H5.625" stroke="#A1A1AA" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7.5 1.5H10.5V4.5" stroke="#A1A1AA" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4.5 7.5L10.5 1.5" stroke="#A1A1AA" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
    sidebarContainer.appendChild(memoryCountContainer);

    // Create toggle section
    const toggleSection = document.createElement("div");
    toggleSection.className = "toggle-section";
    toggleSection.innerHTML = `
      <div class="toggle-label">Show Memory Suggestions</div>
      <label class="switch">
        <input type="checkbox" id="mem0Toggle">
        <span class="slider round"></span>
      </label>
    `;
    sidebarContainer.appendChild(toggleSection);

    // Create footer with shortcut and logout
    const footerToggle = document.createElement("div");
    footerToggle.className = "footer-toggle";
    footerToggle.innerHTML = `
      <div class="shortcut-text"><span>Shortcut : ^ + M</span></div>
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

    // Add event listener for the Add Memory button
    const addMemoryBtn = fixedHeader.querySelector("#addMemoryBtn");
    addMemoryBtn.addEventListener("click", addNewMemory);

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
    
    // Fetch memory count
    fetchMemoryCount();
  }

  function fetchMemoryCount() {
    chrome.storage.sync.get(
      ["apiKey", "userId", "access_token"],
      function (data) {
        if (data.apiKey || data.access_token) {
          const headers = getHeaders(data.apiKey, data.access_token);
          fetch(`https://api.mem0.ai/v1/memories/?user_id=${data.userId}`, {
            method: "GET",
            headers: headers,
          })
            .then((response) => response.json())
            .then((data) => {
              updateMemoryCount(data.length || 0);
            })
            .catch((error) => {
              console.error("Error fetching memory count:", error);
              updateMemoryCount("Error");
            });
        } else {
          updateMemoryCount("Login required");
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

  // Replace fetchAndDisplayMemories with a simplified version that just gets the count
  function fetchAndDisplayMemories() {
    fetchMemoryCount();
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

  // Add this new function to handle adding a new memory
  function addNewMemory() {
    const inputContainer = document.querySelector(".input-container");
    const existingAddInput = inputContainer.querySelector(".add-memory");
    const addMemoryBtn = document.getElementById("addMemoryBtn");

    // Close search input if it's open
    const existingSearchInput = inputContainer.querySelector(".search-memory");
    if (existingSearchInput) {
      closeSearchInput();
    }

    if (existingAddInput) {
      closeAddMemoryInput();
    } else {
      const addMemoryInput = document.createElement("div");
      addMemoryInput.className = "add-memory";
      addMemoryInput.innerHTML = `
        <div class="add-container">
          <textarea class="memory-textarea" placeholder="Write your memory"></textarea>
          <div class="arrow-button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      `;

      inputContainer.appendChild(addMemoryInput);

      const memoryTextarea = addMemoryInput.querySelector(".memory-textarea");
      
      // Focus the add memory input
      memoryTextarea.focus();

      // Add event listener for the textarea
      memoryTextarea.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const newContent = this.value.trim();
          if (newContent) {
            saveNewMemory(newContent, addMemoryInput);
          } else {
            closeAddMemoryInput();
          }
        }
      });

      // Add event listener for the arrow button
      const arrowButton = addMemoryInput.querySelector(".arrow-button");
      arrowButton.addEventListener("click", function() {
        const newContent = memoryTextarea.value.trim();
        if (newContent) {
          saveNewMemory(newContent, addMemoryInput);
        } else {
          closeAddMemoryInput();
        }
      });

      addMemoryBtn.classList.add("active");
    }
  }

  function closeAddMemoryInput() {
    const inputContainer = document.querySelector(".input-container");
    const existingAddInput = inputContainer.querySelector(".add-memory");
    const addMemoryBtn = document.getElementById("addMemoryBtn");

    if (existingAddInput) {
      existingAddInput.remove();
      addMemoryBtn.classList.remove("active");
    }
  }

  function saveNewMemory(newContent, addMemoryInput) {
    chrome.storage.sync.get(
      ["apiKey", "access_token", "userId"],
      function (data) {
        const headers = getHeaders(data.apiKey, data.access_token);

        // Show loading indicator
        addMemoryInput.innerHTML = `
          <div class="loading-indicator" style="width: 100%; display: flex; justify-content: center; align-items: center;">
            <div class="loader"></div>
          </div>
        `;

        // Send add event to API
        fetch(`https://api.mem0.ai/v1/extension/`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ event_type: "extension_add_event" }),
        }).catch(error => {
          console.error("Error sending add event:", error);
        });

        fetch("https://api.mem0.ai/v1/memories/", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            messages: [{ role: "user", content: newContent }],
            user_id: data.userId,
            infer: false,
            metadata: {
              provider: "OpenMemory", // Change provider from Mem0 to OpenMemory
            },
          }),
        })
          .then((response) => response.json())
          .then((data) => {
            addMemoryInput.remove();
            fetchMemoryCount(); // Just update the memory count instead of refreshing all memories
          })
          .catch((error) => {
            console.error("Error adding memory:", error);
            addMemoryInput.remove();
          })
          .finally(() => {
            document.getElementById("addMemoryBtn").classList.remove("active");
          });
      }
    );
  }

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        #mem0-sidebar {
          font-family: 'Inter', sans-serif;
          position: fixed; 
          top: 60px;
          right: -600px;
          width: 500px;
          height: auto;
          background: #18181B;
          border: 1px solid #27272A;
          border-radius: 12px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 0px;
          color: #FFFFFF;
          z-index: 2147483647;
          transition: right 0.3s ease-in-out;
          overflow: hidden;
          box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.25);
        }
        
        .fixed-header {
          box-sizing: border-box;
          width: 100%;
          background: #27272A;
          border-bottom: 1px solid #27272A;
          display: flex;
          flex-direction: column;
          flex: none;
          order: 0;
          align-self: stretch;
          flex-grow: 0;
        }
        
        .header {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
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
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .openmemory-icon {
          width: 18px;
          height: 18px;
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .openmemory-logo {
          height: 24px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 600;
          font-size: 19.5px;
          line-height: 24px;
          letter-spacing: -0.03em;
          color: #FFFFFF;
          flex: none;
          order: 1;
          flex-grow: 0;
        }
        
        .header-buttons {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 0px;
          gap: 16px;
          height: 30px;
          flex: none;
          order: 1;
          flex-grow: 0;
        }
        
        .add-new-memory-btn {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 8px;
          gap: 4px;
          width: 131px;
          height: 30px;
          background: #FFFFFF;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          flex: none;
          order: 0;
          flex-grow: 0;
          transition: all 0.2s ease;
        }
        
        .add-new-memory-btn:hover {
          background: #F4F4F5;
        }
        
        .add-new-memory-btn span {
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          font-size: 12px;
          line-height: 120%;
          letter-spacing: -0.03em;
          color: #000000;
          flex: none;
          order: 1;
          flex-grow: 0;
        }
        
        .plus-icon {
          width: 12px;
          height: 12px;
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .close-button {
          background: none;
          border: none;
          width: 20px;
          height: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #A1A1AA;
          font-size: 20px;
          flex: none;
          order: 1;
          flex-grow: 0;
          transition: color 0.2s ease;
        }
        
        .close-button:hover {
          color: #FFFFFF;
        }
        
        .memory-count-container {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: flex-start;
          padding: 20px 16px;
          gap: 16px;
          width: 100%;
          height: 176px;
          border-bottom: 1px solid #27272A;
          flex: none;
          order: 1;
          align-self: stretch;
          flex-grow: 0;
        }
        
        .memory-count-display {
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding: 12px 13px;
          gap: 5px;
          width: 100%;
          height: 78px;
          background: #27272A;
          border: 1px solid #27272A;
          border-radius: 8px;
          flex: none;
          order: 0;
          align-self: stretch;
          flex-grow: 0;
        }
        
        .memory-count-content {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 0px;
          gap: 4px;
          width: 305px;
          height: 54px;
          flex: none;
          order: 0;
          flex-grow: 1;
        }
        
        .memory-count-title {
          width: 305px;
          height: 22px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          font-size: 16px;
          line-height: 140%;
          letter-spacing: -0.03em;
          color: #71717A;
          flex: none;
          order: 0;
          align-self: stretch;
          flex-grow: 0;
        }
        
        .memory-count {
          width: 305px;
          height: 28px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          font-size: 20px;
          line-height: 140%;
          letter-spacing: -0.03em;
          color: #FFFFFF;
          flex: none;
          order: 1;
          align-self: stretch;
          flex-grow: 0;
        }
        
        .memory-count.loading {
          color: #71717A;
          font-size: 16px;
        }
        
        .dashboard-button {
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 8px 12px;
          gap: 4px;
          width: 132px;
          height: 30px;
          border: 0.91358px solid #3B3B3F;
          border-radius: 8px;
          background: transparent;
          flex: none;
          order: 1;
          flex-grow: 0;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .dashboard-button:hover {
          background: #3B3B3F;
        }
        
        .dashboard-button span {
          width: 92px;
          height: 14px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          font-size: 12px;
          line-height: 120%;
          letter-spacing: -0.03em;
          color: #A1A1AA;
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .dashboard-button:hover span {
          color: #FFFFFF;
        }
        
        .external-link-icon {
          width: 12px;
          height: 12px;
          flex: none;
          order: 1;
          flex-grow: 0;
        }
        
        .dashboard-button:hover .external-link-icon path {
          stroke: #FFFFFF;
        }
        
        .toggle-section {
          display: flex;
          flex-direction: row;
          justify-content: center;
          align-items: center;
          padding: 10px 4px;
          gap: 12px;
          width: 100%;
          height: 42px;
          flex: none;
          order: 1;
          align-self: stretch;
          flex-grow: 0;
          border-bottom: 1px solid #27272A;
        }
        
        .toggle-label {
          width: 408px;
          height: 22px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 600;
          font-size: 16px;
          line-height: 140%;
          letter-spacing: -0.03em;
          color: #FFFFFF;
          flex: none;
          order: 0;
          flex-grow: 1;
        }


        .toggle-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .toggle-text {
          font-size: 12px;
          color: #666;
        }

        
        .toggle-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .toggle-text {
          font-size: 12px;
          color: #666;
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 40px;
          height: 20px;
          flex: none;
          order: 1;
          flex-grow: 0;
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
          background-color: #3B3B3F;
          transition: .4s;
        }
        
        .slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 2px;
          bottom: 2px;
          background-color: white;
          transition: .4s;
        }
        
        input:checked + .slider {
          background-color: #7A5BF7;
        }
        
        input:focus + .slider {
          box-shadow: 0 0 1px #7A5BF7;
        }
        
        input:checked + .slider:before {
          transform: translateX(20px);
        }
        
        .slider.round {
          border-radius: 52px;
        }
        
        .slider.round:before {
          border-radius: 50%;
        }
        
        .footer-toggle {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding: 20px 12px;
          gap: 4px;
          width: 100%;
          height: 70px;
          flex: none;
          order: 2;
          align-self: stretch;
          flex-grow: 0;
        }
        
        .shortcut-text {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 8px 16px;
          gap: 8px;
          width: 118px;
          height: 30px;
          margin: 0 auto;
          border-radius: 8px;
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .shortcut-text span {
          width: 86px;
          height: 14px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          font-size: 12px;
          line-height: 120%;
          letter-spacing: -0.03em;
          color: #A1A1AA;
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .logout-button {
          display: flex;
          flex-direction: row;
          align-items: center;
          padding: 8px 16px;
          gap: 8px;
          width: 71px;
          height: 30px;
          margin: 0 auto;
          background: #27272A;
          border-radius: 8px;
          border: none;
          flex: none;
          order: 1;
          flex-grow: 0;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .logout-button:hover {
          background: #3B3B3F;
        }
        
        .logout-button span {
          width: 39px;
          height: 14px;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          font-size: 12px;
          line-height: 120%;
          letter-spacing: -0.03em;
          color: #A1A1AA;
          flex: none;
          order: 0;
          flex-grow: 0;
        }
        
        .logout-button:hover span {
          color: #FFFFFF;
        }
        
        .loader {
          border: 2px solid #3B3B3F;
          border-top: 2px solid #7A5BF7;
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
        
        .add-memory {
          display: flex;
          flex-direction: column;
          width: 100%;
          box-sizing: border-box;
          background-color: transparent;
          margin-top: 16px;
        }
        
        .add-container {
          display: flex;
          flex-direction: column;
          width: 100%;
          background-color: #18181B;
          border-radius: 8px;
          position: relative;
        }
        
        .memory-textarea {
          width: 100%;
          min-height: 120px;
          background-color: #18181B;
          border: none;
          border-radius: 8px;
          padding: 12px;
          color: #FFFFFF;
          font-family: 'Inter';
          font-size: 14px;
          resize: none;
          outline: none;
        }
        
        .memory-textarea::placeholder {
          color: #71717A;
        }
        
        .arrow-button {
          position: absolute;
          bottom: 12px;
          right: 12px;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: #7A5BF7;
          border-radius: 50%;
          cursor: pointer;
        }

        .input-container {
          width: 100%;
          padding: 0;
          box-sizing: border-box;
        }

        .add-new-memory-btn.active {
          background: #7A5BF7;
        }
        
        .add-new-memory-btn.active span,
        .add-new-memory-btn.active .plus-icon path {
          color: #FFFFFF;
          stroke: #FFFFFF;
        }
    `;
    document.head.appendChild(style);
  }

  // Add these new functions
  function toggleEllipsisMenu(event) {
    event.stopPropagation(); // Prevent the click from bubbling up
    const ellipsisMenu = document.getElementById("ellipsisMenu");
    ellipsisMenu.style.display =
      ellipsisMenu.style.display === "block" ? "none" : "block";

    // Close menu when clicking outside
    document.addEventListener("click", function closeMenu(e) {
      if (
        !ellipsisMenu.contains(e.target) &&
        e.target !== document.getElementById("ellipsisMenuBtn")
      ) {
        ellipsisMenu.style.display = "none";
        document.removeEventListener("click", closeMenu);
      }
    });
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
      const userId = data.userId || "chrome-extension-user";
      chrome.runtime.sendMessage({
        action: "openDashboard",
        url: `https://app.mem0.ai/dashboard/user/${userId}`,
      });
    });
  }

  // Initialize the listener when the script loads
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeMem0Sidebar);
  } else {
    initializeMem0Sidebar();
  }
})();
