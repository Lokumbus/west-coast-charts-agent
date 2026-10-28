# Build from the source root; Core is an explicit public, pinned dependency.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm install --no-save --ignore-scripts --no-audit --no-fund https://github.com/Lokumbus/west-coast-charts-core/releases/download/v1.1.1-rc.7/west-coast-charts-1.1.1-rc.7.tgz
ENV NODE_ENV=production WCC_MCP_TRANSPORT=http HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node
CMD ["node", "packages/mcp/bin/wcc-mcp.js"]
