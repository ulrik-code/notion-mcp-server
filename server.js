const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

require('dotenv').config();

const app = express();

// CORS configuration for n8n
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

const PORT = process.env.PORT || 10000;
const NOTION_API_KEY = process.env.NOTION_API_KEY;

if (!NOTION_API_KEY) {
  console.error('NOTION_API_KEY is required');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

// Tool handlers
const listToolsHandler = async () => {
  return {
    tools: [
      {
        name: 'notion_search',
        description: 'Search Notion pages and databases',
        inputSchema: {
          type: 'object',
          properties: {
            query: { 
              type: 'string', 
              description: 'Search query' 
            },
            filter: { 
              type: 'object', 
              description: 'Optional filter object' 
            }
          },
          required: ['query']
        }
      },
      {
        name: 'notion_create_page',
        description: 'Create a new page in Notion',
        inputSchema: {
          type: 'object',
          properties: {
            parent_id: { 
              type: 'string', 
              description: 'Parent page or database ID' 
            },
            title: { 
              type: 'string', 
              description: 'Page title' 
            },
            content: { 
              type: 'string', 
              description: 'Page content (optional)' 
            }
          },
          required: ['parent_id', 'title']
        }
      },
      {
        name: 'notion_get_page',
        description: 'Get a Notion page by ID',
        inputSchema: {
          type: 'object',
          properties: {
            page_id: { 
              type: 'string', 
              description: 'Page ID' 
            }
          },
          required: ['page_id']
        }
      },
      {
        name: 'notion_update_page',
        description: 'Update a Notion page',
        inputSchema: {
          type: 'object',
          properties: {
            page_id: { 
              type: 'string', 
              description: 'Page ID' 
            },
            properties: { 
              type: 'object', 
              description: 'Page properties to update' 
            }
          },
          required: ['page_id', 'properties']
        }
      },
      {
        name: 'notion_list_databases',
        description: 'List all databases the integration has access to',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'notion_query_database',
        description: 'Query a database with filters and sorts',
        inputSchema: {
          type: 'object',
          properties: {
            database_id: {
              type: 'string',
              description: 'Database ID'
            },
            filter: {
              type: 'object',
              description: 'Optional filter object'
            },
            sorts: {
              type: 'array',
              description: 'Optional sort array'
            }
          },
          required: ['database_id']
        }
      }
    ]
  };
};

const callToolHandler = async (request) => {
  const { name, arguments: args } = request.params;

  console.log(`Executing tool: ${name}`, args);

  try {
    let result;

    switch (name) {
      case 'notion_search':
        result = await notion.search({
          query: args.query,
          filter: args.filter || undefined
        });
        break;

      case 'notion_create_page':
        const parent = args.parent_id.includes('-') && args.parent_id.length === 36
          ? { database_id: args.parent_id }
          : { page_id: args.parent_id };
        
        result = await notion.pages.create({
          parent,
          properties: {
            title: {
              title: [{ text: { content: args.title } }]
            }
          },
          children: args.content ? [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: args.content } }]
            }
          }] : []
        });
        break;

      case 'notion_get_page':
        result = await notion.pages.retrieve({ page_id: args.page_id });
        break;

      case 'notion_update_page':
        result = await notion.pages.update({
          page_id: args.page_id,
          properties: args.properties
        });
        break;

      case 'notion_list_databases':
        result = await notion.search({
          filter: {
            property: 'object',
            value: 'database'
          }
        });
        break;

      case 'notion_query_database':
        result = await notion.databases.query({
          database_id: args.database_id,
          filter: args.filter || undefined,
          sorts: args.sorts || undefined
        });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error('Tool execution error:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
};

// Create MCP Server factory
function createMCPServer() {
  const server = new Server(
    {
      name: 'notion-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define Notion tools
  server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
  server.setRequestHandler(CallToolRequestSchema, callToolHandler);

  return server;
}

// Store active SSE connections
const sseConnections = new Map();

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'notion-mcp-server',
    version: '1.0.0',
    protocol: 'MCP',
    protocolVersion: '2025-03-26',
    transports: ['SSE', 'HTTP'],
    endpoints: {
      health: '/health',
      sse: '/sse',
      mcp: '/mcp (POST)',
      message: '/message (POST)'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'notion-mcp-server',
    protocol: 'MCP',
    protocolVersion: '2025-03-26',
    timestamp: new Date().toISOString() 
  });
});

// SSE endpoint for MCP (for SSE-based clients)
app.get('/sse', async (req, res) => {
  console.log('SSE connection established');
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const mcpServer = createMCPServer();
  const transport = new SSEServerTransport('/message', res);
  
  // Store connection
  const connectionId = Date.now().toString();
  sseConnections.set(connectionId, { transport, server: mcpServer });
  
  await mcpServer.connect(transport);
  
  console.log(`MCP server connected via SSE (ID: ${connectionId})`);

  // Handle client disconnect
  req.on('close', () => {
    console.log(`SSE connection closed (ID: ${connectionId})`);
    sseConnections.delete(connectionId);
  });
});

// Message endpoint for SSE transport
app.post('/message', async (req, res) => {
  console.log('Received SSE message:', JSON.stringify(req.body));
  
  // The SSE transport handles the actual message processing
  // This endpoint just needs to acknowledge receipt
  res.status(202).json({ received: true });
});

// Direct MCP HTTP endpoint (for HTTP-based clients like n8n)
app.post('/mcp', async (req, res) => {
  console.log('Received MCP request:', JSON.stringify(req.body, null, 2));
  
  try {
    const request = req.body;
    
    // Handle different MCP methods
    if (request.method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'notion-mcp-server',
            version: '1.0.0'
          }
        }
      });
    } else if (request.method === 'notifications/initialized') {
      // Acknowledge initialized notification
      res.status(200).json({ received: true });
    } else if (request.method === 'tools/list') {
      const result = await listToolsHandler();
      res.json({
        jsonrpc: '2.0',
        id: request.id,
        result
      });
    } else if (request.method === 'tools/call') {
      const result = await callToolHandler(request);
      res.json({
        jsonrpc: '2.0',
        id: request.id,
        result
      });
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`
        }
      });
    }
  } catch (error) {
    console.error('MCP request error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Notion MCP Server running on port ${PORT}`);
  console.log(`Protocol Version: 2025-03-26`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`HTTP MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Notion API Key configured: ${NOTION_API_KEY ? 'Yes' : 'No'}`);
});
