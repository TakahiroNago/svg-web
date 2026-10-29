FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Converter mode is fixed at build time. Unset means wasm; docker-compose.yml (AWS) passes server.
ARG VITE_CONVERTER_MODE
ARG VITE_API_BASE_URL
ENV VITE_CONVERTER_MODE=${VITE_CONVERTER_MODE}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
