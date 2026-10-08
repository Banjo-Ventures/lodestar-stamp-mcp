FROM node:24-alpine
WORKDIR /app
RUN npm install -g lodestar-stamp-mcp@0.1.18 && npm cache clean --force
USER node
ENTRYPOINT ["lodestar-stamp-mcp"]
