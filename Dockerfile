FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# optional but safe
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm install

# 🔥 ENSURE BROWSERS ARE PRESENT (CRITICAL)
RUN npx playwright install chromium

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
