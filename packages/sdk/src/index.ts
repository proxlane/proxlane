// @proxlane/sdk: the MCP server that gives an agent a fetch tool through a Proxlane gateway.
// `proxlane-mcp` runs it over stdio; `createServer` embeds it in your own process.
export const PACKAGE_NAME = '@proxlane/sdk';
export { createServer, type ServerConfig } from './server.js';
export { htmlToText, titleOf } from './text.js';
