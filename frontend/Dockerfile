# frontend/Dockerfile
# Build stage
FROM node:18-bullseye as builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
COPY frontend/ ./
RUN npm install
RUN npm run build

# Production stage (nginx)
FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Optional: add nginx config to proxy /api to backend (see nginx.conf example)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]