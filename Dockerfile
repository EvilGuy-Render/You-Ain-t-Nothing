FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# 🚨 FORCE CORRECT BROWSER LOCATION
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
