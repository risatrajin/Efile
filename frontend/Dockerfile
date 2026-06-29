# CloudTax x Ownr frontend — CRA build served by nginx, which also proxies
# /api to the backend so the whole app lives on one domain.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
# Empty backend URL => api.js calls relative "/api" (same origin, nginx proxies
# it to the backend). CI=false so pre-existing lint warnings don't fail build.
ENV REACT_APP_BACKEND_URL=""
ENV CI=false
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
