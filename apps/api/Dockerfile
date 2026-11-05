FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json eslint.config.mjs ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
RUN npm install
RUN npm run build -w @agentops/contracts && npm run build -w @agentops/api

FROM node:22-alpine
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/apps/api ./apps/api
CMD ["node", "apps/api/dist/src/server.js"]
