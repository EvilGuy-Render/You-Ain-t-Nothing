FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

# 🚨 FORCE BROWSER INSTALL INSIDE IMAGE
RUN npx playwright install chromium

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
