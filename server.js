const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');

require('dotenv').config();

const app = express();

// More permissive CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

const PORT = process.env.PORT || 3000;
const NOTION_API_KEY = process.env.NOTION_API_KEY;

if (!NOTION_API_KEY) {
  console.error('NOTION_API_KEY is required');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'notion-mcp-server',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      tools: '/mcp/tools',
      execute: '/mcp/execute (POST)'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notion-mcp-server', timestamp: new Date().toISOString() });
});

// MCP tools list endpoint
app.get('/mcp/tools', async (req, res) => {
  try {
    console.log('Tools list requested');
    res.json({
      tools: [
        {
          name: 'notion_search',
          description: 'Search Notion pages and databases',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              filter: { type: 'object', description: 'Optional filter' }
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
              parent_id: { type: 'string', description: 'Parent page or database ID' },
              title: { type: 'string', description: 'Page title' },
              content: { type: 'string', description: 'Page content' }
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
              page_id: { type: 'string', description: 'Page ID' }
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
              page_id: { type: 'string', description: 'Page ID' },
              properties: { type: 'object', description: 'Page properties to update' }
            },
            required: ['page_id', 'properties']
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error in /mcp/tools:', error);
    res.status(500).json({ error: error.message });
  }
});

// MCP tool execution endpoint
app.post('/mcp/execute', async (req, res) => {
  const { tool, arguments: args } = req.body;

  console.log(`Executing tool: ${tool}`, args);

  try {
    let result;

    switch (tool) {
      case 'notion_search':
        result = await notion.search({
          query: args.query,
          filter: args.filter
        });
        break;

      case 'notion_create_page':
        const parent = args.parent_id.includes('-') 
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

      default:
        return res.status(400).json({ error: 'Unknown tool: ' + tool });
    }

    res.json({ result });
  } catch (error) {
    console.error('Tool execution error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Notion MCP Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Notion API Key configured: ${NOTION_API_KEY ? 'Yes' : 'No'}`);
});