# build stage
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# runtime stage
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# nginx конфиг приходит из отдельного nginx-сервиса в compose (prod),
# но если захотим “единый образ”, можно копировать конфиг сюда.
