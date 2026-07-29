FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package.json
RUN npm install --workspaces --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY package.json tsconfig.base.json ./
COPY frontend ./frontend
# Build with NO frontend/.env in sight, deliberately (issue #73).
#
# .dockerignore keeps frontend/.env in the build context on purpose — the test
# image wants it — but Vite would inline whatever it finds there into the
# bundle, which is exactly the bug: an image pinned to one API origin. Deleting
# it here makes "the image contains no baked origin and no baked Supabase key"
# a property you can verify by grepping dist, not a claim. Configuration is
# supplied at container start instead; see docker-entrypoint.d/.
RUN rm -f frontend/.env frontend/.env.* \
 && npm run build -w frontend

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
# Rendered into /etc/nginx/security-headers.conf by the startup script below,
# which is included by every location block in nginx.conf (see that file).
COPY frontend/security-headers.conf.template /etc/nginx/security-headers.conf.template
# The nginx image runs every executable /docker-entrypoint.d/*.sh before nginx
# starts. This one writes config.js and the CSP from the environment.
COPY frontend/docker-entrypoint.d/10-onboardbuddy-runtime-config.sh /docker-entrypoint.d/
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# chmod because a Windows/zip checkout can lose the exec bit, and the nginx
# entrypoint silently skips non-executable scripts. Running it once here leaves
# the image with a valid, maximally strict, unconfigured pair of outputs, so a
# container started with a custom command still has a CSP and still explains
# itself instead of showing a blank page.
RUN chmod +x /docker-entrypoint.d/10-onboardbuddy-runtime-config.sh \
 && /docker-entrypoint.d/10-onboardbuddy-runtime-config.sh
EXPOSE 80
