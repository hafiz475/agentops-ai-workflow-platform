FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json eslint.config.mjs ./
COPY apps/web ./apps/web
RUN npm install
RUN npm run build -w @agentops/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
