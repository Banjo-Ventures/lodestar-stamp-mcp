FROM node:20-alpine
WORKDIR /app
RUN npm install -g lodestar-stamp-mcp@0.1.15
ENTRYPOINT ["lodestar-stamp-mcp"]
