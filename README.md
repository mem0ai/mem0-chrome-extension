# Mem0 Chrome Extension — Cross-LLM Memory

Mem0 brings ChatGPT-style memory to all your favorite AI assistants. Share context seamlessly across ChatGPT, Claude, Perplexity, and more, making your AI interactions more personalized and efficient.

<a href="https://chromewebstore.google.com/detail/claude-memory/onihkkbipkfeijkadecaafbgagkhglop?hl=en-GB&utm_source=ext_sidebar" style="display: inline-block; padding: 8px 12px; background-color: white; color: #3c4043; text-decoration: none; font-family: 'Roboto', Arial, sans-serif; font-size: 14px; font-weight: 500; border-radius: 4px; border: 1px solid #dadce0; box-shadow: 0 1px 2px rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);">
  <img src="https://www.google.com/chrome/static/images/chrome-logo.svg" alt="Chrome logo" style="height: 24px; vertical-align: middle; margin-right: 8px;">
  Add to Chrome, It's Free
</a>
<br>
<br>

Built using [Mem0](https://www.mem0.ai) ❤️


## Demo

Watch the Mem0 Chrome Extension in action (full-resolution video available [here](https://www.youtube.com/watch?v=cByzXztn-YY)):

https://github.com/user-attachments/assets/a069a178-631e-4b35-a182-9f4fef7735c4


## Features

- **Universal Memory Layer:** Share context across ChatGPT, Claude, Perplexity, and more
- **Smart Context Detection:** Automatically captures relevant information from your conversations
- **Intelligent Memory Retrieval:** Surfaces relevant memories at the right time
- **One-click sync** with existing ChatGPT memories
- **Memory dashboard** to manage all memories

## Installation

> **Note:** Make sure you have [Node.js](https://nodejs.org/) installed before proceeding.

1. Clone this repository.
2. Navigate to the directory where you cloned the repository.
3. Run `npm install` to install dependencies.
4. Run `npm run build` to build the extension.
5. The built files will be in the `dist` directory.
6. Open Google Chrome and navigate to `chrome://extensions`.
7. Enable "Developer mode" in the top right corner.
8. Click "Load unpacked" and select the `dist` directory containing the extension files.
9. The Mem0 Chrome Extension should now appear in your Chrome toolbar.


## Usage

1. After installation, look for the Mem0 icon in your Chrome toolbar
2. Sign in with Google
3. Start chatting with any supported AI assistant
4. For ChatGPT and Perplexity, just press enter while chatting as you would normally
5. On Claude, click the Mem0 button or use shortcut ^ + M

## ❤️ Free to Use

Mem0 is completely free with:

- No usage limits
- No ads
- All features included

## Configuration

- API Key: Required for connecting to the Mem0 API. Obtain this from your Mem0 Dashboard.
- User ID: Your unique identifier in the Mem0 system. If not provided, it defaults to 'chrome-extension-user'.

## Troubleshooting

If you encounter any issues:

- Check your internet connection
- Verify you're signed in correctly
- Clear your browser cache if needed
- Contact support if issues persist

## Privacy and Data Security

Your messages are sent to the Mem0 API for extracting and retrieving memories.

## Contributing

Contributions to improve Mem0 Chrome Extension are welcome. Please feel free to submit pull requests or open issues for bugs and feature requests.

## License
MIT License
