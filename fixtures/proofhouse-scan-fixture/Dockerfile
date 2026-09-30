FROM node:latest

WORKDIR /app
COPY . .
RUN npm install

# Planted IaC finding: container runs as root (no USER instruction)
EXPOSE 3000
CMD ["node", "src/server.js"]
