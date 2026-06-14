FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package.json
RUN npm install --workspaces --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY frontend ./frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
